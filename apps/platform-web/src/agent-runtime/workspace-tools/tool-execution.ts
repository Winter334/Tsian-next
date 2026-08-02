import type {
  AskUserRequest,
  ToolRegistryEntry,
  WorkspaceOperationName,
  WorkspaceOperationRequest,
} from "@tsian/contracts"
import { executeWorkspaceOperation } from "../workspace-operations"
import {
  RUNTIME_WORKSPACE_TOOL_NAMES,
  isWorkspaceOperationToolName,
  type InspectDomAction,
  type InspectDomActionType,
  type InspectFrontendInput,
  type InspectFrontendWaitMode,
  type ParsedRuntimeWorkspaceToolCall,
  type RuntimeTestSkillScriptInput,
  type RuntimeDiagnosticsQueryInput,
  type RuntimeWorkspaceToolCall,
  type RuntimeWorkspaceToolExecutionContext,
  type RuntimeWorkspaceToolObservation,
} from "../workspace-tools-types"
import { normalizeAgentCallArguments } from "./agent-call"
import { executeUserTool } from "./action-executors"
import { buildToolPresentation, projectToolObservationForAgent } from "./observations"
import { activateSkillByName, executeRunScript } from "./skill-actions"
import { isRecord, normalizeRequiredString, toolError } from "./shared"

function normalizeDiagnosticsQueryArguments(
  input: Record<string, unknown>,
): RuntimeDiagnosticsQueryInput {
  const operation = input.operation
  if (operation !== "list" && operation !== "search" && operation !== "read") {
    throw toolError(
      "DIAGNOSTICS_OPERATION_INVALID",
      "query_diagnostics operation must be list, search, or read.",
    )
  }
  const allowed = new Set(operation === "list"
    ? ["operation", "recordType", "status", "provider", "model", "operationId", "limit"]
    : operation === "search"
      ? ["operation", "query", "recordType", "limit"]
      : ["operation", "id", "section", "offset", "limit"])
  const unknown = Object.keys(input).find((key) => !allowed.has(key))
  if (unknown) {
    throw toolError(
      "DIAGNOSTICS_ARGUMENT_UNKNOWN",
      `query_diagnostics ${operation} received an unknown argument: ${unknown}.`,
    )
  }
  if (
    input.recordType !== undefined
    && input.recordType !== "ai-request"
    && input.recordType !== "frontend-error"
  ) {
    throw toolError("DIAGNOSTICS_RECORD_TYPE_INVALID", "query_diagnostics recordType is invalid.")
  }
  if (operation === "search") {
    return {
      operation,
      query: normalizeRequiredString(
        input.query,
        "DIAGNOSTICS_QUERY_REQUIRED",
        "query_diagnostics search query must be a non-empty string.",
      ),
      ...(input.recordType === "ai-request" || input.recordType === "frontend-error"
        ? { recordType: input.recordType }
        : {}),
      ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
    }
  }
  if (operation === "read") {
    const section = input.section
    if (
      section !== undefined
      && section !== "summary"
      && section !== "error"
      && section !== "attempts"
      && section !== "request"
      && section !== "response"
    ) {
      throw toolError("DIAGNOSTICS_SECTION_INVALID", "query_diagnostics read section is invalid.")
    }
    return {
      operation,
      id: normalizeRequiredString(
        input.id,
        "DIAGNOSTICS_ID_REQUIRED",
        "query_diagnostics read id must be a non-empty string.",
      ),
      ...(section ? { section } : {}),
      ...(typeof input.offset === "number" ? { offset: input.offset } : {}),
      ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
    }
  }
  if (
    input.status !== undefined
    && input.status !== "running"
    && input.status !== "succeeded"
    && input.status !== "failed"
    && input.status !== "aborted"
    && input.status !== "interrupted"
  ) {
    throw toolError("DIAGNOSTICS_STATUS_INVALID", "query_diagnostics status is invalid.")
  }
  return {
    operation,
    ...(input.recordType === "ai-request" || input.recordType === "frontend-error"
      ? { recordType: input.recordType }
      : {}),
    ...(typeof input.status === "string" ? { status: input.status } : {}),
    ...(typeof input.provider === "string" ? { provider: input.provider } : {}),
    ...(typeof input.model === "string" ? { model: input.model } : {}),
    ...(typeof input.operationId === "string" ? { operationId: input.operationId } : {}),
    ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
  }
}
import { emitToolObservationTrace } from "./tracing"

