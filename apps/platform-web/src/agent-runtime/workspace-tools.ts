import type {
  AgentContextEntry,
  AskUserRequest,
  AskUserResult,
  ContentPart,
  PlatformActionResult,
  SkillConfigItem,
  SkillRegistryEntry,
  TurnToolOutput,
  WorkspaceFile,
  WorkspaceOperationName,
  WorkspaceOperationRequest,
} from "@tsian/contracts"
import type {
  RuntimeTraceDebugLabel,
  RuntimeTraceEmitter,
} from "./trace"
import { summarizeTraceValue } from "./trace"
import {
  executeWorkspaceOperation,
  type WorkspaceOperationMutationAdapter,
} from "./workspace-operations"
import { normalizeWorkspacePath } from "@/lib/workspace-path"

// barrel re-export (public API — 23 type + 1 value)
export type {
  RuntimeWorkspaceToolCall,
  RuntimeWorkspaceToolName,
  ParsedRuntimeWorkspaceToolCall,
  RuntimeWorkspaceToolError,
  RuntimeWorkspaceToolObservation,
  RuntimeActionExecutorReference,
  RuntimeAgentCallHistoryMode,
  RuntimeAgentCallArguments,
  InspectDomActionType,
  InspectDomAction,
  InspectFrontendInput,
  InspectFrontendStructure,
  InspectFrontendDiagnostics,
  InspectFrontendTimelineEntry,
  InspectFrontendActionSnapshot,
  InspectFrontendResult,
  RuntimeControlledExecutorContext,
  RuntimeBrowserScriptExecutorRequest,
  RuntimeActionExecutorPolicyRequest,
  RuntimeActionExecutorPolicyDecision,
  RuntimeActionExecutorPolicy,
  RuntimeWorkspaceToolSessionState,
  RuntimeWorkspaceToolExecutionContext,
} from "./workspace-tools-types"
export { RUNTIME_WORKSPACE_TOOL_NAMES } from "./workspace-tools-types"
// import for internal use (local binding)
import {
  RUNTIME_WORKSPACE_TOOL_NAMES,
  WORKSPACE_OPERATION_TOOL_NAMES,
  isWorkspaceOperationToolName,
} from "./workspace-tools-types"
import type {
  RuntimeWorkspaceToolCall,
  RuntimeWorkspaceToolName,
  ParsedRuntimeWorkspaceToolCall,
  RuntimeWorkspaceToolError,
  RuntimeWorkspaceToolObservation,
  RuntimeActionExecutorReference,
  RuntimeAgentCallHistoryMode,
  RuntimeAgentCallArguments,
  InspectDomActionType,
  InspectDomAction,
  InspectFrontendInput,
  InspectFrontendStructure,
  InspectFrontendDiagnostics,
  InspectFrontendTimelineEntry,
  InspectFrontendActionSnapshot,
  InspectFrontendResult,
  RuntimeControlledExecutorContext,
  RuntimeBrowserScriptExecutorRequest,
  RuntimeActionExecutorPolicyRequest,
  RuntimeActionExecutorPolicyDecision,
  RuntimeActionExecutorPolicy,
  RuntimeWorkspaceToolSessionState,
  RuntimeWorkspaceToolExecutionContext,
  RuntimeSkillActionDeclaration,
  RuntimeActionExecutorResult,
  RuntimeAgentCallRunner,
  RuntimeInspectFrontendRunner,
  RuntimeBrowserScriptRunner,
  RuntimeActionExecutorContext,
  RuntimeLoadedSkill,
  SkillActionParseResult,
} from "./workspace-tools-types"
const TOOL_CALL_PATTERN = /<tsian-tool-call>\s*([\s\S]*?)\s*<\/tsian-tool-call>/g
const SKILL_ACTIONS_FENCE_PATTERN = /```([^\n`]*)\r?\n([\s\S]*?)```/g
const SKILL_ACTIONS_FENCE_LABEL = "tsian-actions"
const DEFAULT_AGENT_CALL_HISTORY_MODE: RuntimeAgentCallHistoryMode = "recent"
const AGENT_CALL_HISTORY_MODES = new Set<RuntimeAgentCallHistoryMode>([
  "minimal",
  "recent",
  "scene",
])
const BROWSER_SCRIPT_EXECUTOR_TYPE = "browser_script"
const DEFAULT_CONTROLLED_EXECUTOR_TIMEOUT_MS = 10_000
const MAX_CONTROLLED_EXECUTOR_TIMEOUT_MS = 60_000
const SUPPORTED_ACTION_SCHEMA_TYPES = new Set([
  "array",
  "boolean",
  "integer",
  "null",
  "number",
  "object",
  "string",
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toolError(
  code: string,
  message: string,
  details?: unknown,
): RuntimeWorkspaceToolError {
  return details === undefined ? { code, message } : { code, message, details }
}

export function createRuntimeWorkspaceToolSessionState(): RuntimeWorkspaceToolSessionState {
  return {
    loadedSkills: [],
    injectedSkillPaths: [],
  }
}

function normalizeWorkspaceFilePath(value: unknown): string {
  const result = normalizeWorkspacePath(value, {
    allowEmpty: false,
    rejectTrailingSlash: true,
  })
  if (!result.ok) {
    throw toolError(result.code, result.message)
  }
  return result.path
}

function traceBase(context: RuntimeWorkspaceToolExecutionContext) {
  return {
    ...(context.agentContext ? { agentId: context.agentContext.agent.id } : {}),
    ...(context.debugLabel ? { debugLabel: context.debugLabel } : {}),
  }
}

function countResultItems(result: unknown): number | undefined {
  if (Array.isArray(result)) return result.length
  if (isRecord(result) && Array.isArray(result.entries)) return result.entries.length
  return undefined
}

function summarizeWorkspaceReadResult(result: unknown): Record<string, unknown> {
  if (!isRecord(result)) {
    return {}
  }

  const summary: Record<string, unknown> = {
    path: typeof result.path === "string" ? result.path : undefined,
    size: typeof result.content === "string" ? result.content.length : undefined,
    updatedAt: typeof result.updatedAt === "number" ? result.updatedAt : undefined,
  }
  if (typeof result.offset === "number") {
    summary.offset = result.offset
  }
  if (typeof result.totalLines === "number") {
    summary.totalLines = result.totalLines
  }
  if (typeof result.returnedLines === "number") {
    summary.returnedLines = result.returnedLines
  }
  if (typeof result.truncated === "boolean") {
    summary.truncated = result.truncated
  }
  if (typeof result.isBinaryPlaceholder === "boolean") {
    summary.isBinaryPlaceholder = result.isBinaryPlaceholder
  }
  return summary
}

function emitWorkspaceToolTrace(
  context: RuntimeWorkspaceToolExecutionContext,
  call: RuntimeWorkspaceToolCall,
  observation: RuntimeWorkspaceToolObservation,
  durationMs?: number,
): void {
  if (!isWorkspaceOperationToolName(call.name)) {
    return
  }

  const data: Record<string, unknown> = {
    tool: call.name,
    ...(durationMs !== undefined ? { durationMs } : {}),
  }
  if (typeof call.arguments.scope === "string") {
    data.scope = call.arguments.scope
  }
  if (typeof call.arguments.path === "string") {
    data.path = call.arguments.path
  }
  if (typeof call.arguments.targetPath === "string") {
    data.targetPath = call.arguments.targetPath
  }
  if (typeof call.arguments.query === "string") {
    data.query = call.arguments.query
    data.queryLength = call.arguments.query.length
  }
  if (typeof call.arguments.pattern === "string") {
    data.pattern = call.arguments.pattern
  }
  if (typeof call.arguments.offset === "number") {
    data.offset = call.arguments.offset
  }
  if (typeof call.arguments.contextLines === "number") {
    data.contextLines = call.arguments.contextLines
  }
  if (typeof call.arguments.ignoreCase === "boolean") {
    data.ignoreCase = call.arguments.ignoreCase
  }
  if (typeof call.arguments.limit === "number") {
    data.limit = call.arguments.limit
  }
  if (observation.ok) {
    data.resultCount = countResultItems(observation.result)
    if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.read) {
      data.result = summarizeWorkspaceReadResult(observation.result)
    }
    if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.search && Array.isArray(observation.result)) {
      let totalMatches = 0
      for (const file of observation.result) {
        if (isRecord(file) && Array.isArray(file.matches)) {
          totalMatches += file.matches.length
        }
      }
      data.totalMatches = totalMatches
    }
  } else if (observation.error) {
    data.error = observation.error
  }

  context.emitTrace?.({
    type: "workspace_tool_called",
    ...traceBase(context),
    ok: observation.ok,
    data,
  })
}

function emitActionCallTrace(
  context: RuntimeWorkspaceToolExecutionContext,
  call: RuntimeWorkspaceToolCall,
  observation: RuntimeWorkspaceToolObservation,
  durationMs?: number,
): void {
  if (call.name !== RUNTIME_WORKSPACE_TOOL_NAMES.runScript) {
    return
  }

  const data: Record<string, unknown> = {
    skill: typeof call.arguments.skill === "string" ? call.arguments.skill : undefined,
    script: typeof call.arguments.script === "string" ? call.arguments.script : undefined,
    inputSummary: summarizeTraceValue(call.arguments.input ?? {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  }

  if (observation.ok && isRecord(observation.result)) {
    const result = observation.result
    if (isRecord(result.skill) && typeof result.skill.name === "string") {
      data.skill = result.skill.name
    }
    if (isRecord(result.action) && typeof result.action.name === "string") {
      data.action = result.action.name
    }
    data.executor = isRecord(result.executor) ? result.executor : undefined
    data.status = typeof result.status === "string" ? result.status : undefined
    data.outputSummary = summarizeTraceValue(result.output)
  } else if (observation.error) {
    data.error = observation.error
  }

  context.emitTrace?.({
    type: "action_called",
    ...traceBase(context),
    ok: observation.ok,
    data,
  })
}

function emitAgentCallTrace(
  context: RuntimeWorkspaceToolExecutionContext,
  call: RuntimeWorkspaceToolCall,
  observation: RuntimeWorkspaceToolObservation,
  durationMs?: number,
): void {
  if (call.name !== RUNTIME_WORKSPACE_TOOL_NAMES.agentCall) {
    return
  }

  const result = isRecord(observation.result) ? observation.result : {}
  const targetAgent = isRecord(result.targetAgent) ? result.targetAgent : {}
  const resultMetadata = isRecord(result.metadata) ? result.metadata : {}
  const errorDetails = isRecord(observation.error?.details) ? observation.error.details : {}
  const metadata = Object.keys(resultMetadata).length > 0 ? resultMetadata : errorDetails
  const data: Record<string, unknown> = {
    callerAgentId: typeof metadata.callerAgentId === "string"
      ? metadata.callerAgentId
      : context.agentContext?.agent.id,
    targetAgentId: typeof targetAgent.id === "string"
      ? targetAgent.id
      : typeof metadata.targetAgentId === "string"
        ? metadata.targetAgentId
      : typeof call.arguments.agentId === "string"
        ? call.arguments.agentId
        : undefined,
    targetAgentTitle: typeof targetAgent.title === "string" ? targetAgent.title : undefined,
    inputSummary: summarizeTraceValue(call.arguments),
    ...(durationMs !== undefined ? { durationMs } : {}),
  }

  if (observation.ok) {
    data.outputSummary = summarizeTraceValue(
      typeof result.response === "string" ? result.response : observation.result,
    )
  } else if (observation.error) {
    data.error = observation.error
  }

  context.emitTrace?.({
    type: "agent_called",
    ...traceBase(context),
    ok: observation.ok,
    data,
  })
}

function emitToolObservationTrace(
  context: RuntimeWorkspaceToolExecutionContext,
  call: RuntimeWorkspaceToolCall,
  observation: RuntimeWorkspaceToolObservation,
  durationMs?: number,
): void {
  emitAgentCallTrace(context, call, observation, durationMs)
  emitWorkspaceToolTrace(context, call, observation, durationMs)
  emitActionCallTrace(context, call, observation, durationMs)
}

function parseToolCall(raw: string): ParsedRuntimeWorkspaceToolCall {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return {
      raw,
      error: toolError(
        "TOOL_CALL_JSON_INVALID",
        error instanceof Error ? error.message : "Tool call JSON is invalid.",
      ),
    }
  }

  if (!isRecord(parsed)) {
    return {
      raw,
      error: toolError(
        "TOOL_CALL_INVALID",
        "Tool call must be a JSON object.",
      ),
    }
  }

  const name = typeof parsed.name === "string" ? parsed.name.trim() : ""
  if (!name) {
    return {
      raw,
      error: toolError(
        "TOOL_NAME_REQUIRED",
        "Tool call requires a non-empty string name.",
      ),
    }
  }

  const args = parsed.arguments
  if (args !== undefined && !isRecord(args)) {
    return {
      raw,
      error: toolError(
        "TOOL_ARGUMENTS_INVALID",
        "Tool call arguments must be a JSON object when provided.",
      ),
    }
  }

  return {
    raw,
    call: {
      name,
      arguments: args ?? {},
    },
  }
}

export function parseRuntimeWorkspaceToolCalls(
  text: string,
): ParsedRuntimeWorkspaceToolCall[] {
  const calls: ParsedRuntimeWorkspaceToolCall[] = []
  for (const match of text.matchAll(TOOL_CALL_PATTERN)) {
    calls.push(parseToolCall(match[1] ?? ""))
  }

  return calls
}

export function stripRuntimeWorkspaceToolCallBlocks(text: string): string {
  return text.replace(TOOL_CALL_PATTERN, "").trim()
}

// ─────────────────────────────────────────────────────────────────────────
// Think-block stripping (task 06-26-text-protocol-and-agent-entry)
//
// Text-protocol models that emit chain-of-thought as inline tags (e.g. QwQ
//  让 1/2 步思考), we strip these from the content fed back to the model
// (防上下文污染). This is a platform-side hard requirement independent of
// rendering — the game frontend / assistant UI handle their own display.
// Only common native tags are adapted: <thought>, <thinking>,  Non-mainstream formats are intentionally not handled; prompt-layer
// responsibility.
// ─────────────────────────────────────────────────────────────────────────

const THINK_BLOCK_PATTERNS = [
  /<thought>\s*([\s\S]*?)\s*<\/thought>/g,
  /<thinking>\s*([\s\S]*?)\s*<\/thinking>/g,
  /<think>\s*([\s\S]*?)\s*<\/think>/g,
]

/** Strip closed think blocks from text. Used at round end to clean content
 *  fed back to the model (prevent chain-of-thought from polluting context). */
export function stripThinkBlocks(text: string): string {
  let result = text
  for (const pattern of THINK_BLOCK_PATTERNS) {
    result = result.replace(pattern, "")
  }
  return result.trim()
}

/** Extract the inner content of closed think blocks. Used to collect thought
 *  processNodes (parallel to native mode's reasoning stream → thought node). */
export function extractThinkBlocks(text: string): string[] {
  const blocks: string[] = []
  for (const pattern of THINK_BLOCK_PATTERNS) {
    const reset = new RegExp(pattern.source, pattern.flags)
    let match: RegExpExecArray | null
    while ((match = reset.exec(text)) !== null) {
      const inner = (match[1] ?? "").trim()
      if (inner) {
        blocks.push(inner)
      }
    }
  }
  return blocks
}

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

function normalizedLookupKey(value: string): string {
  return value.trim().toLowerCase()
}

function normalizeRequiredString(
  value: unknown,
  code: string,
  message: string,
): string {
  if (typeof value !== "string") {
    throw toolError(code, message)
  }

  const normalized = value.trim()
  if (!normalized) {
    throw toolError(code, message)
  }

  return normalized
}

function normalizeExecutorTimeoutMs(
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

function normalizeActionExecutorReference(
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

  return {
    type,
    name: explicitName || path,
    path,
    ...(timeoutMs ? { timeoutMs } : {}),
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

function checkActionExecutorPolicy(
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

function normalizeActionOutputSchema(
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

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function normalizeAgentCallHistoryMode(value: unknown): RuntimeAgentCallHistoryMode {
  if (value === undefined) {
    return DEFAULT_AGENT_CALL_HISTORY_MODE
  }

  if (typeof value !== "string" || !AGENT_CALL_HISTORY_MODES.has(value as RuntimeAgentCallHistoryMode)) {
    throw toolError(
      "AGENT_CALL_HISTORY_MODE_INVALID",
      "agent_call historyMode must be one of: minimal, recent, scene.",
      { historyMode: value },
    )
  }

  return value as RuntimeAgentCallHistoryMode
}

function normalizeAgentCallArguments(
  input: Record<string, unknown>,
): RuntimeAgentCallArguments {
  const agentId = normalizeRequiredString(
    input.agentId,
    "AGENT_CALL_TARGET_REQUIRED",
    "agent_call requires a non-empty string agentId.",
  )
  const request = normalizeRequiredString(
    input.request,
    "AGENT_CALL_REQUEST_REQUIRED",
    "agent_call requires a non-empty string request.",
  )
  const reason = normalizeOptionalString(input.reason)
  const contextSummary = normalizeOptionalString(input.contextSummary)
  const expectedOutput = normalizeOptionalString(input.expectedOutput)
  // timeoutMs:可选,非负有限整数才透传,否则忽略(走默认 300s).
  const rawTimeoutMs = input.timeoutMs
  const timeoutMs =
    typeof rawTimeoutMs === "number"
    && Number.isFinite(rawTimeoutMs)
    && rawTimeoutMs > 0
      ? Math.floor(rawTimeoutMs)
      : undefined

  return {
    agentId,
    request,
    ...(reason ? { reason } : {}),
    ...(contextSummary ? { contextSummary } : {}),
    ...(expectedOutput ? { expectedOutput } : {}),
    historyMode: normalizeAgentCallHistoryMode(input.historyMode),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  }
}

const INSPECT_FRONTEND_WAIT_MODES = new Set(["bridge-ready", "turn-completed"])
const INSPECT_FRONTEND_RUNTIME_MODES = new Set(["real", "mock"])
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

/**
 * 校验 inspect_frontend 工具入参。手写校验（镜像 normalizeAgentCallArguments），
 * 无 cardId 参数——inspector 内部从 getPlatformActiveGameCard() 取当前卡。
 * wait 默认 bridge-ready；只把实际提供的字段放进结果。
 */
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

function normalizeInspectFrontendArguments(
  input: Record<string, unknown>,
): InspectFrontendInput {
  const result: InspectFrontendInput = {}

  if (input.send !== undefined) {
    if (!isRecord(input.send)) {
      throw toolError(
        "INSPECT_FRONTEND_SEND_INVALID",
        "inspect_frontend send must be an object with a message string.",
      )
    }
    const message = normalizeRequiredString(
      input.send.message,
      "INSPECT_FRONTEND_MESSAGE_REQUIRED",
      "inspect_frontend send.message must be a non-empty string.",
    )
    result.send = { message }
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
      if (typeof raw.text === "string" && raw.text) action.text = raw.text
      if (typeof raw.key === "string" && raw.key) action.key = raw.key
      if (
        typeof raw.to === "string"
        && INSPECT_SCROLL_TARGETS.has(raw.to as "top" | "bottom")
      ) {
        action.to = raw.to as "top" | "bottom"
      }
      // selectOption:按 option value 或 label 文本匹配
      if (typeof raw.value === "string" && raw.value) action.value = raw.value
      if (typeof raw.label === "string" && raw.label) action.label = raw.label
      // check:checked 默认 true,false=取消勾选
      if (typeof raw.checked === "boolean") action.checked = raw.checked
      return action
    })
  }

  if (typeof input.observeBetween === "boolean") {
    result.observeBetween = input.observeBetween
  }
  if (typeof input.refresh === "boolean") {
    result.refresh = input.refresh
  }
  if (typeof input.autoWait === "boolean") {
    result.autoWait = input.autoWait
  }

  if (input.wait !== undefined) {
    if (
      typeof input.wait !== "string"
      || !INSPECT_FRONTEND_WAIT_MODES.has(input.wait as "bridge-ready" | "turn-completed")
    ) {
      throw toolError(
        "INSPECT_FRONTEND_WAIT_INVALID",
        "inspect_frontend wait must be one of: bridge-ready, turn-completed.",
      )
    }
    result.wait = input.wait as "bridge-ready" | "turn-completed"
  } else {
    result.wait = "bridge-ready"
  }

  if (input.runtime !== undefined) {
    if (
      typeof input.runtime !== "string"
      || !INSPECT_FRONTEND_RUNTIME_MODES.has(input.runtime as "real" | "mock")
    ) {
      throw toolError(
        "INSPECT_FRONTEND_RUNTIME_INVALID",
        "inspect_frontend runtime must be one of: real, mock.",
      )
    }
    result.runtime = input.runtime as "real" | "mock"
  }

  if (typeof input.screenshot === "boolean") {
    result.screenshot = input.screenshot
  }

  return result
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

function parseActionDeclarations(content: string): SkillActionParseResult {
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

      let executor: RuntimeActionExecutorReference
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

function validateActionInputSchema(
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

function validateActionOutputSchema(
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

function resolveBrowserScriptPath(
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

async function executeSkillAction(
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

function activateSkillByName(
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

  // use_skill only declares intent + registers actions; the full SKILL.md is
  // injected into the next round's context by injectActivatedSkillMessages
  // (see index.ts tool loops). The observation returns a lightweight
  // confirmation + action list so the model knows what it can run_script,
  // without burning a round on the full SKILL.md as a tool result.
  return {
    skill: {
      name: skill.name,
      title: skill.title,
      scope: skill.scope,
      ...(skill.agentId ? { agentId: skill.agentId } : {}),
    },
    activated: true,
    actions: actions.map((action) => ({
      name: action.name,
      description: action.description,
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

async function executeRunScript(
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
      scope: loadedSkill.skill.scope,
      ...(loadedSkill.skill.agentId ? { agentId: loadedSkill.skill.agentId } : {}),
    },
    action: {
      name: action.name,
      description: action.description,
      hasInputSchema: action.inputSchema !== undefined,
      hasOutputSchema: action.outputSchema !== undefined,
    },
    executor: action.executor,
    input: actionInput,
    output: execution.output,
  }
}

/**
 * Build the `turn-tool` event output for a tool observation.
 *
 * - 普通工具：完整 `JSON.stringify(result)`（或 `String(result)`），**不截断**。
 *   截断/显示策略交给 UI 侧（前端按需折叠或不显 output）。
 *   返回 `undefined` 当 result 为空（事件省略 output）。
 * - agent_call：结构化对象 `{type:"agent_call", targetAgent, response, status}`，
 *   提取被调用 agent 的 title + 完整 response，让前端不用解析整坨 JSON。
 *   response 不截断（UI 侧控制长度）。
 *
 * **不动**喂回模型的 `formatRuntimeWorkspaceToolObservationMessage`（model 路径
 * 仍全量 JSON.stringify observation，本函数只服务 UI 旁路的 turn-tool 事件）。
 */
function buildToolOutput(
  call: RuntimeWorkspaceToolCall | undefined,
  observation: RuntimeWorkspaceToolObservation,
): TurnToolOutput | undefined {
  const isAgentCall = call?.name === RUNTIME_WORKSPACE_TOOL_NAMES.agentCall

  // agent_call 结构化：成功提 targetAgent + response，失败提 error
  if (isAgentCall) {
    if (!observation.ok) {
      const err = observation.error
      return {
        type: "agent_call",
        targetAgent: { id: "", title: "" },
        response: "",
        status: "failed",
        ...(err ? { error: { code: err.code, message: err.message } } : {}),
      }
    }
    const result = isRecord(observation.result) ? observation.result : {}
    const targetAgent = isRecord(result.targetAgent) ? result.targetAgent : {}
    const response = typeof result.response === "string" ? result.response : ""
    return {
      type: "agent_call",
      targetAgent: {
        id: typeof targetAgent.id === "string" ? targetAgent.id : "",
        title: typeof targetAgent.title === "string" ? targetAgent.title : "",
        ...(typeof targetAgent.summary === "string" ? { summary: targetAgent.summary } : {}),
      },
      response,
      status: "completed",
    }
  }

  // 普通工具：完整 stringify，不截断
  if (observation.result === undefined) {
    return undefined
  }
  try {
    return typeof observation.result === "string"
      ? observation.result
      : JSON.stringify(observation.result)
  } catch {
    return undefined
  }
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
  context.onTool?.(callId, call.name, "loading")

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
    } else if (isWorkspaceOperationToolName(call.name)) {
      const opResult = await executeWorkspaceOperation(
        workspaceOperationRequestFromToolCall(call),
        {
          workspaceFiles: context.workspaceFiles,
          agentContext: context.agentContext,
          mutations: context.workspaceMutations,
          exposedOperations: context.exposedWorkspaceOperations,
          semanticSearchOwnerId: context.semanticSearchOwnerId,
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

  emitToolObservationTrace(context, call, observation, Date.now() - toolStartedAt)
  // Turn-tool event (子2b R2): report the final status + output.
  // buildToolOutput 统一处理 success/failed：普通工具返回完整 string（不截断），
  // agent_call 返回结构化 {type:"agent_call", targetAgent, response, status}。
  const status: "success" | "failed" = observation.ok ? "success" : "failed"
  context.onTool?.(callId, call.name, status, buildToolOutput(call, observation))
  return observation
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

export function formatRuntimeWorkspaceToolObservationMessage(
  observations: RuntimeWorkspaceToolObservation[],
): string {
  const compactObservations = observations.map(compactToolObservationForModel)
  return [
    "Workspace tool observations:",
    "<tsian-tool-observation>",
    JSON.stringify(compactObservations, null, 2),
    "</tsian-tool-observation>",
    "Use these observations to continue. If you have enough context, provide the required final output without tool-call blocks.",
  ].join("\n")
}

const INLINE_OBSERVATION_CHAR_LIMIT = 6_000
const OBSERVATION_PREVIEW_CHAR_LIMIT = 2_000

function previewObservationText(text: string, limit = OBSERVATION_PREVIEW_CHAR_LIMIT): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n...[truncated ${text.length - limit} chars; read a narrower slice or use offset/limit to continue]`
}

