import type { StateQueryNodeConfig } from "@tsian/contracts"
import type { NodeExecutor } from "@tsian/workflow-engine"
import { listStateRecordsForSave } from "../../storage"
import type { PlatformWorkflowContext } from "../types"

type NormalizedStateQueryConfig = StateQueryNodeConfig & {
  namespace: string
  collection: string
}

function normalizeRequiredText(value: string | undefined, label: string): string {
  const normalized = value?.trim()
  if (!normalized) {
    throw new Error(`state-query node config is invalid: ${label} is required`)
  }
  return normalized
}

function readStateQueryConfig(raw: unknown): NormalizedStateQueryConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(
      `state-query node config is invalid: expected { source: "collection" }`,
    )
  }
  const config = raw as Partial<StateQueryNodeConfig>
  if (config.source !== "collection") {
    throw new Error(
      `state-query node config is invalid: source must be "collection"`,
    )
  }
  return {
    ...config,
    source: "collection",
    namespace: normalizeRequiredText(config.namespace, "namespace"),
    collection: normalizeRequiredText(config.collection, "collection"),
  }
}

function castPlatformContext(raw: unknown): PlatformWorkflowContext {
  const ctx = raw as Partial<PlatformWorkflowContext>
  if (!ctx || typeof ctx.saveId !== "string" || !ctx.runtimeEngine) {
    throw new Error(`state-query node requires PlatformWorkflowContext`)
  }
  return ctx as PlatformWorkflowContext
}

function readStringInput(
  inputs: Record<string, unknown>,
  key: string | undefined,
): string | undefined {
  if (!key) return undefined
  const value = inputs[key]
  return typeof value === "string" ? value : undefined
}

function normalizeLimit(raw: number | undefined): number | undefined {
  if (typeof raw !== "number" || raw <= 0) return undefined
  return Math.floor(raw)
}

export const stateQueryExecutor: NodeExecutor = {
  async execute({ node, inputs, context }) {
    const config = readStateQueryConfig(node.config)
    const ctx = castPlatformContext(context)
    const query =
      readStringInput(inputs, config.queryVarName) ??
      config.query ??
      ctx.macros["user.input"] ??
      ctx.userInput

    const records = await listStateRecordsForSave(ctx.saveId, {
      namespace: config.namespace,
      collection: config.collection,
      query,
      limit: normalizeLimit(config.limit),
    })
    return {
      outputs: {
        records,
        count: records.length,
      },
    }
  },
}
