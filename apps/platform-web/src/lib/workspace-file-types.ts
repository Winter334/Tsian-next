export interface WorkspaceMediaTypeOption {
  value: string
  label: string
  extensions: string
}

export const WORKSPACE_MEDIA_TYPE_OPTIONS: WorkspaceMediaTypeOption[] = [
  { value: "text/plain", label: "普通文本", extensions: ".txt" },
  { value: "text/markdown", label: "Markdown", extensions: ".md" },
  { value: "application/json", label: "JSON", extensions: ".json" },
  { value: "application/x-ndjson", label: "JSONL / NDJSON", extensions: ".jsonl" },
  { value: "text/typescript", label: "TypeScript", extensions: ".ts, .tsx" },
  { value: "text/javascript", label: "JavaScript", extensions: ".js, .mjs, .jsx" },
  { value: "text/css", label: "CSS", extensions: ".css" },
  { value: "text/html", label: "HTML", extensions: ".html" },
  { value: "text/yaml", label: "YAML", extensions: ".yaml, .yml" },
]

// The inference logic now lives in lib/media-type.ts (shared with game-cards,
// game-card-packages, and workspace storage). Re-exported here so existing
// `inferWorkspaceMediaType` import sites keep working.
export { inferWorkspaceMediaType } from "./media-type"

export function workspaceMediaTypeLabel(mediaType: string): string {
  const normalized = mediaType.trim().toLowerCase()
  const label = WORKSPACE_MEDIA_TYPE_OPTIONS.find((option) => option.value === normalized)?.label
    ?? normalized
  return label || "普通文本"
}
