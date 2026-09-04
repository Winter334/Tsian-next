// @vitest-environment happy-dom
// 一次性验证脚本（跑完即删）：确认 studio 侧无槽位 save 路径可读。
import "fake-indexeddb/auto"
import { expect, it } from "vitest"
import {
  createLocalSaveFromGameCard,
  ensureBuiltinBlankGameCard,
  setActiveSaveId,
  writeWorkspaceFileForSave,
} from "../storage"
import { readPlatformWorkspaceFile } from "./workspace-ops"

it("reads a slot-less save runtime path in studio", async () => {
  const card = await ensureBuiltinBlankGameCard()
  const save = await createLocalSaveFromGameCard(card as never)
  await setActiveSaveId(save.id)
  await writeWorkspaceFileForSave(save.id, {
    path: "save/source/manifest.json",
    content: "{\"ok\":true}",
  })

  const slotless = await readPlatformWorkspaceFile({
    cardId: card.id,
    path: "save/source/manifest.json",
  })
  expect(slotless.content).toBe("{\"ok\":true}")
  expect(slotless.path).toBe("save/source/manifest.json")

  const aliased = await readPlatformWorkspaceFile({
    cardId: card.id,
    path: "save/save-01/source/manifest.json",
  })
  expect(aliased.content).toBe("{\"ok\":true}")
})
