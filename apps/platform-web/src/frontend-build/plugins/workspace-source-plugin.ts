import type { Loader, Plugin } from "esbuild-wasm"
import {
  toImportMetaGlobMessage,
  transformImportMetaGlob,
  type GlobTransformLoader,
} from "../glob-transform"
import {
  compileStylePreprocessor,
  toStylePreprocessorMessage,
  type StylePreprocessorLanguage,
} from "../style-preprocessors"
import {
  assertNoDirectWorkerConstructors,
  toDirectWorkerConstructorMessage,
} from "../worker-build/diagnostics"

/**
 * Workspace source plugin — feeds source files from IndexedDB memory into
 * esbuild-wasm, which has no file system in the browser.
 *
 * esbuild-wasm's `file` namespace would fall back to (non-existent) FS
 * resolution, so we resolve local imports into a custom `workspace` namespace
 * and load contents from the preloaded `sources` map.
 *
 * `sources` keys are paths relative to `frontend/src/` (e.g. `App.vue`,
 * `components/Foo.ts`). Relative imports resolve against the importer's virtual
 * path. `@/x` resolves to `frontend/src/x`. Extension-less imports try common
 * extensions and directory `index.*` files.
 */
export type WorkspaceSourceContent = string | Uint8Array

export interface WorkspaceSourcePluginInput {
  sources: Map<string, WorkspaceSourceContent>
}

const WORKSPACE_NAMESPACE = "workspace"
const SOURCE_PREFIX = "frontend/src/"

/** Extensions tried when an import path has no explicit extension. */
const RESOLVE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".vue",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".json",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".svg",
  ".ico",
  ".avif",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".wasm",
]

/** Directory imports only try source/module-ish files, not arbitrary assets. */
const INDEX_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".vue",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".json",
]

const STYLE_RESOLVE_EXTENSIONS = new Set([".scss", ".sass", ".less"])

interface SourceRequest {
  path: string
  query: string
  hash: string
}

interface LoadedSource {
  path: string
  query: string
  hash: string
  contents: WorkspaceSourceContent
}

function splitSourceRequest(value: string): SourceRequest {
  const hashIndex = value.indexOf("#")
  const beforeHash = hashIndex >= 0 ? value.slice(0, hashIndex) : value
  const hash = hashIndex >= 0 ? value.slice(hashIndex + 1) : ""
  const queryIndex = beforeHash.indexOf("?")
  if (queryIndex < 0) {
    return { path: beforeHash, query: "", hash }
  }
  return {
    path: beforeHash.slice(0, queryIndex),
    query: beforeHash.slice(queryIndex + 1),
    hash,
  }
}

function joinSourceRequest(request: SourceRequest): string {
  return `${request.path}${request.query ? `?${request.query}` : ""}${request.hash ? `#${request.hash}` : ""}`
}

