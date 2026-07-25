import type { JsonValue } from "@tsian/contracts"

/** Host-matched hard limits for Frontend Action input/output transport values. */
export const FRONTEND_ACTION_JSON_MAX_BYTES = 1024 * 1024
export const FRONTEND_ACTION_JSON_MAX_DEPTH = 64
export const FRONTEND_ACTION_JSON_MAX_NODES = 100_000

export interface StrictJsonLimits {
  maxBytes?: number
  maxDepth?: number
  maxNodes?: number
}

export type StrictJsonValidationResult =
  | {
      ok: true
      value: JsonValue
      byteLength: number
      maxDepth: number
      nodeCount: number
    }
  | { ok: false }

interface ResolvedStrictJsonLimits {
  maxBytes: number
  maxDepth: number
  maxNodes: number
}

const DEFAULT_LIMITS: ResolvedStrictJsonLimits = {
  maxBytes: FRONTEND_ACTION_JSON_MAX_BYTES,
  maxDepth: FRONTEND_ACTION_JSON_MAX_DEPTH,
  maxNodes: FRONTEND_ACTION_JSON_MAX_NODES,
}

function resolveLimits(limits: StrictJsonLimits): ResolvedStrictJsonLimits {
  const resolved = { ...DEFAULT_LIMITS, ...limits }
  if (!Number.isInteger(resolved.maxBytes) || resolved.maxBytes < 0) {
    throw new RangeError("maxBytes must be a non-negative integer.")
  }
  if (!Number.isInteger(resolved.maxDepth) || resolved.maxDepth < 0) {
    throw new RangeError("maxDepth must be a non-negative integer.")
  }
  if (!Number.isInteger(resolved.maxNodes) || resolved.maxNodes < 1) {
    throw new RangeError("maxNodes must be a positive integer.")
  }
  return resolved
}

/** UTF-8 byte length of a string after JSON string escaping, including quotes. */
function jsonStringByteLength(value: string): number {
  let bytes = 2
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code === 0x22 || code === 0x5c) {
      bytes += 2
    } else if (code <= 0x1f) {
      bytes += code === 0x08
        || code === 0x09
        || code === 0x0a
        || code === 0x0c
        || code === 0x0d
        ? 2
        : 6
    } else if (code <= 0x7f) {
      bytes += 1
    } else if (code <= 0x7ff) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else {
        // Well-formed JSON.stringify escapes unpaired surrogates as \udxxx.
        bytes += 6
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 6
    } else {
      bytes += 3
    }
  }
  return bytes
}

/**
 * Validates the host's strict JSON subset without invoking accessors or
 * modifying the supplied value. The root has depth 0 and counts as one node;
 * byte length is the compact JSON serialization's UTF-8 length.
 */
export function validateStrictJson(
  value: unknown,
  limits: StrictJsonLimits = {},
): StrictJsonValidationResult {
  const resolved = resolveLimits(limits)
  const activeObjects = new WeakSet<object>()
  let byteLength = 0
  let nodeCount = 0
  let observedMaxDepth = 0

  const addBytes = (amount: number): boolean => {
    byteLength += amount
    return byteLength <= resolved.maxBytes
  }

  const visit = (current: unknown, depth: number): boolean => {
    if (depth > resolved.maxDepth) return false
    observedMaxDepth = Math.max(observedMaxDepth, depth)
    nodeCount += 1
    if (nodeCount > resolved.maxNodes) return false

    if (current === null) return addBytes(4)

    switch (typeof current) {
      case "string":
        return addBytes(jsonStringByteLength(current))
      case "boolean":
        return addBytes(current ? 4 : 5)
      case "number": {
        if (!Number.isFinite(current)) return false
        return addBytes(JSON.stringify(current).length)
      }
      case "undefined":
      case "bigint":
      case "function":
      case "symbol":
        return false
      case "object":
        break
      default:
        return false
    }

    const object = current as object
    if (activeObjects.has(object)) return false

    try {
      const prototype = Object.getPrototypeOf(object) as object | null
      const ownKeys = Reflect.ownKeys(object)

      if (Array.isArray(object)) {
        if (prototype !== Array.prototype) return false
        if (!addBytes(2 + Math.max(0, object.length - 1))) return false
        if (nodeCount + object.length > resolved.maxNodes) return false

        const lengthDescriptor = Object.getOwnPropertyDescriptor(object, "length")
        if (!lengthDescriptor
          || !("value" in lengthDescriptor)
          || lengthDescriptor.enumerable
          || lengthDescriptor.value !== object.length) {
          return false
        }

        const descriptors = new Map<string, PropertyDescriptor>()
        for (const key of ownKeys) {
          if (typeof key === "symbol") return false
          if (key === "length") continue
          const index = Number(key)
          if (!Number.isInteger(index)
            || index < 0
            || index >= object.length
            || String(index) !== key) {
            return false
          }
          const descriptor = Object.getOwnPropertyDescriptor(object, key)
          if (!descriptor
            || !("value" in descriptor)
            || !descriptor.enumerable) {
            return false
          }
          descriptors.set(key, descriptor)
        }
        if (descriptors.size !== object.length) return false

        activeObjects.add(object)
        try {
          for (let index = 0; index < object.length; index += 1) {
            const descriptor = descriptors.get(String(index))
            if (!descriptor || !visit(descriptor.value, depth + 1)) return false
          }
        } finally {
          activeObjects.delete(object)
        }
        return true
      }

      if (prototype !== Object.prototype && prototype !== null) return false
      if (!addBytes(2 + Math.max(0, ownKeys.length - 1))) return false
      if (nodeCount + ownKeys.length > resolved.maxNodes) return false

      const properties: unknown[] = []
      for (const key of ownKeys) {
        if (typeof key === "symbol") return false
        const descriptor = Object.getOwnPropertyDescriptor(object, key)
        if (!descriptor
          || !("value" in descriptor)
          || !descriptor.enumerable) {
          return false
        }
        if (!addBytes(jsonStringByteLength(key) + 1)) return false
        properties.push(descriptor.value)
      }

      activeObjects.add(object)
      try {
        for (const propertyValue of properties) {
          if (!visit(propertyValue, depth + 1)) return false
        }
      } finally {
        activeObjects.delete(object)
      }
      return true
    } catch {
      // Proxies may throw or mutate while descriptors are inspected.
      return false
    }
  }

  try {
    if (!visit(value, 0)) return { ok: false }
  } catch {
    return { ok: false }
  }

  return {
    ok: true,
    value: value as JsonValue,
    byteLength,
    maxDepth: observedMaxDepth,
    nodeCount,
  }
}

export function isStrictJsonValue(value: unknown): value is JsonValue {
  return validateStrictJson(value).ok
}
