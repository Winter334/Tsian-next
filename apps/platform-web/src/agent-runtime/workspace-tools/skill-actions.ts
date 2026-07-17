import type {
  AgentContextEntry,
  SkillRegistryEntry,
  WorkspaceFile,
} from "@tsian/contracts"
import type {
  RuntimeLoadedSkill,
  RuntimeSkillActionDeclaration,
  RuntimeWorkspaceToolError,
  RuntimeWorkspaceToolExecutionContext,
  RuntimeWorkspaceToolSessionState,
  SkillActionParseResult,
} from "../workspace-tools-types"
import {
  checkActionExecutorPolicy,
  executeSkillAction,
  normalizeActionExecutorReference,
  normalizeActionOutputSchema,
  validateActionInputSchema,
  validateActionOutputSchema,
} from "./action-executors"
import {
  BROWSER_SCRIPT_EXECUTOR_TYPE,
  isRecord,
  normalizedLookupKey,
  normalizeRequiredString,
  toolError,
  traceBase,
} from "./shared"

const SKILL_ACTIONS_FENCE_PATTERN = /```([^\n`]*)\r?\n([\s\S]*?)```/g
const SKILL_ACTIONS_FENCE_LABEL = "tsian-actions"

function normalizeSkillName(value: unknown): string {
  if (typeof value !== "string") {
    throw toolError(
      "SKILL_NAME_REQUIRED",
      "Skill name must be a string.",
    )
  }

  const name = value.trim()
  if (!name) {
    throw toolError(
      "SKILL_NAME_REQUIRED",
      "Skill name is required.",
    )
  }

  return name
}

function skillCandidateDetails(skill: SkillRegistryEntry): Record<string, unknown> {
  const details: Record<string, unknown> = {
    name: skill.name,
    title: skill.title,
    description: skill.description,
    scope: skill.scope,
  }
  if (skill.agentId) {
    details.agentId = skill.agentId
  }
  return details
}

function narrowSkillCandidates(
  candidates: SkillRegistryEntry[],
  agentContext: AgentContextEntry,
): SkillRegistryEntry[] {
  const localCandidates = candidates.filter((skill) =>
    skill.scope === "agent-local" && skill.agentId === agentContext.agent.id
  )

  return localCandidates.length ? localCandidates : candidates
}

function resolveVisibleSkillByName(
  agentContext: AgentContextEntry,
  value: unknown,
): SkillRegistryEntry {
  const requestedName = normalizeSkillName(value)
  const requestedKey = normalizedLookupKey(requestedName)
  const nameMatches = agentContext.skillIndex.filter((skill) =>
    normalizedLookupKey(skill.name) === requestedKey
  )
  const candidates = nameMatches.length
    ? nameMatches
    : agentContext.skillIndex.filter((skill) => normalizedLookupKey(skill.id) === requestedKey)

  if (candidates.length === 0) {
    throw toolError(
      "SKILL_NOT_FOUND",
      `Skill was not found or is not visible to this agent: ${requestedName}`,
    )
  }

  const narrowed = narrowSkillCandidates(candidates, agentContext)
  if (narrowed.length !== 1) {
    throw toolError(
      "SKILL_NAME_AMBIGUOUS",
      `Skill name is ambiguous for this agent: ${requestedName}`,
      {
        candidates: narrowed.map(skillCandidateDetails),
      },
    )
  }

  return narrowed[0]
}

function loadSkillEntryFile(
  files: WorkspaceFile[],
  skill: SkillRegistryEntry,
): WorkspaceFile {
  const file = files.find((candidate) => candidate.path === skill.path)
  if (!file) {
    throw toolError(
      "SKILL_DETAIL_NOT_FOUND",
      `Skill detail file was not found for skill: ${skill.name}`,
    )
  }

  return file
}

export function parseActionDeclarations(content: string): SkillActionParseResult {
  const actions: RuntimeSkillActionDeclaration[] = []
  const errors: RuntimeWorkspaceToolError[] = []
  const seenNames = new Set<string>()

  for (const match of content.matchAll(SKILL_ACTIONS_FENCE_PATTERN)) {
    const info = (match[1] ?? "").toLowerCase()
    if (!info.split(/\s+/).includes(SKILL_ACTIONS_FENCE_LABEL)) {
      continue
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(match[2] ?? "")
    } catch (error) {
      errors.push(toolError(
        "ACTION_DECLARATION_JSON_INVALID",
        error instanceof Error ? error.message : "Action declaration JSON is invalid.",
      ))
      continue
    }

    const rawActions = Array.isArray(parsed) ? parsed : [parsed]
    for (const [index, rawAction] of rawActions.entries()) {
      if (!isRecord(rawAction)) {
        errors.push(toolError(
          "ACTION_DECLARATION_INVALID",
          "Action declaration must be a JSON object.",
          { index },
        ))
        continue
      }

      const name = typeof rawAction.name === "string" ? rawAction.name.trim() : ""
      if (!name) {
        errors.push(toolError(
          "ACTION_DECLARATION_NAME_REQUIRED",
          "Action declaration requires a non-empty string name.",
          { index },
        ))
        continue
      }

      const normalizedName = normalizedLookupKey(name)
      if (seenNames.has(normalizedName)) {
        errors.push(toolError(
          "ACTION_DECLARATION_DUPLICATE",
          `Duplicate action declaration: ${name}`,
          { index, name },
        ))
        continue
      }

      let executor: RuntimeSkillActionDeclaration["executor"]
      try {
        executor = normalizeActionExecutorReference(rawAction.executor, name, index)
      } catch (error) {
        errors.push(isRecord(error) && typeof error.code === "string" && typeof error.message === "string"
          ? {
              code: error.code,
              message: error.message,
              ...(error.details === undefined ? {} : { details: error.details }),
            }
          : toolError(
              "ACTION_EXECUTOR_INVALID",
              error instanceof Error ? error.message : `Action executor is invalid: ${name}`,
              { index, name },
            ))
        continue
      }

      let inputSchema: Record<string, unknown> | undefined
      if (rawAction.inputSchema !== undefined) {
        if (!isRecord(rawAction.inputSchema)) {
          errors.push(toolError(
            "ACTION_INPUT_SCHEMA_INVALID",
            `Action inputSchema must be an object: ${name}`,
            { index, name },
          ))
          continue
        }

        inputSchema = rawAction.inputSchema
      }

      let outputSchema: Record<string, unknown> | undefined
      try {
        outputSchema = normalizeActionOutputSchema(rawAction.outputSchema, name, index)
      } catch (error) {
        errors.push(isRecord(error) && typeof error.code === "string" && typeof error.message === "string"
          ? {
              code: error.code,
              message: error.message,
              ...(error.details === undefined ? {} : { details: error.details }),
            }
          : toolError(
              "ACTION_OUTPUT_SCHEMA_INVALID",
              error instanceof Error ? error.message : `Action outputSchema is invalid: ${name}`,
              { index, name },
            ))
        continue
      }

      const action: RuntimeSkillActionDeclaration = {
        name,
        description: typeof rawAction.description === "string"
          ? rawAction.description.trim()
          : "",
        executor,
        ...(inputSchema ? { inputSchema } : {}),
        ...(outputSchema ? { outputSchema } : {}),
      }

      seenNames.add(normalizedName)
      actions.push(action)
    }
  }

  return { actions, errors }
}

function registerLoadedSkill(
  state: RuntimeWorkspaceToolSessionState | undefined,
  skill: SkillRegistryEntry,
  actions: RuntimeSkillActionDeclaration[],
): void {
  if (!state) {
    return
  }

  const existingIndex = state.loadedSkills.findIndex((entry) => entry.skill.path === skill.path)
  const loadedSkill = { skill, actions }
  if (existingIndex >= 0) {
    state.loadedSkills[existingIndex] = loadedSkill
    return
  }

  state.loadedSkills.push(loadedSkill)
}

function findLoadedSkill(
  state: RuntimeWorkspaceToolSessionState | undefined,
  skillName: string,
): RuntimeLoadedSkill | null {
  if (!state) {
    return null
  }

  const requestedKey = normalizedLookupKey(skillName)
  return state.loadedSkills.find((entry) =>
    normalizedLookupKey(entry.skill.name) === requestedKey
      || normalizedLookupKey(entry.skill.id) === requestedKey
  ) ?? null
}

function findDeclaredAction(
  loadedSkill: RuntimeLoadedSkill,
  actionName: string,
): RuntimeSkillActionDeclaration | null {
  const requestedKey = normalizedLookupKey(actionName)
  return loadedSkill.actions.find((action) => normalizedLookupKey(action.name) === requestedKey) ?? null
}

export function activateSkillByName(
  context: RuntimeWorkspaceToolExecutionContext,
  input: Record<string, unknown>,
): Record<string, unknown> {
  if (!context.agentContext) {
    throw toolError(
      "SKILL_CONTEXT_REQUIRED",
      "use_skill requires an active Agent context.",
    )
  }

  const skill = resolveVisibleSkillByName(context.agentContext, input.name)
  const file = loadSkillEntryFile(context.workspaceFiles, skill)
  const { actions, errors: actionDeclarationErrors } = parseActionDeclarations(file.content)
  registerLoadedSkill(context.sessionState, skill, actions)
  // The full SKILL.md content + inputSchema are returned in the observation this
  // round, so the model can call run_script immediately without waiting for the
  // next-round injectActivatedSkillMessages. Mark the skill path as already
  // injected so collectActivatedSkillContents skips it next round.
  if (context.sessionState) {
    if (!context.sessionState.injectedSkillPaths.includes(skill.path)) {
      context.sessionState.injectedSkillPaths.push(skill.path)
    }
  }
  context.emitTrace?.({
    type: "skill_loaded",
    ...traceBase(context),
    ok: true,
    data: {
      skill: {
        name: skill.name,
        path: skill.path,
      },
      actionCount: actions.length,
      declarationErrorCount: actionDeclarationErrors.length,
    },
  })

  return {
    skill: {
      name: skill.name,
      title: skill.title,
      path: skill.path,
    },
    activated: true,
    content: file.content,
    actions: actions.map((action) => ({
      name: action.name,
      description: action.description,
      ...(action.inputSchema ? { inputSchema: action.inputSchema } : {}),
      executorType: action.executor.type,
      executable: action.executor.type === BROWSER_SCRIPT_EXECUTOR_TYPE,
    })),
    ...(actionDeclarationErrors.length
      ? { actionDeclarationErrors: actionDeclarationErrors.map((error) => error.message) }
      : {}),
  }
}

export interface ActivatedSkillContent {
  name: string
  title: string
  path: string
  content: string
}

/**
 * Collect the full SKILL.md contents of skills activated via use_skill whose
 * content has not yet been injected into the model context this tool loop.
 * Marks each collected skill path as injected in `sessionState` so repeat
 * use_skill calls (registerLoadedSkill upserts by path) do not re-inject.
 *
 * The caller (index.ts tool loops) wraps each entry in a context user message
 * after the round's tool observations, so the model sees the full SKILL.md in
 * the next round without burning a tool-result round on the full text.
 */
export function collectActivatedSkillContents(
  sessionState: RuntimeWorkspaceToolSessionState | undefined,
  workspaceFiles: WorkspaceFile[],
): ActivatedSkillContent[] {
  if (!sessionState) {
    return []
  }

  const contents: ActivatedSkillContent[] = []
  for (const entry of sessionState.loadedSkills) {
    if (sessionState.injectedSkillPaths.includes(entry.skill.path)) {
      continue
    }
    const file = workspaceFiles.find((candidate) => candidate.path === entry.skill.path)
    if (!file) {
      continue
    }
    contents.push({
      name: entry.skill.name,
      title: entry.skill.title,
      path: entry.skill.path,
      content: file.content,
    })
    sessionState.injectedSkillPaths.push(entry.skill.path)
  }
  return contents
}

export async function executeRunScript(
  context: RuntimeWorkspaceToolExecutionContext,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const skillName = normalizeRequiredString(
    input.skill,
    "ACTION_SKILL_REQUIRED",
    "run_script requires a non-empty string skill.",
  )
  const scriptName = normalizeRequiredString(
    input.script,
    "ACTION_NAME_REQUIRED",
    "run_script requires a non-empty string script.",
  )
  const actionInput = input.input === undefined ? {} : input.input
  if (!isRecord(actionInput)) {
    throw toolError(
      "ACTION_INPUT_INVALID",
      "run_script input must be a JSON object when provided.",
    )
  }

  const loadedSkill = findLoadedSkill(context.sessionState, skillName)
  if (!loadedSkill) {
    throw toolError(
      "SKILL_NOT_ACTIVATED",
      `Skill must be activated with use_skill before running its scripts: ${skillName}`,
      { skill: skillName },
    )
  }

  const action = findDeclaredAction(loadedSkill, scriptName)
  if (!action) {
    throw toolError(
      "ACTION_NOT_FOUND",
      `Action is not declared by activated Skill "${loadedSkill.skill.name}": ${scriptName}`,
      {
        skill: loadedSkill.skill.name,
        action: scriptName,
        availableActions: loadedSkill.actions.map((candidate) => ({
          name: candidate.name,
          description: candidate.description,
        })),
      },
    )
  }

  // run_script only executes browser_script actions. workspace operations are
  // done via the top-level workspace.* tools; multi-step orchestration belongs
  // in a browser_script. executor.type is always browser_script after R4, so
  // this guard is defensive against any legacy-registered action.
  if (action.executor.type !== BROWSER_SCRIPT_EXECUTOR_TYPE) {
    throw toolError(
      "ACTION_NOT_BROWSER_SCRIPT",
      `run_script only executes browser_script actions; "${scriptName}" is not browser_script. Use the top-level workspace tools for single operations, or declare a browser_script to orchestrate multi-step workspace operations.`,
      {
        skill: loadedSkill.skill.name,
        action: scriptName,
        executorType: action.executor.type,
      },
    )
  }

  validateActionInputSchema(action.inputSchema, actionInput)
  checkActionExecutorPolicy(context, loadedSkill, action)
  const execution = await executeSkillAction(loadedSkill, action, actionInput, {
    input: actionInput,
    loadedSkill,
    workspaceFiles: context.workspaceFiles,
    agentContext: context.agentContext,
    workspaceMutations: context.workspaceMutations,
    exposedWorkspaceOperations: context.exposedWorkspaceOperations,
    runBrowserScript: context.runBrowserScript,
    signal: context.signal,
  })
  validateActionOutputSchema(action.outputSchema, execution.output, loadedSkill, action)

  return {
    status: execution.status,
    skill: {
      name: loadedSkill.skill.name,
      title: loadedSkill.skill.title,
    },
    action: {
      name: action.name,
    },
    output: execution.output,
  }
}
