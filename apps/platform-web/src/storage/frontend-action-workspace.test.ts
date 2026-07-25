import "fake-indexeddb/auto"
import type { GameCardManifest, WorkspaceFile } from "@tsian/contracts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  commitFrontendActionWorkspace,
  createFrontendActionWorkspaceDependencyTracker,
  createFrontendActionWorkspaceResourceDependency,
  loadFrontendActionWorkspaceSnapshot,
} from "./frontend-action-workspace"
import { localDb, type LocalGameCardRecord, type LocalWorkspaceFileRecord } from "./db"
import { gameCardContentFileId } from "./game-cards"
import { WorkspaceStorageError } from "./workspace-types"
import * as workspaceStorage from "./workspace"

const CARD_ID = "card-frontend-action"
const SAVE_ID = "save-frontend-action"
const SECOND_SAVE_ID = "save-frontend-action-second"
const MANIFEST_PATH = "frontend-actions/use-item/action.json"
const EXECUTOR_PATH = "frontend-actions/use-item/run.js"

function cardManifest(): GameCardManifest {
  return {
    schema: "tsian.game-card.v1",
    id: CARD_ID,
    name: "Frontend Action Test",
    version: "1.0.0",
    summary: "Fixture",
  }
}

function workspaceRow(
  path: string,
  content: string,
  overrides: Partial<LocalWorkspaceFileRecord> = {},
): LocalWorkspaceFileRecord {
  return {
    id: `${SAVE_ID}:workspace:${encodeURIComponent(path)}`,
    saveId: SAVE_ID,
    path,
    content,
    createdAt: 10,
    updatedAt: 10,
    ...overrides,
  }
}

function writtenFile(path: string, content: string): WorkspaceFile {
  return {
    path,
    content,
    createdAt: 10,
    updatedAt: 20,
  }
}

async function seed(): Promise<void> {
  const card: LocalGameCardRecord = {
    id: CARD_ID,
    manifest: cardManifest(),
    source: "local",
    createdAt: 1,
    updatedAt: 1,
  }
  await localDb.transaction(
    "rw",
    [
      localDb.meta,
      localDb.saves,
      localDb.gameCards,
      localDb.gameCardContentFiles,
      localDb.gameCardFrontendFiles,
      localDb.workspaceFiles,
    ],
    async () => {
      await localDb.meta.put({ key: "active-save-id", value: SAVE_ID })
      await localDb.saves.put({
        id: SAVE_ID,
        name: "Save",
        gameCardId: CARD_ID,
        gameCardVersion: "1.0.0",
        createdAt: 1,
        updatedAt: 1,
      })
      await localDb.gameCards.put(card)
      await localDb.gameCardContentFiles.bulkPut([
        {
          id: gameCardContentFileId(CARD_ID, MANIFEST_PATH),
          gameCardId: CARD_ID,
          path: MANIFEST_PATH,
          content: JSON.stringify({
            schemaVersion: 1,
            inputSchema: { type: "object" },
            outputSchema: { type: "boolean" },
            executor: { type: "browser_script", path: "run.js" },
          }),
          createdAt: 2,
          updatedAt: 2,
        },
        {
          id: gameCardContentFileId(CARD_ID, EXECUTOR_PATH),
          gameCardId: CARD_ID,
          path: EXECUTOR_PATH,
          content: "return true",
          createdAt: 3,
          updatedAt: 3,
        },
        {
          id: gameCardContentFileId(CARD_ID, "rules/readme.md"),
          gameCardId: CARD_ID,
          path: "rules/readme.md",
          content: "card content",
          createdAt: 4,
          updatedAt: 4,
        },
      ])
      await localDb.gameCardFrontendFiles.put({
        id: `${CARD_ID}::frontend/dist/index.html`,
        gameCardId: CARD_ID,
        path: "frontend/dist/index.html",
        data: new Blob(["<main>fixture</main>"], { type: "text/html" }),
        size: 20,
        createdAt: 5,
        updatedAt: 5,
      })
      await localDb.workspaceFiles.bulkPut([
        workspaceRow("save/read.json", "old"),
        workspaceRow("save/delete/a.json", "a"),
        workspaceRow("save/keep.json", "keep"),
      ])
    },
  )
}

