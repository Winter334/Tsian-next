// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest"

const host = vi.hoisted(() => ({
  listPlatformWorkspaceDirectory: vi.fn(),
  readPlatformWorkspaceFile: vi.fn(),
  validatePlatformWorkspaceFile: vi.fn(),
  writePlatformWorkspaceFile: vi.fn(),
}))
const guards = vi.hoisted(() => ({ setBeforeClose: vi.fn(), clearBeforeClose: vi.fn() }))
const dialogs = vi.hoisted(() => ({ confirmChoice: vi.fn() }))
const active = vi.hoisted(() => ({ id: "workspace-editor:card:e-1" }))

vi.mock("vue", async () => {
  const actual = await vi.importActual<typeof import("vue")>("vue")
  return { ...actual, onMounted: vi.fn(), onBeforeUnmount: vi.fn() }
})
vi.mock("@/platform-host", () => host)
vi.mock("@/composables/window-close-guards", () => guards)
vi.mock("@/composables/useConfirm", () => dialogs)
vi.mock("@/platform-apps", () => ({
  editorWindowIdFor: (input: { scopeKey: string; editorId: string; mode: string; path: string }) => (
    input.editorId
      ? `workspace-editor:${input.scopeKey}:${input.editorId}`
      : `workspace-editor:${input.scopeKey}:${input.mode}:${input.path}`
  ),
  platformWindowForRoute: () => active.id ? { id: active.id } : null,
}))

import { nextTick, onMounted, ref } from "vue"
import { useWorkspaceEditorController } from "./use-workspace-editor-controller"

const route = {
  name: "workspace-editor",
  fullPath: "/workspace/editor?cardId=card&path=notes.md&editorId=e-1",
  params: {},
  query: { cardId: "card", path: "notes.md", mode: "edit", editorId: "e-1" },
  hash: "",
  matched: [],
  meta: {},
  redirectedFrom: undefined,
} as never
const router = { replace: vi.fn() } as never

describe("useWorkspaceEditorController", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    active.id = "workspace-editor:card:e-1"
    dialogs.confirmChoice.mockResolvedValue("discard")
    host.readPlatformWorkspaceFile.mockResolvedValue({
      path: "notes.md",
      content: "before",
      readOnly: false,
    })
    host.writePlatformWorkspaceFile.mockResolvedValue({
      file: { path: "notes.md", content: "after", readOnly: false },
    })
    host.listPlatformWorkspaceDirectory.mockResolvedValue({ path: "", entries: [] })
    host.validatePlatformWorkspaceFile.mockResolvedValue({
      scope: "effective",
      path: "notes.md",
      valid: true,
      validator: "plain",
      errors: [],
    })
  })

  function createController() {
    return useWorkspaceEditorController({
      cardId: "card",
      path: "notes.md",
      mode: "edit",
      editorId: "e-1",
      route,
      router,
    })
  }

  it("registers one stable cross-shell guard and saves only the active editor", async () => {
    const controller = createController()
    const mountedCalls = vi.mocked(onMounted).mock.calls
    const mounted = mountedCalls[mountedCalls.length - 1]?.[0]
    mounted?.()
    await vi.waitFor(() => expect(controller.content.value).toBe("before"))
    expect(guards.setBeforeClose).toHaveBeenCalledWith(
      "workspace-editor:card:e-1",
      expect.any(Function),
    )

    controller.content.value = "after"
    const preventDefault = vi.fn()
    controller.handleSaveShortcut({
      ctrlKey: true,
      metaKey: false,
      key: "s",
      preventDefault,
    } as unknown as KeyboardEvent)
    await vi.waitFor(() => expect(host.writePlatformWorkspaceFile).toHaveBeenCalledTimes(1))
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(host.writePlatformWorkspaceFile).toHaveBeenCalledWith({
      cardId: "card",
      path: "notes.md",
      content: "after",
      expectedContent: "before",
    })

    active.id = "workspace-editor:card:e-2"
    controller.content.value = "background edit"
    controller.handleSaveShortcut({
      ctrlKey: true,
      metaKey: false,
      key: "s",
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent)
    expect(host.writePlatformWorkspaceFile).toHaveBeenCalledTimes(1)
  })

  it("rejects binary files before creating an editable baseline", async () => {
    host.readPlatformWorkspaceFile.mockResolvedValueOnce({
      path: "unknown.bin",
      content: "diagnostic placeholder",
      binary: new Blob(["binary"]),
    })
    const controller = useWorkspaceEditorController({
      cardId: "card",
      path: "unknown.bin",
      mode: "edit",
      editorId: "binary",
      route,
      router,
    })

    await controller.load()

    expect(controller.loadError.value).toMatch(/二进制文件/)
    expect(controller.content.value).toBe("")
  })

  it("vetoes close when the user chooses save but persistence fails", async () => {
    dialogs.confirmChoice.mockResolvedValueOnce("save")
    host.writePlatformWorkspaceFile.mockRejectedValueOnce({ message: "conflict" })
    const controller = createController()
    await controller.load()
    controller.content.value = "unsaved"

    await expect(controller.beforeClose()).resolves.toBe(false)
    expect(controller.hasDraftChanges.value).toBe(true)
    expect(controller.saveError.value).toBe("conflict")
  })

  it("does not reload the editor after create-save route synchronization", async () => {
    const path = ref("new.md")
    const mode = ref<"create" | "edit">("create")
    host.writePlatformWorkspaceFile.mockResolvedValueOnce({
      file: { path: "new.md", content: "draft", readOnly: false },
    })
    const controller = useWorkspaceEditorController({
      cardId: "card",
      path,
      mode,
      editorId: "create-1",
      route,
      router,
    })
    await controller.load()
    controller.content.value = "draft"

    await controller.saveDraft()
    mode.value = "edit"
    await nextTick()

    expect(host.readPlatformWorkspaceFile).not.toHaveBeenCalled()
    expect(controller.content.value).toBe("draft")
  })
})
