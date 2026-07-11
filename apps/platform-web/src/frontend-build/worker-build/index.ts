import * as esbuild from "esbuild-wasm"
import type { PartialMessage } from "esbuild-wasm"
import {
  toImportMetaGlobMessage,
  transformImportMetaGlob,
} from "../glob-transform"
import type { WorkspaceSourceContent } from "../plugins/workspace-source-plugin"
import {
  assertNoDirectWorkerConstructors,
  toDirectWorkerConstructorMessage,
} from "./diagnostics"
import { createWorkerSourcePlugin } from "./worker-source-plugin"
import {
  SOURCE_PREFIX,
  loadWorkspaceSource,
  scriptLoaderForPath,
  stableWorkerKey,
  workerEntryOutputPathForKey,
  workerEntryUrlExpression,
} from "./paths"

export interface FrontendBuildContext {
  sources: Map<string, WorkspaceSourceContent>
  workerEntries: Map<string, QueuedWorkerEntry>
}

export interface QueuedWorkerEntry {
  entryPath: string
  key: string
  buildPromise?: Promise<WorkerBuildResult>
}

export interface WorkerBuildResult {
  entryPath: string
  key: string
  entryOutputPath: string
  outputFiles: esbuild.OutputFile[]
  metafile: esbuild.Metafile
}

export class WorkerBuildFailure extends Error {
  readonly errors: PartialMessage[]

  constructor(messageDetail: PartialMessage, cause?: unknown) {
    super(messageDetail.text)
    this.name = "WorkerBuildFailure"
    this.errors = [messageDetail]
    if (cause !== undefined) {
      Object.defineProperty(this, "cause", {
        value: cause,
        configurable: true,
      })
    }
  }
}

export function createFrontendBuildContext(
  sources: Map<string, WorkspaceSourceContent>,
): FrontendBuildContext {
  return {
    sources,
    workerEntries: new Map(),
  }
}

export function queueWorkerEntry(
  context: FrontendBuildContext,
  entryPath: string,
): QueuedWorkerEntry {
  const existing = context.workerEntries.get(entryPath)
  if (existing) return existing

  const queued: QueuedWorkerEntry = {
    entryPath,
    key: stableWorkerKey(entryPath),
  }
  context.workerEntries.set(entryPath, queued)
  return queued
}

export function generateWorkerConstructorWrapper(key: string): string {
  return [
    `const workerUrl = ${workerEntryUrlExpression(key)}`,
    "export default class TsianWorker extends Worker {",
    "  constructor(options) {",
    "    super(workerUrl, { ...options, type: \"module\" })",
    "  }",
    "}",
  ].join("\n")
}

function normalizeOutputPath(path: string): string {
  return path.replace(/^\/+/, "")
}

function firstStructuredMessage(error: unknown): PartialMessage | undefined {
  let current: unknown = error
  const visited = new Set<unknown>()
  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current)
    const candidate = current as {
      errors?: unknown
      messageDetail?: unknown
      cause?: unknown
    }
    if (Array.isArray(candidate.errors)) {
      const message = candidate.errors.find((item): item is PartialMessage => (
        Boolean(item && typeof item === "object" && typeof (item as PartialMessage).text === "string")
      ))
      if (message) return message
    }
    if (candidate.messageDetail && typeof candidate.messageDetail === "object"
      && typeof (candidate.messageDetail as PartialMessage).text === "string") {
      return candidate.messageDetail as PartialMessage
    }
    current = candidate.cause
  }
  return undefined
}

function toWorkerBuildFailure(entryPath: string, error: unknown): WorkerBuildFailure {
  const structured = firstStructuredMessage(error)
  const message = structured?.text ?? (error instanceof Error ? error.message : String(error))
  return new WorkerBuildFailure({
    text: `Worker 构建失败 (${entryPath}): ${message}`,
    ...(structured?.location ? { location: structured.location } : {}),
  }, error)
}