function compactUnknownResultForModel(result: unknown): unknown {
  if (typeof result === "string") {
    if (result.length <= INLINE_OBSERVATION_CHAR_LIMIT) return result
    return {
      preview: previewObservationText(result),
      charCount: result.length,
      truncatedForModel: true,
    }
  }
  if (!isRecord(result)) {
    return result
  }

  const content = typeof result.content === "string" ? result.content : undefined
  if (content === undefined || content.length <= INLINE_OBSERVATION_CHAR_LIMIT) {
    return result
  }

  const compact: Record<string, unknown> = { ...result }
  compact.content = previewObservationText(content)
  compact.charCount = content.length
  compact.truncatedForModel = true
  if (typeof result.offset === "number" && typeof result.returnedLines === "number") {
    compact.nextOffset = result.offset + result.returnedLines
  }
  return compact
}

function compactToolObservationForModel(
  observation: RuntimeWorkspaceToolObservation,
): RuntimeWorkspaceToolObservation {
  if (!observation.ok) {
    return observation
  }
  return {
    ...observation,
    result: compactUnknownResultForModel(observation.result),
  }
}

/**
 * Native 模式 tool message content：裸结果，无容器外壳/引导语。
 * toolCallId 已关联调用，index/name 冗余；provider native 训练分布直接放结果。
 * 成功：result 是 string 直放，否则 JSON.stringify(result)。
 * 失败：JSON.stringify(error)（保留 code + message + details）。
 */
export function formatNativeToolObservationContent(
  observation: RuntimeWorkspaceToolObservation,
): string {
  if (!observation.ok) {
    return JSON.stringify(
      observation.error ?? { code: "UNKNOWN", message: "Unknown error" },
    )
  }
  const result = compactUnknownResultForModel(observation.result)
  return typeof result === "string" ? result : JSON.stringify(result)
}
