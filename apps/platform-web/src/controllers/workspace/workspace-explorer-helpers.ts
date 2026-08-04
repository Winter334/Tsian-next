export function splitWorkspaceNameExtension(name: string): { base: string; ext: string } {
  const dotIndex = name.lastIndexOf(".")
  if (dotIndex <= 0) return { base: name, ext: "" }
  return { base: name.slice(0, dotIndex), ext: name.slice(dotIndex) }
}

export function uniqueWorkspaceName(base: string, ext: string, existing: ReadonlySet<string>): string {
  const candidate = `${base}${ext}`
  if (!existing.has(candidate)) return candidate
  let index = 1
  while (existing.has(`${base}(${index})${ext}`)) index += 1
  return `${base}(${index})${ext}`
}

export function siblingWorkspacePath(path: string, nextName: string): string {
  const segments = path.split("/").filter(Boolean)
  segments.pop()
  return [...segments, nextName].join("/")
}

export function createWorkspaceEditorSessionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function isEditableWorkspaceKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable
    || target.tagName === "INPUT"
    || target.tagName === "TEXTAREA"
    || target.tagName === "SELECT"
    || Boolean(target.closest(".cm-editor"))
}

export function clampWorkspaceMenuCoordinate(
  value: number,
  containerSize: number,
  menuSize: number,
): number {
  return Math.min(Math.max(value, 8), Math.max(8, containerSize - menuSize - 8))
}