function normalizeWorkspaceSourcePath(path: string): string {
  const request = splitSourceRequest(path)
  const normalized = request.path
    .replace(/^workspace:/, "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^\.\//, "")
  if (normalized.startsWith(SOURCE_PREFIX)) {
    return normalized.slice(SOURCE_PREFIX.length)
  }
  const sourceIndex = normalized.indexOf(`/${SOURCE_PREFIX}`)
  return sourceIndex >= 0
    ? normalized.slice(sourceIndex + SOURCE_PREFIX.length + 1)
    : normalized
}

function resolveAlias(importPath: string): string {
  const request = splitSourceRequest(importPath)
  return joinSourceRequest({
    ...request,
    path: normalizeWorkspaceSourcePath(request.path.slice(2)),
  })
}

/** Resolve a relative import path against the importer's virtual path. */
function resolveRelative(importPath: string, importer: string | undefined): string {
  const request = splitSourceRequest(importPath)
  if (!importer) {
    return joinSourceRequest({
      ...request,
      path: normalizeWorkspaceSourcePath(request.path.replace(/^\.\//, "")),
    })
  }
  const importerPath = normalizeWorkspaceSourcePath(splitSourceRequest(importer).path)
  const importerDir = importerPath.includes("/")
    ? importerPath.slice(0, importerPath.lastIndexOf("/"))
    : ""
  const parts = importerDir ? importerDir.split("/") : []
  for (const seg of request.path.split("/")) {
    if (seg === "" || seg === ".") continue
    if (seg === "..") {
      parts.pop()
      continue
    }
    parts.push(seg)
  }
  return joinSourceRequest({
    ...request,
    path: normalizeWorkspaceSourcePath(parts.join("/")),
  })
}

function hasExplicitExtension(path: string): boolean {
  const leaf = path.replace(/\/+$/, "").split("/").pop() ?? ""
  return /\.[^/.]+$/.test(leaf)
}

function sourceResolutionTiers(path: string): string[][] {
  const normalized = normalizeWorkspaceSourcePath(path)
  const base = normalized.replace(/\/+$/, "")
  if (hasExplicitExtension(base)) return [[normalized]]

  const tiers: string[][] = [[normalized]]
  for (const ext of RESOLVE_EXTENSIONS) {
    if (!STYLE_RESOLVE_EXTENSIONS.has(ext)) {
      tiers.push([base + ext])
    }
  }
  tiers.push([...STYLE_RESOLVE_EXTENSIONS].map((extension) => `${base}${extension}`))
  for (const ext of INDEX_EXTENSIONS) {
    if (!STYLE_RESOLVE_EXTENSIONS.has(ext)) {
      tiers.push([`${base}/index${ext}`])
    }
  }
  tiers.push([...STYLE_RESOLVE_EXTENSIONS].map((extension) => `${base}/index${extension}`))
  return tiers
}

function stylePreprocessorLanguage(path: string): StylePreprocessorLanguage | undefined {
  const match = /\.(scss|sass|less)$/i.exec(path)
  return match?.[1]?.toLowerCase() as StylePreprocessorLanguage | undefined
}

/** Pick an esbuild loader by file extension. `.vue` is left to the sfc plugin. */
function loaderFor(path: string, query: string): Loader {
  const params = new URLSearchParams(query)
  if (params.has("inline")) return "dataurl"
  if (params.has("url")) return "file"

  const lowerPath = path.toLowerCase()
  if (lowerPath.endsWith(".tsx")) return "tsx"
  if (lowerPath.endsWith(".ts") || lowerPath.endsWith(".mts") || lowerPath.endsWith(".cts")) return "ts"
  if (lowerPath.endsWith(".jsx")) return "jsx"
  if (lowerPath.endsWith(".js") || lowerPath.endsWith(".mjs") || lowerPath.endsWith(".cjs")) return "js"
  if (lowerPath.endsWith(".module.css") || /\.module\.(scss|sass|less)$/.test(lowerPath)) return "local-css"
  if (lowerPath.endsWith(".css") || /\.(scss|sass|less)$/.test(lowerPath)) return "css"
  if (lowerPath.endsWith(".json")) return "json"
  if (/\.(png|jpe?g|webp|gif|svg|ico|avif|woff2?|ttf|otf|eot|wasm)$/.test(lowerPath)) return "file"
  return "text"
}

function globTransformLoader(loader: Loader): GlobTransformLoader | undefined {
  return loader === "js" || loader === "jsx" || loader === "ts" || loader === "tsx"
    ? loader
    : undefined
}

interface SourceResolution {
  loaded?: LoadedSource
  error?: string
}

function loadSource(
  sources: Map<string, WorkspaceSourceContent>,
  path: string,
): SourceResolution {
  const request = splitSourceRequest(path)
  for (const tier of sourceResolutionTiers(request.path)) {
    const existing = tier.filter((candidate) => sources.has(candidate))
    if (existing.length > 1) {
      return {
        error: `样式源码解析存在歧义 ${JSON.stringify(request.path)}: ${existing.join(", ")}`,
      }
    }
    const candidate = existing[0]
    if (candidate) {
      return {
        loaded: {
          ...request,
          path: candidate,
          contents: sources.get(candidate)!,
        },
      }
    }
  }
  return {}
}

function toText(contents: WorkspaceSourceContent): string {
  return typeof contents === "string" ? contents : new TextDecoder().decode(contents)
}

function unsupportedQueryError(path: string, query: string): string | undefined {
  if (!query) return undefined
  const params = new URLSearchParams(query)
  const keys = [...new Set(params.keys())]
  const workerKey = keys.find((key) => key === "worker" || key === "sharedworker")
  if (workerKey) {
    return `源码导入暂不支持 ${workerKey} query: ${path}?${query}`
  }

  const supportedKeys = ["raw", "url", "inline"]
  const selectedKeys = keys.filter((key) => supportedKeys.includes(key))
  const unsupportedKey = keys.find((key) => !supportedKeys.includes(key))
  if (unsupportedKey) {
    return `源码导入暂不支持 query 参数 "${unsupportedKey}": ${path}?${query}`
  }
  if (selectedKeys.length !== 1 || keys.length !== 1) {
    return `源码导入 query 必须且只能使用 raw、url、inline 之一: ${path}?${query}`
  }
  return undefined
}

interface ResolvedSource {
  path: string
  suffix: string
  error?: string
}

function toResolvedSource(loaded: LoadedSource): ResolvedSource {
  return {
    path: loaded.path,
    suffix: `${loaded.query ? `?${loaded.query}` : ""}${loaded.hash ? `#${loaded.hash}` : ""}`,
  }
}

function resolveExistingSource(
  sources: Map<string, WorkspaceSourceContent>,
  path: string,
): ResolvedSource {
  const resolution = loadSource(sources, path)
  if (resolution.loaded) return toResolvedSource(resolution.loaded)
  const request = splitSourceRequest(path)
  return {
    path: request.path,
    suffix: `${request.query ? `?${request.query}` : ""}${request.hash ? `#${request.hash}` : ""}`,
    error: resolution.error,
  }
}

export function workspaceSourcePlugin({ sources }: WorkspaceSourcePluginInput): Plugin {
  return {
    name: "workspace-source",
    setup(build) {
      // Vite-style source alias: @/components/Foo.vue → frontend/src/components/Foo.vue.
      build.onResolve({ filter: /^@\// }, (args) => {
        const resolved = resolveExistingSource(sources, resolveAlias(args.path))
        return {
          path: resolved.path,
          suffix: resolved.suffix,
          namespace: WORKSPACE_NAMESPACE,
          ...(resolved.error ? { errors: [{ text: resolved.error }] } : {}),
        }
      })

      // Relative imports (./ ../) → resolve into the workspace namespace.
      build.onResolve({ filter: /^\.\.?\// }, (args) => {
        const resolved = resolveExistingSource(
          sources,
          resolveRelative(args.path, args.importer),
        )
        return {
          path: resolved.path,
          suffix: resolved.suffix,
          namespace: WORKSPACE_NAMESPACE,
          ...(resolved.error ? { errors: [{ text: resolved.error }] } : {}),
        }
      })

      // Load source content from the preloaded map. Try the path as-is, then
      // common extensions and directory index files for extension-less imports.
      build.onLoad(
        { filter: /.*/, namespace: WORKSPACE_NAMESPACE },
        async (args) => {
          const resolution = loadSource(sources, `${args.path}${args.suffix}`)
          if (resolution.error) {
            return { errors: [{ text: resolution.error }] }
          }
          const loaded = resolution.loaded
          if (loaded !== undefined) {
            const unsupported = unsupportedQueryError(loaded.path, loaded.query)
            if (unsupported) {
              return { errors: [{ text: unsupported }] }
            }
            const params = new URLSearchParams(loaded.query)
            if (params.has("raw")) {
              return {
                contents: `export default ${JSON.stringify(toText(loaded.contents))}`,
                loader: "js",
              }
            }
            const language = loaded.query ? undefined : stylePreprocessorLanguage(loaded.path)
            if (language) {
              if (typeof loaded.contents !== "string") {
                return { errors: [{ text: `${language} 样式源码必须是文本文件: ${loaded.path}` }] }
              }
              try {
                const compiled = await compileStylePreprocessor({
                  language,
                  source: loaded.contents,
                  filename: loaded.path,
                  sources,
                })
                return {
                  contents: compiled.css,
                  loader: loaderFor(loaded.path, loaded.query),
                  resolveDir: loaded.path.includes("/")
                    ? loaded.path.slice(0, loaded.path.lastIndexOf("/"))
                    : ".",
                  watchFiles: compiled.dependencies,
                }
              } catch (error) {
                return {
                  errors: [toStylePreprocessorMessage(error, {
                    language,
                    filename: loaded.path,
                  })],
                }
              }
            }
            const loader = loaderFor(loaded.path, loaded.query)
            const transformLoader = loaded.query ? undefined : globTransformLoader(loader)
            if (transformLoader && typeof loaded.contents === "string") {
              try {
                await assertNoDirectWorkerConstructors({
                  code: loaded.contents,
                  importer: loaded.path,
                  loader: transformLoader,
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
                  loader: transformLoader,
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
          }
          return {
            errors: [{ text: `源码文件未找到: ${args.path}` }],
          }
        },
      )
    },
  }
}