function resourceFromSnapshot(
  snapshot: Awaited<ReturnType<typeof loadFrontendActionWorkspaceSnapshot>>,
  path: string,
) {
  const file = snapshot.cardContentFiles.find((candidate) => candidate.path === path)!
  return createFrontendActionWorkspaceResourceDependency(snapshot, {
    provenance: "card-content",
    gameCardId: snapshot.gameCardId,
    file,
    signature: {
      path,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      byteLength: new TextEncoder().encode(file.content).byteLength,
    },
  })
}

function expectCode(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(WorkspaceStorageError)
  expect((error as WorkspaceStorageError).code).toBe(code)
}

beforeEach(async () => {
  await localDb.delete()
  await localDb.open()
  await seed()
})

afterEach(async () => {
  vi.restoreAllMocks()
  await localDb.delete()
})

describe("Frontend Action workspace snapshot", () => {
  it("loads one mounted-card snapshot with source provenance and frozen views", async () => {
    const snapshot = await loadFrontendActionWorkspaceSnapshot(CARD_ID)

    expect(snapshot.saveId).toBe(SAVE_ID)
    expect(snapshot.gameCardId).toBe(CARD_ID)
    expect(snapshot.cardContentFiles.find((file) => file.path === MANIFEST_PATH)?.provenance).toMatchObject({
      source: "card-content",
      rowId: gameCardContentFileId(CARD_ID, MANIFEST_PATH),
      gameCardId: CARD_ID,
    })
    expect(snapshot.cardFrontendFiles[0]?.provenance.source).toBe("card-frontend")
    expect(snapshot.saveWorkspaceFiles.find((file) => file.path === "save/read.json")?.provenance.source)
      .toBe("save-workspace")
    expect(snapshot.effectiveFiles.find((file) => file.path === "game-card.json")?.provenance.source)
      .toBe("game-card-manifest")
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.effectiveFiles)).toBe(true)
    expect(Object.isFrozen(snapshot.effectiveFiles[0])).toBe(true)
  })

  it("retries when active save switches after initialization and initializes the accepted save", async () => {
    await localDb.saves.put({
      id: SECOND_SAVE_ID,
      name: "Second Save",
      gameCardId: CARD_ID,
      gameCardVersion: "1.0.0",
      createdAt: 2,
      updatedAt: 2,
    })

    const initialize = workspaceStorage.initializeWorkspaceForSave
    const initializedSaveIds: string[] = []
    vi.spyOn(workspaceStorage, "initializeWorkspaceForSave").mockImplementation(async (saveId) => {
      initializedSaveIds.push(saveId)
      await initialize(saveId)
      if (saveId === SAVE_ID) {
        await localDb.meta.put({ key: "active-save-id", value: SECOND_SAVE_ID })
      }
    })

    const snapshot = await loadFrontendActionWorkspaceSnapshot(CARD_ID)

    expect(initializedSaveIds).toEqual([SAVE_ID, SECOND_SAVE_ID])
    expect(snapshot.saveId).toBe(SECOND_SAVE_ID)
    expect(snapshot.saveWorkspaceFiles.length).toBeGreaterThan(0)
    expect(await localDb.workspaceFiles.where("saveId").equals(SECOND_SAVE_ID).count()).toBeGreaterThan(0)
  })

  it("rejects when active save is cleared after initialization", async () => {
    const initialize = workspaceStorage.initializeWorkspaceForSave
    vi.spyOn(workspaceStorage, "initializeWorkspaceForSave").mockImplementation(async (saveId) => {
      await initialize(saveId)
      await localDb.meta.delete("active-save-id")
    })

    await expect(loadFrontendActionWorkspaceSnapshot(CARD_ID)).rejects.toMatchObject({
      code: "ACTIVE_SAVE_REQUIRED",
    })
  })

  it("rejects a mounted card that does not match the active save binding", async () => {
    await expect(loadFrontendActionWorkspaceSnapshot("other-card")).rejects.toMatchObject({
      code: "FRONTEND_ACTION_GAME_CARD_MISMATCH",
    })
  })
})

