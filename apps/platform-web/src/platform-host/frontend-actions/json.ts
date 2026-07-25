import type { JsonValue } from "@tsian/contracts"

export const FRONTEND_ACTION_JSON_MAX_BYTES = 1024 * 1024
export const FRONTEND_ACTION_JSON_MAX_DEPTH = 64
export const FRONTEND_ACTION_JSON_MAX_NODES = 100_000

export interface StrictJsonLimits {
  maxBytes?: number
  maxDepth?: number
  maxNodes?: number
}

export type StrictJsonIssueCode =
  | "unsupported_type"
  | "non_finite_number"
  | "cycle"
  | "sparse_array"
  | "array_property"
  | "non_plain_object"
  | "symbol_property"
  | "non_enumerable_property"
  | "accessor_property"
  | "inspection_failed"
  | "max_bytes"
  | "max_depth"
  | "max_nodes"
  | "invalid_json"

export interface StrictJsonIssue {
  code: StrictJsonIssueCode
  path: string
  message: string
}

export interface StrictJsonStats {
  byteLength: number
  nodeCount: number
  maxDepth: number
}

export type StrictJsonValidationResult =
  | {
      ok: true
      value: JsonValue
      stats: StrictJsonStats
    }
  | {
      ok: false
      issue: StrictJsonIssue
    }

export interface StrictJsonParseOptions extends StrictJsonLimits {
  maxSourceBytes: number
}

export type StrictJsonParseResult =
  | {
      ok: true
      value: JsonValue
      stats: StrictJsonStats
      sourceByteLength: number
    }
  | {
      ok: false
      issue: StrictJsonIssue
    }

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

/** Returns the number of bytes produced by UTF-8 encoding without allocating a copy. */
export function utf8ByteLength(value: string): number {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x7f) {
      bytes += 1
    } else if (code <= 0x7ff) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else {
        // TextEncoder replaces an unpaired surrogate with U+FFFD.
        bytes += 3
      }
    } else {
      bytes += 3
    }
  }
  return bytes
}

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

function displayPropertyPath(path: string, key: string): string {
  const abbreviated = key.length > 80 ? `${key.slice(0, 77)}...` : key
  return `${path}[${JSON.stringify(abbreviated)}]`
}

