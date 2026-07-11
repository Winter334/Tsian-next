import type { WorkspaceStyleSourceContent } from "./index"

export const STYLE_VFS_SCHEME = "tsian-vfs:"
export const STYLE_VFS_SOURCE_ROOT = "/frontend/src/"

export class StyleVfsError extends Error {
  readonly request: string
  readonly kind: "invalid" | "outside-root" | "missing" | "ambiguous" | "binary"

  constructor(kind: StyleVfsError["kind"], request: string, message: string) {
    super(message)
    this.name = "StyleVfsError"
    this.kind = kind
    this.request = request
  }
}

function failInvalid(request: string, detail: string): never {
  throw new StyleVfsError("invalid", request, `非法样式 import ${JSON.stringify(request)}: ${detail}`)
}

function assertSafePathText(request: string): void {
  if (!request) failInvalid(request, "路径为空")
  if (request.includes("\0")) failInvalid(request, "包含 NUL 字符")
  if (request.includes("\\")) failInvalid(request, "反斜杠不受支持")
  if (/[?#]/.test(request)) failInvalid(request, "query/hash 不受支持")
  if (/%2f|%5c/i.test(request)) failInvalid(request, "encoded slash/backslash 不受支持")
  try {
    const decoded = decodeURIComponent(request)
    if (/%(?:2f|5c|3f|23|00)/i.test(decoded)) {
      failInvalid(request, "encoded slash/backslash/query/hash/NUL 不受支持")
    }
    if (decoded.includes("\\")) {
      failInvalid(request, "encoded backslash 不受支持")
    }
    if (decoded.includes("?") || decoded.includes("#") || decoded.includes("\0")) {
      failInvalid(request, "encoded query/hash/NUL 不受支持")
    }
  } catch (error) {
    if (error instanceof StyleVfsError) throw error
    failInvalid(request, "percent encoding 无效")
  }
}

function normalizeSegments(request: string, baseSegments: string[]): string {
  const segments = [...baseSegments]
  for (const segment of request.split("/")) {
    if (!segment || segment === ".") continue
    if (segment === "..") {
      if (segments.length === 0) {
        throw new StyleVfsError(
          "outside-root",
          request,
          `样式 import 越出 frontend/src/: ${JSON.stringify(request)}`,
        )
      }
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  if (segments.length === 0) failInvalid(request, "路径不能指向 frontend/src/ 根目录")
  return segments.join("/")
}

export function canonicalStylePath(path: string): string {
  assertSafePathText(path)
  if (path.startsWith("/")) failInvalid(path, "绝对路径不受支持")
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) failInvalid(path, "URL scheme 不受支持")
  return normalizeSegments(path, [])
}

export function styleDirectory(path: string): string {
  const canonical = canonicalStylePath(path)
  const slash = canonical.lastIndexOf("/")
  return slash < 0 ? "" : canonical.slice(0, slash + 1)
}

export function resolveStylePath(request: string, containingPath: string): string {
  assertSafePathText(request)
  if (request.startsWith("/") || request.startsWith("//")) {
    failInvalid(request, "绝对路径或 authority 不受支持")
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(request)) failInvalid(request, "URL scheme 不受支持")
  const baseDir = styleDirectory(containingPath)
  return normalizeSegments(request, baseDir ? baseDir.slice(0, -1).split("/") : [])
}

export function stylePathToUrl(path: string): URL {
  return new URL(`${STYLE_VFS_SCHEME}///frontend/src/${canonicalStylePath(path)}`)
}

export function styleUrlToPath(url: URL): string {
  if (url.protocol !== STYLE_VFS_SCHEME) failInvalid(url.href, `仅允许 ${STYLE_VFS_SCHEME} URL`)
  if (url.host || url.username || url.password || url.port) failInvalid(url.href, "authority 不受支持")
  if (url.search || url.hash) failInvalid(url.href, "query/hash 不受支持")
  if (!url.pathname.startsWith(STYLE_VFS_SOURCE_ROOT)) {
    throw new StyleVfsError("outside-root", url.href, `样式 URL 越出 frontend/src/: ${url.href}`)
  }
  const encodedPath = url.pathname.slice(STYLE_VFS_SOURCE_ROOT.length)
  if (/%(?:2f|5c|3f|23|00|25(?:2f|5c|3f|23|00))/i.test(encodedPath)) {
    failInvalid(url.href, "encoded slash/backslash/query/hash/NUL 不受支持")
  }
  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(encodedPath)
  } catch {
    failInvalid(url.href, "percent encoding 无效")
  }
  return canonicalStylePath(decodedPath)
}

export function readStyleSource(
  sources: Map<string, WorkspaceStyleSourceContent>,
  path: string,
  request = path,
): string {
  const canonical = canonicalStylePath(path)
  const contents = sources.get(canonical)
  if (contents === undefined) {
    throw new StyleVfsError(
      "missing",
      request,
      `样式源码未找到: ${canonical}（请求 ${JSON.stringify(request)}）`,
    )
  }
  if (typeof contents !== "string") {
    throw new StyleVfsError(
      "binary",
      request,
      `样式源码必须是文本文件: ${canonical}（请求 ${JSON.stringify(request)}）`,
    )
  }
  return contents
}

export function existingStyleCandidates(
  sources: Map<string, WorkspaceStyleSourceContent>,
  candidates: string[],
): string[] {
  return [...new Set(candidates)].filter((candidate) => sources.has(candidate))
}

export function assertStyleSourceIsText(
  sources: Map<string, WorkspaceStyleSourceContent>,
  path: string,
  request = path,
): void {
  if (sources.has(path)) readStyleSource(sources, path, request)
}

export function pickUniqueStyleCandidate(request: string, candidates: string[]): string | undefined {
  if (candidates.length === 0) return undefined
  if (candidates.length > 1) {
    throw new StyleVfsError(
      "ambiguous",
      request,
      `样式 import 存在歧义 ${JSON.stringify(request)}: ${candidates.join(", ")}`,
    )
  }
  return candidates[0]
}
