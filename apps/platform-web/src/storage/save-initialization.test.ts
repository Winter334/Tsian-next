// @vitest-environment happy-dom
import "fake-indexeddb/auto"
import type { GameCardManifest } from "@tsian/contracts"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { strToU8, zipSync } from "fflate"
import { localDb } from "./db"
import { createInitialSaveFiles, initialSaveEntries, normalizeInitialSaveConfig } from "./save-initialization"
import { ensureBuiltinBlankGameCard, listLocalGameCardContentFiles, putLocalGameCard, writeLocalGameCardContentFile } from "./game-cards"
import { exportGameCardPackage, importGameCardPackage, normalizeGameCardManifest } from "./game-card-packages"
import { createLocalSaveFromGameCard } from "./saves"
import { initializeWorkspaceForSave, readWorkspaceFileForSave, writeWorkspaceFileForSave } from "./workspace"
import { restoreCheckpointForSave } from "./checkpoints"
import { getBlob } from "./blobs"
import officialManifestText from "../../../../cards/沉浸阅读器.tsian-card/card-manifest.json?raw"

const officialSources = import.meta.glob("../../../../cards/沉浸阅读器.tsian-card/workspace/**/*", {
  eager: true, query: "?raw", import: "default",
}) as Record<string, string>
const officialFiles = Object.entries(officialSources).map(([path, content]) => ({
  path: path.slice(path.indexOf("workspace/") + "workspace/".length), content,
}))
function manifest(id: string, root?: string): GameCardManifest {
  return {
    schema: "tsian.game-card.v1", id, name: id, version: "1", summary: "fixture",
    ...(root === undefined ? {} : { runtime: { initialSave: { templateRoot: root } } }),
  }
}
const config = { templateRoot: "initial-save" }

beforeEach(async () => { await localDb.delete(); await localDb.open() })
afterEach(async () => { await localDb.delete() })

