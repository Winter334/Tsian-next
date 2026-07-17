import type {
  RuntimeAgentCallArguments,
  RuntimeAgentCallHistoryMode,
} from "../workspace-tools-types"
import {
  AGENT_CALL_HISTORY_MODES,
  DEFAULT_AGENT_CALL_HISTORY_MODE,
  normalizeOptionalString,
  normalizeRequiredString,
  toolError,
} from "./shared"

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

export function normalizeAgentCallArguments(
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
