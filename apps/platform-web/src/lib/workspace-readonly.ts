import type { WorkspaceEntry } from "@tsian/contracts"

export type WorkspaceEditorMode = "create" | "edit"

function isProtectedSaveEntry(entry: WorkspaceEntry): boolean {
  return entry.path === "save" || /^save\/save-\d+$/.test(entry.path)
}

export function canCopyWorkspaceEntry(entry: WorkspaceEntry): boolean {
  return !isProtectedSaveEntry(entry)
}

export function canMutateWorkspaceEntry(input: {
  entry: WorkspaceEntry
  currentDirectoryReadOnly: boolean
  directoryLoading: boolean
}): boolean {
  return !input.directoryLoading
    && !input.currentDirectoryReadOnly
    && input.entry.readOnly !== true
    && !isProtectedSaveEntry(input.entry)
}

export function canCreateWorkspaceEntry(input: {
  isBrowsing: boolean
  currentDirectoryReadOnly: boolean
  directoryLoading: boolean
  currentPath: string
}): boolean {
  return input.isBrowsing
    && !input.directoryLoading
    && !input.currentDirectoryReadOnly
    && input.currentPath !== "save"
}

export function hasWorkspaceEditorDraftChanges(input: {
  readOnly: boolean
  mode: WorkspaceEditorMode
  content: string
  expectedContent: string
}): boolean {
  return !input.readOnly
    && (input.mode === "create" || input.content !== input.expectedContent)
}

export function workspaceEditorSaveShortcutAction(input: {
  minimized: boolean
  routeName: unknown
  ctrlKey: boolean
  metaKey: boolean
  key: string
  readOnly: boolean
}): "ignore" | "blocked" | "save" {
  if (
    input.minimized
    || input.routeName !== "workspace-editor"
    || (!input.ctrlKey && !input.metaKey)
    || (input.key !== "s" && input.key !== "S")
  ) {
    return "ignore"
  }
  return input.readOnly ? "blocked" : "save"
}