function normalizeTestSkillScriptArguments(
  input: Record<string, unknown>,
): RuntimeTestSkillScriptInput {
  const skillName = normalizeRequiredString(
    input.skillName,
    "TEST_SKILL_SCRIPT_SKILL_NAME_REQUIRED",
    "test_skill_script skillName must be a non-empty string.",
  )
  const actionName = normalizeRequiredString(
    input.actionName,
    "TEST_SKILL_SCRIPT_ACTION_NAME_REQUIRED",
    "test_skill_script actionName must be a non-empty string.",
  )
  if (!isRecord(input.input)) {
    throw toolError(
      "TEST_SKILL_SCRIPT_INPUT_INVALID",
      "test_skill_script input must be an object.",
    )
  }
  return { skillName, actionName, input: input.input }
}

function normalizeAskUserArguments(input: Record<string, unknown>): AskUserRequest {
  const question = normalizeRequiredString(
    input.question,
    "ASK_USER_QUESTION_REQUIRED",
    "ask_user question must be a non-empty string.",
  )
  const request: AskUserRequest = { question }

  if (input.options !== undefined) {
    if (!Array.isArray(input.options)) {
      throw toolError(
        "ASK_USER_OPTIONS_INVALID",
        "ask_user options must be an array of strings.",
      )
    }
    const options: string[] = []
    for (const opt of input.options) {
      if (typeof opt !== "string" || !opt) {
        throw toolError(
          "ASK_USER_OPTION_INVALID",
          "ask_user options entries must be non-empty strings.",
        )
      }
      options.push(opt)
    }
    if (options.length > 0) request.options = options
  }

  if (input.allowCustom !== undefined) {
    if (typeof input.allowCustom !== "boolean") {
      throw toolError(
        "ASK_USER_ALLOW_CUSTOM_INVALID",
        "ask_user allowCustom must be a boolean.",
      )
    }
    request.allowCustom = input.allowCustom
  }

  return request
}

const INSPECT_FRONTEND_WAIT_MODES = new Set<InspectFrontendWaitMode>([
  "runtime-settled",
  "dom-stable",
])
const INSPECT_FRONTEND_OPERATIONS = new Set(["inspect", "finish"])
const INSPECT_FRONTEND_REMOVED_FIELDS = new Set([
  "send",
  "refresh",
  "runtime",
  "screenshot",
])
const INSPECT_FRONTEND_ALLOWED_FIELDS = new Set([
  "operation",
  "actions",
  "observeBetween",
  "autoWait",
  "wait",
  "timeoutMs",
])
const INSPECT_DOM_ACTION_TYPES = new Set<InspectDomActionType>([
  "click",
  "type",
  "press",
  "scroll",
  "selectOption",
  "check",
  "fill",
  "hover",
  "focus",
])
const INSPECT_SCROLL_TARGETS = new Set(["top", "bottom"])

