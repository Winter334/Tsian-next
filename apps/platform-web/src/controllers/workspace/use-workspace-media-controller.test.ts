import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const host = vi.hoisted(() => ({ readPlatformWorkspaceFile: vi.fn() }))
vi.mock("vue", async () => {
  const actual = await vi.importActual<typeof import("vue")>("vue")
  return { ...actual, onBeforeUnmount: vi.fn() }
})
vi.mock("@/platform-host", () => host)

import { useWorkspaceMediaController } from "./use-workspace-media-controller"

describe("useWorkspaceMediaController", () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it("replaces and revokes owned object URLs", async () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:first")
      .mockReturnValueOnce("blob:second")
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined)
    host.readPlatformWorkspaceFile.mockResolvedValue({
      path: "assets/a.png",
      content: "",
      binary: new Blob(["image"], { type: "image/png" }),
    })
    let path = "assets/a.png"
    const controller = useWorkspaceMediaController({ cardId: "card", path: () => path })
    await vi.waitFor(() => expect(controller.blobUrl.value).toBe("blob:first"))
    path = "assets/b.png"
    await controller.load()

    expect(createObjectURL).toHaveBeenCalledTimes(2)
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:first")
    controller.revokeUrl()
    expect(revokeObjectURL).toHaveBeenLastCalledWith("blob:second")
  })

  it("rejects text-only results without manufacturing a Blob URL", async () => {
    host.readPlatformWorkspaceFile.mockResolvedValue({ path: "assets/a.png", content: "placeholder" })
    const controller = useWorkspaceMediaController({ cardId: "card", path: "assets/a.png" })
    await vi.waitFor(() => expect(controller.loading.value).toBe(false))
    expect(controller.loadError.value).toMatch(/二进制数据/)
    expect(controller.blobUrl.value).toBe("")
  })

  it("does not let an older media read replace the latest route", async () => {
    type WorkspaceFileResult = {
      path: string
      content: string
      binary: Blob
    }
    let resolveFirst!: (file: WorkspaceFileResult) => void
    host.readPlatformWorkspaceFile
      .mockReturnValueOnce(new Promise<WorkspaceFileResult>((resolve) => {
        resolveFirst = resolve
      }))
      .mockResolvedValueOnce({
        path: "assets/b.png",
        content: "",
        binary: new Blob(["second"], { type: "image/png" }),
      })
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:second")
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined)
    let path = "assets/a.png"
    const controller = useWorkspaceMediaController({ cardId: "card", path: () => path })
    await vi.waitFor(() => expect(host.readPlatformWorkspaceFile).toHaveBeenCalledTimes(1))

    path = "assets/b.png"
    await controller.load()
    resolveFirst({
      path: "assets/a.png",
      content: "",
      binary: new Blob(["first"], { type: "image/png" }),
    })
    await Promise.resolve()

    expect(controller.blobUrl.value).toBe("blob:second")
    expect(createObjectURL).toHaveBeenCalledTimes(1)
  })
})
