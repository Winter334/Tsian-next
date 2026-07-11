/**
 * Shared media-type and editable-text classification for workspace, package,
 * and frontend-build consumers. Internal workspace records do not store a
 * separate mediaType field; packaged frontend files preserve an explicit type
 * through Blob.type.
 */

const GENERIC_BINARY_MEDIA_TYPE = "application/octet-stream"

const EXACT_TEXT_FILE_NAMES = new Set([
  ".dockerignore",
  ".editorconfig",
  ".env",
  ".eslintignore",
  ".gitattributes",
  ".gitignore",
  ".gitmodules",
  ".npmrc",
  ".prettierignore",
  ".stylelintignore",
  ".yarnrc",
  "authors",
  "changelog",
  "codeowners",
  "containerfile",
  "contributors",
  "dockerfile",
  "gemfile",
  "gnumakefile",
  "license",
  "makefile",
  "notice",
  "procfile",
  "rakefile",
  "readme",
  "robots.txt",
  "security",
  "skill.config",
])

const MEDIA_TYPE_BY_EXTENSION = new Map<string, string>([
  // Web source and styles.
  [".astro", "text/x-astro"],
  [".cjs", "text/javascript"],
  [".css", "text/css"],
  [".cts", "text/typescript"],
  [".htm", "text/html"],
  [".html", "text/html"],
  [".js", "text/javascript"],
  [".jsx", "text/javascript"],
  [".less", "text/x-less"],
  [".mjs", "text/javascript"],
  [".mts", "text/typescript"],
  [".sass", "text/x-sass"],
  [".scss", "text/x-scss"],
  [".svelte", "text/x-svelte"],
  [".ts", "text/typescript"],
  [".tsx", "text/typescript"],
  [".vue", "text/x-vue"],

  // Documentation, configuration, and structured data.
  [".cfg", "text/plain"],
  [".conf", "text/plain"],
  [".config", "text/plain"],
  [".csv", "text/csv"],
  [".diff", "text/x-diff"],
  [".env", "text/plain"],
  [".gql", "application/graphql"],
  [".graphql", "application/graphql"],
  [".ini", "text/plain"],
  [".json", "application/json"],
  [".json5", "application/json5"],
  [".jsonc", "application/json"],
  [".jsonl", "application/x-ndjson"],
  [".lock", "text/plain"],
  [".log", "text/plain"],
  [".markdown", "text/markdown"],
  [".md", "text/markdown"],
  [".mdx", "text/mdx"],
  [".patch", "text/x-diff"],
  [".properties", "text/plain"],
  [".sql", "application/sql"],
  [".toml", "application/toml"],
  [".tsv", "text/tab-separated-values"],
  [".txt", "text/plain"],
  [".xml", "application/xml"],
  [".xsd", "application/xml"],
  [".xsl", "application/xml"],
  [".xslt", "application/xml"],
  [".yaml", "text/yaml"],
  [".yml", "text/yaml"],

  // Common templates and scripts remain editable text even when the browser
  // builder does not have a loader/compiler for them.
  [".bash", "text/x-shellscript"],
  [".bat", "text/plain"],
  [".cmd", "text/plain"],
  [".ejs", "text/x-template"],
  [".fish", "text/x-shellscript"],
  [".hbs", "text/x-handlebars-template"],
  [".handlebars", "text/x-handlebars-template"],
  [".jade", "text/x-pug"],
  [".liquid", "text/x-liquid"],
  [".mustache", "text/x-mustache"],
  [".njk", "text/x-nunjucks"],
  [".nunjucks", "text/x-nunjucks"],
  [".php", "text/x-php"],
  [".ps1", "text/plain"],
  [".pug", "text/x-pug"],
  [".sh", "text/x-shellscript"],
  [".tpl", "text/x-template"],
  [".twig", "text/x-twig"],
  [".zsh", "text/x-shellscript"],

  // Images.
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".avif", "image/avif"],

  // Audio.
  [".mp3", "audio/mpeg"],
  [".ogg", "audio/ogg"],
  [".wav", "audio/wav"],
  [".m4a", "audio/mp4"],
  [".flac", "audio/flac"],

  // Video.
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
  [".mov", "video/quicktime"],

  // Fonts, bytecode, and common opaque archives.
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".wasm", "application/wasm"],
  [".zip", "application/zip"],
  [".gz", "application/gzip"],
  [".pdf", "application/pdf"],
])

