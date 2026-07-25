import type {
  JsonValue,
  WorkspaceEntry,
  WorkspaceGlobResult,
  WorkspaceOperationName,
  WorkspaceOperationRequest,
  WorkspaceScope,
} from "@tsian/contracts"
import { executeWorkspaceOperation } from "@/agent-runtime/workspace-operations"
import type {
  FrontendActionWorkspaceDependencyTracker,
  FrontendActionWorkspaceSnapshot,
} from "@/storage/frontend-action-workspace"
import type { RuntimeWorkspaceTransaction } from "@/storage/workspace-types"
import { validateStrictJson } from "./json"
import { FrontendActionRuntimeError } from "./errors"
import type { FrontendActionWorkerSdkRequest } from "./worker"

const ALLOWED_OPERATIONS = new Set<WorkspaceOperationName>(["read", "list", "glob", "write", "delete"])

interface FrontendActionWorkspaceAdapterOptions {
  invocationId: string
  snapshot: FrontendActionWorkspaceSnapshot
  transaction: Pick<RuntimeWorkspaceTransaction, "workspaceFiles" | "write" | "delete">
  dependencies: FrontendActionWorkspaceDependencyTracker
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function executionFailed(invocationId: string, diagnostics?: unknown): FrontendActionRuntimeError {
  return new FrontendActionRuntimeError("FRONTEND_ACTION_EXECUTION_FAILED", {
    correlationId: invocationId,
    diagnostics,
  })
}

function isFrontendActionPath(path: string): boolean {
  return path === "frontend-actions" || path.startsWith("frontend-actions/")
}

function isVisibleFile(file: { path: string }): boolean {
  return !isFrontendActionPath(file.path)
}

function assertJsonResult(value: unknown, invocationId: string): JsonValue {
  const validation = validateStrictJson(value)
  if (!validation.ok) throw executionFailed(invocationId, validation.issue)
  return validation.value
}

function projectEntry(entry: WorkspaceEntry): JsonValue {
  return {
    path: entry.path,
    name: entry.name,
    kind: entry.kind,
    ...(entry.updatedAt === undefined ? {} : { updatedAt: entry.updatedAt }),
    ...(entry.size === undefined ? {} : { size: entry.size }),
    ...(entry.childCount === undefined ? {} : { childCount: entry.childCount }),
  }
}

function resolveScope(request: WorkspaceOperationRequest): WorkspaceScope {
  return request.scope ?? (
    request.operation === "write" || request.operation === "delete"
      ? "save-runtime"
      : "effective"
  )
}

function normalizedRequest(
  raw: FrontendActionWorkerSdkRequest,
  invocationId: string,
): WorkspaceOperationRequest {
  if (!raw.op.startsWith("workspace.")) throw executionFailed(invocationId, "Forbidden SDK capability.")
  const operation = raw.op.slice("workspace.".length) as WorkspaceOperationName
  if (!ALLOWED_OPERATIONS.has(operation)) throw executionFailed(invocationId, "Forbidden Workspace operation.")
  if (!isRecord(raw.args)) throw executionFailed(invocationId, "Workspace arguments must be an object.")
  return { ...raw.args, operation } as WorkspaceOperationRequest
}

function validateReadDependencyInput(
  request: WorkspaceOperationRequest,
  scope: WorkspaceScope,
  tracker: FrontendActionWorkspaceDependencyTracker,
): void {
  if (request.operation === "read") {
    tracker.recordFile(scope, request.path)
    return
  }
  if (request.operation === "list") {
    tracker.recordList(scope, request.path)
    return
  }
  if (request.operation === "glob") tracker.recordGlob(scope, request.pattern, request.limit)
}

/** Creates the host adapter for the five Action-visible Workspace operations. */
export function createFrontendActionWorkspaceAdapter(
  options: FrontendActionWorkspaceAdapterOptions,
): (request: FrontendActionWorkerSdkRequest) => Promise<JsonValue> {
  return async (rawRequest) => {
    try {
      const request = normalizedRequest(rawRequest, options.invocationId)
      const scope = resolveScope(request)
      if (scope === "platform-meta" || scope === "card-frontend" || scope === "temp") {
        throw executionFailed(options.invocationId, "Frontend Action Workspace scope is forbidden.")
      }
      if (request.operation === "write" || request.operation === "delete") {
        if (scope !== "save-runtime") {
          throw executionFailed(options.invocationId, "Frontend Action mutation scope is forbidden.")
        }
      }

      if (
        (request.operation === "read" || request.operation === "list")
        && typeof request.path === "string"
        && isFrontendActionPath(request.path)
      ) {
        throw executionFailed(options.invocationId, "Frontend Action resources are not business-readable.")
      }

      if (request.operation === "write") {
        if (typeof request.content !== "string") {
          throw executionFailed(options.invocationId, "Frontend Action writes must be text.")
        }
        options.dependencies.recordWriteBaseline(request.path)
      } else if (request.operation === "delete") {
        options.dependencies.recordDeleteRange(request.path)
      } else {
        // The invocation-start baseline is independent of staged overlay state;
        // missing-file reads are dependencies too.
        validateReadDependencyInput(request, scope, options.dependencies)
      }

      let result: unknown
      try {
        result = await executeWorkspaceOperation({ ...request, scope }, {
          workspaceFiles: options.transaction.workspaceFiles,
          actorLevel: 1,
          exposedOperations: ALLOWED_OPERATIONS,
          fileFilter: isVisibleFile,
          mutations: {
            write: (input) => options.transaction.write({
              path: input.path,
              content: input.content,
            }),
            delete: (input) => ({
              scope: input.scope,
              deletedPaths: options.transaction.delete(input.path).deletedPaths,
            }),
          },
        })
      } catch (error) {
        if (
          request.operation === "read"
          && isRecord(error)
          && error.code === "WORKSPACE_FILE_NOT_FOUND"
        ) {
          return null
        }
        throw error
      }

      if (request.operation === "read") {
        const read = result as {
          path: string
          content: string
          binary?: Blob
          createdAt: number
          updatedAt: number
          totalLines?: number
          returnedLines?: number
          offset?: number
          truncated?: boolean
        }
        if (read.binary) throw executionFailed(options.invocationId, "Binary Workspace reads are forbidden.")
        return assertJsonResult({
          path: read.path,
          content: read.content,
          createdAt: read.createdAt,
          updatedAt: read.updatedAt,
          ...(read.totalLines === undefined ? {} : { totalLines: read.totalLines }),
          ...(read.returnedLines === undefined ? {} : { returnedLines: read.returnedLines }),
          ...(read.offset === undefined ? {} : { offset: read.offset }),
          ...(read.truncated === undefined ? {} : { truncated: read.truncated }),
        }, options.invocationId)
      }
      if (request.operation === "list") {
        const list = result as { path: string; entries: WorkspaceEntry[] }
        if (list.entries.some((entry) => isFrontendActionPath(entry.path))) {
          throw executionFailed(options.invocationId, "Frontend Action resources are not business-readable.")
        }
        return assertJsonResult({
          path: list.path,
          entries: list.entries.map(projectEntry),
        }, options.invocationId)
      }
      if (request.operation === "glob") {
        const glob = result as WorkspaceGlobResult
        return assertJsonResult({
          scope: glob.scope,
          pattern: glob.pattern,
          matches: glob.matches,
          truncated: glob.truncated,
        }, options.invocationId)
      }
      if (request.operation === "write") {
        const write = result as {
          path: string
          scope: WorkspaceScope
          changed: boolean
          file: { content: string; binary?: Blob; createdAt: number; updatedAt: number }
        }
        if (write.file.binary) throw executionFailed(options.invocationId, "Binary Workspace results are forbidden.")
        return assertJsonResult({
          path: write.path,
          scope: write.scope,
          changed: write.changed,
          file: {
            path: write.path,
            content: write.file.content,
            createdAt: write.file.createdAt,
            updatedAt: write.file.updatedAt,
          },
        }, options.invocationId)
      }
      const deleted = result as { scope: WorkspaceScope; deletedPaths: string[] }
      return assertJsonResult({
        scope: deleted.scope,
        deletedPaths: deleted.deletedPaths,
      }, options.invocationId)
    } catch (error) {
      if (error instanceof FrontendActionRuntimeError) throw error
      throw executionFailed(options.invocationId, error)
    }
  }
}