function normalizeInspectFrontendArguments(
  input: Record<string, unknown>,
): InspectFrontendInput {
  for (const key of Object.keys(input)) {
    if (INSPECT_FRONTEND_REMOVED_FIELDS.has(key)) {
      throw toolError(
        "INSPECT_FRONTEND_ARGUMENT_REMOVED",
        `inspect_frontend ${key} is no longer supported. Operate the current Play iframe through actions.`,
      )
    }
    if (!INSPECT_FRONTEND_ALLOWED_FIELDS.has(key)) {
      throw toolError(
        "INSPECT_FRONTEND_ARGUMENT_UNKNOWN",
        `inspect_frontend received an unknown argument: ${key}.`,
      )
    }
  }

  const operation = input.operation ?? "inspect"
  if (
    typeof operation !== "string"
    || !INSPECT_FRONTEND_OPERATIONS.has(operation)
  ) {
    throw toolError(
      "INSPECT_FRONTEND_OPERATION_INVALID",
      "inspect_frontend operation must be one of: inspect, finish.",
    )
  }
  const result: InspectFrontendInput = {
    operation: operation as "inspect" | "finish",
  }

  if (input.actions !== undefined) {
    if (!Array.isArray(input.actions)) {
      throw toolError(
        "INSPECT_FRONTEND_ACTIONS_INVALID",
        "inspect_frontend actions must be an array.",
      )
    }
    result.actions = input.actions.map((raw, i) => {
      if (!isRecord(raw)) {
        throw toolError(
          "INSPECT_FRONTEND_ACTION_INVALID",
          `inspect_frontend actions[${i}] must be an object.`,
        )
      }
      const type = raw.type
      if (
        typeof type !== "string"
        || !INSPECT_DOM_ACTION_TYPES.has(type as InspectDomActionType)
      ) {
        throw toolError(
          "INSPECT_FRONTEND_ACTION_TYPE_INVALID",
          `inspect_frontend actions[${i}].type must be one of: click, type, press, scroll, selectOption, check, fill, hover, focus.`,
        )
      }
      const selector = normalizeRequiredString(
        raw.selector,
        "INSPECT_FRONTEND_SELECTOR_REQUIRED",
        `inspect_frontend actions[${i}].selector must be a non-empty string.`,
      )
      const action: InspectDomAction = {
        type: type as InspectDomActionType,
        selector,
      }
      if (raw.text !== undefined) {
        if (typeof raw.text !== "string") {
          throw toolError(
            "INSPECT_FRONTEND_ACTION_TEXT_INVALID",
            `inspect_frontend actions[${i}].text must be a string.`,
          )
        }
        action.text = raw.text
      }
      if (raw.key !== undefined) {
        if (typeof raw.key !== "string" || !raw.key) {
          throw toolError(
            "INSPECT_FRONTEND_ACTION_KEY_INVALID",
            `inspect_frontend actions[${i}].key must be a non-empty string.`,
          )
        }
        action.key = raw.key
      }
      if (raw.to !== undefined) {
        if (
          typeof raw.to !== "string"
          || !INSPECT_SCROLL_TARGETS.has(raw.to)
        ) {
          throw toolError(
            "INSPECT_FRONTEND_ACTION_SCROLL_INVALID",
            `inspect_frontend actions[${i}].to must be top or bottom.`,
          )
        }
        action.to = raw.to as "top" | "bottom"
      }
      if (raw.value !== undefined) {
        if (typeof raw.value !== "string") {
          throw toolError(
            "INSPECT_FRONTEND_ACTION_VALUE_INVALID",
            `inspect_frontend actions[${i}].value must be a string.`,
          )
        }
        action.value = raw.value
      }
      if (raw.label !== undefined) {
        if (typeof raw.label !== "string") {
          throw toolError(
            "INSPECT_FRONTEND_ACTION_LABEL_INVALID",
            `inspect_frontend actions[${i}].label must be a string.`,
          )
        }
        action.label = raw.label
      }
      if (raw.checked !== undefined) {
        if (typeof raw.checked !== "boolean") {
          throw toolError(
            "INSPECT_FRONTEND_ACTION_CHECKED_INVALID",
            `inspect_frontend actions[${i}].checked must be a boolean.`,
          )
        }
        action.checked = raw.checked
      }
      return action
    })
  }

  if (input.observeBetween !== undefined) {
    if (typeof input.observeBetween !== "boolean") {
      throw toolError(
        "INSPECT_FRONTEND_OBSERVE_BETWEEN_INVALID",
        "inspect_frontend observeBetween must be a boolean.",
      )
    }
    result.observeBetween = input.observeBetween
  }
  if (input.autoWait !== undefined) {
    if (typeof input.autoWait !== "boolean") {
      throw toolError(
        "INSPECT_FRONTEND_AUTO_WAIT_INVALID",
        "inspect_frontend autoWait must be a boolean.",
      )
    }
    result.autoWait = input.autoWait
  }

  if (input.wait !== undefined) {
    if (
      typeof input.wait !== "string"
      || !INSPECT_FRONTEND_WAIT_MODES.has(input.wait as InspectFrontendWaitMode)
    ) {
      throw toolError(
        "INSPECT_FRONTEND_WAIT_INVALID",
        "inspect_frontend wait must be runtime-settled or dom-stable.",
      )
    }
    result.wait = input.wait as "runtime-settled" | "dom-stable"
  }

  if (input.timeoutMs !== undefined) {
    if (
      !Number.isInteger(input.timeoutMs)
      || (input.timeoutMs as number) <= 0
      || (input.timeoutMs as number) > 900_000
    ) {
      throw toolError(
        "INSPECT_FRONTEND_TIMEOUT_INVALID",
        "inspect_frontend timeoutMs must be an integer between 1 and 900000.",
      )
    }
    if (result.wait !== "runtime-settled") {
      throw toolError(
        "INSPECT_FRONTEND_TIMEOUT_WITHOUT_WAIT",
        "inspect_frontend timeoutMs requires wait=runtime-settled.",
      )
    }
    result.timeoutMs = input.timeoutMs as number
  }

  if (result.operation === "finish") {
    const conflicting = [
      "actions",
      "observeBetween",
      "autoWait",
      "wait",
      "timeoutMs",
    ].filter((key) => input[key] !== undefined)
    if (conflicting.length > 0) {
      throw toolError(
        "INSPECT_FINISH_ARGUMENT_CONFLICT",
        `inspect_frontend finish cannot be combined with: ${conflicting.join(", ")}.`,
      )
    }
  }

  return result
}

