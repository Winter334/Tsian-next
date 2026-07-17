import type {
  SkillRegistryEntry,
  ToolRegistryEntry,
} from "@tsian/contracts"
import { summarizeTraceValue } from "../trace"
import type {
  RuntimeActionExecutorContext,
  RuntimeActionExecutorPolicyDecision,
  RuntimeActionExecutorPolicyRequest,
  RuntimeActionExecutorReference,
  RuntimeActionExecutorResult,
  RuntimeLoadedSkill,
  RuntimeSkillActionDeclaration,
  RuntimeWorkspaceToolError,
  RuntimeWorkspaceToolExecutionContext,
} from "../workspace-tools-types"
import {
  BROWSER_SCRIPT_EXECUTOR_TYPE,
  DEFAULT_CONTROLLED_EXECUTOR_TIMEOUT_MS,
  MAX_CONTROLLED_EXECUTOR_TIMEOUT_MS,
  SUPPORTED_ACTION_SCHEMA_TYPES,
  isRecord,
  normalizeWorkspaceFilePath,
  toolError,
  traceBase,
} from "./shared"

export function normalizeExecutorTimeoutMs(
  value: unknown,
  actionName: string,
  index: number,
): number | undefined {
  if (value === undefined) {
    return undefined
  }

  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || value <= 0
  ) {
    throw toolError(
      "ACTION_EXECUTOR_INVALID",
      `Action executor timeoutMs must be a positive finite number: ${actionName}`,
      { index, name: actionName, timeoutMs: value },
    )
  }

  const timeoutMs = Math.floor(value)
  if (timeoutMs > MAX_CONTROLLED_EXECUTOR_TIMEOUT_MS) {
    throw toolError(
      "ACTION_EXECUTOR_INVALID",
      `Action executor timeoutMs exceeds the maximum ${MAX_CONTROLLED_EXECUTOR_TIMEOUT_MS}ms: ${actionName}`,
      {
        index,
        name: actionName,
        timeoutMs,
        maxTimeoutMs: MAX_CONTROLLED_EXECUTOR_TIMEOUT_MS,
      },
    )
  }

  return timeoutMs
}

export function normalizeActionExecutorReference(
  value: unknown,
  actionName: string,
  index: number,
): RuntimeActionExecutorReference {
  if (value === undefined) {
    throw toolError(
      "ACTION_EXECUTOR_INVALID",
      `Action executor is required and must declare type "${BROWSER_SCRIPT_EXECUTOR_TYPE}": ${actionName}`,
      { index, name: actionName },
    )
  }

  if (!isRecord(value)) {
    throw toolError(
      "ACTION_EXECUTOR_INVALID",
      `Action executor must be an object: ${actionName}`,
      { index, name: actionName },
    )
  }

  const type = typeof value.type === "string" ? value.type.trim() : ""
  if (!type) {
    throw toolError(
      "ACTION_EXECUTOR_INVALID",
      `Action executor requires a non-empty string type: ${actionName}`,
      { index, name: actionName },
    )
  }

  if (type !== BROWSER_SCRIPT_EXECUTOR_TYPE) {
    throw toolError(
      "ACTION_EXECUTOR_INVALID",
      `Action executor type "${type}" is no longer supported; only "${BROWSER_SCRIPT_EXECUTOR_TYPE}" is supported: ${actionName}`,
      { index, name: actionName, type },
    )
  }

  const explicitName = typeof value.name === "string" && value.name.trim()
    ? value.name.trim()
    : ""
  const timeoutMs = normalizeExecutorTimeoutMs(value.timeoutMs, actionName, index)

  const path = typeof value.path === "string" && value.path.trim()
    ? value.path.trim()
    : explicitName
  if (!path) {
    throw toolError(
      "ACTION_EXECUTOR_INVALID",
      `Browser script executor requires a non-empty string path: ${actionName}`,
      { index, name: actionName },
    )
  }

  // helpers: optional string array of helper source file paths. Each entry
  // must be a non-empty trimmed string; invalid entries are rejected rather
  // than silently dropped.
  const rawHelpers = Array.isArray(value.helpers) ? value.helpers : undefined
  let helpers: string[] | undefined
  if (rawHelpers !== undefined) {
    const normalized: string[] = []
    for (let i = 0; i < rawHelpers.length; i++) {
      const entry = rawHelpers[i]
      if (typeof entry !== "string" || !entry.trim()) {
        throw toolError(
          "ACTION_EXECUTOR_INVALID",
          `Action executor helpers must be non-empty strings: ${actionName}`,
          { index, name: actionName, helperIndex: i },
        )
      }
      normalized.push(entry.trim())
    }
    if (normalized.length > 0) {
      helpers = normalized
    }
  }

  return {
    type,
    name: explicitName || path,
    path,
    ...(timeoutMs ? { timeoutMs } : {}),
    ...(helpers ? { helpers } : {}),
  }
}

