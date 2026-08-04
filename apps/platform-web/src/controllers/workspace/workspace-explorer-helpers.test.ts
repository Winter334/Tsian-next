// @vitest-environment happy-dom

import { describe, expect, it } from "vitest"
import {
  clampWorkspaceMenuCoordinate,
  isEditableWorkspaceKeyboardTarget,
  siblingWorkspacePath,
  splitWorkspaceNameExtension,
  uniqueWorkspaceName,
} from "./workspace-explorer-helpers"
import { normalizeWorkspaceDisplayPath } from "./workspace-controller-helpers"

describe("workspace explorer helpers", () => {
  it("normalizes display paths and preserves hidden-file stems", () => {
    expect(normalizeWorkspaceDisplayPath(" /foo\\bar// ")).toBe("foo/bar")
    expect(splitWorkspaceNameExtension("notes.md")).toEqual({ base: "notes", ext: ".md" })
    expect(splitWorkspaceNameExtension(".keep")).toEqual({ base: ".keep", ext: "" })
    expect(siblingWorkspacePath("foo/old.md", "new.md")).toBe("foo/new.md")
  })

  it("increments conflict names and clamps Source-local menus", () => {
    expect(uniqueWorkspaceName("foo", ".txt", new Set(["foo.txt", "foo(1).txt"])))
      .toBe("foo(2).txt")
    expect(clampWorkspaceMenuCoordinate(500, 300, 100)).toBe(192)
  })

  it("protects editable and CodeMirror targets from file shortcuts", () => {
    const editor = document.createElement("div")
    editor.className = "cm-editor"
    const content = document.createElement("div")
    editor.append(content)
    expect(isEditableWorkspaceKeyboardTarget(content)).toBe(true)
    expect(isEditableWorkspaceKeyboardTarget(document.createElement("input"))).toBe(true)
    expect(isEditableWorkspaceKeyboardTarget(document.createElement("button"))).toBe(false)
  })
})
