export type GlobPatternOrigin = "relative" | "alias"

export interface ResolvedGlobPattern {
  origin: GlobPatternOrigin
  canonicalPattern: string
  displayPrefix: string
  importerDirectory: string
}

export interface GlobMatch {
  canonicalPath: string
  key: string
  importSpecifier: string
}

export class GlobPathError extends Error {
  readonly pattern: string

  constructor(pattern: string, message: string) {
    super(message)
    this.name = "GlobPathError"
    this.pattern = pattern
  }
}

function failPath(pattern: string, detail: string): never {
  throw new GlobPathError(pattern, `${JSON.stringify(pattern)}: ${detail}`)
}

function assertSafePatternText(pattern: string): void {
  if (!pattern) failPath(pattern, "pattern 不能为空")
  if (/[\u0000-\u001f\u007f]/.test(pattern)) failPath(pattern, "控制字符不受支持")
  if (pattern.includes("\\")) failPath(pattern, "反斜杠不受支持，请使用 POSIX / 分隔符")
  if (/[?#]/.test(pattern)) failPath(pattern, "query/hash 不受支持")
  if (/%(?:2f|5c|3f|23|00)/i.test(pattern)) {
    failPath(pattern, "encoded slash/backslash/query/hash/NUL 不受支持")
  }

  let decoded: string
  try {
    decoded = decodeURIComponent(pattern)
  } catch {
    failPath(pattern, "percent encoding 无效")
  }
  if (decoded.includes("\\")) failPath(pattern, "encoded backslash 不受支持")
  if (/%(?:2f|5c|3f|23|0[0-9a-f]|1[0-9a-f]|7f)/i.test(decoded)) {
    failPath(pattern, "nested encoded separator/query/hash/control 不受支持")
  }
  if (/[\u0000-\u001f\u007f]/.test(decoded)) {
    failPath(pattern, "encoded control character 不受支持")
  }
  if (decoded.includes("?") || decoded.includes("#")) {
    failPath(pattern, "encoded query/hash 不受支持")
  }
}

function normalizeSegments(
  pattern: string,
  request: string,
  baseSegments: string[],
): string {
  const segments = [...baseSegments]
  for (const segment of request.split("/")) {
    if (!segment || segment === ".") continue
    if (segment === "..") {
      if (segments.length === 0) {
        failPath(pattern, "pattern 越出 frontend/src/ VFS 根目录")
      }
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  if (segments.length === 0) failPath(pattern, "pattern 不能只指向 frontend/src/ 根目录")
  return segments.join("/")
}

function canonicalImporterPath(importer: string): string {
  const normalized = importer
    .replace(/^workspace:/, "")
    .replace(/^\/+/, "")
    .replace(/^frontend\/src\//, "")
  if (!normalized || normalized.includes("\\") || /[?#]/.test(normalized)) {
    throw new GlobPathError(importer, `${JSON.stringify(importer)}: importer 不是规范化 VFS source key`)
  }
  return normalizeSegments(importer, normalized, [])
}

function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/")
  return slash < 0 ? "" : path.slice(0, slash)
}

function relativePath(fromDirectory: string, target: string): string {
  const from = fromDirectory ? fromDirectory.split("/") : []
  const to = target.split("/")
  let common = 0
  while (common < from.length && common < to.length && from[common] === to[common]) {
    common += 1
  }
  const relative = [
    ...Array.from({ length: from.length - common }, () => ".."),
    ...to.slice(common),
  ].join("/")
  return relative.startsWith("../") ? relative : `./${relative}`
}

export function resolveGlobPattern(pattern: string, importer: string): ResolvedGlobPattern {
  assertSafePatternText(pattern)
  if (pattern.startsWith("//")) failPath(pattern, "authority pattern 不受支持")
  if (pattern.startsWith("/")) failPath(pattern, "绝对 pattern 不受支持")
  if (/^[a-z][a-z0-9+.-]*:/i.test(pattern)) failPath(pattern, "URL/scheme pattern 不受支持")

  const importerPath = canonicalImporterPath(importer)
  const importerDirectory = directoryOf(importerPath)
  if (pattern.startsWith("@/")) {
    const request = pattern.slice(2)
    if (!request) failPath(pattern, "@/ 后必须提供 pattern")
    return {
      origin: "alias",
      canonicalPattern: normalizeSegments(pattern, request, []),
      displayPrefix: "/",
      importerDirectory,
    }
  }

  if (!pattern.startsWith("./") && !pattern.startsWith("../")) {
    failPath(pattern, "仅支持 ./、../ 或 @/ 开头的 pattern")
  }
  return {
    origin: "relative",
    canonicalPattern: normalizeSegments(
      pattern,
      pattern,
      importerDirectory ? importerDirectory.split("/") : [],
    ),
    displayPrefix: pattern.startsWith("./") ? "./" : "../",
    importerDirectory,
  }
}

export function globMatchFor(
  resolved: ResolvedGlobPattern,
  canonicalPath: string,
): GlobMatch {
  const relative = relativePath(resolved.importerDirectory, canonicalPath)
  return {
    canonicalPath,
    key: resolved.origin === "alias" ? `/${canonicalPath}` : relative,
    importSpecifier: relative,
  }
}
