import type {
  AgentContextEntry,
  PlatformActionRequest,
  PlatformActionResult,
  SkillRegistryEntry,
  WorkspaceFile,
  WorkspaceOperationName,
  WorkspaceOperationRequest,
  WorkspaceScope,
} from "@tsian/contracts"
import type {
  RuntimeTraceDebugLabel,
  RuntimeTraceEmitter,
} from "./trace"
import { summarizeTraceValue } from "./trace"
import {
  DEFAULT_RUNTIME_WORKSPACE_OPERATIONS,
  executeWorkspaceOperation,
  type WorkspaceOperationMutationAdapter,
} from "./workspace-operations"

export interface RuntimeWorkspaceToolCall {
  name: string
  arguments: Record<string, unknown>
}

export const RUNTIME_WORKSPACE_TOOL_NAMES = {
  skillLoad: "skill_load",
  actionCall: "action_call",
  agentCall: "agent_call",
  workspaceRead: "workspace.read",
  workspaceList: "workspace.list",
  workspaceSearch: "workspace.search",
  workspaceDiff: "workspace.diff",
  workspacePatch: "workspace.patch",
  workspaceWrite: "workspace.write",
  workspaceMove: "workspace.move",
  workspaceDelete: "workspace.delete",
  workspaceValidate: "workspace.validate",
} as const

export type RuntimeWorkspaceToolName =
  (typeof RUNTIME_WORKSPACE_TOOL_NAMES)[keyof typeof RUNTIME_WORKSPACE_TOOL_NAMES]

export interface ParsedRuntimeWorkspaceToolCall {
  raw: string
  call?: RuntimeWorkspaceToolCall
  error?: RuntimeWorkspaceToolError
}

export interface RuntimeWorkspaceToolError {
  code: string
  message: string
  details?: unknown
}

export interface RuntimeWorkspaceToolObservation {
  index: number
  name: string
  ok: boolean
  result?: unknown
  error?: RuntimeWorkspaceToolError
}

interface RuntimeSkillActionDeclaration {
  name: string
  description: string
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  executor: RuntimeActionExecutorReference
}

export interface RuntimeActionExecutorReference {
  type: string
  name: string
  operation?: WorkspaceOperationName
  scope?: WorkspaceScope
  path?: string
  timeoutMs?: number
}

interface RuntimeActionExecutorResult {
  status: "validated" | "executed"
  output: unknown
}

export type RuntimeAgentCallHistoryMode = "minimal" | "recent" | "scene"

export interface RuntimeAgentCallArguments {
  agentId: string
  request: string
  reason?: string
  contextSummary?: string
  expectedOutput?: string
  historyMode: RuntimeAgentCallHistoryMode
}

type RuntimeAgentCallRunner = (
  input: RuntimeAgentCallArguments,
) => Promise<unknown>

type RuntimePlatformActionRunner = (
  request: PlatformActionRequest,
) => Promise<PlatformActionResult>

export interface RuntimeBrowserScriptExecutorRequest {
  skillName: string
  skillPath: string
  actionName: string
  scriptPath: string
  input: Record<string, unknown>
  timeoutMs: number
}

type RuntimeBrowserScriptRunner = (
  request: RuntimeBrowserScriptExecutorRequest,
) => Promise<PlatformActionResult>

export interface RuntimeActionExecutorPolicyRequest {
  skill: {
    name: string
    path: string
    scope: string
    agentId?: string
  }
  action: {
    name: string
  }
  executor: RuntimeActionExecutorReference
}

export interface RuntimeActionExecutorPolicyDecision {
  enabled: boolean
  reason?: string
  source?: string
}

export type RuntimeActionExecutorPolicy = (
  request: RuntimeActionExecutorPolicyRequest,
) => RuntimeActionExecutorPolicyDecision | boolean

interface RuntimeActionExecutorContext {
  input: Record<string, unknown>
  loadedSkill: RuntimeLoadedSkill
  workspaceFiles: WorkspaceFile[]
  agentContext?: AgentContextEntry
  workspaceMutations?: WorkspaceOperationMutationAdapter
  exposedWorkspaceOperations?: Iterable<WorkspaceOperationName>
  runPlatformAction?: RuntimePlatformActionRunner
  runBrowserScript?: RuntimeBrowserScriptRunner
  signal?: AbortSignal
}

interface RuntimeLoadedSkill {
  skill: SkillRegistryEntry
  actions: RuntimeSkillActionDeclaration[]
}

