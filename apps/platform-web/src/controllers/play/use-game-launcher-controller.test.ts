import { beforeEach, describe, expect, it, vi } from "vitest"
import type { CloudBackupSummary } from "@tsian/contracts"
import type { LocalGameCardRecord, LocalSaveRecord } from "@/storage/db"

const host = vi.hoisted(() => {
  class CloudBackupConflictError extends Error {}
  return {
    CloudBackupConflictError,
    backupPlatformSaveToCloud: vi.fn(),
    createPlatformSaveFromGameCard: vi.fn(),
    deleteCloudBackupForSave: vi.fn(),
    deletePlatformSave: vi.fn(),
    exportPlatformSaveBackup: vi.fn(),
    importPlatformSaveBackup: vi.fn(),
    listCloudBackupsForCard: vi.fn(),
    pullCloudBackupToLocal: vi.fn(),
    renamePlatformSave: vi.fn(),
    updatePlatformSaveGameCardVersion: vi.fn(),
  }
})
const confirmMock = vi.hoisted(() => vi.fn())
const confirmChoiceMock = vi.hoisted(() => vi.fn())
const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}))

vi.mock("@/platform-host", () => host)
vi.mock("@/composables/useConfirm", () => ({
  confirm: confirmMock,
  confirmChoice: confirmChoiceMock,
}))
vi.mock("@/composables/useToast", () => ({ toast: toastMock }))

import { useGameLauncherController } from "./use-game-launcher-controller"

function gameCard(): LocalGameCardRecord {
  return {
    id: "card-row",
    source: "local",
    manifest: {
      schema: "tsian.game-card.v1",
      id: "card",
      name: "测试卡",
      version: "2.0.0",
      summary: "summary",
      runtime: { entrypoints: { playerTurn: "agent" } },
    },
    createdAt: 1,
    updatedAt: 1,
  }
}