function workspaceOperationRequestFromToolCall(
  call: RuntimeWorkspaceToolCall,
): WorkspaceOperationRequest {
  // Tool name equals operation name after the R1 rename (e.g. `read` → "read").
  // The `workspace.` prefix was removed; the SDK RPC path in
  // `browser-skill-script-executor.ts` / `platform-host/index.ts` still slices
  // `workspace.` but that is a separate wire protocol, not this tool path.
  const operation = call.name as WorkspaceOperationName
  return {
    ...call.arguments,
    operation,
  } as WorkspaceOperationRequest
}

/**
 * Look up a Tool visible to the Agent by wire name. Returns `undefined` when
 * no Tool exists — the caller can decide whether to fall through to the
 * unsupported-tool branch or emit a stricter error.
 */
function resolveVisibleToolByName(
  context: RuntimeWorkspaceToolExecutionContext,
  name: string,
): ToolRegistryEntry | undefined {
  const tools = context.agentContext?.toolIndex
  if (!tools || tools.length === 0) return undefined
  return tools.find((entry) => entry.name === name)
}

async function executeRuntimeWorkspaceToolCall(
  context: RuntimeWorkspaceToolExecutionContext,
  parsed: ParsedRuntimeWorkspaceToolCall,
  index: number,
): Promise<RuntimeWorkspaceToolObservation> {
  if (parsed.error) {
    return {
      index,
      name: "invalid",
      ok: false,
      error: parsed.error,
    }
  }

  const call = parsed.call
  if (!call) {
    return {
      index,
      name: "invalid",
      ok: false,
      error: toolError(
        "TOOL_CALL_INVALID",
        "Tool call was not parsed.",
      ),
    }
  }

  // Turn-tool event (子2b R2): notify the caller the tool is about to run.
  // callId uses the provider-assigned id (native) or falls back to `tool-${index}`.
  const callId = call.id ?? `tool-${index}`
  const visibleTool = resolveVisibleToolByName(context, call.name)
  const displayName = visibleTool?.title
  context.onTool?.(callId, call.name, "loading", undefined, displayName)

  const toolStartedAt = Date.now()
  let observation: RuntimeWorkspaceToolObservation
  try {
    if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.useSkill) {
      observation = {
        index,
        name: call.name,
        ok: true,
        result: activateSkillByName(context, call.arguments),
      }
    } else if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.runScript) {
      observation = {
        index,
        name: call.name,
        ok: true,
        result: await executeRunScript(context, call.arguments),
      }
    } else if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.agentCall) {
      if (!context.agentContext) {
        throw toolError(
          "AGENT_CALL_CONTEXT_REQUIRED",
          "agent_call requires an active Agent context.",
        )
      }
      if (!context.runAgentCall) {
        throw toolError(
          "AGENT_CALL_UNAVAILABLE",
          "agent_call is not available in this Agent step.",
        )
      }
      observation = {
        index,
        name: call.name,
        ok: true,
        result: await context.runAgentCall(normalizeAgentCallArguments(call.arguments)),
      }
    } else if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.inspectFrontend) {
      if (!context.runInspectFrontend) {
        throw toolError(
          "INSPECT_FRONTEND_UNAVAILABLE",
          "inspect_frontend is not available in this Agent step.",
        )
      }
      observation = {
        index,
        name: call.name,
        ok: true,
        result: await context.runInspectFrontend(
          normalizeInspectFrontendArguments(call.arguments),
        ),
      }
    } else if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.queryDiagnostics) {
      if (!context.runQueryDiagnostics) {
        throw toolError(
          "QUERY_DIAGNOSTICS_UNAVAILABLE",
          "query_diagnostics is not available in this Agent step.",
        )
      }
      observation = {
        index,
        name: call.name,
        ok: true,
        result: await context.runQueryDiagnostics(
          normalizeDiagnosticsQueryArguments(call.arguments),
        ),
      }
    } else if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.askUser) {
      if (!context.onAskUser) {
        throw toolError(
          "ASK_USER_UNAVAILABLE",
          "ask_user is not available in this Agent step.",
        )
      }
      const requestId = (crypto.randomUUID?.() ?? `ask-${index}-${Date.now()}`)
      const request = normalizeAskUserArguments(call.arguments)
      const result = await context.onAskUser(requestId, request)
      observation = {
        index,
        name: call.name,
        ok: true,
        result: result,
      }
    } else if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.testSkillScript) {
      if (!context.runTestSkillScript) {
        throw toolError(
          "TEST_SKILL_SCRIPT_UNAVAILABLE",
          "test_skill_script is not available in this Agent step.",
        )
      }
      observation = {
        index,
        name: call.name,
        ok: true,
        result: await context.runTestSkillScript(
          normalizeTestSkillScriptArguments(call.arguments),
          {
            agentContext: context.agentContext,
            exposedWorkspaceOperations: context.exposedWorkspaceOperations,
            workspaceFileFilter: context.workspaceFileFilter,
            virtualWorkspaceReads: context.virtualWorkspaceReads,
          },
        ),
      }
    } else if (isWorkspaceOperationToolName(call.name)) {
      const opResult = await executeWorkspaceOperation(
        workspaceOperationRequestFromToolCall(call),
        {
          workspaceFiles: context.workspaceFiles,
          agentContext: context.agentContext,
          mutations: context.workspaceMutations,
          exposedOperations: context.exposedWorkspaceOperations,
          fileFilter: context.workspaceFileFilter,
          semanticSearchOwnerId: context.semanticSearchOwnerId,
          virtualReads: context.virtualWorkspaceReads,
        },
      )
      // workspace_read 图片结果:提取 imageBase64 到 imageParts(多模态通道),
      // 从 result 清除 imageBase64(避免 base64 进 JSON text observation 爆上下文).
      observation = {
        index,
        name: call.name,
        ok: true,
        result: opResult,
      }
      if (
        call.name === RUNTIME_WORKSPACE_TOOL_NAMES.read
        && isRecord(opResult)
        && typeof opResult.imageBase64 === "string"
        && typeof opResult.imageMimeType === "string"
      ) {
        observation.imageParts = [
          { type: "image", mimeType: opResult.imageMimeType as string, data: opResult.imageBase64 as string },
        ]
        // 从 result 里删掉 imageBase64 + binary(不进 JSON observation)
        const stripped = { ...opResult }
        delete (stripped as Record<string, unknown>).imageBase64
        delete (stripped as Record<string, unknown>).binary
        observation.result = stripped
      }
    } else {
      // User Tool dispatch (07-05 task): after platform built-ins and workspace
      // operations, before the unsupported-fallback. Only Tools visible to this
      // Agent (already filtered by `filterToolsForAgent` during schema build)
      // are reachable — a stray call to a hidden Tool falls through to the
      // unsupported branch below.
      if (visibleTool) {
        const toolInput = isRecord(call.arguments) ? call.arguments : {}
        observation = {
          index,
          name: call.name,
          ok: true,
          result: await executeUserTool(context, visibleTool, toolInput),
        }
      } else {
        observation = {
          index,
          name: call.name,
          ok: false,
          error: toolError(
            "UNSUPPORTED_WORKSPACE_TOOL",
            `Unsupported workspace tool: ${call.name}`,
          ),
        }
      }
    }
  } catch (error) {
    observation = {
      index,
      name: call.name,
      ok: false,
      error: isRecord(error) && typeof error.code === "string" && typeof error.message === "string"
        ? {
            code: error.code,
            message: error.message,
            ...(error.details === undefined ? {} : { details: error.details }),
          }
        : toolError(
            "WORKSPACE_TOOL_FAILED",
            error instanceof Error ? error.message : "Workspace tool failed.",
          ),
    }
  }

  const agentObservation = projectToolObservationForAgent(
    call,
    observation,
    context.observationCharBudget,
  )
  emitToolObservationTrace(
    context,
    call,
    observation,
    agentObservation,
    Date.now() - toolStartedAt,
  )
  // UI consumes only a closed presentation projection. Ordinary tool results
  // never enter timeline/session storage.
  const status: "success" | "failed" = observation.ok ? "success" : "failed"
  context.onTool?.(
    callId,
    call.name,
    status,
    buildToolPresentation(call, observation),
    displayName,
  )
  return agentObservation
}