export interface RuntimeWorkspaceToolSessionState {
  loadedSkills: RuntimeLoadedSkill[]
}

interface SkillActionParseResult {
  actions: RuntimeSkillActionDeclaration[]
  errors: RuntimeWorkspaceToolError[]
}

interface NormalizePathOptions {
  allowEmpty: boolean
  rejectTrailingSlash: boolean
}

export interface RuntimeWorkspaceToolExecutionContext {
  workspaceFiles: WorkspaceFile[]
  agentContext?: AgentContextEntry
  sessionState?: RuntimeWorkspaceToolSessionState
  runAgentCall?: RuntimeAgentCallRunner
  runPlatformAction?: RuntimePlatformActionRunner
  runBrowserScript?: RuntimeBrowserScriptRunner
  actionExecutorPolicy?: RuntimeActionExecutorPolicy
  workspaceMutations?: WorkspaceOperationMutationAdapter
  exposedWorkspaceOperations?: Iterable<WorkspaceOperationName>
  signal?: AbortSignal
  debugLabel?: RuntimeTraceDebugLabel
  emitTrace?: RuntimeTraceEmitter
}

const TOOL_CALL_PATTERN = /<tsian-tool-call>\s*([\s\S]*?)\s*<\/tsian-tool-call>/g
const SKILL_ACTIONS_FENCE_PATTERN = /```([^\n`]*)\r?\n([\s\S]*?)```/g
const SKILL_ACTIONS_FENCE_LABEL = "tsian-actions"
const DEFAULT_AGENT_CALL_HISTORY_MODE: RuntimeAgentCallHistoryMode = "recent"
const AGENT_CALL_HISTORY_MODES = new Set<RuntimeAgentCallHistoryMode>([
  "minimal",
  "recent",
  "scene",
])
const DEFAULT_ACTION_EXECUTOR: RuntimeActionExecutorReference = {
  type: "builtin",
  name: "validation",
}
const PLATFORM_ACTION_EXECUTOR_TYPE = "platform_action"
const BROWSER_SCRIPT_EXECUTOR_TYPE = "browser_script"
const WORKSPACE_OPERATION_EXECUTOR_TYPE = "workspace_operation"
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
  }
}

function normalizePathBase(value: unknown, options: NormalizePathOptions): string {
  if (typeof value !== "string") {
    throw toolError(
      "WORKSPACE_PATH_REQUIRED",
      "Workspace path must be a string.",
    )
  }

  const raw = value.trim()
  const hadTrailingSlash = /[\\/]$/.test(raw)
  const normalized = raw
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/+$/, "")

  if (!normalized) {
    if (options.allowEmpty) {
      return ""
    }
    throw toolError(
      "WORKSPACE_PATH_REQUIRED",
      "Workspace path is required.",
    )
  }

  if (options.rejectTrailingSlash && hadTrailingSlash) {
    throw toolError(
      "WORKSPACE_FILE_PATH_REQUIRED",
      "Workspace file path must not end with a slash.",
    )
  }

  const segments = normalized.split("/")
  if (segments.some((segment) => segment === "." || segment === ".." || segment === "")) {
    throw toolError(
      "WORKSPACE_PATH_INVALID",
      "Workspace path must not contain empty, current, or parent directory segments.",
    )
  }

  return normalized
}

function normalizeWorkspaceFilePath(value: unknown): string {
  return normalizePathBase(value, {
    allowEmpty: false,
    rejectTrailingSlash: true,
  })
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

  return {
    path: typeof result.path === "string" ? result.path : undefined,
    mediaType: typeof result.mediaType === "string" ? result.mediaType : undefined,
    size: typeof result.content === "string" ? result.content.length : undefined,
    updatedAt: typeof result.updatedAt === "number" ? result.updatedAt : undefined,
  }
}

function emitWorkspaceToolTrace(
  context: RuntimeWorkspaceToolExecutionContext,
  call: RuntimeWorkspaceToolCall,
  observation: RuntimeWorkspaceToolObservation,
): void {
  if (!call.name.startsWith("workspace.")) {
    return
  }

  const data: Record<string, unknown> = {
    tool: call.name,
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
  if (typeof call.arguments.limit === "number") {
    data.limit = call.arguments.limit
  }
  if (observation.ok) {
    data.resultCount = countResultItems(observation.result)
    if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.workspaceRead) {
      data.result = summarizeWorkspaceReadResult(observation.result)
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
): void {
  if (call.name !== RUNTIME_WORKSPACE_TOOL_NAMES.actionCall) {
    return
  }

  const data: Record<string, unknown> = {
    skill: typeof call.arguments.skill === "string" ? call.arguments.skill : undefined,
    action: typeof call.arguments.action === "string" ? call.arguments.action : undefined,
    inputSummary: summarizeTraceValue(call.arguments.input ?? {}),
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
    callerDepth: typeof metadata.callerDepth === "number" ? metadata.callerDepth : undefined,
    depth: typeof metadata.targetDepth === "number" ? metadata.targetDepth : undefined,
    maxDepth: typeof metadata.maxDepth === "number" ? metadata.maxDepth : undefined,
    callCount: typeof metadata.callCount === "number" ? metadata.callCount : undefined,
    maxCallsPerTurn: typeof metadata.maxCallsPerTurn === "number"
      ? metadata.maxCallsPerTurn
      : undefined,
    historyMode: typeof metadata.historyMode === "string"
      ? metadata.historyMode
      : typeof result.historyMode === "string"
        ? result.historyMode
        : typeof call.arguments.historyMode === "string"
          ? call.arguments.historyMode
          : DEFAULT_AGENT_CALL_HISTORY_MODE,
    inputSummary: summarizeTraceValue(call.arguments),
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
): void {
  emitAgentCallTrace(context, call, observation)
  emitWorkspaceToolTrace(context, call, observation)
  emitActionCallTrace(context, call, observation)
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
    return { ...DEFAULT_ACTION_EXECUTOR }
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

  const explicitName = typeof value.name === "string" && value.name.trim()
    ? value.name.trim()
    : ""
  if (type === PLATFORM_ACTION_EXECUTOR_TYPE && !explicitName) {
    throw toolError(
      "ACTION_EXECUTOR_INVALID",
      `Platform action executor requires a non-empty string name: ${actionName}`,
      { index, name: actionName },
    )
  }

  const timeoutMs = normalizeExecutorTimeoutMs(value.timeoutMs, actionName, index)

  if (type === WORKSPACE_OPERATION_EXECUTOR_TYPE) {
    const operation = typeof value.operation === "string" && value.operation.trim()
      ? value.operation.trim()
      : explicitName
    const supportedOperations = [
      "list",
      "search",
      "read",
      "diff",
      "patch",
      "write",
      "move",
      "delete",
      "validate",
    ]
    if (!supportedOperations.includes(operation)) {
      throw toolError(
        "ACTION_EXECUTOR_INVALID",
        `Workspace operation executor requires a supported operation: ${actionName}`,
        { index, name: actionName, operation, supportedOperations },
      )
    }

    const scope = typeof value.scope === "string" && value.scope.trim()
      ? value.scope.trim()
      : undefined
    if (
      scope !== undefined
      && scope !== "effective"
      && scope !== "card-content"
      && scope !== "save-runtime"
      && scope !== "platform-meta"
    ) {
      throw toolError(
        "ACTION_EXECUTOR_INVALID",
        `Workspace operation executor scope is invalid: ${actionName}`,
        { index, name: actionName, scope },
      )
    }

    return {
      type,
      name: operation,
      operation: operation as WorkspaceOperationName,
      ...(scope ? { scope: scope as WorkspaceScope } : {}),
      ...(typeof value.path === "string" && value.path.trim()
        ? { path: value.path.trim() }
        : {}),
      ...(timeoutMs ? { timeoutMs } : {}),
    }
  }

  if (type === BROWSER_SCRIPT_EXECUTOR_TYPE) {
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

  const name = explicitName || (type === "builtin" ? DEFAULT_ACTION_EXECUTOR.name : "")

  return {
    type,
    name,
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
  return executor.type === "builtin"
    || executor.type === PLATFORM_ACTION_EXECUTOR_TYPE
    || executor.type === BROWSER_SCRIPT_EXECUTOR_TYPE
    || executor.type === WORKSPACE_OPERATION_EXECUTOR_TYPE
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

  return {
    agentId,
    request,
    ...(reason ? { reason } : {}),
    ...(contextSummary ? { contextSummary } : {}),
    ...(expectedOutput ? { expectedOutput } : {}),
    historyMode: normalizeAgentCallHistoryMode(input.historyMode),
  }
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

function loadedSkillDetails(
  skill: SkillRegistryEntry,
  actions: RuntimeSkillActionDeclaration[],
  actionDeclarationErrors: RuntimeWorkspaceToolError[],
): Record<string, unknown> {
  const details: Record<string, unknown> = {
    name: skill.name,
    title: skill.title,
    description: skill.description,
    triggers: skill.triggers,
    appliesTo: skill.appliesTo,
    scope: skill.scope,
    actions: actions.map((action) => ({
      name: action.name,
      description: action.description,
      hasInputSchema: action.inputSchema !== undefined,
      hasOutputSchema: action.outputSchema !== undefined,
      executor: action.executor,
    })),
  }
  if (skill.agentId) {
    details.agentId = skill.agentId
  }
  if (actionDeclarationErrors.length) {
    details.actionDeclarationErrors = actionDeclarationErrors
  }
  return details
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

const BUILTIN_ACTION_EXECUTORS: Record<
  string,
  (context: RuntimeActionExecutorContext) => RuntimeActionExecutorResult
> = {
  validation: () => ({
    status: "validated",
    output: null,
  }),
  echo: ({ input }) => ({
    status: "executed",
    output: input,
  }),
}

function workspaceOperationRequestFromExecutor(
  executor: RuntimeActionExecutorReference,
  input: Record<string, unknown>,
): WorkspaceOperationRequest {
  const operation = executor.operation ?? executor.name as WorkspaceOperationName
  const scope = executor.scope ?? input.scope
  const path = executor.path ?? input.path

  return {
    ...input,
    operation,
    scope,
    ...(typeof path === "string" ? { path } : {}),
  } as WorkspaceOperationRequest
}

function workspaceOperationRequestFromToolCall(
  call: RuntimeWorkspaceToolCall,
): WorkspaceOperationRequest {
  const operation = call.name.slice("workspace.".length)
  return {
    ...call.arguments,
    operation,
  } as WorkspaceOperationRequest
}

function exposedOperationsForWorkspaceAction(
  context: RuntimeActionExecutorContext,
  operation: WorkspaceOperationName,
): WorkspaceOperationName[] {
  return Array.from(new Set([
    ...DEFAULT_RUNTIME_WORKSPACE_OPERATIONS,
    ...(context.exposedWorkspaceOperations ?? []),
    operation,
  ]))
}

async function executeSkillAction(
  loadedSkill: RuntimeLoadedSkill,
  action: RuntimeSkillActionDeclaration,
  input: Record<string, unknown>,
  context: RuntimeActionExecutorContext,
): Promise<RuntimeActionExecutorResult> {
  if (action.executor.type === "builtin") {
    const executor = BUILTIN_ACTION_EXECUTORS[action.executor.name]
    if (!executor) {
      throw toolError(
        "ACTION_EXECUTOR_NOT_FOUND",
        `Built-in action executor was not found: ${action.executor.name}`,
        {
          executor: action.executor,
          availableExecutors: Object.keys(BUILTIN_ACTION_EXECUTORS).sort(),
        },
      )
    }

    return executor(context)
  }

  if (action.executor.type === WORKSPACE_OPERATION_EXECUTOR_TYPE) {
    const operation = action.executor.operation ?? action.executor.name as WorkspaceOperationName
    const output = await runWithExecutorTimeout(
      action.executor,
      context.signal,
      () => executeWorkspaceOperation(
        workspaceOperationRequestFromExecutor(action.executor, input),
        {
          workspaceFiles: context.workspaceFiles,
          agentContext: context.agentContext,
          mutations: context.workspaceMutations,
          exposedOperations: exposedOperationsForWorkspaceAction(context, operation),
        },
      ),
    )

    return {
      status: "executed",
      output,
    }
  }

  if (action.executor.type === PLATFORM_ACTION_EXECUTOR_TYPE) {
    if (!context.runPlatformAction) {
      throw toolError(
        "PLATFORM_ACTION_UNAVAILABLE",
        "Platform action executor is not available in this runtime.",
        { executor: action.executor },
      )
    }

    const result = await runWithExecutorTimeout(
      action.executor,
      context.signal,
      () => context.runPlatformAction?.({
        action: action.executor.name,
        params: input,
      }) ?? Promise.resolve({
        ok: false,
        error: {
          code: "PLATFORM_ACTION_UNAVAILABLE",
          message: "Platform action executor is not available in this runtime.",
        },
      }),
    )
    if (!result.ok) {
      throw toolError(
        "PLATFORM_ACTION_FAILED",
        `Platform action failed: ${action.executor.name}`,
        {
          action: action.executor.name,
          platformError: result.error ?? null,
        },
      )
    }

    return {
      status: "executed",
      output: result.item ?? null,
    }
  }

  if (action.executor.type === BROWSER_SCRIPT_EXECUTOR_TYPE) {
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
      () => context.runBrowserScript?.({
        skillName: loadedSkill.skill.name,
        skillPath: loadedSkill.skill.path,
        actionName: action.name,
        scriptPath,
        input,
        timeoutMs: effectiveExecutorTimeoutMs(action.executor),
      }) ?? Promise.resolve({
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

  throw toolError(
    "ACTION_EXECUTOR_UNSUPPORTED",
    `Action executor type is not supported: ${action.executor.type}`,
    { executor: action.executor },
  )
}

function loadSkillByName(
  context: RuntimeWorkspaceToolExecutionContext,
  input: Record<string, unknown>,
): Record<string, unknown> {
  if (!context.agentContext) {
    throw toolError(
      "SKILL_CONTEXT_REQUIRED",
      "skill_load requires an active Agent context.",
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
        scope: skill.scope,
        ...(skill.agentId ? { agentId: skill.agentId } : {}),
      },
      actionCount: actions.length,
      declarationErrorCount: actionDeclarationErrors.length,
    },
  })

  return {
    loadedSkill: loadedSkillDetails(skill, actions, actionDeclarationErrors),
    file: {
      mediaType: file.mediaType,
      content: file.content,
      updatedAt: file.updatedAt,
    },
  }
}

async function validateSkillActionCall(
  context: RuntimeWorkspaceToolExecutionContext,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const skillName = normalizeRequiredString(
    input.skill,
    "ACTION_SKILL_REQUIRED",
    "action_call requires a non-empty string skill.",
  )
  const actionName = normalizeRequiredString(
    input.action,
    "ACTION_NAME_REQUIRED",
    "action_call requires a non-empty string action.",
  )
  const actionInput = input.input === undefined ? {} : input.input
  if (!isRecord(actionInput)) {
    throw toolError(
      "ACTION_INPUT_INVALID",
      "action_call input must be a JSON object when provided.",
    )
  }

  const loadedSkill = findLoadedSkill(context.sessionState, skillName)
  if (!loadedSkill) {
    throw toolError(
      "SKILL_ACTION_NOT_LOADED",
      `Skill must be loaded before calling its actions: ${skillName}`,
      { skill: skillName },
    )
  }

  const action = findDeclaredAction(loadedSkill, actionName)
  if (!action) {
    throw toolError(
      "ACTION_NOT_FOUND",
      `Action is not declared by loaded Skill "${loadedSkill.skill.name}": ${actionName}`,
      {
        skill: loadedSkill.skill.name,
        action: actionName,
        availableActions: loadedSkill.actions.map((candidate) => ({
          name: candidate.name,
          description: candidate.description,
        })),
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
    runPlatformAction: context.runPlatformAction,
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

  let observation: RuntimeWorkspaceToolObservation
  try {
    if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.skillLoad) {
      observation = {
        index,
        name: call.name,
        ok: true,
        result: loadSkillByName(context, call.arguments),
      }
    } else if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.actionCall) {
      observation = {
        index,
        name: call.name,
        ok: true,
        result: await validateSkillActionCall(context, call.arguments),
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
    } else if (call.name.startsWith("workspace.")) {
      observation = {
        index,
        name: call.name,
        ok: true,
        result: await executeWorkspaceOperation(
          workspaceOperationRequestFromToolCall(call),
          {
            workspaceFiles: context.workspaceFiles,
            agentContext: context.agentContext,
            mutations: context.workspaceMutations,
            exposedOperations: context.exposedWorkspaceOperations,
          },
        ),
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

  emitToolObservationTrace(context, call, observation)
  return observation
}

export async function executeRuntimeWorkspaceToolCalls(
  context: RuntimeWorkspaceToolExecutionContext,
  calls: ParsedRuntimeWorkspaceToolCall[],
): Promise<RuntimeWorkspaceToolObservation[]> {
  const observations: RuntimeWorkspaceToolObservation[] = []
  for (const [index, call] of calls.entries()) {
    observations.push(await executeRuntimeWorkspaceToolCall(context, call, index))
  }

  return observations
}

export function formatRuntimeWorkspaceToolObservationMessage(
  observations: RuntimeWorkspaceToolObservation[],
): string {
  return [
    "Workspace tool observations:",
    "<tsian-tool-observation>",
    JSON.stringify(observations, null, 2),
    "</tsian-tool-observation>",
    "Use these observations to continue. If you have enough context, provide the required final output without tool-call blocks.",
  ].join("\n")
}