function save(
  id: string,
  overrides: Partial<LocalSaveRecord> = {},
): LocalSaveRecord {
  return {
    id,
    name: id,
    gameCardId: "card",
    gameCardVersion: "2.0.0",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function backup(id: string): CloudBackupSummary {
  return {
    id,
    name: `backup ${id}`,
    cardId: "card",
    cardVersion: "2.0.0",
    revisionId: `revision ${id}`,
    sizeBytes: 1024,
    fileCount: 1,
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
  }
}

function createController(input: {
  saves?: LocalSaveRecord[]
  onContinue?: (saveId: string) => void
  onChanged?: () => void
  downloadBackup?: (download: { blob: Blob; filename: string }) => void
} = {}) {
  return useGameLauncherController({
    card: gameCard(),
    saves: input.saves ?? [],
    onContinue: input.onContinue ?? vi.fn(),
    onChanged: input.onChanged ?? vi.fn(),
    downloadBackup: input.downloadBackup ?? vi.fn(),
  })
}

describe("useGameLauncherController", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    confirmMock.mockResolvedValue(true)
    confirmChoiceMock.mockResolvedValue(null)
    host.backupPlatformSaveToCloud.mockResolvedValue({})
    host.createPlatformSaveFromGameCard.mockResolvedValue(save("created", { name: "新存档" }))
    host.deleteCloudBackupForSave.mockResolvedValue(undefined)
    host.deletePlatformSave.mockResolvedValue(undefined)
    host.exportPlatformSaveBackup.mockResolvedValue(new Blob(["backup"]))
    host.importPlatformSaveBackup.mockResolvedValue(save("imported", { name: "导入存档" }))
    host.listCloudBackupsForCard.mockResolvedValue([])
    host.pullCloudBackupToLocal.mockResolvedValue({ save: save("cloud"), replaced: true })
    host.renamePlatformSave.mockResolvedValue(save("renamed"))
    host.updatePlatformSaveGameCardVersion.mockResolvedValue(save("updated"))
  })

  it("filters and sorts card saves, then updates an old save before continuing", async () => {
    const sequence: string[] = []
    host.updatePlatformSaveGameCardVersion.mockImplementation(async () => {
      sequence.push("update")
      return save("old", { gameCardVersion: "2.0.0" })
    })
    const controller = createController({
      saves: [
        save("other", { gameCardId: "other", updatedAt: 9 }),
        save("old", { gameCardVersion: "1.0.0", updatedAt: 2 }),
        save("current", { updatedAt: 3 }),
      ],
      onChanged: () => sequence.push("changed"),
      onContinue: (id) => sequence.push(`continue:${id}`),
    })

    expect(controller.cardSaves.value.map((item) => item.id)).toEqual(["current", "old"])
    await controller.requestContinue(controller.cardSaves.value[1]!)

    expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ severity: "danger" }))
    expect(host.updatePlatformSaveGameCardVersion).toHaveBeenCalledWith("old", "2.0.0")
    expect(sequence).toEqual(["update", "changed", "continue:old"])
    expect(controller.busy.value).toBe(false)
  })

  it("owns create, rename, import, and export sequencing while delegating download delivery", async () => {
    const changed = vi.fn()
    const downloadBackup = vi.fn()
    const controller = createController({ onChanged: changed, downloadBackup })

    controller.startCreate()
    controller.createName.value = "  自定义存档  "
    await controller.confirmCreate()
    controller.startRename(save("created", { name: "新存档" }))
    controller.renameName.value = "重命名"
    await controller.confirmRename()
    const file = new File(["zip"], "save.zip", { type: "application/zip" })
    await controller.importSave(file)
    await controller.exportSave(save("export", { name: "A / B" }))

    expect(host.createPlatformSaveFromGameCard).toHaveBeenCalledWith("card-row", { name: "自定义存档" })
    expect(host.renamePlatformSave).toHaveBeenCalledWith("created", "重命名")
    expect(host.importPlatformSaveBackup).toHaveBeenCalledWith("card-row", file)
    expect(downloadBackup).toHaveBeenCalledWith({
      blob: expect.any(Blob),
      filename: "A---B.tsian-save.zip",
    })
    expect(changed).toHaveBeenCalledTimes(3)
    expect(toastMock.success).toHaveBeenCalledTimes(4)
  })

  it("requires explicit confirmation before forcing a conflicting cloud backup", async () => {
    const changed = vi.fn()
    host.backupPlatformSaveToCloud
      .mockRejectedValueOnce(new host.CloudBackupConflictError())
      .mockResolvedValueOnce({})
    const controller = createController({ onChanged: changed })
    const target = save("local")

    await controller.backupToCloud(target)

    expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({
      title: "覆盖云端备份？",
      severity: "danger",
    }))
    expect(host.backupPlatformSaveToCloud).toHaveBeenNthCalledWith(1, "local")
    expect(host.backupPlatformSaveToCloud).toHaveBeenNthCalledWith(2, "local", { force: true })
    expect(changed).toHaveBeenCalledTimes(1)
    expect(toastMock.success).toHaveBeenCalledWith("已覆盖云端备份。")
  })

  it("confirms cloud overwrite and deletes cloud state before the local save", async () => {
    const cloudSave = save("local", { cloudBackupId: "backup-1" })
    const changed = vi.fn()
    host.listCloudBackupsForCard.mockResolvedValue([backup("backup-1")])
    host.pullCloudBackupToLocal.mockResolvedValue({ save: cloudSave, replaced: true })
    confirmChoiceMock.mockResolvedValueOnce("cloud")
    const controller = createController({ saves: [cloudSave], onChanged: changed })

    await controller.syncFromCloud()
    await controller.requestDelete(cloudSave)

    expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ title: "同步云端？" }))
    expect(host.pullCloudBackupToLocal).toHaveBeenCalledWith("backup-1", expect.objectContaining({ id: "card-row" }))
    expect(host.deleteCloudBackupForSave).toHaveBeenCalledWith(cloudSave)
    expect(host.deletePlatformSave).toHaveBeenCalledWith("local")
    expect(host.deleteCloudBackupForSave.mock.invocationCallOrder[0])
      .toBeLessThan(host.deletePlatformSave.mock.invocationCallOrder[0]!)
    expect(changed).toHaveBeenCalledTimes(2)
  })

  it("suppresses duplicate mutations while an operation is busy", async () => {
    let resolveExport!: (blob: Blob) => void
    host.exportPlatformSaveBackup.mockReturnValueOnce(new Promise<Blob>((resolve) => {
      resolveExport = resolve
    }))
    const downloadBackup = vi.fn()
    const controller = createController({ downloadBackup })
    const target = save("save")

    const first = controller.exportSave(target)
    await controller.exportSave(target)
    resolveExport(new Blob(["done"]))
    await first

    expect(host.exportPlatformSaveBackup).toHaveBeenCalledTimes(1)
    expect(downloadBackup).toHaveBeenCalledTimes(1)
  })
})
