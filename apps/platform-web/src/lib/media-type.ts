/**
 * Shared media-type inference. Replaces the four duplicate
 * `inferMediaType`/`normalizeMediaType` helpers that lived in
 * `workspace-file-types.ts`, `game-cards.ts`, `game-card-packages.ts`,
 * and `workspace.ts`.
 *
 * `mediaType` is no longer stored on workspace/content records — it is
 * derived from the file path at consumption points. The zip manifest
 * (`GameCardPackageFileEntry.mediaType`) remains an external format
 * contract and is populated via `inferMediaTypeFromPath` on export.
 */

/** Infer a media type from a file path's extension. */
export function inferMediaTypeFromPath(
  pathInput: string,
  options?: { fallback?: string },
): string {
  const fallback = options?.fallback ?? "application/octet-stream"
  const path = pathInput.toLowerCase()
  // Text
  if (path.endsWith(".json")) return "application/json"
  if (path.endsWith(".jsonl")) return "application/x-ndjson"
  if (path.endsWith(".md") || path.endsWith(".markdown")) return "text/markdown"
  if (path.endsWith(".txt")) return "text/plain"
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "text/typescript"
  if (path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".jsx")) return "text/javascript"
  if (path.endsWith(".css")) return "text/css"
  if (path.endsWith(".html") || path.endsWith(".htm")) return "text/html"
  if (path.endsWith(".yaml") || path.endsWith(".yml")) return "text/yaml"
  // Image
  if (path.endsWith(".svg")) return "image/svg+xml"
  if (path.endsWith(".png")) return "image/png"
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg"
  if (path.endsWith(".webp")) return "image/webp"
  if (path.endsWith(".gif")) return "image/gif"
  if (path.endsWith(".avif")) return "image/avif"
  // Audio
  if (path.endsWith(".mp3")) return "audio/mpeg"
  if (path.endsWith(".ogg")) return "audio/ogg"
  if (path.endsWith(".wav")) return "audio/wav"
  if (path.endsWith(".m4a")) return "audio/mp4"
  if (path.endsWith(".flac")) return "audio/flac"
  // Video
  if (path.endsWith(".mp4")) return "video/mp4"
  if (path.endsWith(".webm")) return "video/webm"
  if (path.endsWith(".mov")) return "video/quicktime"
  // Font / wasm
  if (path.endsWith(".woff")) return "font/woff"
  if (path.endsWith(".woff2")) return "font/woff2"
  if (path.endsWith(".wasm")) return "application/wasm"
  return fallback
}

/** Workspace-domain wrapper: unknown extensions default to `text/plain`
 *  (workspace files are text-oriented). Package/frontend code uses the raw
 *  `inferMediaTypeFromPath` with the `application/octet-stream` fallback. */
export function inferWorkspaceMediaType(path: string): string {
  return inferMediaTypeFromPath(path, { fallback: "text/plain" })
}

export function isTextMediaType(mediaType: string): boolean {
  const type = mediaType.toLowerCase()
  return type.startsWith("text/")
    || type === "application/json"
    || type === "application/x-ndjson"
    || type === "text/yaml"
    || type === "application/yaml"
}

export function isImageMediaType(mediaType: string): boolean {
  return mediaType.toLowerCase().startsWith("image/")
}

export function isAudioMediaType(mediaType: string): boolean {
  return mediaType.toLowerCase().startsWith("audio/")
}

export function isVideoMediaType(mediaType: string): boolean {
  return mediaType.toLowerCase().startsWith("video/")
}

/** Placeholder text returned as `WorkspaceFile.content` for binary files, so
 *  agents reading the file do not mistake it for an empty file. Future
 *  multimodal support will replace this with an image content block through
 *  an independent channel. */
export function binaryPlaceholderText(blob: Blob, path: string): string {
  const mediaType = inferMediaTypeFromPath(path)
  return `[binary file: ${mediaType}, ${blob.size} bytes — 不可读取为文本]`
}