describe("Frontend Action workspace CAS", () => {
  it("preserves unrelated concurrent paths and commits concrete sorted actual paths without a checkpoint", async () => {
    const snapshot = await loadFrontendActionWorkspaceSnapshot(CARD_ID)
    const tracker = createFrontendActionWorkspaceDependencyTracker(snapshot)
    tracker.recordFile("save-runtime", "save/read.json")
    tracker.recordWriteBaseline("save/read.json")
    tracker.recordDeleteRange("save/delete")

    await localDb.workspaceFiles.put(workspaceRow("save/concurrent.json", "concurrent", {
      createdAt: 30,
      updatedAt: 30,
    }))
    const checkpointCountBefore = await localDb.checkpoints.count()
    const result = await commitFrontendActionWorkspace({
      snapshot,
      mountedGameCardId: CARD_ID,
      resources: [
        resourceFromSnapshot(snapshot, MANIFEST_PATH),
        resourceFromSnapshot(snapshot, EXECUTOR_PATH),
      ],
      dependencies: tracker.dependencies,
      deletePrefixes: tracker.deletePrefixes,
      changes: {
        writtenFiles: [writtenFile("save/read.json", "new")],
        deletedPaths: ["save/delete"],
      },
    })

    expect(result).toEqual({
      saveId: SAVE_ID,
      gameCardId: CARD_ID,
      writtenPaths: ["save/read.json"],
      deletedPaths: ["save/delete/a.json"],
      changed: true,
    })
    expect((await localDb.workspaceFiles.get(workspaceRow("save/read.json", "").id))?.content).toBe("new")
    expect(await localDb.workspaceFiles.where("saveId").equals(SAVE_ID).sortBy("path"))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ path: "save/concurrent.json", content: "concurrent" }),
        expect.objectContaining({ path: "save/keep.json", content: "keep" }),
      ]))
    expect(await localDb.checkpoints.count()).toBe(checkpointCountBefore)
    expect((await localDb.saves.get(SAVE_ID))?.updatedAt).toBeGreaterThan(1)
  })

  it("accepts concrete descendant deletes covered by the requested parent range", async () => {
    await localDb.workspaceFiles.put(workspaceRow("save/delete/nested/b.json", "b"))
    const snapshot = await loadFrontendActionWorkspaceSnapshot(CARD_ID)
    const tracker = createFrontendActionWorkspaceDependencyTracker(snapshot)
    tracker.recordDeleteRange("save/delete")

    const result = await commitFrontendActionWorkspace({
      snapshot,
      mountedGameCardId: CARD_ID,
      resources: [],
      dependencies: tracker.dependencies,
      deletePrefixes: tracker.deletePrefixes,
      changes: {
        writtenFiles: [],
        deletedPaths: ["save/delete/a.json", "save/delete/nested/b.json"],
      },
    })

    expect(result).toEqual({
      saveId: SAVE_ID,
      gameCardId: CARD_ID,
      writtenPaths: [],
      deletedPaths: ["save/delete/a.json", "save/delete/nested/b.json"],
      changed: true,
    })
    expect(await localDb.workspaceFiles.get(workspaceRow("save/delete/a.json", "").id)).toBeUndefined()
    expect(await localDb.workspaceFiles.get(workspaceRow("save/delete/nested/b.json", "").id)).toBeUndefined()
  })

  it("conflicts when a descendant is created under a non-empty requested parent range", async () => {
    const snapshot = await loadFrontendActionWorkspaceSnapshot(CARD_ID)
    const tracker = createFrontendActionWorkspaceDependencyTracker(snapshot)
    tracker.recordDeleteRange("save/delete")
    await localDb.workspaceFiles.put(workspaceRow("save/delete/concurrent.json", "concurrent", {
      createdAt: 40,
      updatedAt: 40,
    }))

    await expect(commitFrontendActionWorkspace({
      snapshot,
      mountedGameCardId: CARD_ID,
      resources: [],
      dependencies: tracker.dependencies,
      deletePrefixes: tracker.deletePrefixes,
      changes: {
        writtenFiles: [],
        deletedPaths: ["save/delete/a.json"],
      },
    })).rejects.toMatchObject({ code: "FRONTEND_ACTION_WORKSPACE_CONFLICT" })

    expect(await localDb.workspaceFiles.get(workspaceRow("save/delete/a.json", "").id)).toBeDefined()
    expect(await localDb.workspaceFiles.get(workspaceRow("save/delete/concurrent.json", "").id)).toBeDefined()
  })

  it("conflicts on a present file dependency and writes nothing", async () => {
    const snapshot = await loadFrontendActionWorkspaceSnapshot(CARD_ID)
    const tracker = createFrontendActionWorkspaceDependencyTracker(snapshot)
    tracker.recordFile("save-runtime", "save/read.json")
    tracker.recordWriteBaseline("save/keep.json")
    await localDb.workspaceFiles.put(workspaceRow("save/read.json", "concurrent", { updatedAt: 40 }))

    let caught: unknown
    try {
      await commitFrontendActionWorkspace({
        snapshot,
        mountedGameCardId: CARD_ID,
        resources: [],
        dependencies: tracker.dependencies,
        changes: {
          writtenFiles: [writtenFile("save/keep.json", "changed")],
          deletedPaths: [],
        },
      })
    } catch (error) {
      caught = error
    }
    expectCode(caught, "FRONTEND_ACTION_WORKSPACE_CONFLICT")
    expect((await localDb.workspaceFiles.get(workspaceRow("save/keep.json", "").id))?.content).toBe("keep")
  })

  it("conflicts when a previously missing file is created", async () => {
    const snapshot = await loadFrontendActionWorkspaceSnapshot(CARD_ID)
    const tracker = createFrontendActionWorkspaceDependencyTracker(snapshot)
    tracker.recordFile("save-runtime", "save/missing.json")
    await localDb.workspaceFiles.put(workspaceRow("save/missing.json", "created", { updatedAt: 40 }))

    await expect(commitFrontendActionWorkspace({
      snapshot,
      mountedGameCardId: CARD_ID,
      resources: [],
      dependencies: tracker.dependencies,
      changes: { writtenFiles: [], deletedPaths: [] },
    })).rejects.toMatchObject({ code: "FRONTEND_ACTION_WORKSPACE_CONFLICT" })
  })

  it("conflicts when an effective read overlay winner changes", async () => {
    const snapshot = await loadFrontendActionWorkspaceSnapshot(CARD_ID)
    const tracker = createFrontendActionWorkspaceDependencyTracker(snapshot)
    tracker.recordFile("effective", "rules/readme.md")
    await localDb.gameCardFrontendFiles.put({
      id: `${CARD_ID}::rules/readme.md`,
      gameCardId: CARD_ID,
      path: "rules/readme.md",
      data: new Blob(["frontend overlay"], { type: "text/plain" }),
      size: 16,
      createdAt: 40,
      updatedAt: 40,
    })

    await expect(commitFrontendActionWorkspace({
      snapshot,
      mountedGameCardId: CARD_ID,
      resources: [],
      dependencies: tracker.dependencies,
      changes: { writtenFiles: [], deletedPaths: [] },
    })).rejects.toMatchObject({ code: "FRONTEND_ACTION_WORKSPACE_CONFLICT" })
  })

  it("rejects forged dependency baselines", async () => {
    const snapshot = await loadFrontendActionWorkspaceSnapshot(CARD_ID)
    const tracker = createFrontendActionWorkspaceDependencyTracker(snapshot)
    const dependency = tracker.recordFile("save-runtime", "save/read.json")
    expect(dependency.kind).toBe("file")
    if (dependency.kind !== "file") throw new Error("Expected a file dependency")

    await expect(commitFrontendActionWorkspace({
      snapshot,
      mountedGameCardId: CARD_ID,
      resources: [],
      dependencies: [{ ...dependency, signature: "forged" }],
      changes: { writtenFiles: [], deletedPaths: [] },
    })).rejects.toMatchObject({ code: "FRONTEND_ACTION_DEPENDENCY_INVALID" })
  })

  it("conflicts on list and limited glob observable-result changes", async () => {
    const snapshot = await loadFrontendActionWorkspaceSnapshot(CARD_ID)
    const tracker = createFrontendActionWorkspaceDependencyTracker(snapshot)
    tracker.recordList("save-runtime", "save", { recursive: false })
    tracker.recordGlob("save-runtime", "save/**/*.json", 1)
    await localDb.workspaceFiles.put(workspaceRow("save/aaa.json", "new member", { updatedAt: 40 }))

    await expect(commitFrontendActionWorkspace({
      snapshot,
      mountedGameCardId: CARD_ID,
      resources: [],
      dependencies: tracker.dependencies,
      changes: { writtenFiles: [], deletedPaths: [] },
    })).rejects.toMatchObject({ code: "FRONTEND_ACTION_WORKSPACE_CONFLICT" })
  })

  it("conflicts when a new descendant appears under an initially empty delete prefix", async () => {
    const snapshot = await loadFrontendActionWorkspaceSnapshot(CARD_ID)
    const tracker = createFrontendActionWorkspaceDependencyTracker(snapshot)
    tracker.recordDeleteRange("save/empty")
    await localDb.workspaceFiles.put(workspaceRow("save/empty/new.json", "concurrent", { updatedAt: 40 }))

    await expect(commitFrontendActionWorkspace({
      snapshot,
      mountedGameCardId: CARD_ID,
      resources: [],
      dependencies: tracker.dependencies,
      deletePrefixes: tracker.deletePrefixes,
      changes: { writtenFiles: [], deletedPaths: [] },
    })).rejects.toMatchObject({ code: "FRONTEND_ACTION_WORKSPACE_CONFLICT" })
    expect(await localDb.workspaceFiles.get(workspaceRow("save/empty/new.json", "").id)).toBeDefined()
  })

  it("rejects a forged delete-range baseline before applying the live delete target", async () => {
    const snapshot = await loadFrontendActionWorkspaceSnapshot(CARD_ID)
    const tracker = createFrontendActionWorkspaceDependencyTracker(snapshot)
    const dependency = tracker.recordDeleteRange("save/delete")
    expect(dependency.kind).toBe("delete-range")
    if (dependency.kind !== "delete-range") throw new Error("Expected a delete-range dependency")
    await localDb.workspaceFiles.put(workspaceRow("save/delete/a.json", "changed", { updatedAt: 40 }))
    const liveSnapshot = await loadFrontendActionWorkspaceSnapshot(CARD_ID)
    const liveTracker = createFrontendActionWorkspaceDependencyTracker(liveSnapshot)
    const liveDependency = liveTracker.recordDeleteRange("save/delete")
    expect(liveDependency.kind).toBe("delete-range")
    if (liveDependency.kind !== "delete-range") throw new Error("Expected a live delete-range dependency")

    await expect(commitFrontendActionWorkspace({
      snapshot,
      mountedGameCardId: CARD_ID,
      resources: [],
      dependencies: [{
        ...dependency,
        descendantsSignature: liveDependency.descendantsSignature,
      }],
      deletePrefixes: tracker.deletePrefixes,
      changes: { writtenFiles: [], deletedPaths: ["save/delete"] },
    })).rejects.toMatchObject({ code: "FRONTEND_ACTION_DEPENDENCY_INVALID" })
    expect((await localDb.workspaceFiles.get(workspaceRow("save/delete/a.json", "").id))?.content)
      .toBe("changed")
  })

  it("conflicts when a binary read changes with the same metadata", async () => {
    await localDb.workspaceFiles.put(workspaceRow("save/image.bin", "", {
      data: new Blob([new Uint8Array([1, 2, 3])], { type: "application/octet-stream" }),
      updatedAt: 10,
    }))
    const snapshot = await loadFrontendActionWorkspaceSnapshot(CARD_ID)
    const tracker = createFrontendActionWorkspaceDependencyTracker(snapshot)
    tracker.recordFile("save-runtime", "save/image.bin")
    await localDb.workspaceFiles.put(workspaceRow("save/image.bin", "", {
      data: new Blob([new Uint8Array([1, 2, 4])], { type: "application/octet-stream" }),
      updatedAt: 10,
    }))

    await expect(commitFrontendActionWorkspace({
      snapshot,
      mountedGameCardId: CARD_ID,
      resources: [],
      dependencies: tracker.dependencies,
      changes: { writtenFiles: [], deletedPaths: [] },
    })).rejects.toMatchObject({ code: "FRONTEND_ACTION_WORKSPACE_CONFLICT" })
  })

  it("conflicts on active-save and save-to-card binding changes", async () => {
    const snapshot = await loadFrontendActionWorkspaceSnapshot(CARD_ID)
    await localDb.saves.update(SAVE_ID, { gameCardId: "other-card" })

    await expect(commitFrontendActionWorkspace({
      snapshot,
      mountedGameCardId: CARD_ID,
      resources: [],
      dependencies: [],
      changes: { writtenFiles: [], deletedPaths: [] },
    })).rejects.toMatchObject({ code: "FRONTEND_ACTION_WORKSPACE_CONFLICT" })
  })

  it("rejects resource dependencies that are not the exact snapshot object", async () => {
    const snapshot = await loadFrontendActionWorkspaceSnapshot(CARD_ID)
    const file = snapshot.cardContentFiles.find((candidate) => candidate.path === EXECUTOR_PATH)!

    expect(() => createFrontendActionWorkspaceResourceDependency(snapshot, {
      provenance: "card-content",
      gameCardId: snapshot.gameCardId,
      file: { ...file },
      signature: {
        path: file.path,
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
        byteLength: new TextEncoder().encode(file.content).byteLength,
      },
    })).toThrowError(expect.objectContaining({ code: "FRONTEND_ACTION_RESOURCE_INVALID" }))
  })

  it("conflicts on exact Action resource content changes", async () => {
    const snapshot = await loadFrontendActionWorkspaceSnapshot(CARD_ID)
    const resource = resourceFromSnapshot(snapshot, EXECUTOR_PATH)
    await localDb.gameCardContentFiles.put({
      id: gameCardContentFileId(CARD_ID, EXECUTOR_PATH),
      gameCardId: CARD_ID,
      path: EXECUTOR_PATH,
      content: "return false",
      createdAt: 3,
      updatedAt: 3,
    })

    await expect(commitFrontendActionWorkspace({
      snapshot,
      mountedGameCardId: CARD_ID,
      resources: [resource],
      dependencies: [],
      changes: { writtenFiles: [], deletedPaths: [] },
    })).rejects.toMatchObject({ code: "FRONTEND_ACTION_WORKSPACE_CONFLICT" })
  })

  it("ignores changes to unrelated Frontend Action resources", async () => {
    const snapshot = await loadFrontendActionWorkspaceSnapshot(CARD_ID)
    const resource = resourceFromSnapshot(snapshot, EXECUTOR_PATH)
    await localDb.gameCardContentFiles.put({
      id: gameCardContentFileId(CARD_ID, "frontend-actions/other/run.js"),
      gameCardId: CARD_ID,
      path: "frontend-actions/other/run.js",
      content: "return false",
      createdAt: 3,
      updatedAt: 3,
    })

    await expect(commitFrontendActionWorkspace({
      snapshot,
      mountedGameCardId: CARD_ID,
      resources: [resource],
      dependencies: [],
      changes: { writtenFiles: [], deletedPaths: [] },
    })).resolves.toMatchObject({ changed: false })
  })

  it("invokes the commit assertion twice for a successful mutation", async () => {
    const snapshot = await loadFrontendActionWorkspaceSnapshot(CARD_ID)
    const tracker = createFrontendActionWorkspaceDependencyTracker(snapshot)
    tracker.recordWriteBaseline("save/read.json")
    let assertionCount = 0

    const result = await commitFrontendActionWorkspace({
      snapshot,
      mountedGameCardId: CARD_ID,
      resources: [],
      dependencies: tracker.dependencies,
      changes: {
        writtenFiles: [writtenFile("save/read.json", "new")],
        deletedPaths: [],
      },
      assertCommitAllowed: () => {
        assertionCount += 1
      },
    })

    expect(assertionCount).toBe(2)
    expect(result).toMatchObject({ changed: true, writtenPaths: ["save/read.json"] })
  })

  it("rolls back when commit permission is invalidated at the final assertion", async () => {
    const snapshot = await loadFrontendActionWorkspaceSnapshot(CARD_ID)
    const tracker = createFrontendActionWorkspaceDependencyTracker(snapshot)
    tracker.recordWriteBaseline("save/read.json")
    let assertionCount = 0
    const leaseInvalidated = new Error("lease invalidated")

    await expect(commitFrontendActionWorkspace({
      snapshot,
      mountedGameCardId: CARD_ID,
      resources: [],
      dependencies: tracker.dependencies,
      changes: {
        writtenFiles: [writtenFile("save/read.json", "new")],
        deletedPaths: [],
      },
      assertCommitAllowed: () => {
        assertionCount += 1
        if (assertionCount === 2) throw leaseInvalidated
      },
    })).rejects.toBe(leaseInvalidated)

    expect(assertionCount).toBe(2)
    expect((await localDb.workspaceFiles.get(workspaceRow("save/read.json", "").id))?.content).toBe("old")
  })

  it("invokes the final assertion before a read-only no-op returns", async () => {
    const snapshot = await loadFrontendActionWorkspaceSnapshot(CARD_ID)
    let assertionCount = 0

    const result = await commitFrontendActionWorkspace({
      snapshot,
      mountedGameCardId: CARD_ID,
      resources: [],
      dependencies: [],
      changes: { writtenFiles: [], deletedPaths: [] },
      assertCommitAllowed: () => {
        assertionCount += 1
      },
    })

    expect(assertionCount).toBe(2)
    expect(result).toMatchObject({ changed: false, writtenPaths: [], deletedPaths: [] })
  })

  it("validates read-only and byte-identical no-op commits without touching timestamps or checkpoints", async () => {
    const snapshot = await loadFrontendActionWorkspaceSnapshot(CARD_ID)
    const tracker = createFrontendActionWorkspaceDependencyTracker(snapshot)
    tracker.recordFile("save-runtime", "save/read.json")
    tracker.recordWriteBaseline("save/read.json")
    const saveBefore = await localDb.saves.get(SAVE_ID)
    const checkpointsBefore = await localDb.checkpoints.count()

    const result = await commitFrontendActionWorkspace({
      snapshot,
      mountedGameCardId: CARD_ID,
      resources: [],
      dependencies: tracker.dependencies,
      changes: {
        writtenFiles: [writtenFile("save/read.json", "old")],
        deletedPaths: [],
      },
    })

    expect(result).toMatchObject({ changed: false, writtenPaths: [], deletedPaths: [] })
    expect((await localDb.saves.get(SAVE_ID))?.updatedAt).toBe(saveBefore?.updatedAt)
    expect(await localDb.checkpoints.count()).toBe(checkpointsBefore)
  })

  it("conflicts when a stale write target changed even if requested bytes now match", async () => {
    const snapshot = await loadFrontendActionWorkspaceSnapshot(CARD_ID)
    const tracker = createFrontendActionWorkspaceDependencyTracker(snapshot)
    tracker.recordWriteBaseline("save/read.json")
    await localDb.workspaceFiles.put(workspaceRow("save/read.json", "new", { updatedAt: 40 }))
    const saveBefore = await localDb.saves.get(SAVE_ID)

    await expect(commitFrontendActionWorkspace({
      snapshot,
      mountedGameCardId: CARD_ID,
      resources: [],
      dependencies: tracker.dependencies,
      changes: {
        writtenFiles: [writtenFile("save/read.json", "new")],
        deletedPaths: [],
      },
    })).rejects.toMatchObject({ code: "FRONTEND_ACTION_WORKSPACE_CONFLICT" })

    expect((await localDb.workspaceFiles.get(workspaceRow("save/read.json", "").id))?.content).toBe("new")
    expect((await localDb.saves.get(SAVE_ID))?.updatedAt).toBe(saveBefore?.updatedAt)
  })

  it("requires blind-write and delete-range baselines", async () => {
    const snapshot = await loadFrontendActionWorkspaceSnapshot(CARD_ID)

    await expect(commitFrontendActionWorkspace({
      snapshot,
      mountedGameCardId: CARD_ID,
      resources: [],
      dependencies: [],
      changes: {
        writtenFiles: [writtenFile("save/read.json", "new")],
        deletedPaths: [],
      },
    })).rejects.toMatchObject({ code: "FRONTEND_ACTION_WRITE_BASELINE_REQUIRED" })

    await expect(commitFrontendActionWorkspace({
      snapshot,
      mountedGameCardId: CARD_ID,
      resources: [],
      dependencies: [],
      changes: { writtenFiles: [], deletedPaths: ["save/delete"] },
    })).rejects.toMatchObject({ code: "FRONTEND_ACTION_DELETE_RANGE_REQUIRED" })
  })
})
