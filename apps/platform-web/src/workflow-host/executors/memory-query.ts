import type { MemoryQueryNodeConfig } from "@tsian/contracts"
import type { NodeExecutor } from "@tsian/workflow-engine"
import { assembleRetrievalContext } from "../../runtime-host/retrieval"
import { listMemoryRecordsForSave } from "../../storage"
import type { PlatformWorkflowContext } from "../types"

function readMemoryQueryConfig(raw: unknown): MemoryQueryNodeConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(
      `memory-query node config is invalid: expected { source: "event-archive" | "collection" }`,
    )
  }
  const config = raw as Partial<MemoryQueryNodeConfig>
  if (config.source !== "event-archive" && config.source !== "collection") {
    throw new Error(
      `memory-query node config is invalid: source must be "event-archive" or "collection"`,
    )
  }
  return config as MemoryQueryNodeConfig
}

function castPlatformContext(raw: unknown): PlatformWorkflowContext {
  const ctx = raw as Partial<PlatformWorkflowContext>
  if (!ctx || typeof ctx.saveId !== "string" || !ctx.runtimeEngine) {
    throw new Error(`memory-query node requires PlatformWorkflowContext`)
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

export const memoryQueryExecutor: NodeExecutor = {
  async execute({ node, inputs, context }) {
    const config = readMemoryQueryConfig(node.config)
    const ctx = castPlatformContext(context)
    const query =
      readStringInput(inputs, config.queryVarName) ??
      config.query ??
      ctx.macros["user.input"] ??
      ctx.userInput

    if (config.source === "collection") {
      const records = await listMemoryRecordsForSave(ctx.saveId, {
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
    }

    const result = await assembleRetrievalContext({
      messages: [...ctx.history],
      userInput: query,
      events: [...ctx.events],
      catalogEvents: [...ctx.catalogEvents],
      activeEvent: ctx.activeEvents[0] ?? null,
      activeEvents: [...ctx.activeEvents],
      archives: [...ctx.archives],
      currentTime: ctx.currentTime,
      narrativeTimeText: ctx.narrativeTimeText,
      globals: ctx.globals,
      playerArchiveIds: [...ctx.playerArchiveIds],
      settings: ctx.retrievalSettings,
    })

    const debug = {
      ...result.debug,
      turn: ctx.turn,
    }
    ctx.recordRetrievalDebug?.(debug)
    const hitArchiveIds = new Set(debug.archives.map((archive) => archive.id))
    const hitArchives = ctx.archives.filter((archive) => hitArchiveIds.has(archive.id))

    return {
      outputs: {
        prompt: result.prompt,
        directEntities: debug.directEntities,
        archives: hitArchives,
        debug,
      },
    }
  },
}
