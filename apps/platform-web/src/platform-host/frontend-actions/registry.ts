import type { JsonValue, WorkspaceFile } from "@tsian/contracts"
import { FrontendActionRuntimeError } from "./errors"
import { parseStrictJson, utf8ByteLength } from "./json"
import {
  compileFrontendActionSchema,
  type FrontendActionCompiledValidator,
} from "./schema"

export const FRONTEND_ACTION_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/
export const FRONTEND_ACTION_MANIFEST_MAX_BYTES = 64 * 1024
export const FRONTEND_ACTION_SOURCE_MAX_BYTES = 2 * 1024 * 1024
export const FRONTEND_ACTION_MAX_HELPERS = 16
export const FRONTEND_ACTION_DEFAULT_TIMEOUT_MS = 10_000
export const FRONTEND_ACTION_MIN_TIMEOUT_MS = 100
export const FRONTEND_ACTION_MAX_TIMEOUT_MS = 30_000

export interface FrontendActionManifestV1 {
  schemaVersion: 1
  inputSchema: JsonValue
  outputSchema: JsonValue
  executor: {
    type: "browser_script"
    path: string
    timeoutMs?: number
    helpers?: string[]
  }
}

export interface FrontendActionResourceSignature {
  path: string
  createdAt: number
  updatedAt: number
  byteLength: number
}

export interface BoundFrontendActionResource {
  provenance: "card-content"
  gameCardId: string
  file: WorkspaceFile
  signature: FrontendActionResourceSignature
}

export interface ResolvedFrontendAction {
  actionId: string
  gameCardId: string
  rootDirectory: string
  manifestPath: string
  manifest: FrontendActionManifestV1
  timeoutMs: number
  inputValidator: FrontendActionCompiledValidator
  outputValidator: FrontendActionCompiledValidator
  resources: {
    manifest: BoundFrontendActionResource
    executor: BoundFrontendActionResource
    helpers: readonly BoundFrontendActionResource[]
  }
}

export interface ResolveFrontendActionOptions {
  gameCardId: string
  actionId: string
  /** Immutable invocation-start snapshot of bound-card card-content rows. */
  files: readonly WorkspaceFile[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value) as object | null
  return prototype === Object.prototype || prototype === null
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedSet = new Set(allowed)
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !allowedSet.has(key))) {
    throw manifestInvalid(`${label} contains unknown fields.`)
  }
}

function manifestInvalid(diagnostic: string, cause?: unknown): FrontendActionRuntimeError {
  return new FrontendActionRuntimeError("FRONTEND_ACTION_MANIFEST_INVALID", {
    diagnostics: cause === undefined ? diagnostic : { diagnostic, cause },
  })
}

export function isValidFrontendActionId(actionId: string): boolean {
  return FRONTEND_ACTION_ID_PATTERN.test(actionId)
}

export function frontendActionManifestPath(actionId: string): string {
  if (!isValidFrontendActionId(actionId)) throw manifestInvalid("Action id is invalid.")
  return `frontend-actions/${actionId}/action.json`
}

function resolveActionResourcePath(
  rootDirectory: string,
  authoredPath: string,
  label: string,
): string {
  if (
    authoredPath.length === 0
    || authoredPath.trim() !== authoredPath
    || authoredPath.includes("\\")
    || authoredPath.includes("\0")
    || authoredPath.startsWith("/")
    || authoredPath.includes(":")
    || /%(?:2f|2F|5c|5C|00)/.test(authoredPath)
  ) {
    throw manifestInvalid(`${label} path is invalid.`)
  }

  const parts = authoredPath.split("/")
  if (parts.some((part) => part.length === 0 || part === "." || part === "..")) {
    throw manifestInvalid(`${label} path is invalid.`)
  }

  return `${rootDirectory}/${parts.join("/")}`
}

function parseManifest(file: WorkspaceFile): FrontendActionManifestV1 {
  if (file.binary !== undefined || file.imageMimeType !== undefined) {
    throw manifestInvalid("Manifest must be a text resource.")
  }
  const parsed = parseStrictJson(file.content, {
    maxSourceBytes: FRONTEND_ACTION_MANIFEST_MAX_BYTES,
    maxBytes: FRONTEND_ACTION_MANIFEST_MAX_BYTES,
    maxDepth: 64,
    maxNodes: 10_000,
  })
  if (!parsed.ok || !isRecord(parsed.value)) {
    throw manifestInvalid("Manifest must be a JSON object.")
  }

  assertOnlyKeys(parsed.value, ["schemaVersion", "inputSchema", "outputSchema", "executor"], "Manifest")
  if (parsed.value.schemaVersion !== 1) {
    throw manifestInvalid("Manifest schemaVersion must be 1.")
  }
  if (!("inputSchema" in parsed.value) || !("outputSchema" in parsed.value)) {
    throw manifestInvalid("Manifest schemas are required.")
  }
  const executor = parsed.value.executor
  if (!isRecord(executor)) throw manifestInvalid("Manifest executor is invalid.")
  assertOnlyKeys(executor, ["type", "path", "timeoutMs", "helpers"], "Executor")
  if (executor.type !== "browser_script" || typeof executor.path !== "string") {
    throw manifestInvalid("Executor type or path is invalid.")
  }

  let timeoutMs: number | undefined
  if (executor.timeoutMs !== undefined) {
    const rawTimeoutMs = executor.timeoutMs
    if (
      typeof rawTimeoutMs !== "number"
      || !Number.isInteger(rawTimeoutMs)
      || rawTimeoutMs < FRONTEND_ACTION_MIN_TIMEOUT_MS
      || rawTimeoutMs > FRONTEND_ACTION_MAX_TIMEOUT_MS
    ) {
      throw manifestInvalid("Executor timeout is out of range.")
    }
    timeoutMs = rawTimeoutMs
  }

  let helpers: string[] | undefined
  if (executor.helpers !== undefined) {
    if (!Array.isArray(executor.helpers) || executor.helpers.length > FRONTEND_ACTION_MAX_HELPERS) {
      throw manifestInvalid("Executor helpers are invalid.")
    }
    helpers = []
    const seen = new Set<string>()
    for (const helper of executor.helpers) {
      if (typeof helper !== "string" || seen.has(helper)) {
        throw manifestInvalid("Executor helpers must be unique strings.")
      }
      seen.add(helper)
      helpers.push(helper)
    }
  }

  const normalizedExecutor: FrontendActionManifestV1["executor"] = {
    type: "browser_script",
    path: executor.path,
  }
  if (timeoutMs !== undefined) normalizedExecutor.timeoutMs = timeoutMs
  if (helpers !== undefined) normalizedExecutor.helpers = helpers

  return {
    schemaVersion: 1,
    inputSchema: parsed.value.inputSchema as JsonValue,
    outputSchema: parsed.value.outputSchema as JsonValue,
    executor: normalizedExecutor,
  }
}

