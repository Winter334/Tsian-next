// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest"

const host = vi.hoisted(() => ({
  copyPlatformWorkspacePath: vi.fn(),
  deletePlatformWorkspacePath: vi.fn(),
  listPlatformWorkspaceDirectory: vi.fn(),
  listPlatformWorkspaceRoots: vi.fn(),
  movePlatformWorkspacePath: vi.fn(),
  searchPlatformWorkspace: vi.fn(),
  writePlatformWorkspaceFile: vi.fn(),
}))
const route = vi.hoisted(() => ({ name: "workspace", fullPath: "/workspace", query: {} as Record<string, unknown> }))
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }))

vi.mock("vue", async () => {
  const actual = await vi.importActual<typeof import("vue")>("vue")
  return { ...actual, onMounted: vi.fn(), onBeforeUnmount: vi.fn() }
})
vi.mock("vue-router", () => ({ useRoute: () => route, useRouter: () => router }))
vi.mock("@/platform-host", () => host)
vi.mock("@/composables/useConfirm", () => ({ confirm: vi.fn(async () => true) }))

import type { WorkspaceEntry } from "@tsian/contracts"
import { useWorkspaceExplorerController } from "./use-workspace-explorer-controller"

function listing(entries: WorkspaceEntry[] = []) {
  return { path: "", entries, readOnly: false }
}

describe("useWorkspaceExplorerController", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    route.name = "workspace"
    route.fullPath = "/workspace"
    route.query = {}
    host.listPlatformWorkspaceRoots.mockResolvedValue([])
    host.listPlatformWorkspaceDirectory.mockResolvedValue(listing())
    host.searchPlatformWorkspace.mockResolvedValue([])
  })

  it("persists a new empty folder with .keep and enters stem rename", async () => {
    const controller = useWorkspaceExplorerController()
    controller.selectedCardId.value = "card-a"
    controller.currentPath.value = "world"
    host.listPlatformWorkspaceDirectory.mockResolvedValueOnce({
      path: "world",
      readOnly: false,
      entries: [{
        path: "world/新文件夹",
        name: "新文件夹",
        kind: "directory",
      }],
    })

    await controller.createNewFolder()

    expect(host.writePlatformWorkspaceFile).toHaveBeenCalledWith({
      cardId: "card-a",
      path: "world/新文件夹/.keep",
      content: "",
    })
    expect(controller.renamingEntryPath.value).toBe("world/新文件夹")
    expect(controller.renameSelection.value).toBe("stem")
  })

  it("retains source and target roots for a cross-root copy", async () => {
    const controller = useWorkspaceExplorerController()
    const entry: WorkspaceEntry = { path: "docs/a.md", name: "a.md", kind: "file" }
    controller.selectedCardId.value = "source-card"
    controller.currentPath.value = "docs"
    controller.directoryEntries.value = [entry]
    controller.copyEntry(entry)
    controller.selectedCardId.value = "target-card"
    controller.currentPath.value = "imports"
    controller.directoryEntries.value = []
    host.copyPlatformWorkspacePath.mockResolvedValue(undefined)

    await controller.pasteFromClipboard()

    expect(host.copyPlatformWorkspacePath).toHaveBeenCalledWith({
      cardId: "source-card",
      targetCardId: "target-card",
      path: "docs/a.md",
      targetPath: "imports/a - 副本.md",
    })
    expect(controller.clipboard.value?.kind).toBe("copy")
  })

  it("invalidates an in-flight directory read when returning to the root list", async () => {
    let resolveDirectory!: (value: ReturnType<typeof listing>) => void
    host.listPlatformWorkspaceDirectory.mockReturnValueOnce(new Promise((resolve) => {
      resolveDirectory = resolve
    }))
    const controller = useWorkspaceExplorerController()
    controller.selectedCardId.value = "card-a"
    controller.currentPath.value = "world"

    const pending = controller.refreshDirectory()
    controller.returnToRoot()
    resolveDirectory({
      path: "world",
      readOnly: false,
      entries: [{ path: "world/stale.md", name: "stale.md", kind: "file" }],
    })
    await pending

    expect(controller.currentPath.value).toBe("")
    expect(controller.directoryEntries.value).toEqual([])
    expect(controller.directoryLoading.value).toBe(false)
  })
})
