import { ref } from "vue"
import { beforeEach, describe, expect, it, vi } from "vitest"

const host = vi.hoisted(() => ({
  getPlatformActiveGameCard: vi.fn(),
  listPlatformGameCards: vi.fn(),
}))
const storage = vi.hoisted(() => ({
  listLocalGameCardContentFiles: vi.fn(),
  loadLocalAssistantFiles: vi.fn(),
}))

vi.mock("@/platform-host", () => host)
vi.mock("@/storage", () => ({
  ...storage,
  LOCAL_ASSISTANT_AGENT_ID: "assistant",
}))
import {
  activeInstallTargetCards,
  cardsById,
  contentFileToWorkspaceFile,
  sameAgentSource,
  sameSkillSource,
  sameToolSource,
  useMarketInventory,
} from "./use-market-inventory"

function card(id: string, source: "builtin" | "local" | "imported" = "local") {
  return {
    id,
    source,
    manifest: {
      schema: "tsian.game-card.v1" as const,
      id,
      name: id,
      version: "0.1.0",
      summary: "summary",
      runtime: { entrypoints: { playerTurn: "agent" } },
    },
    createdAt: 1,
    updatedAt: 1,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

describe("market inventory helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storage.listLocalGameCardContentFiles.mockResolvedValue([])
    storage.loadLocalAssistantFiles.mockResolvedValue([])
  })

  it("keeps only the editable active card as an install target", () => {
    expect(activeInstallTargetCards(card("builtin", "builtin"))).toEqual([])
    expect(activeInstallTargetCards(card("local"))).toEqual([card("local")])
  })

  it("deduplicates card inventory without reordering", () => {
    expect(cardsById([card("a"), card("b"), card("a")]).map((item) => item.id)).toEqual(["a", "b"])
  })

  it("preserves binary workspace content at the inventory boundary", () => {
    const blob = new Blob(["x"], { type: "image/png" })
    expect(contentFileToWorkspaceFile({ path: "cover.png", content: "", data: blob, createdAt: 1, updatedAt: 2 }))
      .toMatchObject({ path: "cover.png", binary: blob, createdAt: 1, updatedAt: 2 })
  })

  it("compares upload sources by their complete target identity", () => {
    expect(sameAgentSource({ kind: "assistant" }, { kind: "assistant" })).toBe(true)
    expect(sameAgentSource(
      { kind: "card-agent", cardId: "a", agentId: "x" },
      { kind: "card-agent", cardId: "b", agentId: "x" },
    )).toBe(false)
    expect(sameSkillSource(
      { kind: "card-shared", cardId: "a", skillId: "x", skillPath: "skills/x/SKILL.md" },
      { kind: "card-shared", cardId: "a", skillId: "x", skillPath: "skills/x/SKILL.md" },
    )).toBe(true)
    expect(sameToolSource(
      { kind: "assistant-local", toolId: "x", toolPath: "tools/x/tool.json" },
      { kind: "assistant-local", toolId: "y", toolPath: "tools/y/tool.json" },
    )).toBe(false)
  })

  it("does not let an older upload inventory overwrite a newer install inventory", async () => {
    const oldCards = deferred<ReturnType<typeof card>[]>()
    host.listPlatformGameCards.mockReturnValueOnce(oldCards.promise)
    host.getPlatformActiveGameCard
      .mockResolvedValueOnce(card("old"))
      .mockResolvedValueOnce(card("new"))
    const inventory = useMarketInventory(ref(""))

    const oldLoad = inventory.loadUploadResources()
    await inventory.loadInstallResources()
    oldCards.resolve([card("old")])
    await oldLoad

    expect(inventory.localCards.value.map((item) => item.id)).toEqual(["new"])
    expect(inventory.uploadCards.value).toEqual([])
    expect(inventory.localResourcesLoading.value).toBe(false)
  })
})