function actionExecutionMetadata(
  loadedSkill: RuntimeLoadedSkill,
  action: RuntimeSkillActionDeclaration,
): RuntimeActionExecutorPolicyRequest {
  return {
    skill: {
      name: loadedSkill.skill.name,
      path: loadedSkill.skill.path,
      scope: loadedSkill.skill.scope,
      ...(loadedSkill.skill.agentId ? { agentId: loadedSkill.skill.agentId } : {}),
    },
    action: {
      name: action.name,
    },
    executor: action.executor,
  }
}

function defaultActionExecutorPolicy(): RuntimeActionExecutorPolicyDecision {
  return {
    enabled: true,
    source: "default",
  }
}

function normalizePolicyDecision(
  value: RuntimeActionExecutorPolicyDecision | boolean,
): RuntimeActionExecutorPolicyDecision {
  if (typeof value === "boolean") {
    return {
      enabled: value,
    }
  }

  if (!isRecord(value) || typeof value.enabled !== "boolean") {
    throw toolError(
      "ACTION_EXECUTOR_POLICY_INVALID",
      "Action executor policy must return a boolean or an object with enabled.",
    )
  }

  return {
    enabled: value.enabled,
    ...(typeof value.reason === "string" && value.reason.trim()
      ? { reason: value.reason.trim() }
      : {}),
    ...(typeof value.source === "string" && value.source.trim()
      ? { source: value.source.trim() }
      : {}),
  }
}

function shouldCheckActionExecutorPolicy(executor: RuntimeActionExecutorReference): boolean {
  // browser_script is the only supported executor after the decouple task; the
  // policy gate only applies to it (subtask 4 wires the actual host policy).
  return executor.type === BROWSER_SCRIPT_EXECUTOR_TYPE
}

export function checkActionExecutorPolicy(
  context: RuntimeWorkspaceToolExecutionContext,
  loadedSkill: RuntimeLoadedSkill,
  action: RuntimeSkillActionDeclaration,
): void {
  if (!shouldCheckActionExecutorPolicy(action.executor)) {
    return
  }

  const request = actionExecutionMetadata(loadedSkill, action)
  let decision: RuntimeActionExecutorPolicyDecision
  try {
    const policy = context.actionExecutorPolicy ?? defaultActionExecutorPolicy
    decision = normalizePolicyDecision(policy(request))
  } catch (error) {
    context.emitTrace?.({
      type: "action_executor_policy_checked",
      ...traceBase(context),
      ok: false,
      data: {
        ...request,
        policy: {
          enabled: false,
          source: "policy-error",
        },
        error: error instanceof Error ? error.message : "Action executor policy failed.",
      },
    })
    throw isRecord(error) && typeof error.code === "string" && typeof error.message === "string"
      ? error
      : toolError(
          "ACTION_EXECUTOR_POLICY_FAILED",
          "Action executor policy failed.",
          {
            ...request,
            policyError: error instanceof Error ? error.message : String(error),
          },
        )
  }

  context.emitTrace?.({
    type: "action_executor_policy_checked",
    ...traceBase(context),
    ok: decision.enabled,
    data: {
      ...request,
      policy: {
        enabled: decision.enabled,
        ...(decision.source ? { source: decision.source } : {}),
        ...(decision.reason ? { reason: decision.reason } : {}),
      },
    },
  })

  if (!decision.enabled) {
    throw toolError(
      "ACTION_EXECUTOR_DISABLED",
      `Action executor is disabled by policy: ${action.executor.type}`,
      {
        ...request,
        policy: {
          enabled: false,
          ...(decision.source ? { source: decision.source } : {}),
          ...(decision.reason ? { reason: decision.reason } : {}),
        },
      },
    )
  }
}