function findExactFile(
  files: readonly WorkspaceFile[],
  path: string,
  missingCode: "FRONTEND_ACTION_NOT_FOUND" | "FRONTEND_ACTION_MANIFEST_INVALID",
): WorkspaceFile {
  const matches = files.filter((file) => file.path === path)
  if (matches.length !== 1) {
    if (matches.length === 0 && missingCode === "FRONTEND_ACTION_NOT_FOUND") {
      throw new FrontendActionRuntimeError("FRONTEND_ACTION_NOT_FOUND")
    }
    throw manifestInvalid("Action resource is missing or ambiguous.")
  }
  return matches[0]!
}

function bindResource(
  gameCardId: string,
  file: WorkspaceFile,
  label: string,
): BoundFrontendActionResource {
  if (file.binary !== undefined || file.imageMimeType !== undefined) {
    throw manifestInvalid(`${label} must be a text resource.`)
  }
  const byteLength = utf8ByteLength(file.content)
  return {
    provenance: "card-content",
    gameCardId,
    file,
    signature: {
      path: file.path,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      byteLength,
    },
  }
}

/** Resolves one known Action from an already-bound card-content snapshot. */
export function resolveFrontendAction(
  options: ResolveFrontendActionOptions,
): ResolvedFrontendAction {
  if (!isValidFrontendActionId(options.actionId)) {
    throw manifestInvalid("Action id is invalid.")
  }
  if (typeof options.gameCardId !== "string" || options.gameCardId.length === 0) {
    throw manifestInvalid("Bound game card id is invalid.")
  }

  const rootDirectory = `frontend-actions/${options.actionId}`
  const manifestPath = `${rootDirectory}/action.json`
  const manifestFile = findExactFile(
    options.files,
    manifestPath,
    "FRONTEND_ACTION_NOT_FOUND",
  )
  const manifest = parseManifest(manifestFile)

  const inputCompilation = compileFrontendActionSchema(manifest.inputSchema)
  if (!inputCompilation.ok) {
    throw manifestInvalid("Input schema is invalid.", inputCompilation.issue)
  }
  const outputCompilation = compileFrontendActionSchema(manifest.outputSchema)
  if (!outputCompilation.ok) {
    throw manifestInvalid("Output schema is invalid.", outputCompilation.issue)
  }

  const executorPath = resolveActionResourcePath(rootDirectory, manifest.executor.path, "Executor")
  if (executorPath === manifestPath) throw manifestInvalid("Manifest cannot be the executor.")
  const executorFile = findExactFile(
    options.files,
    executorPath,
    "FRONTEND_ACTION_MANIFEST_INVALID",
  )
  const executorResource = bindResource(options.gameCardId, executorFile, "Executor")

  const helperResources: BoundFrontendActionResource[] = []
  const resolvedHelpers = new Set<string>()
  for (const helperPath of manifest.executor.helpers ?? []) {
    const path = resolveActionResourcePath(rootDirectory, helperPath, "Helper")
    if (path === manifestPath || path === executorPath || resolvedHelpers.has(path)) {
      throw manifestInvalid("Helper path is duplicated or reserved.")
    }
    resolvedHelpers.add(path)
    helperResources.push(bindResource(
      options.gameCardId,
      findExactFile(
        options.files,
        path,
        "FRONTEND_ACTION_MANIFEST_INVALID",
      ),
      "Helper",
    ))
  }

  const aggregateSourceBytes = executorResource.signature.byteLength
    + helperResources.reduce((total, resource) => total + resource.signature.byteLength, 0)
  if (aggregateSourceBytes > FRONTEND_ACTION_SOURCE_MAX_BYTES) {
    throw manifestInvalid("Executor and helper sources exceed the aggregate limit.")
  }

  return {
    actionId: options.actionId,
    gameCardId: options.gameCardId,
    rootDirectory,
    manifestPath,
    manifest,
    timeoutMs: manifest.executor.timeoutMs ?? FRONTEND_ACTION_DEFAULT_TIMEOUT_MS,
    inputValidator: inputCompilation.validator,
    outputValidator: outputCompilation.validator,
    resources: {
      manifest: bindResource(options.gameCardId, manifestFile, "Manifest"),
      executor: executorResource,
      helpers: helperResources,
    },
  }
}
