import type {
  RuntimeAgentCallHistoryMode,
  RuntimeWorkspaceToolError,
  RuntimeWorkspaceToolExecutionContext,
  RuntimeWorkspaceToolSessionState,
} from "../workspace-tools-types"
import { normalizeWorkspacePath } from "@/lib/workspace-path"

export const BROWSER_SCRIPT_EXECUTOR_TYPE = "browser_script"
export const DEFAULT_AGENT_CALL_HISTORY_MODE: RuntimeAgentCallHistoryMode = "recent"
export const AGENT_CALL_HISTORY_MODES = new Set<RuntimeAgentCallHistoryMode>([
  "minimal",
  "recent",
  "scene",
])
export const DEFAULT_CONTROLLED_EXECUTOR_TIMEOUT_MS = 10_000
export const MAX_CONTROLLED_EXECUTOR_TIMEOUT_MS = 60_000
export const SUPPORTED_ACTION_SCHEMA_TYPES = new Set([
  "array",
  "boolean",
  "integer",
  "null",
  "number",
  "object",
  "string",
])

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function toolError(
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

export function normalizeWorkspaceFilePath(value: unknown): string {
  const result = normalizeWorkspacePath(value, {
    allowEmpty: false,
    rejectTrailingSlash: true,
  })
  if (!result.ok) {
    throw toolError(result.code, result.message)
  }
  return result.path
}

export function traceBase(context: RuntimeWorkspaceToolExecutionContext) {
  return {
    ...(context.agentContext ? { agentId: context.agentContext.agent.id } : {}),
    ...(context.debugLabel ? { debugLabel: context.debugLabel } : {}),
  }
}

export function normalizeRequiredString(
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

export function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

export function normalizedLookupKey(value: string): string {
  return value.trim().toLowerCase()
}