export function normalizeActionOutputSchema(
  value: unknown,
  actionName: string,
  index: number,
): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!isRecord(value)) {
    throw toolError(
      "ACTION_OUTPUT_SCHEMA_INVALID",
      `Action outputSchema must be an object: ${actionName}`,
      { index, name: actionName },
    )
  }

  validateDeclaredActionSchema(value, "outputSchema", actionName, index)
  return value
}

function validateDeclaredActionSchema(
  schema: Record<string, unknown>,
  schemaName: "outputSchema",
  actionName: string,
  index: number,
): void {
  if (
    schema.type !== undefined
    && (
      typeof schema.type !== "string"
      || !SUPPORTED_ACTION_SCHEMA_TYPES.has(schema.type)
    )
  ) {
    throw toolError(
      "ACTION_OUTPUT_SCHEMA_INVALID",
      `Action ${schemaName} has an unsupported root type: ${actionName}`,
      {
        index,
        name: actionName,
        type: schema.type,
        supportedTypes: Array.from(SUPPORTED_ACTION_SCHEMA_TYPES).sort(),
      },
    )
  }

  if (
    schema.required !== undefined
    && (
      !Array.isArray(schema.required)
      || schema.required.some((item) => typeof item !== "string" || !item.trim())
    )
  ) {
    throw toolError(
      "ACTION_OUTPUT_SCHEMA_INVALID",
      `Action ${schemaName} required fields must be non-empty strings: ${actionName}`,
      { index, name: actionName },
    )
  }

  if (schema.properties !== undefined && !isRecord(schema.properties)) {
    throw toolError(
      "ACTION_OUTPUT_SCHEMA_INVALID",
      `Action ${schemaName} properties must be an object: ${actionName}`,
      { index, name: actionName },
    )
  }

  const properties = isRecord(schema.properties) ? schema.properties : {}
  for (const [field, rawPropertySchema] of Object.entries(properties)) {
    if (!isRecord(rawPropertySchema)) {
      throw toolError(
        "ACTION_OUTPUT_SCHEMA_INVALID",
        `Action ${schemaName} property schema must be an object: ${actionName}`,
        { index, name: actionName, field },
      )
    }

    if (
      rawPropertySchema.type !== undefined
      && (
        typeof rawPropertySchema.type !== "string"
        || !SUPPORTED_ACTION_SCHEMA_TYPES.has(rawPropertySchema.type)
      )
    ) {
      throw toolError(
        "ACTION_OUTPUT_SCHEMA_INVALID",
        `Action ${schemaName} property has an unsupported type: ${actionName}.${field}`,
        {
          index,
          name: actionName,
          field,
          type: rawPropertySchema.type,
          supportedTypes: Array.from(SUPPORTED_ACTION_SCHEMA_TYPES).sort(),
        },
      )
    }
  }
}

function schemaTypeMatches(type: string, value: unknown): boolean {
  if (type === "array") return Array.isArray(value)
  if (type === "boolean") return typeof value === "boolean"
  if (type === "integer") return Number.isInteger(value)
  if (type === "null") return value === null
  if (type === "number") return typeof value === "number" && Number.isFinite(value)
  if (type === "object") return isRecord(value)
  if (type === "string") return typeof value === "string"
  return true
}

