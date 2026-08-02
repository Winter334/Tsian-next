import { summarizeTraceValue } from "../trace"
import {
  RUNTIME_WORKSPACE_TOOL_NAMES,
  isWorkspaceOperationToolName,
  type RuntimeWorkspaceToolCall,
  type RuntimeWorkspaceToolExecutionContext,
  type RuntimeWorkspaceToolObservation,
} from "../workspace-tools-types"
import { isRecord, traceBase } from "./shared"
import { buildToolPresentation } from "./observations"

function serializedLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? String(value).length
  } catch {
    return String(value).length
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

export function emitToolObservationTrace(
  context: RuntimeWorkspaceToolExecutionContext,
  call: RuntimeWorkspaceToolCall,
  rawObservation: RuntimeWorkspaceToolObservation,
  agentObservation: RuntimeWorkspaceToolObservation,
  durationMs?: number,
): void {
  emitAgentCallTrace(context, call, rawObservation, durationMs)
  emitWorkspaceToolTrace(context, call, rawObservation, durationMs)
  emitActionCallTrace(context, call, rawObservation, durationMs)
  const presentation = buildToolPresentation(call, rawObservation)
  const agentText = (() => {
    try {
      return JSON.stringify({ ...agentObservation, imageParts: undefined })
    } catch {
      return ""
    }
  })()
  const result = isRecord(agentObservation.result) ? agentObservation.result : {}
  context.emitTrace?.({
    type: "tool_projected",
    ...traceBase(context),
    ok: rawObservation.ok,
    data: {
      tool: call.name,
      toolCallId: call.id,
      rawChars: serializedLength(rawObservation),
      agentChars: agentText.length,
      uiChars: serializedLength(presentation),
      truncated: agentText.includes('"truncatedForModel":true')
        || result.truncated === true,
      anchors: Array.isArray(result.anchors) ? result.anchors : undefined,
      ...(durationMs !== undefined ? { durationMs } : {}),
    },
  })
}
