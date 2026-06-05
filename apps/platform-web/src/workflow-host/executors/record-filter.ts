import type {
  RecordFilterNodeConfig,
  RecordFilterPredicate,
} from "@tsian/contracts"
import type { NodeExecutor } from "@tsian/workflow-engine"
import { resolvePath } from "./template-utils"

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readRecordFilterConfig(raw: unknown): RecordFilterNodeConfig {
  if (raw !== undefined && !isPlainObject(raw)) {
    throw new Error("record-filter node config is invalid: expected object config")
  }
  const config = (raw ?? {}) as Partial<RecordFilterNodeConfig>
  if (config.match !== undefined && config.match !== "all" && config.match !== "any") {
    throw new Error('record-filter node config.match must be "all" or "any"')
  }
  if (config.predicates !== undefined && !Array.isArray(config.predicates)) {
    throw new Error("record-filter node config.predicates must be an array")
  }
  return {
    inputVarName: readText(config.inputVarName, "records"),
    outputName: readText(config.outputName, "records"),
    match: config.match ?? "all",
    predicates: (config.predicates ?? []).map(readPredicate),
    limit: normalizeLimit(config.limit),
  }
}

function readText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}

function normalizeLimit(value: unknown): number | undefined {
  return typeof value === "number" && value > 0 ? Math.floor(value) : undefined
}

function readPredicate(raw: unknown): RecordFilterPredicate {
  if (!isPlainObject(raw)) {
    throw new Error("record-filter predicate must be an object")
  }
  const path = raw.path
  const op = raw.op
  if (typeof path !== "string" || !path.trim()) {
    throw new Error("record-filter predicate.path must be a non-empty string")
  }
  if (
    op !== "exists" &&
    op !== "equals" &&
    op !== "not-equals" &&
    op !== "contains" &&
    op !== "in"
  ) {
    throw new Error("record-filter predicate.op is invalid")
  }
  return {
    path: path.trim(),
    op,
    value: raw.value as RecordFilterPredicate["value"],
    caseSensitive: typeof raw.caseSensitive === "boolean" ? raw.caseSensitive : undefined,
  }
}

function readArrayInput(inputs: Record<string, unknown>, key: string): unknown[] {
  const value = inputs[key]
  if (!Array.isArray(value)) {
    throw new Error(`record-filter node expected inputs["${key}"] to be an array`)
  }
  return value
}

function normalizeComparable(value: unknown, caseSensitive: boolean | undefined): unknown {
  if (typeof value === "string" && caseSensitive !== true) {
    return value.toLowerCase()
  }
  return value
}

function valuesEqual(left: unknown, right: unknown, caseSensitive?: boolean): boolean {
  const normalizedLeft = normalizeComparable(left, caseSensitive)
  const normalizedRight = normalizeComparable(right, caseSensitive)
  if (normalizedLeft === normalizedRight) return true
  if (typeof normalizedLeft === "object" || typeof normalizedRight === "object") {
    return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight)
  }
  return false
}

function valueContains(container: unknown, needle: unknown, caseSensitive?: boolean): boolean {
  if (Array.isArray(container)) {
    return container.some((item) => valuesEqual(item, needle, caseSensitive))
  }
  if (typeof container === "string") {
    const haystack = caseSensitive === true ? container : container.toLowerCase()
    const query = String(needle ?? "")
    return haystack.includes(caseSensitive === true ? query : query.toLowerCase())
  }
  if (container !== undefined && container !== null) {
    const haystack = JSON.stringify(container)
    const query = String(needle ?? "")
    return (caseSensitive === true ? haystack : haystack.toLowerCase()).includes(
      caseSensitive === true ? query : query.toLowerCase(),
    )
  }
  return false
}

function matchesPredicate(item: unknown, predicate: RecordFilterPredicate): boolean {
  const value = resolvePath(item, predicate.path.split(".").filter(Boolean))
  if (predicate.op === "exists") return value !== undefined && value !== null
  if (predicate.op === "equals") {
    return valuesEqual(value, predicate.value, predicate.caseSensitive)
  }
  if (predicate.op === "not-equals") {
    return !valuesEqual(value, predicate.value, predicate.caseSensitive)
  }
  if (predicate.op === "contains") {
    return valueContains(value, predicate.value, predicate.caseSensitive)
  }
  if (predicate.op === "in") {
    return Array.isArray(predicate.value) &&
      predicate.value.some((item) => valuesEqual(value, item, predicate.caseSensitive))
  }
  return false
}

export const recordFilterExecutor: NodeExecutor = {
  async execute({ node, inputs }) {
    const config = readRecordFilterConfig(node.config)
    const records = readArrayInput(inputs, config.inputVarName ?? "records")
    const predicates = config.predicates ?? []
    const filtered = predicates.length === 0
      ? records
      : records.filter((record) => {
        const results = predicates.map((predicate) => matchesPredicate(record, predicate))
        return config.match === "any" ? results.some(Boolean) : results.every(Boolean)
      })
    const limited = config.limit ? filtered.slice(0, config.limit) : filtered
    const outputName = config.outputName ?? "records"
    return {
      outputs: {
        [outputName]: limited,
        count: limited.length,
      },
    }
  },
}
