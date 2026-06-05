import type { RecordFormatNodeConfig } from "@tsian/contracts"
import type { NodeExecutor } from "@tsian/workflow-engine"
import { renderWorkflowTemplate } from "./template-utils"

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readRecordFormatConfig(raw: unknown): RecordFormatNodeConfig {
  if (!isPlainObject(raw) || typeof raw.itemTemplate !== "string") {
    throw new Error(
      "record-format node config is invalid: expected { itemTemplate: string }",
    )
  }
  return {
    inputVarName: readText(raw.inputVarName, "records"),
    outputName: readText(raw.outputName, "text"),
    itemTemplate: raw.itemTemplate,
    separator: typeof raw.separator === "string" ? raw.separator : "\n",
    prefix: typeof raw.prefix === "string" ? raw.prefix : undefined,
    suffix: typeof raw.suffix === "string" ? raw.suffix : undefined,
    emptyText: typeof raw.emptyText === "string" ? raw.emptyText : "",
  }
}

function readText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}

function readArrayInput(inputs: Record<string, unknown>, key: string): unknown[] {
  const value = inputs[key]
  if (!Array.isArray(value)) {
    throw new Error(`record-format node expected inputs["${key}"] to be an array`)
  }
  return value
}

export const recordFormatExecutor: NodeExecutor = {
  async execute({ node, inputs, context }) {
    const config = readRecordFormatConfig(node.config)
    const records = readArrayInput(inputs, config.inputVarName ?? "records")
    const macros = (context as { macros?: Record<string, string> }).macros ?? {}
    const outputName = config.outputName ?? "text"
    const text = records.length === 0
      ? config.emptyText ?? ""
      : [
        config.prefix ?? "",
        records.map((record, index) =>
          renderWorkflowTemplate(config.itemTemplate, inputs, macros, {
            item: record,
            record,
            index,
            number: index + 1,
          }),
        ).join(config.separator ?? "\n"),
        config.suffix ?? "",
      ].join("")

    return {
      outputs: {
        [outputName]: text,
        count: records.length,
      },
    }
  },
}
