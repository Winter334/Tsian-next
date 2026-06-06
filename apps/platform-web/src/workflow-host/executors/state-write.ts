import type {
  MemorySchemaDefinition,
  StateWriteOperation,
  StateWriteNodeConfig,
} from "@tsian/contracts"
import {
  assertValidMemorySchema,
  MemoryValidationError,
  normalizeStateWriteOperation,
} from "@tsian/memory-core"
import type { NodeExecutor } from "@tsian/workflow-engine"
import {
  applyStateWriteOperationsForSave,
  createCheckpointForSave,
  listArchivesForSave,
  listEventsForSave,
  listLocalStateRecordsForSave,
} from "../../storage"
import type { PlatformWorkflowContext } from "../types"

function readStateWriteConfig(raw: unknown): StateWriteNodeConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(
      `state-write node config is invalid: expected { operationsVarName: string }`,
    )
  }
  const config = raw as Partial<StateWriteNodeConfig>
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
    throw new Error(`state-write node requires PlatformWorkflowContext`)
  }
  return ctx as PlatformWorkflowContext
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readOperations(raw: unknown): StateWriteOperation[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => {
      if (!isPlainObject(item)) {
        throw new Error("state-write operations array contains non-object item")
      }
      return item as unknown as StateWriteOperation
    })
  }

  if (isPlainObject(raw)) {
    const operations = raw.operations
    if (Array.isArray(operations)) {
      return readOperations(operations)
    }
    return [raw as unknown as StateWriteOperation]
  }

  throw new Error("state-write node expected operations input to be an object or array")
}

function getSnapshotMessages(snapshot: {
  state: { messages?: Array<{ role: string; content: string }> }
}): Array<{ role: string; content: string }> {
  return Array.isArray(snapshot.state.messages) ? snapshot.state.messages : []
}

function checkpointReason(
  raw: StateWriteNodeConfig["pushCheckpointReason"],
): "after-turn" | "manual" | null {
  if (raw === "manual") return "manual"
  if (raw === "after-turn") return "after-turn"
  return null
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function usesConfiguredSchema(
  schema: MemorySchemaDefinition,
  operation: StateWriteOperation,
  defaults: { namespace?: string; collection?: string },
): boolean {
  const collection =
    optionalText(operation.collection) ?? optionalText(defaults.collection)
  if (!collection || !schema.collections[collection]) {
    return false
  }

  const namespace =
    optionalText(operation.namespace) ??
    optionalText(defaults.namespace) ??
    schema.defaultNamespace

  return !schema.defaultNamespace || namespace === schema.defaultNamespace
}

function formatValidationError(error: MemoryValidationError): string {
  const details = error.issues
    .map((issue) => `${issue.code} at ${issue.path}: ${issue.message}`)
    .join("; ")
  return details
    ? `state-write schema validation failed: ${details}`
    : "state-write schema validation failed"
}

function normalizeSchemaCoveredOperations(
  operations: StateWriteOperation[],
  defaults: { namespace?: string; collection?: string },
  schema: MemorySchemaDefinition | undefined,
): StateWriteOperation[] {
  if (!schema) {
    return operations
  }

  try {
    assertValidMemorySchema(schema)
  } catch (error) {
    if (error instanceof MemoryValidationError) {
      throw new Error(formatValidationError(error))
    }
    throw error
  }

  return operations.map((operation) => {
    if (!usesConfiguredSchema(schema, operation, defaults)) {
      return operation
    }

    try {
      return normalizeStateWriteOperation(
        schema,
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

export const stateWriteExecutor: NodeExecutor = {
  async execute({ node, inputs, context }) {
    const config = readStateWriteConfig(node.config)
    const ctx = castPlatformContext(context)
    const operations = readOperations(inputs[config.operationsVarName])
    const defaults = {
      namespace: config.namespace,
      collection: config.collection,
    }
    const normalizedOperations = normalizeSchemaCoveredOperations(
      operations,
      defaults,
      config.schema,
    )
    const result = await applyStateWriteOperationsForSave(
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
        stateRecords: await listLocalStateRecordsForSave(ctx.saveId),
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