export function validateActionInputSchema(
  schema: Record<string, unknown> | undefined,
  input: Record<string, unknown>,
): void {
  if (!schema) {
    return
  }

  const rootType = typeof schema.type === "string" ? schema.type : "object"
  if (rootType !== "object") {
    throw toolError(
      "ACTION_INPUT_SCHEMA_UNSUPPORTED",
      "Action inputSchema root type must be object for the MVP.",
      { type: rootType },
    )
  }

  const required = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : []
  for (const field of required) {
    if (input[field] === undefined) {
      throw toolError(
        "ACTION_INPUT_INVALID",
        `Action input is missing required field: ${field}`,
        { field },
      )
    }
  }

  const properties = isRecord(schema.properties) ? schema.properties : {}
  for (const [field, rawPropertySchema] of Object.entries(properties)) {
    if (input[field] === undefined || !isRecord(rawPropertySchema)) {
      continue
    }

    const fieldType = typeof rawPropertySchema.type === "string"
      ? rawPropertySchema.type
      : ""
    if (!fieldType || !SUPPORTED_ACTION_SCHEMA_TYPES.has(fieldType)) {
      continue
    }

    if (!schemaTypeMatches(fieldType, input[field])) {
      throw toolError(
        "ACTION_INPUT_INVALID",
        `Action input field has invalid type: ${field}`,
        {
          field,
          expected: fieldType,
          actual: Array.isArray(input[field]) ? "array" : input[field] === null ? "null" : typeof input[field],
        },
      )
    }
  }
}

function actualSchemaType(value: unknown): string {
  if (Array.isArray(value)) return "array"
  if (value === null) return "null"
  if (Number.isInteger(value)) return "integer"
  return typeof value
}

function outputValidationDetails(
  loadedSkill: RuntimeLoadedSkill,
  action: RuntimeSkillActionDeclaration,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...actionExecutionMetadata(loadedSkill, action),
    ...extra,
  }
}

export function validateActionOutputSchema(
  schema: Record<string, unknown> | undefined,
  output: unknown,
  loadedSkill: RuntimeLoadedSkill,
  action: RuntimeSkillActionDeclaration,
): void {
  if (!schema) {
    return
  }

  const rootType = typeof schema.type === "string" ? schema.type : "object"
  if (!schemaTypeMatches(rootType, output)) {
    throw toolError(
      "ACTION_OUTPUT_INVALID",
      "Action output root value has invalid type.",
      outputValidationDetails(loadedSkill, action, {
        expected: rootType,
        actual: actualSchemaType(output),
        outputSummary: summarizeTraceValue(output),
      }),
    )
  }

  if (rootType !== "object") {
    return
  }

  if (!isRecord(output)) {
    return
  }

  const required = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : []
  for (const field of required) {
    if (output[field] === undefined) {
      throw toolError(
        "ACTION_OUTPUT_INVALID",
        `Action output is missing required field: ${field}`,
        outputValidationDetails(loadedSkill, action, {
          field,
          outputSummary: summarizeTraceValue(output),
        }),
      )
    }
  }

  const properties = isRecord(schema.properties) ? schema.properties : {}
  for (const [field, rawPropertySchema] of Object.entries(properties)) {
    if (output[field] === undefined || !isRecord(rawPropertySchema)) {
      continue
    }

    const fieldType = typeof rawPropertySchema.type === "string"
      ? rawPropertySchema.type
      : ""
    if (!fieldType || !SUPPORTED_ACTION_SCHEMA_TYPES.has(fieldType)) {
      continue
    }

    if (!schemaTypeMatches(fieldType, output[field])) {
      throw toolError(
        "ACTION_OUTPUT_INVALID",
        `Action output field has invalid type: ${field}`,
        outputValidationDetails(loadedSkill, action, {
          field,
          expected: fieldType,
          actual: actualSchemaType(output[field]),
          outputSummary: summarizeTraceValue(output),
        }),
      )
    }
  }
}

function effectiveExecutorTimeoutMs(executor: RuntimeActionExecutorReference): number {
  return executor.timeoutMs ?? DEFAULT_CONTROLLED_EXECUTOR_TIMEOUT_MS
}

function actionExecutorAbortError(
  executor: RuntimeActionExecutorReference,
): RuntimeWorkspaceToolError {
  return toolError(
    "ACTION_EXECUTOR_ABORTED",
    `Action executor was aborted: ${executor.type}/${executor.name}`,
    { executor },
  )
}

