import type { JsonValue, RuntimeWorkspaceMutationEvent } from "@tsian/contracts"
import {
  commitFrontendActionWorkspace,
  createFrontendActionWorkspaceDependencyTracker,
  createFrontendActionWorkspaceResourceDependency,
  loadFrontendActionWorkspaceSnapshot,
  type FrontendActionWorkspaceCommitResult,
  type FrontendActionWorkspaceSnapshot,
} from "@/storage/frontend-action-workspace"
import { createRuntimeWorkspaceTransaction } from "@/storage/workspace"
import { WorkspaceStorageError } from "@/storage/workspace-types"
import {
  FrontendActionDomainError,
  FrontendActionRuntimeError,
} from "./errors"
import { emitRuntimeWorkspaceMutation } from "./events"
import { ensureFrontendActionRuntimeReady } from "./preflight"
import { validateAndInlineFrontendActionImports } from "./imports"
import { validateStrictJson } from "./json"
import {
  resolveFrontendAction,
  type BoundFrontendActionResource,
} from "./registry"
import { validateFrontendActionData } from "./schema"
import {
  runFrontendActionWorker,
  type FrontendActionWorkerFactory,
} from "./worker"
import { createFrontendActionWorkspaceAdapter } from "./workspace-adapter"

export interface RunFrontendActionInput {
  mountedGameCardId: string
  invocationId: string
  actionId: string
  input: unknown
  signal?: AbortSignal
  /**
   * Mount-owned synchronous lifecycle guard. The storage commit invokes it at
   * transaction entry and again at the final pre-write/no-op boundary.
   */
  assertCommitAllowed?: () => void
  beforeCommit?: (context: FrontendActionBeforeCommitContext) => void | Promise<void>
}

export interface FrontendActionBeforeCommitContext {
  invocationId: string
  actionId: string
  mountedGameCardId: string
  saveId: string
  signal?: AbortSignal
}

export interface FrontendActionRunResult {
  output: JsonValue
  mutationEvent?: RuntimeWorkspaceMutationEvent
}

export interface FrontendActionExecutionService {
  runAction(input: RunFrontendActionInput): Promise<FrontendActionRunResult>
}

export interface FrontendActionExecutionServiceOptions {
  workerFactory?: FrontendActionWorkerFactory
  ensureRuntimeReady?: () => Promise<unknown>
  loadSnapshot?: typeof loadFrontendActionWorkspaceSnapshot
  commitWorkspace?: typeof commitFrontendActionWorkspace
}

function runtimeError(
  code: ConstructorParameters<typeof FrontendActionRuntimeError>[0],
  invocationId: string,
  diagnostics?: unknown,
): FrontendActionRuntimeError {
  return new FrontendActionRuntimeError(code, {
    correlationId: invocationId,
    diagnostics,
  })
}

function requireInvocationId(value: unknown): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 256
    || value.trim() !== value
  ) {
    throw new FrontendActionRuntimeError("FRONTEND_ACTION_EXECUTION_FAILED", {
      diagnostics: "Invocation id is invalid.",
    })
  }
  return value
}

function requireIdentifier(value: unknown, label: string, invocationId: string): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 256
    || value.trim() !== value
  ) {
    throw runtimeError("FRONTEND_ACTION_EXECUTION_FAILED", invocationId, `${label} is invalid.`)
  }
  return value
}

function throwIfAborted(signal: AbortSignal | undefined, invocationId: string): void {
  if (signal?.aborted) throw runtimeError("FRONTEND_ACTION_ABORTED", invocationId)
}

function exactResourceDependencies(
  snapshot: FrontendActionWorkspaceSnapshot,
  action: ReturnType<typeof resolveFrontendAction>,
  importedResources: readonly BoundFrontendActionResource[],
) {
  return [
    action.resources.manifest,
    action.resources.executor,
    ...importedResources,
  ].map((resource) => createFrontendActionWorkspaceResourceDependency(snapshot, resource))
}

function mutationEvent(
  input: RunFrontendActionInput,
  commit: FrontendActionWorkspaceCommitResult,
): RuntimeWorkspaceMutationEvent | undefined {
  if (!commit.changed) return undefined
  return {
    invocationId: input.invocationId,
    saveId: commit.saveId,
    source: "frontend-action",
    actionId: input.actionId,
    writtenPaths: [...commit.writtenPaths].sort(),
    deletedPaths: [...commit.deletedPaths].sort(),
  }
}

function mapServiceError(error: unknown, invocationId: string): Error {
  if (error instanceof FrontendActionRuntimeError || error instanceof FrontendActionDomainError) {
    return error
  }
  if (error instanceof WorkspaceStorageError) {
    if (error.code === "FRONTEND_ACTION_WORKSPACE_CONFLICT") {
      return runtimeError("FRONTEND_ACTION_WORKSPACE_CONFLICT", invocationId, error)
    }
    return runtimeError("FRONTEND_ACTION_EXECUTION_FAILED", invocationId, error)
  }
  return runtimeError("FRONTEND_ACTION_EXECUTION_FAILED", invocationId, error)
}

