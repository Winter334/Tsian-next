import type { UiToolPresentation } from "@tsian/contracts"
import {
  RUNTIME_WORKSPACE_TOOL_NAMES,
  type RuntimeWorkspaceToolCall,
  type RuntimeWorkspaceToolObservation,
} from "../workspace-tools-types"
import { isRecord } from "./shared"

export const MAX_AGENT_OBSERVATION_CHARS = 32 * 1024
export const MAX_UI_AGENT_CALL_RESPONSE_CHARS = 8 * 1024

const OBSERVATION_REMEDIATION =
  "Return a concise summary, a bounded page with continuation, or a workspace artifact path that can be read separately."

type JsonValidationFailure =
  | "unsupported-type"
  | "non-finite-number"
  | "circular-reference"
  | "sparse-array"
  | "non-plain-object"
  | "unsupported-property"
  | "inspection-failed"

function validateJsonValue(
  value: unknown,
  activeObjects = new WeakSet<object>(),
): JsonValidationFailure | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return undefined
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? undefined : "non-finite-number"
  }
  if (typeof value !== "object") {
    return "unsupported-type"
  }
  if (activeObjects.has(value)) {
    return "circular-reference"
  }

  activeObjects.add(value)
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) return "non-plain-object"
      const ownKeys = Reflect.ownKeys(value)
      for (const key of ownKeys) {
        if (key === "length") continue
        if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key)) {
          return "unsupported-property"
        }
        const index = Number(key)
        if (!Number.isSafeInteger(index) || index < 0 || index >= value.length) {
          return "unsupported-property"
        }
      }
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) return "sparse-array"
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        if (!descriptor?.enumerable || !("value" in descriptor)) return "unsupported-property"
        const failure = validateJsonValue(descriptor.value, activeObjects)
        if (failure) return failure
      }
      return undefined
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return "non-plain-object"
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") return "unsupported-property"
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor?.enumerable || !("value" in descriptor)) return "unsupported-property"
      const failure = validateJsonValue(descriptor.value, activeObjects)
      if (failure) return failure
    }
    return undefined
  } catch {
    return "inspection-failed"
  } finally {
    activeObjects.delete(value)
  }
}

function textObservation(
  observation: RuntimeWorkspaceToolObservation,
): Omit<RuntimeWorkspaceToolObservation, "imageParts"> {
  if (observation.ok) {
    return {
      index: observation.index,
      name: observation.name,
      ok: true,
      ...(observation.result === undefined ? {} : { result: observation.result }),
    }
  }
  return {
    index: observation.index,
    name: observation.name,
    ok: false,
    ...(observation.error ? { error: observation.error } : {}),
  }
}

function rejectedObservation(
  observation: RuntimeWorkspaceToolObservation,
  error: RuntimeWorkspaceToolObservation["error"],
): RuntimeWorkspaceToolObservation {
  return {
    index: observation.index,
    name: observation.name,
    ok: false,
    error,
    ...(observation.imageParts ? { imageParts: observation.imageParts } : {}),
  }
}

/**
 * Final acceptance gate for the only observation representation allowed into
 * native/text model messages and Tool memory. Producers own pagination and
 * summaries; this boundary never rewrites a successful result.
 */
export function acceptToolObservationForAgent(
  call: RuntimeWorkspaceToolCall | undefined,
  observation: RuntimeWorkspaceToolObservation,
): RuntimeWorkspaceToolObservation {
  const candidate = textObservation(observation)
  const validationFailure = validateJsonValue(candidate)
  const toolName = call?.name ?? observation.name
  if (validationFailure) {
    return rejectedObservation(observation, {
      code: "TOOL_OBSERVATION_INVALID",
      message: `Tool ${toolName} returned a result that is not safely JSON serializable.`,
      details: {
        toolName,
        reason: validationFailure,
        remediation: OBSERVATION_REMEDIATION,
      },
    })
  }

  let serialized: string
  try {
    serialized = JSON.stringify(candidate)
  } catch {
    return rejectedObservation(observation, {
      code: "TOOL_OBSERVATION_INVALID",
      message: `Tool ${toolName} returned a result that is not safely JSON serializable.`,
      details: {
        toolName,
        reason: "serialization-failed",
        remediation: OBSERVATION_REMEDIATION,
      },
    })
  }

  if (serialized.length > MAX_AGENT_OBSERVATION_CHARS) {
    return rejectedObservation(observation, {
      code: "TOOL_OBSERVATION_TOO_LARGE",
      message: `Tool ${toolName} returned ${serialized.length} characters; the maximum accepted observation is ${MAX_AGENT_OBSERVATION_CHARS}.`,
      details: {
        toolName,
        actualChars: serialized.length,
        maxChars: MAX_AGENT_OBSERVATION_CHARS,
        remediation: OBSERVATION_REMEDIATION,
      },
    })
  }

  return observation
}

/** Build the closed UI projection. Ordinary tools intentionally return no
 * payload; only agent_call currently has a real presentation consumer. */
export function buildToolPresentation(
  call: RuntimeWorkspaceToolCall | undefined,
  observation: RuntimeWorkspaceToolObservation,
): UiToolPresentation | undefined {
  if (call?.name !== RUNTIME_WORKSPACE_TOOL_NAMES.agentCall) return undefined
  const requestedAgentId = typeof call.arguments.agentId === "string" ? call.arguments.agentId : ""
  if (!observation.ok) {
    return {
      type: "agent_call",
      targetAgent: { id: requestedAgentId, title: requestedAgentId },
      response: "",
      status: "failed",
      ...(observation.error
        ? { error: { code: observation.error.code, message: observation.error.message } }
        : {}),
    }
  }
  const result = isRecord(observation.result) ? observation.result : {}
  const targetAgent = isRecord(result.targetAgent) ? result.targetAgent : {}
  const response = typeof result.response === "string" ? result.response : ""
  return {
    type: "agent_call",
    targetAgent: {
      id: typeof targetAgent.id === "string" ? targetAgent.id : requestedAgentId,
      title: typeof targetAgent.title === "string" ? targetAgent.title : requestedAgentId,
      ...(typeof targetAgent.summary === "string" ? { summary: targetAgent.summary } : {}),
    },
    response: response.slice(0, MAX_UI_AGENT_CALL_RESPONSE_CHARS),
    ...(response.length > MAX_UI_AGENT_CALL_RESPONSE_CHARS ? { responseTruncated: true } : {}),
    status: "completed",
  }
}

export function formatNativeToolObservationContent(
  observation: RuntimeWorkspaceToolObservation,
): string {
  if (!observation.ok) {
    return JSON.stringify(observation.error ?? { code: "UNKNOWN", message: "Unknown error" })
  }
  return typeof observation.result === "string"
    ? observation.result
    : JSON.stringify(observation.result) ?? "null"
}