function findWorkerEntryOutputPath(
  metafile: esbuild.Metafile,
  entryPath: string,
  key: string,
): string {
  const entryPoint = `${SOURCE_PREFIX}${entryPath}`
  const matches = Object.entries(metafile.outputs)
    .filter(([outputPath, output]) => output.entryPoint === entryPoint && /\.m?js$/i.test(outputPath))
    .map(([outputPath]) => normalizeOutputPath(outputPath))
  if (matches.length === 0) {
    throw new Error(`Worker 构建产物缺少入口文件（entry=${entryPath}, metafile entryPoint=${JSON.stringify(entryPoint)}）`)
  }
  if (matches.length > 1) {
    throw new Error(`Worker 构建产物存在多个入口文件（entry=${entryPath}）: ${matches.join(", ")}`)
  }
  const expected = workerEntryOutputPathForKey(key)
  if (matches[0] !== expected) {
    throw new Error(`Worker 构建入口输出路径不符合稳定命名约定（entry=${entryPath}）: expected ${expected}, got ${matches[0]}`)
  }
  return matches[0]
}

export async function buildWorkerEntry(
  context: FrontendBuildContext,
  entryPath: string,
): Promise<WorkerBuildResult> {
  const key = stableWorkerKey(entryPath)
  const resolution = loadWorkspaceSource(context.sources, entryPath)
  if (resolution.error) {
    throw new WorkerBuildFailure({ text: `Worker 源码解析失败 (${entryPath}): ${resolution.error}` })
  }
  const loaded = resolution.loaded
  if (!loaded) {
    throw new WorkerBuildFailure({ text: `Worker 源码文件未找到: ${entryPath}` })
  }
  if (loaded.query || loaded.hash) {
    throw new WorkerBuildFailure({ text: `Worker entry 不支持 query/hash: ${entryPath}` })
  }
  if (typeof loaded.contents !== "string") {
    throw new WorkerBuildFailure({ text: `Worker entry 必须是文本源码: ${loaded.path}` })
  }
  const entryLoader = scriptLoaderForPath(loaded.path)
  if (!entryLoader) {
    throw new WorkerBuildFailure({ text: `Worker entry 只支持 JS/TS/JSX/TSX 源码: ${loaded.path}` })
  }

  let entryContents = loaded.contents
  try {
    await assertNoDirectWorkerConstructors({
      code: entryContents,
      importer: loaded.path,
      loader: entryLoader,
    })
  } catch (error) {
    throw new WorkerBuildFailure(toDirectWorkerConstructorMessage(error, { importer: loaded.path }), error)
  }
  try {
    entryContents = (await transformImportMetaGlob({
      code: entryContents,
      importer: loaded.path,
      loader: entryLoader,
      sources: context.sources,
    })).code
  } catch (error) {
    throw new WorkerBuildFailure(toImportMetaGlobMessage(error, { importer: loaded.path }), error)
  }

  try {
    const result = await esbuild.build({
      stdin: {
        contents: entryContents,
        sourcefile: loaded.path,
        resolveDir: "frontend/src",
        loader: entryLoader,
      },
      bundle: true,
      format: "esm",
      splitting: true,
      write: false,
      outdir: `assets/workers/${key}`,
      entryNames: "entry",
      chunkNames: "chunks/[name]-[hash]",
      assetNames: "assets/[name]-[hash]",
      metafile: true,
      sourcemap: true,
      plugins: [createWorkerSourcePlugin({ sources: context.sources })],
      loader: { ".json": "json" },
    })
    const metafile = result.metafile!
    return {
      entryPath: loaded.path,
      key,
      entryOutputPath: findWorkerEntryOutputPath(metafile, loaded.path, key),
      outputFiles: result.outputFiles ?? [],
      metafile,
    }
  } catch (error) {
    throw toWorkerBuildFailure(loaded.path, error)
  }
}

function runQueuedWorkerEntry(
  context: FrontendBuildContext,
  queued: QueuedWorkerEntry,
): Promise<WorkerBuildResult> {
  queued.buildPromise ??= buildWorkerEntry(context, queued.entryPath)
  return queued.buildPromise
}

export async function buildQueuedWorkerEntries(
  context: FrontendBuildContext,
): Promise<WorkerBuildResult[]> {
  const results: WorkerBuildResult[] = []
  for (const queued of context.workerEntries.values()) {
    results.push(await runQueuedWorkerEntry(context, queued))
  }
  return results
}