function normalizedMediaType(mediaType: string): string {
  return mediaType.split(";", 1)[0]?.trim().toLowerCase() ?? ""
}

function fileNameFromPath(path: string): string {
  const withoutQuery = path.split(/[?#]/, 1)[0] ?? path
  return withoutQuery.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? ""
}

/** Infer a media type from a path's exact filename or extension. */
export function inferMediaTypeFromPath(
  pathInput: string,
  options?: { fallback?: string },
): string {
  const fallback = options?.fallback ?? GENERIC_BINARY_MEDIA_TYPE
  const fileName = fileNameFromPath(pathInput)
  if (!fileName) return fallback

  if (
    EXACT_TEXT_FILE_NAMES.has(fileName)
    || fileName.startsWith(".env.")
    || (fileName.startsWith(".") && fileName.endsWith("rc"))
  ) {
    return "text/plain"
  }

  const dotIndex = fileName.lastIndexOf(".")
  const extension = dotIndex >= 0 ? fileName.slice(dotIndex) : ""
  return MEDIA_TYPE_BY_EXTENSION.get(extension) ?? fallback
}

/** Workspace-authored strings are text even when their extension is unknown. */
export function inferWorkspaceMediaType(path: string): string {
  return inferMediaTypeFromPath(path, { fallback: "text/plain" })
}

export function isTextMediaType(mediaType: string): boolean {
  const type = normalizedMediaType(mediaType)
  return type.startsWith("text/")
    || type === "image/svg+xml"
    || type === "application/json"
    || type.endsWith("+json")
    || type === "application/json5"
    || type === "application/x-ndjson"
    || type === "application/ndjson"
    || type === "application/xml"
    || type.endsWith("+xml")
    || type === "application/yaml"
    || type === "application/x-yaml"
    || type === "application/toml"
    || type === "application/x-toml"
    || type === "application/javascript"
    || type === "application/ecmascript"
    || type === "application/typescript"
    || type === "application/graphql"
    || type === "application/sql"
}

/** Path-only editable-text predicate shared by workspace and frontend build. */
export function isTextFilePath(path: string): boolean {
  return isTextMediaType(inferMediaTypeFromPath(path))
}

export function isImageMediaType(mediaType: string): boolean {
  return normalizedMediaType(mediaType).startsWith("image/")
}

export function isAudioMediaType(mediaType: string): boolean {
  return normalizedMediaType(mediaType).startsWith("audio/")
}

export function isVideoMediaType(mediaType: string): boolean {
  return normalizedMediaType(mediaType).startsWith("video/")
}

/** Blank and generic octet-stream MIME values do not carry useful intent. */
export function isMeaningfulMediaType(mediaType: string | undefined): boolean {
  const type = normalizedMediaType(mediaType ?? "")
  return Boolean(type) && type !== GENERIC_BINARY_MEDIA_TYPE
}

/** Meaningful explicit MIME wins; otherwise infer from the path. */
export function resolveMediaType(
  path: string,
  explicitMediaType?: string,
  options?: { fallback?: string },
): string {
  const explicit = explicitMediaType?.trim()
  if (explicit && isMeaningfulMediaType(explicit)) {
    return explicit
  }
  return inferMediaTypeFromPath(path, options)
}

/** Resolve a stored Blob's effective MIME without trusting generic octet-stream. */
export function resolveBlobMediaType(
  path: string,
  blob: Blob,
  options?: { fallback?: string },
): string {
  return resolveMediaType(path, blob.type, options)
}

/** Placeholder returned as WorkspaceFile.content for opaque binary data. */
export function binaryPlaceholderText(
  blob: Blob,
  path: string,
  resolvedMediaType?: string,
): string {
  const mediaType = resolvedMediaType?.trim() || resolveBlobMediaType(path, blob)
  return `[binary file: ${mediaType}, ${blob.size} bytes — 不可读取为文本]`
}