/**
 * Tool names that are safe to run in parallel within a single tool-loop round:
 * all are read-only and stateless. `agent_call` is NOT in this set — it runs a
 * delegated tool loop (own workspace writes, nested agent_call, shared
 * callCount) — but multiple agent_calls in the same round are independent of
 * each other, so `executeRuntimeWorkspaceToolCalls` runs them concurrently in a
 * dedicated agentCallGroup instead. `run_script` is kept serial as a whole
 * because it runs a browser_script (side effects + bounded timeout) and
 * resolving its action requires a use_skill activation + action resolution up
 * front. `use_skill` is parallel-safe: it only registers actions into session
 * state and does not mutate the workspace.
 * See `06-19-ai-agent-process-visible` design §2 (scheme A) and
 * `06-20-agent-call-concurrency` design §2.2 (agent_call separate group).
 */
const PARALLEL_TOOL_NAMES = new Set<string>([
  RUNTIME_WORKSPACE_TOOL_NAMES.useSkill,
  RUNTIME_WORKSPACE_TOOL_NAMES.read,
  RUNTIME_WORKSPACE_TOOL_NAMES.list,
  RUNTIME_WORKSPACE_TOOL_NAMES.search,
  RUNTIME_WORKSPACE_TOOL_NAMES.glob,
  RUNTIME_WORKSPACE_TOOL_NAMES.diff,
  RUNTIME_WORKSPACE_TOOL_NAMES.queryDiagnostics,
])

