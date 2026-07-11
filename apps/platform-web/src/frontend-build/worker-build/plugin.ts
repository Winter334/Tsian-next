import type { Plugin } from "esbuild-wasm"
import {
  generateWorkerConstructorWrapper,
  queueWorkerEntry,
  type FrontendBuildContext,
} from "./index"
import {
  loadWorkspaceSource,
  resolveAlias,
  resolveRelative,
  splitSourceRequest,
} from "./paths"

export interface WorkerPluginInput {
  context: FrontendBuildContext
}

const WORKER_WRAPPER_NAMESPACE = "worker-wrapper"

function requestFromPath(path: string): string {
  return path
}

function isWorkerQuery(query: string): boolean {
  const params = new URLSearchParams(query)
  return params.has("worker") || params.has("sharedworker")
}

function workerRequestError(path: string, query: string): string | undefined {
  const params = new URLSearchParams(query)
  const keys = [...new Set(params.keys())]
  if (keys.includes("sharedworker")) {
    return `首版暂不支持 ?sharedworker: ${path}?${query}；请使用 import WorkerCtor from "./x?worker"`
  }
  if (!keys.includes("worker")) return undefined
  if (keys.includes("url")) {
    return `首版暂不支持 ?worker&url: ${path}?${query}；只支持默认导出 Worker constructor`
  }
  if (keys.includes("inline")) {
    return `首版暂不支持 ?worker&inline: ${path}?${query}；Worker 产物必须写入 frontend/dist/**`
  }
  const unsupported = keys.find((key) => key !== "worker")
  if (unsupported) {
    return `首版 ?worker 导入不支持额外 query 参数 "${unsupported}": ${path}?${query}`
  }
  if (query !== "worker") {
    return `首版只支持 import WorkerCtor from "./x?worker" 默认构造器导入，不支持 ${path}?${query}`
  }
  return undefined
}

function resolveWorkerImport(
  context: FrontendBuildContext,
  request: string,
  importer: string | undefined,
  kind: string,
): { path: string; namespace: string; pluginData: { key: string } } | { errors: Array<{ text: string }> } | undefined {
  const raw = splitSourceRequest(request)
  if (!isWorkerQuery(raw.query)) return undefined

  if (kind !== "import-statement") {
    return {
      errors: [{
        text: `首版 ?worker 只支持 ESM 默认静态导入 import WorkerCtor from "./x?worker"，不支持 ${kind}: ${JSON.stringify(request)}（importer: ${importer || "<entry>"}）`,
      }],
    }
  }

  const isVfsRequest = request.startsWith("@/") || request.startsWith("./") || request.startsWith("../")
  if (!isVfsRequest) {
    return {
      errors: [{
        text: `首版 ?worker 只支持相对路径或 @/ VFS alias，不支持 ${JSON.stringify(request)}（importer: ${importer || "<entry>"}）`,
      }],
    }
  }

  const resolvedRequest = request.startsWith("@/")
    ? resolveAlias(request)
    : resolveRelative(request, importer)
  const resolved = splitSourceRequest(resolvedRequest)
  const queryError = workerRequestError(resolved.path, resolved.query)
  if (queryError) return { errors: [{ text: queryError }] }
  if (resolved.hash) {
    return { errors: [{ text: `首版 ?worker 导入不支持 hash: ${resolved.path}?${resolved.query}#${resolved.hash}` }] }
  }

  const resolution = loadWorkspaceSource(context.sources, resolved.path)
  if (resolution.error) return { errors: [{ text: resolution.error }] }
  const loaded = resolution.loaded
  if (!loaded) return { errors: [{ text: `Worker 源码文件未找到: ${resolved.path}` }] }
  if (typeof loaded.contents !== "string") {
    return { errors: [{ text: `Worker entry 必须是文本源码: ${loaded.path}` }] }
  }
  const queued = queueWorkerEntry(context, loaded.path)
  return {
    path: queued.entryPath,
    namespace: WORKER_WRAPPER_NAMESPACE,
    pluginData: { key: queued.key },
  }
}

export function createWorkerPlugin({ context }: WorkerPluginInput): Plugin {
  return {
    name: "worker-build",
    setup(build) {
      build.onResolve({ filter: /^@\// }, (args) => {
        return resolveWorkerImport(context, requestFromPath(args.path), args.importer, args.kind)
      })

      build.onResolve({ filter: /^\.\.?\// }, (args) => {
        return resolveWorkerImport(context, requestFromPath(args.path), args.importer, args.kind)
      })

      build.onResolve({ filter: /.*/ }, (args) => {
        return resolveWorkerImport(context, requestFromPath(args.path), args.importer, args.kind)
      })

      build.onLoad(
        { filter: /.*/, namespace: WORKER_WRAPPER_NAMESPACE },
        (args) => {
          const queued = queueWorkerEntry(context, args.path)
          return {
            contents: generateWorkerConstructorWrapper(queued.key),
            loader: "js",
          }
        },
      )
    },
  }
}