describe("card-owned save initialization", () => {
  it("copies opaque contents, preserves names, and never interprets gameplay or expands macros", () => {
    const content = "{{file:secret}}\nThis does not have to be JSON."
    const files = createInitialSaveFiles(config, [
      { path: "initial-save/世界/状态.json", content },
      { path: "initial-save-other/ignored.md", content: "ignored" },
      { path: "agents/narrator/AGENT.md", content: "ignored" },
    ], 123)
    expect(files).toHaveLength(2)
    expect(files[1]).toEqual({ path: "save/世界/状态.json", content, createdAt: 123, updatedAt: 123 })
    expect(files[0].path).toBe(".tsian/manifest.json")
    expect(createInitialSaveFiles(undefined, [{ path: "initial-save/a", content: "ignored" }])).toHaveLength(1)
  })

  it.each([null, false, {}, { templateRoot: "" }, { templateRoot: "../seed" },
    { templateRoot: "/seed" }, { templateRoot: "C:/seed" }, { templateRoot: "seed/../other" },
    { templateRoot: "save" }, { templateRoot: ".tsian/a" }, { templateRoot: "frontend/src" },
    { templateRoot: "seed", script: "run.js" },
  ])("rejects invalid declarations: %j", value => {
    expect(() => normalizeInitialSaveConfig(value)).toThrow()
  })

  it("rejects missing/empty roots, traversal, metadata, duplicate and file-directory collisions", () => {
    for (const files of [
      [],
      [{ path: "initial-save", content: "not a directory" }],
      [{ path: "initial-save/../escape", content: "bad" }],
      [{ path: "initial-save/.tsian/manifest.json", content: "bad" }],
      [{ path: "initial-save/a", content: "1" }, { path: "initial-save/a", content: "2" }],
      [{ path: "initial-save/a", content: "file" }, { path: "initial-save/a/b", content: "child" }],
    ]) expect(() => initialSaveEntries(config, files)).toThrow()
  })

  it("keeps different card schemas and individual saves isolated, including the initial checkpoint", async () => {
    const a = await putLocalGameCard({ manifest: manifest("a", "initial-save"), contentFiles: [
      { path: "initial-save/counters.json", content: '{"score":7}' },
    ] })
    const b = await putLocalGameCard({ manifest: manifest("b", "boot"), contentFiles: [
      { path: "boot/diary.md", content: "unrelated schema" },
    ] })
    const sa = await createLocalSaveFromGameCard(a)
    const sa2 = await createLocalSaveFromGameCard(a)
    const sb = await createLocalSaveFromGameCard(b)
    expect((await readWorkspaceFileForSave(sa.id, "save/counters.json"))?.content).toBe('{"score":7}')
    expect(await readWorkspaceFileForSave(sb.id, "save/counters.json")).toBeNull()
    expect((await readWorkspaceFileForSave(sb.id, "save/diary.md"))?.content).toBe("unrelated schema")
    expect(await readWorkspaceFileForSave(sa.id, "save/playthrough/runtime.json")).toBeNull()
    const checkpoints = await localDb.checkpoints.where("saveId").equals(sa.id).toArray()
    expect(checkpoints).toHaveLength(1)
    expect(checkpoints[0]!.retention).toBe("pinned")
    const entry = checkpoints[0]!.manifest.find(file => file.path === "save/counters.json")!
    expect((await getBlob(entry.hash, sa.id))?.content).toBe('{"score":7}')
    await writeWorkspaceFileForSave(sa.id, { path: "save/counters.json", content: "changed" })
    expect((await readWorkspaceFileForSave(sa2.id, "save/counters.json"))?.content).toBe('{"score":7}')
    expect((await listLocalGameCardContentFiles(a.id))[0]!.content).toBe('{"score":7}')
    await restoreCheckpointForSave(sa.id, checkpoints[0]!.id)
    expect((await readWorkspaceFileForSave(sa.id, "save/counters.json"))?.content).toBe('{"score":7}')
  })

  it("uses only platform metadata without configuration, and the builtin is truly blank", async () => {
    const blank = await ensureBuiltinBlankGameCard()
    expect(blank.manifest.runtime?.entrypoints).toBeUndefined()
    expect(await listLocalGameCardContentFiles(blank.id)).toEqual([])
    const save = await createLocalSaveFromGameCard(blank)
    expect((await localDb.workspaceFiles.where("saveId").equals(save.id).toArray()).map(f => f.path)).toEqual([".tsian/manifest.json"])
    await initializeWorkspaceForSave(save.id)
    expect(await readWorkspaceFileForSave(save.id, "save/schema/current.md")).toBeNull()
  })

  it("does not reapply templates or repair business files on open, card update or restore", async () => {
    const card = await putLocalGameCard({ manifest: manifest("update", "seed"), contentFiles: [
      { path: "seed/state.md", content: "v1" },
    ] })
    const oldSave = await createLocalSaveFromGameCard(card)
    await writeWorkspaceFileForSave(oldSave.id, { path: "save/state.md", content: "player data" })
    await localDb.workspaceFiles.where("saveId").equals(oldSave.id)
      .filter(file => file.path === ".tsian/manifest.json").modify({ content: '{"workspaceVersion":0}' })
    const updated = await putLocalGameCard({ manifest: { ...card.manifest, version: "2" }, contentFiles: [
      { path: "seed/state.md", content: "v2" },
      { path: "seed/added.md", content: "new" },
    ] })
    await initializeWorkspaceForSave(oldSave.id)
    expect((await readWorkspaceFileForSave(oldSave.id, "save/state.md"))?.content).toBe("player data")
    expect(await readWorkspaceFileForSave(oldSave.id, "save/added.md")).toBeNull()
    expect(await readWorkspaceFileForSave(oldSave.id, "save/playthrough/runtime.json")).toBeNull()
    const newSave = await createLocalSaveFromGameCard(updated)
    expect((await readWorkspaceFileForSave(newSave.id, "save/state.md"))?.content).toBe("v2")
    const cp = await localDb.checkpoints.where("saveId").equals(oldSave.id).first()
    await restoreCheckpointForSave(oldSave.id, cp!.id)
    await initializeWorkspaceForSave(oldSave.id)
    expect((await readWorkspaceFileForSave(oldSave.id, "save/state.md"))?.content).toBe("v1")
    expect(await readWorkspaceFileForSave(oldSave.id, "save/added.md")).toBeNull()
  })

  it("fails before writes on a bad import or on a subsequently removed template", async () => {
    await expect(putLocalGameCard({ manifest: manifest("missing", "seed"), contentFiles: [] })).rejects.toThrow(/no files/)
    expect(await localDb.gameCards.count()).toBe(0)
    const badPackage = zipSync({ "game-card.json": strToU8(JSON.stringify({
      schema: "tsian.game-card.package.v1", manifest: manifest("bad-import", "missing"),
    })) })
    await expect(importGameCardPackage(badPackage)).rejects.toThrow(/no files/)
    expect(await localDb.gameCards.count()).toBe(0)
    const card = await putLocalGameCard({ manifest: manifest("broken", "seed"), contentFiles: [{ path: "seed/a", content: "a" }] })
    await localDb.gameCardContentFiles.where("gameCardId").equals(card.id).delete()
    await expect(createLocalSaveFromGameCard(card)).rejects.toThrow(/no files/)
    expect(await localDb.saves.count()).toBe(0)
    expect(await localDb.checkpoints.count()).toBe(0)
    expect(await localDb.workspaceFiles.count()).toBe(0)
    expect(await localDb.blobs.count()).toBe(0)
    await expect(exportGameCardPackage(card.id)).rejects.toThrow(/no files/)
  })

  it("preserves the declaration and files across export/import and creates from the imported package", async () => {
    const card = await putLocalGameCard({ manifest: manifest("roundtrip", "seed"), contentFiles: [
      { path: "seed/中文.md", content: "初始资料\n" },
    ] })
    expect(normalizeGameCardManifest(card.manifest).runtime?.initialSave).toEqual({ templateRoot: "seed" })
    const zip = await exportGameCardPackage(card.id)
    await localDb.gameCardContentFiles.clear()
    await localDb.gameCards.clear()
    const imported = await importGameCardPackage(zip)
    expect(imported.manifest.runtime?.initialSave).toEqual({ templateRoot: "seed" })
    expect(await localDb.saves.count()).toBe(0)
    const save = await createLocalSaveFromGameCard(imported)
    expect((await readWorkspaceFileForSave(save.id, "save/中文.md"))?.content).toBe("初始资料\n")
  })

  it("initializes the official reader from its distributed assets, including setup and schema skeletons", async () => {
    const official = JSON.parse(officialManifestText) as GameCardManifest
    const card = await putLocalGameCard({
      manifest: { ...official, frontend: undefined, cover: undefined }, contentFiles: officialFiles,
    })
    const save = await createLocalSaveFromGameCard(card)
    const seeds = officialFiles.filter(f => f.path.startsWith("initial-save/"))
    expect(seeds).toHaveLength(29)
    for (const seed of seeds) {
      expect((await readWorkspaceFileForSave(save.id, `save/${seed.path.slice("initial-save/".length)}`))?.content).toBe(seed.content)
    }
    const runtime = JSON.parse((await readWorkspaceFileForSave(save.id, "save/playthrough/runtime.json"))!.content)
    expect(runtime).toMatchObject({ turn: 0, plotOrder: 1, activeSceneRefs: [] })
    await writeLocalGameCardContentFile(card.id, { path: "initial-save/playthrough/runtime.json", content: '{"new":true}' })
    await initializeWorkspaceForSave(save.id)
    expect(JSON.parse((await readWorkspaceFileForSave(save.id, "save/playthrough/runtime.json"))!.content)).toEqual(runtime)
  })
})