/** Creates the standalone platform-host service; bridge composition is separate. */
export function createFrontendActionExecutionService(
  options: FrontendActionExecutionServiceOptions = {},
): FrontendActionExecutionService {
  const loadSnapshot = options.loadSnapshot ?? loadFrontendActionWorkspaceSnapshot
  const commitWorkspace = options.commitWorkspace ?? commitFrontendActionWorkspace
  const ensureRuntimeReady = options.ensureRuntimeReady ?? ensureFrontendActionRuntimeReady

  return {
    async runAction(input) {
      const invocationId = requireInvocationId(input.invocationId)
      requireIdentifier(input.mountedGameCardId, "Mounted game card id", invocationId)
      throwIfAborted(input.signal, invocationId)

      let transaction: ReturnType<typeof createRuntimeWorkspaceTransaction> | undefined
      try {
        await ensureRuntimeReady()
        throwIfAborted(input.signal, invocationId)

        const strictInput = validateStrictJson(input.input)
        if (!strictInput.ok) {
          throw runtimeError("FRONTEND_ACTION_INPUT_INVALID", invocationId, strictInput.issue)
        }

        const snapshot = await loadSnapshot(input.mountedGameCardId)
        throwIfAborted(input.signal, invocationId)
        const action = resolveFrontendAction({
          gameCardId: snapshot.gameCardId,
          actionId: input.actionId,
          files: snapshot.cardContentFiles,
        })
        const inputValidation = validateFrontendActionData(action.inputValidator, strictInput.value)
        if (!inputValidation.ok) {
          throw runtimeError("FRONTEND_ACTION_INPUT_INVALID", invocationId, inputValidation)
        }
        const imports = validateAndInlineFrontendActionImports(action)
        const source = imports.source
        const resources = exactResourceDependencies(snapshot, action, imports.importedResources)
        const dependencies = createFrontendActionWorkspaceDependencyTracker(snapshot)
        transaction = createRuntimeWorkspaceTransaction([...snapshot.effectiveFiles])
        const handleSdkRequest = createFrontendActionWorkspaceAdapter({
          invocationId,
          snapshot,
          transaction,
          dependencies,
        })

        const workerInput = structuredClone(strictInput.value)
        const clonedInput = validateStrictJson(workerInput)
        if (!clonedInput.ok) {
          throw runtimeError("FRONTEND_ACTION_INPUT_INVALID", invocationId, clonedInput.issue)
        }
        const rawOutput = await runFrontendActionWorker({
          invocationId,
          source,
          input: clonedInput.value,
          timeoutMs: action.timeoutMs,
          signal: input.signal,
          workerFactory: options.workerFactory,
          handleSdkRequest,
        })
        const strictOutput = validateStrictJson(rawOutput)
        if (!strictOutput.ok) {
          throw runtimeError("FRONTEND_ACTION_OUTPUT_INVALID", invocationId, strictOutput.issue)
        }
        const clonedOutput = structuredClone(strictOutput.value)
        const hostOutput = validateStrictJson(clonedOutput)
        if (!hostOutput.ok) {
          throw runtimeError("FRONTEND_ACTION_OUTPUT_INVALID", invocationId, hostOutput.issue)
        }
        const outputValidation = validateFrontendActionData(action.outputValidator, hostOutput.value)
        if (!outputValidation.ok) {
          throw runtimeError("FRONTEND_ACTION_OUTPUT_INVALID", invocationId, outputValidation)
        }

        throwIfAborted(input.signal, invocationId)
        await input.beforeCommit?.({
          invocationId,
          actionId: input.actionId,
          mountedGameCardId: input.mountedGameCardId,
          saveId: snapshot.saveId,
          ...(input.signal ? { signal: input.signal } : {}),
        })
        throwIfAborted(input.signal, invocationId)

        const readSet = dependencies.readSet()
        const commit = await commitWorkspace({
          snapshot,
          mountedGameCardId: input.mountedGameCardId,
          resources,
          dependencies: readSet.dependencies,
          changes: transaction.finalWorkspaceChanges(),
          deletePrefixes: readSet.deletePrefixes,
          ...(input.assertCommitAllowed
            ? { assertCommitAllowed: input.assertCommitAllowed }
            : {}),
        })
        const event = mutationEvent(input, commit)
        if (event) emitRuntimeWorkspaceMutation(event)
        return {
          output: hostOutput.value,
          ...(event ? { mutationEvent: event } : {}),
        }
      } catch (error) {
        throw mapServiceError(error, invocationId)
      } finally {
        transaction?.discard()
      }
    },
  }
}

export const frontendActionExecutionService = createFrontendActionExecutionService()
