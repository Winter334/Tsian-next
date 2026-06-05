import type { RecordMergeNodeConfig } from "@tsian/contracts"
import type { NodeExecutor } from "@tsian/workflow-engine"
import { resolvePath } from "./template-utils"

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readRecordMergeConfig(raw: unknown): RecordMergeNodeConfig {
  if (!isPlainObject(raw)) {
    throw new Error(
      "record-merge node config is invalid: expected { inputVarNames: string[] }",
    )
  }
  if (!Array.isArray(raw.inputVarNames)) {
    throw new Error("record-merge node config.inputVarNames must be an array")
  }
  const inputVarNames = raw.inputVarNames
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
  if (inputVarNames.length === 0) {
    throw new Error("record-merge node config.inputVarNames must contain at least one name")
  }
  const strategy = raw.strategy === "last" ? "last" : "first"
  return {
    inputVarNames,
    keyPath: typeof raw.keyPath === "string" && raw.keyPath.trim()
      ? raw.keyPath.trim()
      : "id",
    strategy,
    outputName: typeof raw.outputName === "string" && raw.outputName.trim()
      ? raw.outputName.trim()
      : "records",
    limit: typeof raw.limit === "number" && raw.limit > 0
      ? Math.floor(raw.limit)
      : undefined,
  }
}

function readArrayInput(inputs: Record<string, unknown>, key: string): unknown[] {
  const value = inputs[key]
  if (!Array.isArray(value)) {
    throw new Error(`record-merge node expected inputs["${key}"] to be an array`)
  }
  return value
}

function keyForItem(item: unknown, keyPath: string, fallback: string): string {
  const value = resolvePath(item, keyPath.split(".").filter(Boolean))
  if (value === undefined || value === null || value === "") return fallback
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  return JSON.stringify(value)
}

export const recordMergeExecutor: NodeExecutor = {
  async execute({ node, inputs }) {
    const config = readRecordMergeConfig(node.config)
    const outputName = config.outputName ?? "records"
    const keyPath = config.keyPath ?? "id"
    const merged: unknown[] = []
    const indexByKey = new Map<string, number>()

    for (const inputName of config.inputVarNames) {
      const items = readArrayInput(inputs, inputName)
      for (const [itemIndex, item] of items.entries()) {
        const key = keyForItem(item, keyPath, `${inputName}:${itemIndex}:${merged.length}`)
        const existingIndex = indexByKey.get(key)
        if (existingIndex === undefined) {
          indexByKey.set(key, merged.length)
          merged.push(item)
          continue
        }
        if (config.strategy === "last") {
          merged[existingIndex] = item
        }
      }
    }

    const limited = config.limit ? merged.slice(0, config.limit) : merged
    return {
      outputs: {
        [outputName]: limited,
        count: limited.length,
      },
    }
  },
}
