import type { RuntimeWorkspaceMutationEvent } from "@tsian/contracts"
import { validateStrictJson } from "./strict-json"

const MUTATION_EVENT_FIELDS = new Set([
  "invocationId",
  "saveId",
  "source",
  "actionId",
  "writtenPaths",
  "deletedPaths",
])

const INVOCATION_ID_MAX_LENGTH = 128
const INVOCATION_ID_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/
const ACTION_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

function isCanonicalIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.trim() === value
}

function isInvocationId(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= INVOCATION_ID_MAX_LENGTH
    && INVOCATION_ID_PATTERN.test(value)
}

function isActionId(value: unknown): value is string {
  return typeof value === "string" && ACTION_ID_PATTERN.test(value)
}

function isCanonicalPathArray(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false

  let previous: string | undefined
  for (const path of value) {
    if (typeof path !== "string"
      || path.length === 0
      || path.trim() !== path
      || (previous !== undefined && previous >= path)) {
      return false
    }
    previous = path
  }
  return true
}

/**
 * Parses a path-only mutation notification without normalizing untrusted data.
 * The host is required to emit deduplicated, stable-sorted path arrays; a
 * malformed or lossy event is ignored rather than delivered to subscribers.
 */
export function parseWorkspaceMutationEvent(
  value: unknown,
): RuntimeWorkspaceMutationEvent | null {
  try {
    const validation = validateStrictJson(value)
    if (!validation.ok
      || value === null
      || typeof value !== "object"
      || Array.isArray(value)) {
      return null
    }

    const keys = Reflect.ownKeys(value)
    if (keys.length !== MUTATION_EVENT_FIELDS.size
      || !keys.every((key) => typeof key === "string" && MUTATION_EVENT_FIELDS.has(key))) {
      return null
    }

    const fields = new Map<string, unknown>()
    for (const key of keys) {
      if (typeof key !== "string") return null
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null
      fields.set(key, descriptor.value)
    }

    const invocationId = fields.get("invocationId")
    const saveId = fields.get("saveId")
    const source = fields.get("source")
    const actionId = fields.get("actionId")
    const writtenPaths = fields.get("writtenPaths")
    const deletedPaths = fields.get("deletedPaths")

    if (!isInvocationId(invocationId)
      || !isCanonicalIdentifier(saveId)
      || source !== "frontend-action"
      || !isActionId(actionId)
      || !isCanonicalPathArray(writtenPaths)
      || !isCanonicalPathArray(deletedPaths)
      || (writtenPaths.length === 0 && deletedPaths.length === 0)) {
      return null
    }

    return {
      invocationId,
      saveId,
      source,
      actionId,
      writtenPaths,
      deletedPaths,
    }
  } catch {
    return null
  }
}