/**
 * Checks the strict, non-mutating JSON boundary used by Frontend Actions.
 * The root is depth 0; every contained value adds one level and one node.
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
  let issue: StrictJsonIssue | undefined

  const fail = (
    code: StrictJsonIssueCode,
    path: string,
    message: string,
  ): false => {
    issue = { code, path, message }
    return false
  }

  const addBytes = (amount: number, path: string): boolean => {
    byteLength += amount
    return byteLength <= resolved.maxBytes
      || fail("max_bytes", path, `JSON value exceeds ${resolved.maxBytes} bytes.`)
  }

  const visit = (current: unknown, depth: number, path: string): boolean => {
    if (depth > resolved.maxDepth) {
      return fail("max_depth", path, `JSON value exceeds depth ${resolved.maxDepth}.`)
    }
    observedMaxDepth = Math.max(observedMaxDepth, depth)
    nodeCount += 1
    if (nodeCount > resolved.maxNodes) {
      return fail("max_nodes", path, `JSON value exceeds ${resolved.maxNodes} nodes.`)
    }

    if (current === null) return addBytes(4, path)

    switch (typeof current) {
      case "string":
        return addBytes(jsonStringByteLength(current), path)
      case "boolean":
        return addBytes(current ? 4 : 5, path)
      case "number": {
        if (!Number.isFinite(current)) {
          return fail("non_finite_number", path, "JSON numbers must be finite.")
        }
        const serialized = JSON.stringify(current)
        return addBytes(serialized.length, path)
      }
      case "undefined":
      case "bigint":
      case "function":
      case "symbol":
        return fail("unsupported_type", path, `${typeof current} is not a JSON value.`)
      case "object":
        break
      default:
        return fail("unsupported_type", path, "Unsupported JSON value.")
    }

    const object = current as object
    if (activeObjects.has(object)) {
      return fail("cycle", path, "JSON values cannot contain cycles.")
    }

    let prototype: object | null
    let ownKeys: (string | symbol)[]
    try {
      prototype = Object.getPrototypeOf(object) as object | null
      ownKeys = Reflect.ownKeys(object)

      if (Array.isArray(object)) {
        if (prototype !== Array.prototype) {
          return fail("non_plain_object", path, "JSON arrays must use Array.prototype.")
        }
        if (!addBytes(2 + Math.max(0, object.length - 1), path)) return false
        if (nodeCount + object.length > resolved.maxNodes) {
          return fail("max_nodes", path, `JSON value exceeds ${resolved.maxNodes} nodes.`)
        }

        const descriptors = new Map<string, PropertyDescriptor>()
        for (const key of ownKeys) {
          if (typeof key === "symbol") {
            return fail("symbol_property", path, "JSON arrays cannot have symbol properties.")
          }
          if (key === "length") continue
          const numeric = Number(key)
          if (!Number.isInteger(numeric) || numeric < 0 || numeric >= object.length || String(numeric) !== key) {
            return fail("array_property", displayPropertyPath(path, key), "JSON arrays cannot have custom properties.")
          }
          const descriptor = Object.getOwnPropertyDescriptor(object, key)
          if (!descriptor) {
            return fail("inspection_failed", displayPropertyPath(path, key), "Array property disappeared during inspection.")
          }
          if (!("value" in descriptor)) {
            return fail("accessor_property", displayPropertyPath(path, key), "JSON arrays cannot contain accessors.")
          }
          if (!descriptor.enumerable) {
            return fail("non_enumerable_property", displayPropertyPath(path, key), "JSON array elements must be enumerable.")
          }
          descriptors.set(key, descriptor)
        }
        if (descriptors.size !== object.length) {
          return fail("sparse_array", path, "JSON arrays must be dense.")
        }

        activeObjects.add(object)
        try {
          for (let index = 0; index < object.length; index += 1) {
            const descriptor = descriptors.get(String(index))
            if (!descriptor || !visit(descriptor.value, depth + 1, `${path}[${index}]`)) {
              return false
            }
          }
        } finally {
          activeObjects.delete(object)
        }
        return true
      }

      if (prototype !== Object.prototype && prototype !== null) {
        return fail("non_plain_object", path, "JSON objects must be ordinary records.")
      }
      if (!addBytes(2 + Math.max(0, ownKeys.length - 1), path)) return false
      if (nodeCount + ownKeys.length > resolved.maxNodes) {
        return fail("max_nodes", path, `JSON value exceeds ${resolved.maxNodes} nodes.`)
      }

      const properties: Array<[string, unknown]> = []
      for (const key of ownKeys) {
        if (typeof key === "symbol") {
          return fail("symbol_property", path, "JSON objects cannot have symbol properties.")
        }
        const descriptor = Object.getOwnPropertyDescriptor(object, key)
        if (!descriptor) {
          return fail("inspection_failed", displayPropertyPath(path, key), "Object property disappeared during inspection.")
        }
        if (!("value" in descriptor)) {
          return fail("accessor_property", displayPropertyPath(path, key), "JSON objects cannot contain accessors.")
        }
        if (!descriptor.enumerable) {
          return fail("non_enumerable_property", displayPropertyPath(path, key), "JSON object properties must be enumerable.")
        }
        if (!addBytes(jsonStringByteLength(key) + 1, displayPropertyPath(path, key))) {
          return false
        }
        properties.push([key, descriptor.value])
      }

      activeObjects.add(object)
      try {
        for (const [key, propertyValue] of properties) {
          if (!visit(propertyValue, depth + 1, displayPropertyPath(path, key))) {
            return false
          }
        }
      } finally {
        activeObjects.delete(object)
      }
      return true
    } catch {
      return fail("inspection_failed", path, "JSON value could not be inspected safely.")
    }
  }

  if (!visit(value, 0, "$")) {
    return {
      ok: false,
      issue: issue ?? {
        code: "inspection_failed",
        path: "$",
        message: "JSON value could not be inspected safely.",
      },
    }
  }

  return {
    ok: true,
    value: value as JsonValue,
    stats: {
      byteLength,
      nodeCount,
      maxDepth: observedMaxDepth,
    },
  }
}

export function parseStrictJson(
  source: string,
  options: StrictJsonParseOptions,
): StrictJsonParseResult {
  const sourceByteLength = utf8ByteLength(source)
  if (sourceByteLength > options.maxSourceBytes) {
    return {
      ok: false,
      issue: {
        code: "max_bytes",
        path: "$",
        message: `JSON source exceeds ${options.maxSourceBytes} bytes.`,
      },
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(source) as unknown
  } catch {
    return {
      ok: false,
      issue: {
        code: "invalid_json",
        path: "$",
        message: "JSON source is malformed.",
      },
    }
  }

  const validation = validateStrictJson(parsed, options)
  if (!validation.ok) return validation
  return { ...validation, sourceByteLength }
}

function canonicalizeValidatedJson(value: JsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value)
  }
  if (typeof value === "string") return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeValidatedJson).join(",")}]`
  }

  const properties = Object.keys(value).sort()
  return `{${properties
    .map((key) => `${JSON.stringify(key)}:${canonicalizeValidatedJson(value[key]!)}`)
    .join(",")}}`
}

/** Produces a stable cache key after re-checking the strict JSON contract. */
export function canonicalizeStrictJson(value: unknown): string {
  const validation = validateStrictJson(value)
  if (!validation.ok) {
    throw new TypeError(`Cannot canonicalize non-JSON data: ${validation.issue.code}.`)
  }
  return canonicalizeValidatedJson(validation.value)
}
