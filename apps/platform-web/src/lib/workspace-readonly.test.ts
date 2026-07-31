import type { WorkspaceEntry } from "@tsian/contracts"
import { describe, expect, it } from "vitest"
import {
  canCopyWorkspaceEntry,
  canCreateWorkspaceEntry,
  canMutateWorkspaceEntry,
  hasWorkspaceEditorDraftChanges,
  workspaceEditorSaveShortcutAction,
} from "./workspace-readonly"

function entry(path: string, readOnly = false): WorkspaceEntry {
  const segments = path.split("/")
  return {
    path,
    name: segments[segments.length - 1] ?? path,
    kind: "file",
    ...(readOnly ? { readOnly: true } : {}),
  }
}

describe("generic workspace readonly capabilities", () => {
  it("allows copy but blocks every source mutation for readonly entries and directories", () => {
    const ordinary = entry("notes/report.json")
    const readOnly = entry("virtual/report.json", true)

    expect(canCopyWorkspaceEntry(readOnly)).toBe(true)
    expect(canMutateWorkspaceEntry({
      entry: readOnly,
      currentDirectoryReadOnly: false,
      directoryLoading: false,
    })).toBe(false)
    expect(canMutateWorkspaceEntry({
      entry: ordinary,
      currentDirectoryReadOnly: true,
      directoryLoading: false,
    })).toBe(false)
    expect(canCopyWorkspaceEntry(ordinary)).toBe(true)
  })

  it("blocks create and paste capability in readonly or loading directories", () => {
    expect(canCreateWorkspaceEntry({
      isBrowsing: true,
      currentDirectoryReadOnly: true,
      directoryLoading: false,
      currentPath: "virtual",
    })).toBe(false)
    expect(canCreateWorkspaceEntry({
      isBrowsing: true,
      currentDirectoryReadOnly: false,
      directoryLoading: true,
      currentPath: "notes",
    })).toBe(false)
  })

  it("never marks readonly editor content dirty and blocks its save shortcut", () => {
    expect(hasWorkspaceEditorDraftChanges({
      readOnly: true,
      mode: "edit",
      content: "changed",
      expectedContent: "original",
    })).toBe(false)
    expect(hasWorkspaceEditorDraftChanges({
      readOnly: true,
      mode: "create",
      content: "",
      expectedContent: "",
    })).toBe(false)
    expect(workspaceEditorSaveShortcutAction({
      minimized: false,
      routeName: "workspace-editor",
      ctrlKey: true,
      metaKey: false,
      key: "s",
      readOnly: true,
    })).toBe("blocked")
  })
})
