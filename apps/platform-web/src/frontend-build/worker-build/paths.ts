import type { Loader } from "esbuild-wasm"
import type { GlobTransformLoader } from "../glob-transform"
import type { WorkspaceSourceContent } from "../plugins/workspace-source-plugin"

export const SOURCE_PREFIX = "frontend/src/"
export const WORKER_OUTPUT_ROOT = "assets/workers"

export interface SourceRequest {
  path: string
  query: string
  hash: string
}

export interface LoadedWorkspaceSource {
  path: string
  query: string
  hash: string
  contents: WorkspaceSourceContent
}

export interface SourceResolution {
  loaded?: LoadedWorkspaceSource
  error?: string
}

export interface ResolvedWorkspaceSource {
  path: string
  suffix: string
  error?: string
}

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

export function splitSourceRequest(value: string): SourceRequest {
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

export function joinSourceRequest(request: SourceRequest): string {
  return `${request.path}${request.query ? `?${request.query}` : ""}${request.hash ? `#${request.hash}` : ""}`
}

export function suffixForRequest(request: Pick<SourceRequest, "query" | "hash">): string {
  return `${request.query ? `?${request.query}` : ""}${request.hash ? `#${request.hash}` : ""}`
}

export function normalizeWorkspaceSourcePath(path: string): string {
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

export function resolveAlias(importPath: string): string {
  const request = splitSourceRequest(importPath)
  return joinSourceRequest({
    ...request,
    path: normalizeWorkspaceSourcePath(request.path.slice(2)),
  })
}

export function resolveRelative(importPath: string, importer: string | undefined): string {
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

export function loadWorkspaceSource(
  sources: Map<string, WorkspaceSourceContent>,
  path: string,
): SourceResolution {
  const request = splitSourceRequest(path)
  for (const tier of sourceResolutionTiers(request.path)) {
    const existing = tier.filter((candidate) => sources.has(candidate))
    if (existing.length > 1) {
      return {
        error: `源码解析存在歧义 ${JSON.stringify(request.path)}: ${existing.join(", ")}`,
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

function toResolvedSource(loaded: LoadedWorkspaceSource): ResolvedWorkspaceSource {
  return {
    path: loaded.path,
    suffix: suffixForRequest(loaded),
  }
}

export function resolveExistingWorkspaceSource(
  sources: Map<string, WorkspaceSourceContent>,
  path: string,
): ResolvedWorkspaceSource {
  const resolution = loadWorkspaceSource(sources, path)
  if (resolution.loaded) return toResolvedSource(resolution.loaded)
  const request = splitSourceRequest(path)
  return {
    path: request.path,
    suffix: suffixForRequest(request),
    error: resolution.error,
  }
}

export function isExecutableSourcePath(path: string): boolean {
  return /\.(tsx?|jsx?|mjs|cjs|mts|cts)$/i.test(path)
}

export function isStyleSourcePath(path: string): boolean {
  return /\.(css|scss|sass|less)$/i.test(path)
}

export function isVueSourcePath(path: string): boolean {
  return /\.vue$/i.test(path)
}

export function scriptLoaderForPath(path: string): GlobTransformLoader | undefined {
  const lowerPath = path.toLowerCase()
  if (lowerPath.endsWith(".tsx")) return "tsx"
  if (lowerPath.endsWith(".ts") || lowerPath.endsWith(".mts") || lowerPath.endsWith(".cts")) return "ts"
  if (lowerPath.endsWith(".jsx")) return "jsx"
  if (lowerPath.endsWith(".js") || lowerPath.endsWith(".mjs") || lowerPath.endsWith(".cjs")) return "js"
  return undefined
}

export function workerResourceLoaderForPath(path: string, query: string): Loader {
  const params = new URLSearchParams(query)
  if (params.has("inline")) return "dataurl"
  if (params.has("url")) return "file"

  const scriptLoader = scriptLoaderForPath(path)
  if (scriptLoader) return scriptLoader
  if (path.toLowerCase().endsWith(".json")) return "json"
  if (/\.(png|jpe?g|webp|gif|svg|ico|avif|woff2?|ttf|otf|eot|wasm)$/i.test(path)) return "file"
  return "text"
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

export function stableWorkerKey(entryPath: string): string {
  const normalized = normalizeWorkspaceSourcePath(entryPath)
  const safe = normalized
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "worker"
  return `${safe}-${stableHash(normalized)}`
}

export function workerEntryOutputPathForKey(key: string): string {
  return `${WORKER_OUTPUT_ROOT}/${key}/entry.js`
}

export function workerEntryUrlExpression(key: string): string {
  return `new URL(${JSON.stringify(`./${workerEntryOutputPathForKey(key)}`)}, window.location.href)`
}
