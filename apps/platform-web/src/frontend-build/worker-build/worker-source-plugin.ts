import type { Loader, Plugin } from "esbuild-wasm"
import {
  toImportMetaGlobMessage,
  transformImportMetaGlob,
} from "../glob-transform"
import type { WorkspaceSourceContent } from "../plugins/workspace-source-plugin"
import {
  assertNoDirectWorkerConstructors,
  toDirectWorkerConstructorMessage,
} from "./diagnostics"
import {
  isStyleSourcePath,
  isVueSourcePath,
  loadWorkspaceSource,
  resolveAlias,
  resolveExistingWorkspaceSource,
  resolveRelative,
  scriptLoaderForPath,
  workerResourceLoaderForPath,
} from "./paths"

export interface WorkerSourcePluginInput {
  sources: Map<string, WorkspaceSourceContent>
}

const WORKER_WORKSPACE_NAMESPACE = "worker-workspace"

function toText(contents: WorkspaceSourceContent): string {
  return typeof contents === "string" ? contents : new TextDecoder().decode(contents)
}

function unsupportedWorkerQueryError(path: string, query: string): string | undefined {
  if (!query) return undefined
  const params = new URLSearchParams(query)
  const keys = [...params.keys()]
  const uniqueKeys = [...new Set(keys)]
  const workerKey = uniqueKeys.find((key) => key === "worker" || key === "sharedworker")
  if (workerKey) {
    return `Worker 构建暂不支持嵌套 ${workerKey} 导入: ${path}?${query}`
  }

  const supportedKeys = ["raw", "url", "inline"]
  const selectedKeys = uniqueKeys.filter((key) => supportedKeys.includes(key))
  const unsupportedKey = uniqueKeys.find((key) => !supportedKeys.includes(key))
  if (unsupportedKey) {
    return `Worker 构建暂不支持 query 参数 "${unsupportedKey}": ${path}?${query}`
  }
  if (selectedKeys.length !== 1 || keys.length !== 1 || query !== selectedKeys[0]) {
    return `Worker 构建 query 必须且只能使用 raw、url、inline 之一: ${path}?${query}`
  }
  return undefined
}

function unsupportedWorkerSourceKind(path: string): string | undefined {
  if (isVueSourcePath(path)) return `Worker 构建暂不支持 Vue SFC: ${path}`
  if (isStyleSourcePath(path)) return `Worker 构建暂不支持样式导入: ${path}`
  return undefined
}

function unsupportedWorkerResourceKind(path: string, query: string): string | undefined {
  if (scriptLoaderForPath(path)) return undefined
  if (path.toLowerCase().endsWith(".json")) return undefined
  if (/\.(png|jpe?g|webp|gif|svg|ico|avif|woff2?|ttf|otf|eot|wasm)$/i.test(path)) return undefined
  if (query === "raw" || query === "url" || query === "inline") return undefined
  return `Worker 构建暂不支持此资源类型: ${path}`
}

function workerBareImportError(path: string, importer: string): string {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) {
    return `Worker 构建暂不支持 CDN/URL import "${path}"（importer: ${importer || "<entry>"}）；Worker 模块图必须来自 frontend/src/ Map VFS`
  }
  return `Worker 构建暂不支持 bare import "${path}"（importer: ${importer || "<entry>"}）；主页面 import map 不作用于 Worker 模块图`
}

function validateTextSource(path: string, contents: WorkspaceSourceContent, loader: Loader): string | undefined {
  if (typeof contents === "string") return undefined
  if (loader === "js" || loader === "jsx" || loader === "ts" || loader === "tsx" || loader === "json") {
    return `Worker 源码必须是文本文件: ${path}`
  }
  return undefined
}

export function createWorkerSourcePlugin({ sources }: WorkerSourcePluginInput): Plugin {
  return {
    name: "worker-source",
    setup(build) {
      build.onResolve({ filter: /^@\// }, (args) => {
        const resolved = resolveExistingWorkspaceSource(sources, resolveAlias(args.path))
        return {
          path: resolved.path,
          suffix: resolved.suffix,
          namespace: WORKER_WORKSPACE_NAMESPACE,
          ...(resolved.error ? { errors: [{ text: resolved.error }] } : {}),
        }
      })

      build.onResolve({ filter: /^\.\.?\// }, (args) => {
        const resolved = resolveExistingWorkspaceSource(
          sources,
          resolveRelative(args.path, args.importer),
        )
        return {
          path: resolved.path,
          suffix: resolved.suffix,
          namespace: WORKER_WORKSPACE_NAMESPACE,
          ...(resolved.error ? { errors: [{ text: resolved.error }] } : {}),
        }
      })

      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.path.startsWith("./") || args.path.startsWith("../") || args.path.startsWith("@/")) {
          return undefined
        }
        return { errors: [{ text: workerBareImportError(args.path, args.importer) }] }
      })

      build.onLoad(
        { filter: /.*/, namespace: WORKER_WORKSPACE_NAMESPACE },
        async (args) => {
          const resolution = loadWorkspaceSource(sources, `${args.path}${args.suffix}`)
          if (resolution.error) {
            return { errors: [{ text: resolution.error }] }
          }
          const loaded = resolution.loaded
          if (!loaded) {
            return { errors: [{ text: `Worker 源码文件未找到: ${args.path}` }] }
          }

          const unsupportedKind = unsupportedWorkerSourceKind(loaded.path)
          if (unsupportedKind) {
            return { errors: [{ text: unsupportedKind }] }
          }
          const unsupportedQuery = unsupportedWorkerQueryError(loaded.path, loaded.query)
          if (unsupportedQuery) {
            return { errors: [{ text: unsupportedQuery }] }
          }

          const params = new URLSearchParams(loaded.query)
          if (params.has("raw")) {
            return {
              contents: `export default ${JSON.stringify(toText(loaded.contents))}`,
              loader: "js",
            }
          }

          const unsupportedResourceKind = unsupportedWorkerResourceKind(loaded.path, loaded.query)
          if (unsupportedResourceKind) {
            return { errors: [{ text: unsupportedResourceKind }] }
          }

          const loader = workerResourceLoaderForPath(loaded.path, loaded.query)
          const textError = validateTextSource(loaded.path, loaded.contents, loader)
          if (textError) {
            return { errors: [{ text: textError }] }
          }

          const scriptLoader = loaded.query ? undefined : scriptLoaderForPath(loaded.path)
          if (scriptLoader && typeof loaded.contents === "string") {
            try {
              await assertNoDirectWorkerConstructors({
                code: loaded.contents,
                importer: loaded.path,
                loader: scriptLoader,
              })
            } catch (error) {
              return {
                errors: [toDirectWorkerConstructorMessage(error, { importer: loaded.path })],
              }
            }
            try {
              const transformed = await transformImportMetaGlob({
                code: loaded.contents,
                importer: loaded.path,
                loader: scriptLoader,
                sources,
              })
              return {
                contents: transformed.code,
                loader,
              }
            } catch (error) {
              return {
                errors: [toImportMetaGlobMessage(error, { importer: loaded.path })],
              }
            }
          }

          return {
            contents: loaded.contents,
            loader,
          }
        },
      )
    },
  }
}
