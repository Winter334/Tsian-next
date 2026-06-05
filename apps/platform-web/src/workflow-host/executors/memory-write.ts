import type { MemoryWriteNodeConfig, MemoryWriteOperation } from "@tsian/contracts"
import {
  defaultAirpMemorySchema,
  MemoryValidationError,
  normalizeMemoryWriteOperation,
} from "@tsian/memory-core"
import type { NodeExecutor } from "@tsian/workflow-engine"
import {
  applyMemoryWriteOperationsForSave,
  createCheckpointForSave,
  listArchivesForSave,
  listEventsForSave,
  listLocalMemoryRecordsForSave,
} from "../../storage"
import type { PlatformWorkflowContext } from "../types"

function readMemoryWriteConfig(raw: unknown): MemoryWriteNodeConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(
      `memory-write node config is invalid: expected { operationsVarName: string }`,
    )
  }
  const config = raw as Partial<MemoryWriteNodeConfig>
  return {
    ...config,
    operationsVarName:
      typeof config.operationsVarName === "string" && config.operationsVarName.trim()
        ? config.operationsVarName.trim()
        : "operations",
  }
}

function castPlatformContext(raw: unknown): PlatformWorkflowContext {
  const ctx = raw as Partial<PlatformWorkflowContext>
  if (!ctx || typeof ctx.saveId !== "string") {
    throw new Error(`memory-write node requires PlatformWorkflowContext`)
  }
  return ctx as PlatformWorkflowContext
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readOperations(raw: unknown): MemoryWriteOperation[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => {
      if (!isPlainObject(item)) {
        throw new Error("memory-write operations array contains non-object item")
      }
      return item as unknown as MemoryWriteOperation
    })
  }

  if (isPlainObject(raw)) {
    const operations = raw.operations
    if (Array.isArray(operations)) {
      return readOperations(operations)
    }
    return [raw as unknown as MemoryWriteOperation]
  }

  throw new Error("memory-write node expected operations input to be an object or array")
}

function getSnapshotMessages(snapshot: {
  state: { messages?: Array<{ role: string; content: string }> }
}): Array<{ role: string; content: string }> {
  return Array.isArray(snapshot.state.messages) ? snapshot.state.messages : []
}

function checkpointReason(
  raw: MemoryWriteNodeConfig["pushCheckpointReason"],
): "after-turn" | "manual" | null {
  if (raw === "none") return null
  if (raw === "manual") return "manual"
  return "after-turn"
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function usesBuiltInAirpSchema(
  operation: MemoryWriteOperation,
  defaults: { namespace?: string; collection?: string },
): boolean {
  const collection =
    optionalText(operation.collection) ?? optionalText(defaults.collection)
  if (!collection || !defaultAirpMemorySchema.collections[collection]) {
    return false
  }

  const namespace =
    optionalText(operation.namespace) ??
    optionalText(defaults.namespace) ??
    defaultAirpMemorySchema.defaultNamespace

  return namespace === defaultAirpMemorySchema.defaultNamespace
}

function formatValidationError(error: MemoryValidationError): string {
  const details = error.issues
    .map((issue) => `${issue.code} at ${issue.path}: ${issue.message}`)
    .join("; ")
  return details
    ? `memory-write schema validation failed: ${details}`
    : "memory-write schema validation failed"
}

function normalizeSchemaCoveredOperations(
  operations: MemoryWriteOperation[],
  defaults: { namespace?: string; collection?: string },
): MemoryWriteOperation[] {
  return operations.map((operation) => {
    if (!usesBuiltInAirpSchema(operation, defaults)) {
      return operation
    }

    try {
      return normalizeMemoryWriteOperation(
        defaultAirpMemorySchema,
        operation,
        defaults,
      )
    } catch (error) {
      if (error instanceof MemoryValidationError) {
        throw new Error(formatValidationError(error))
      }
      throw error
    }
  })
}

export const memoryWriteExecutor: NodeExecutor = {
  async execute({ node, inputs, context }) {
    const config = readMemoryWriteConfig(node.config)
    const ctx = castPlatformContext(context)
    const operations = readOperations(inputs[config.operationsVarName])
    const defaults = {
      namespace: config.namespace,
      collection: config.collection,
    }
    const normalizedOperations = normalizeSchemaCoveredOperations(
      operations,
      defaults,
    )
    const result = await applyMemoryWriteOperationsForSave(
      ctx.saveId,
      normalizedOperations,
      defaults,
    )
    const reason = checkpointReason(config.pushCheckpointReason)
    if (reason) {
      const latestSnapshot = await ctx.runtimeEngine.getSnapshot()
      await createCheckpointForSave(ctx.saveId, {
        snapshot: latestSnapshot,
        history: getSnapshotMessages(latestSnapshot),
        events: await listEventsForSave(ctx.saveId),
        archives: await listArchivesForSave(ctx.saveId),
        memoryRecords: await listLocalMemoryRecordsForSave(ctx.saveId),
        reason,
      })
    }

    return {
      outputs: {
        upsertedIds: result.upsertedIds,
        deletedIds: result.deletedIds,
        clearedCollections: result.clearedCollections,
      },
    }
  },
}