function isParallelizableToolCall(call: ParsedRuntimeWorkspaceToolCall): boolean {
  return Boolean(call.call && PARALLEL_TOOL_NAMES.has(call.call.name))
}

export async function executeRuntimeWorkspaceToolCalls(
  context: RuntimeWorkspaceToolExecutionContext,
  calls: ParsedRuntimeWorkspaceToolCall[],
): Promise<RuntimeWorkspaceToolObservation[]> {
  // Split into three groups so independent agent_call targets run concurrently
  // while stateful writes stay ordered. Observations are collected in a Map
  // keyed by the original call index so the returned array stays aligned with
  // `calls` — the native loop relies on this to pair each observation with
  // `result.toolCalls[index].id` when threading tool messages.
  //   - parallelGroup: read-only, stateless tools (read/list/search/glob/diff,
  //     use_skill) — safe to run concurrently with each other and anything else.
  //   - agentCallGroup: `agent_call` targets. Each runs a delegated tool loop
  //     (own workspace writes, nested agent_call, shared callCount), so they are
  //     not "stateless reads", but multiple agent_calls in the same round are
  //     independent of each other and run concurrently to shorten wait time.
  //     callCount += 1 is atomic under JS single-threaded async interleaving;
  //     depth is passed by value so parallel agent_calls don't share depth.
  //   - serialGroup: writes, run_script (side effects + bounded timeout), and
  //     unparseable calls — run in original order after agent_call so delegated
  //     workspace writes are visible to this round's serial writes.
  const parallelIndices: number[] = []
  const agentCallIndices: number[] = []
  const serialIndices: number[] = []
  for (const [index, call] of calls.entries()) {
    if (isParallelizableToolCall(call)) {
      parallelIndices.push(index)
    } else if (call.call?.name === RUNTIME_WORKSPACE_TOOL_NAMES.agentCall) {
      agentCallIndices.push(index)
    } else {
      serialIndices.push(index)
    }
  }

  const observations = new Map<number, RuntimeWorkspaceToolObservation>()

  // Parallel group: run all read-only tools concurrently. Promise.all rejects
  // fast if any tool throws (or the signal aborts); the observations map is
  // already populated for the calls that resolved before the rejection, and the
  // caller's catch path handles it.
  if (parallelIndices.length > 0) {
    const parallelResults = await Promise.all(
      parallelIndices.map((index) => executeRuntimeWorkspaceToolCall(context, calls[index]!, index)),
    )
    for (let i = 0; i < parallelIndices.length; i += 1) {
      observations.set(parallelIndices[i]!, parallelResults[i]!)
    }
  }

  // agent_call group: run independent delegated agents concurrently. Same
  // Promise.all semantics as the parallel group; observations land by index.
  if (agentCallIndices.length > 0) {
    if (context.signal?.aborted) {
      throw new DOMException("Agent Runtime tool execution was aborted.", "AbortError")
    }
    const agentCallResults = await Promise.all(
      agentCallIndices.map((index) => executeRuntimeWorkspaceToolCall(context, calls[index]!, index)),
    )
    for (let i = 0; i < agentCallIndices.length; i += 1) {
      observations.set(agentCallIndices[i]!, agentCallResults[i]!)
    }
  }

  // Serial group: run stateful/write tools in their original order, checking
  // abort before each so a stop-generating click halts the remaining tools.
  for (const index of serialIndices) {
    if (context.signal?.aborted) {
      throw new DOMException("Agent Runtime tool execution was aborted.", "AbortError")
    }
    observations.set(index, await executeRuntimeWorkspaceToolCall(context, calls[index]!, index))
  }

  // Restore the original call order (invariant: observations[i] corresponds to calls[i]).
  return calls.map((_, index) => observations.get(index)!)
}