function runWithExecutorTimeout<T>(
  executor: RuntimeActionExecutorReference,
  signal: AbortSignal | undefined,
  run: () => Promise<T>,
): Promise<T> {
  if (signal?.aborted) {
    return Promise.reject(actionExecutorAbortError(executor))
  }

  const timeoutMs = effectiveExecutorTimeoutMs(executor)
  return new Promise<T>((resolve, reject) => {
    let settled = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    const cleanup = () => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }
      signal?.removeEventListener("abort", onAbort)
    }

    const settle = (
      callback: typeof resolve | typeof reject,
      value: T | RuntimeWorkspaceToolError,
    ) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      callback(value as never)
    }

    const onAbort = () => {
      settle(reject, actionExecutorAbortError(executor))
    }

    timeoutId = setTimeout(() => {
      settle(reject, toolError(
        "ACTION_EXECUTOR_TIMEOUT",
        `Action executor timed out after ${timeoutMs}ms: ${executor.type}/${executor.name}`,
        { executor, timeoutMs },
      ))
    }, timeoutMs)

    signal?.addEventListener("abort", onAbort, { once: true })

    try {
      run().then(
        (result) => settle(resolve, result),
        (error) => settle(reject, error),
      )
    } catch (error) {
      settle(reject, error as RuntimeWorkspaceToolError)
    }
  })
}

function skillDirectoryPath(skillPath: string): string {
  const slashIndex = skillPath.lastIndexOf("/")
  return slashIndex >= 0 ? skillPath.slice(0, slashIndex) : ""
}

export function resolveBrowserScriptPath(
  skill: SkillRegistryEntry,
  executor: RuntimeActionExecutorReference,
): string {
  const rawPath = executor.path || executor.name
  const normalizedPath = normalizeWorkspaceFilePath(rawPath)
  const skillDirectory = skillDirectoryPath(skill.path)
  if (!skillDirectory) {
    throw toolError(
      "BROWSER_SCRIPT_PATH_INVALID",
      `Browser script executor requires a skill directory: ${skill.name}`,
      { executor, skillPath: skill.path },
    )
  }

  const resolvedPath = normalizedPath.startsWith(`${skillDirectory}/`)
    ? normalizedPath
    : `${skillDirectory}/${normalizedPath}`

  if (!resolvedPath.startsWith(`${skillDirectory}/`)) {
    throw toolError(
      "BROWSER_SCRIPT_PATH_INVALID",
      `Browser script path must stay under the declaring Skill directory: ${executor.name}`,
      {
        executor,
        skillPath: skill.path,
        resolvedPath,
      },
    )
  }

  return resolvedPath
}

/**
 * Resolve a helper source file path declared by `executor.helpers`.
 *
 * Path resolution:
 * - Relative path (`_common.js`, `./foo.js`, `sub/bar.js`, `../foo.js`):
 *   relative to the declaring Skill's `scripts/` directory.
 * - Workspace-root path (`/agents/...`, `agents/...`, `skills/...`, `save/...`, ...):
 *   resolved from workspace root. Allowed but discouraged — breaks Skill
 *   self-containment.
 *
 * Relative helpers must stay under the declaring Skill directory after segment
 * resolution. Returns the absolute workspace path. Does NOT verify the file
 * exists — existence is checked by the executor when it reads the file.
 */
const WORKSPACE_ROOT_HELPER_PREFIXES = new Set([
  ".tsian",
  "agents",
  "docs",
  "frontend",
  "save",
  "skills",
  "tools",
])

function resolveWorkspacePathFromBase(basePath: string, rawPath: string): string {
  const baseSegments = basePath.split("/").filter(Boolean)
  const rawSegments = rawPath
    .trim()
    .replace(/\\/g, "/")
    .split("/")

  const stack = [...baseSegments]
  for (const segment of rawSegments) {
    if (!segment || segment === ".") continue
    if (segment === "..") {
      stack.pop()
      continue
    }
    stack.push(segment)
  }

  return normalizeWorkspaceFilePath(stack.join("/"))
}

function isWorkspaceRootHelperPath(rawPath: string, normalizedPath: string, skillDirectory: string): boolean {
  if (rawPath.trim().startsWith("/")) return true
  if (normalizedPath.startsWith(`${skillDirectory}/`)) return true
  const [firstSegment] = normalizedPath.split("/")
  return !!firstSegment && WORKSPACE_ROOT_HELPER_PREFIXES.has(firstSegment)
}

