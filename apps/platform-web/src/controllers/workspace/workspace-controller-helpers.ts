/** Normalizes route/editor display paths without applying storage semantics. */
export function normalizeWorkspaceDisplayPath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/+$/, "")
}
