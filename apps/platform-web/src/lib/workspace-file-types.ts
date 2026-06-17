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

export function inferWorkspaceMediaType(pathInput: string): string {
  const path = pathInput.toLowerCase()
  if (path.endsWith(".json")) return "application/json"
  if (path.endsWith(".jsonl")) return "application/x-ndjson"
  if (path.endsWith(".md") || path.endsWith(".markdown")) return "text/markdown"
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "text/typescript"
  if (path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".jsx")) return "text/javascript"
  if (path.endsWith(".css")) return "text/css"
  if (path.endsWith(".html") || path.endsWith(".htm")) return "text/html"
  if (path.endsWith(".yaml") || path.endsWith(".yml")) return "text/yaml"
  return "text/plain"
}

export function workspaceMediaTypeLabel(mediaType: string): string {
  const normalized = mediaType.trim().toLowerCase()
  const label = WORKSPACE_MEDIA_TYPE_OPTIONS.find((option) => option.value === normalized)?.label
    ?? normalized
  return label || "普通文本"
}