export function resolveHelperPath(
  skillPath: string,
  skillName: string,
  helperPath: string,
): string {
  const skillDirectory = skillDirectoryPath(skillPath)
  if (!skillDirectory) {
    throw toolError(
      "BROWSER_SCRIPT_PATH_INVALID",
      `Helper resolution requires a skill directory: ${skillName}`,
      { helperPath, skillPath },
    )
  }

  const normalized = normalizeWorkspaceFilePath(helperPath)
  if (isWorkspaceRootHelperPath(helperPath, normalized, skillDirectory)) {
    return normalized
  }

  const scriptsDirectory = `${skillDirectory}/scripts`
  const resolved = resolveWorkspacePathFromBase(scriptsDirectory, helperPath)
  if (!resolved.startsWith(`${skillDirectory}/`)) {
    throw toolError(
      "BROWSER_SCRIPT_PATH_INVALID",
      `Helper path must stay under the declaring Skill directory: ${helperPath}`,
      { helperPath, skillPath, resolved },
    )
  }
  return resolved
}

export async function executeSkillAction(
  loadedSkill: RuntimeLoadedSkill,
  action: RuntimeSkillActionDeclaration,
  input: Record<string, unknown>,
  context: RuntimeActionExecutorContext,
): Promise<RuntimeActionExecutorResult> {
  // After the tool/skill decouple task, browser_script is the only supported
  // action executor. run_script validates executor.type === browser_script at
  // its entry, so reaching a non-browser_script type here means the action was
  // registered through a legacy path; reject with an explicit unsupported code.
  if (action.executor.type !== BROWSER_SCRIPT_EXECUTOR_TYPE) {
    throw toolError(
      "ACTION_EXECUTOR_UNSUPPORTED",
      `Action executor type is not supported: ${action.executor.type}`,
      { executor: action.executor },
    )
  }

  if (!context.runBrowserScript) {
    throw toolError(
      "BROWSER_SCRIPT_UNAVAILABLE",
      "Browser script executor is not available in this runtime.",
      { executor: action.executor },
    )
  }

  const scriptPath = resolveBrowserScriptPath(loadedSkill.skill, action.executor)
  if (!context.workspaceFiles.some((file) => file.path === scriptPath)) {
    throw toolError(
      "BROWSER_SCRIPT_NOT_FOUND",
      `Browser script file was not found: ${scriptPath}`,
      {
        executor: action.executor,
        scriptPath,
        skillPath: loadedSkill.skill.path,
      },
    )
  }

  const result = await runWithExecutorTimeout(
    action.executor,
    context.signal,
    () => context.runBrowserScript?.(
      {
        skillName: loadedSkill.skill.name,
        skillPath: loadedSkill.skill.path,
        actionName: action.name,
        scriptPath,
        input,
        timeoutMs: effectiveExecutorTimeoutMs(action.executor),
        ...(action.executor.helpers && action.executor.helpers.length > 0
          ? { helpers: action.executor.helpers }
          : {}),
        // Carry declared config items (defaults included) so the executor can
        // merge player overrides and inject `tsian.config`. Omitted when the
        // skill declares no config (keeps `tsian.config` an empty object).
        ...(loadedSkill.skill.configItems && loadedSkill.skill.configItems.length > 0
          ? { configItems: loadedSkill.skill.configItems }
          : {}),
      },
      {
        agentContext: context.agentContext,
        exposedWorkspaceOperations: context.exposedWorkspaceOperations,
      },
    ) ?? Promise.resolve({
      ok: false,
      error: {
        code: "BROWSER_SCRIPT_UNAVAILABLE",
        message: "Browser script executor is not available in this runtime.",
      },
    }),
  )
  if (!result.ok) {
    throw toolError(
      result.error?.code ?? "BROWSER_SCRIPT_FAILED",
      result.error?.message ?? `Browser script failed: ${scriptPath}`,
      {
        executor: action.executor,
        scriptPath,
        scriptError: result.error ?? null,
      },
    )
  }

  return {
    status: "executed",
    output: result.item ?? null,
  }
}

/**
 * Execute a user-defined Tool call. Mirrors `executeSkillAction` but sources
 * the executor reference from `ToolRegistryEntry.executor` (already resolved
 * to `directoryPath + executor.path`) and passes owner metadata so the
 * browser-script executor validates paths against the Tool root, not a Skill
 * directory.
 *
 * The Tool must be visible to the calling Agent (already filtered by
 * `filterToolsForAgent` when the schema was injected). We re-check by name
 * against `context.agentContext.toolIndex` for defense in depth — a stray call
 * to a Tool the Agent cannot see is treated as unsupported.
 *
 * `tsian.config` is always empty for Tools (PRD R12) — no configItems threaded.
 * `outputSchema` validation is deferred (see task PRD Notes & implement.md §7
 * rollback point).
 */
export async function executeUserTool(
  context: RuntimeWorkspaceToolExecutionContext,
  tool: ToolRegistryEntry,
  input: Record<string, unknown>,
): Promise<Record<string, unknown> | null | boolean | number | string> {
  if (!context.runBrowserScript) {
    throw toolError(
      "BROWSER_SCRIPT_UNAVAILABLE",
      "Browser script executor is not available in this runtime.",
      { tool: tool.name },
    )
  }

  if (tool.executor.type !== BROWSER_SCRIPT_EXECUTOR_TYPE) {
    throw toolError(
      "TOOL_EXECUTOR_UNSUPPORTED",
      `Tool executor type is not supported: ${tool.executor.type}`,
      { tool: tool.name, executor: tool.executor },
    )
  }

  // Resolve script path relative to the Tool directory. Same normalization
  // as Skills but rooted at directoryPath instead of the Skill's dir.
  const rawPath = tool.executor.path
  const stripped = rawPath.startsWith("./") ? rawPath.slice(2) : rawPath
  const combined = stripped.startsWith(`${tool.directoryPath}/`)
    ? stripped
    : `${tool.directoryPath}/${stripped}`
  const scriptPath = combined

  if (!context.workspaceFiles.some((file) => file.path === scriptPath)) {
    throw toolError(
      "TOOL_SCRIPT_NOT_FOUND",
      `Tool script file was not found: ${scriptPath}`,
      { tool: tool.name, scriptPath, directoryPath: tool.directoryPath },
    )
  }

  const timeoutMs = tool.executor.timeoutMs ?? DEFAULT_CONTROLLED_EXECUTOR_TIMEOUT_MS
  const executorRef: RuntimeActionExecutorReference = {
    type: BROWSER_SCRIPT_EXECUTOR_TYPE,
    name: tool.name,
    path: tool.executor.path,
    ...(tool.executor.timeoutMs !== undefined ? { timeoutMs: tool.executor.timeoutMs } : {}),
    ...(tool.executor.helpers && tool.executor.helpers.length > 0
      ? { helpers: tool.executor.helpers }
      : {}),
  }

  const result = await runWithExecutorTimeout(
    executorRef,
    context.signal,
    () => context.runBrowserScript!(
      {
        ownerType: "tool",
        rootDirectory: tool.directoryPath,
        // Reuse the skillName/skillPath slots for tool identity so trace events
        // keep a consistent label column. The executor branches on ownerType.
        skillName: tool.name,
        skillPath: tool.path,
        actionName: tool.name,
        scriptPath,
        input,
        timeoutMs,
        ...(tool.executor.helpers && tool.executor.helpers.length > 0
          ? { helpers: tool.executor.helpers }
          : {}),
        // Tools never carry configItems — tsian.config is `{}` by design.
      },
      {
        agentContext: context.agentContext,
        exposedWorkspaceOperations: context.exposedWorkspaceOperations,
      },
    ),
  )

  if (!result.ok) {
    throw toolError(
      result.error?.code ?? "TOOL_SCRIPT_FAILED",
      result.error?.message ?? `Tool script failed: ${scriptPath}`,
      {
        tool: tool.name,
        scriptPath,
        scriptError: result.error ?? null,
      },
    )
  }

  const output = result.item
  if (output === undefined || output === null) return null
  if (
    typeof output === "boolean" ||
    typeof output === "number" ||
    typeof output === "string" ||
    (typeof output === "object" && output !== null)
  ) {
    return output as Record<string, unknown>
  }
  return null
}
