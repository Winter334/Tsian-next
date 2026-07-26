import { describe, expect, it, vi } from "vitest"
import type { JsonValue } from "@tsian/play-bridge"
import { parseEntityRef, refToEntityPath } from "./entity-ref"
import { parseCharacter } from "./parse-character"
import { parseContainer, parseItem } from "./parse-item"
import {
  loadInventoryEntityWith,
  type InventoryRead,
} from "./load-inventory-entity"
import { discoverCharacterInventory } from "./load-character-inventory"
import {
  parseEquipmentActionOutput,
  type EquipmentActionInput,
} from "./equipment-action"
import type { CharacterEntity } from "./character-types"

function characterRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "character:hero",
    name: "主角",
    brief: "一名旅行者",
    attributes: { 力量: 10, 敏捷: 8 },
    containers: [{ ref: "container:pack" }],
    ...overrides,
  }
}

function jsonRead(files: Map<string, unknown>): InventoryRead {
  return (async (path: string) => {
    if (!files.has(path)) return null
    const value = files.get(path)
    if (value instanceof Error) throw value
    return { content: typeof value === "string" ? value : JSON.stringify(value) }
  }) as InventoryRead
}

function mutationOutput(request: EquipmentActionInput): JsonValue {
  const afterRef = request.operation === "equip" ? request.itemRef : null
  return {
    kind: "mutation",
    mode: request.mode,
    operation: request.operation,
    characterRef: request.characterRef,
    slot: {
      slotType: request.slotType,
      slotIndex: request.slotIndex,
      beforeRef: request.expectedCurrentRef,
      afterRef,
    },
    attributes: {
      before: { 力量: 10, 敏捷: 8 },
      after: { 力量: 12, 敏捷: 8 },
      delta: { 力量: 2 },
    },
    equipment: {
      [request.slotType]: [afterRef === null ? { ref: null } : { ref: afterRef, applied: { 力量: 2 } }],
    },
  }
}

describe("canonical entity references", () => {
  it("maps each accepted reference to its canonical entity path", () => {
    expect(parseEntityRef("character:hero", "character")).toEqual({
      ref: "character:hero",
      type: "character",
      localId: "hero",
      path: "save/entities/character/hero.json",
    })
    expect(refToEntityPath("container:随身包")).toBe("save/entities/container/随身包.json")
    expect(refToEntityPath("item:blade")).toBe("save/entities/item/blade.json")
  })

  it.each([
    " item:blade",
    "item:blade ",
    "item:",
    ":blade",
    "item:blade:copy",
    "remote:blade",
    "item:.",
    "item:..",
    "item:a/b",
    "item:a\\b",
    "item:a\0b",
  ])("rejects non-canonical reference %j", (value) => {
    expect(parseEntityRef(value)).toBeNull()
    expect(refToEntityPath(value)).toBe("")
  })

  it("enforces expected type and UTF-16 length limits", () => {
    expect(parseEntityRef("item:blade", "container")).toBeNull()
    expect(parseEntityRef(`item:${"x".repeat(81)}`)).toBeNull()
    expect(parseEntityRef(`${"x".repeat(81)}:id`)).toBeNull()
    expect(parseEntityRef(`item:${"x".repeat(80)}`)).not.toBeNull()
  })
})

describe("character equipment parsing", () => {
  it("accepts fixed-capacity slot arrays and preserves empty and occupied slots", () => {
    const entity = parseCharacter(characterRaw({
      equipment: {
        手部: [
          { ref: "item:blade", applied: { 力量: 2 } },
          { ref: null },
        ],
      },
    }))

    expect(entity?.equipmentStatus).toBe("ready")
    expect(entity?.equipment).toEqual({
      手部: [
        { ref: "item:blade", applied: { 力量: 2 } },
        { ref: null },
      ],
    })
  })

  it("treats an omitted equipment field as absent even when attributes are omitted", () => {
    const entity = parseCharacter(characterRaw({ attributes: undefined }))
    expect(entity).not.toBeNull()
    expect(entity?.equipmentStatus).toBe("absent")
    expect(entity?.equipment).toBeUndefined()
  })

  it.each([
    { 手部: [{ ref: null, applied: {} }] },
    { 手部: [] },
    { 手部: [{ ref: "item:blade", applied: { 未知属性: 1 } }] },
    { 手部: [{ ref: "item:blade", extra: true }] },
    { 手部: { ref: "item:blade" } },
    { 手部: [{ ref: "item:blade", mods: ["力量+=2"] }] },
  ])("keeps the character readable but marks malformed equipment unavailable", (equipment) => {
    const entity = parseCharacter(characterRaw({ equipment }))
    expect(entity).not.toBeNull()
    expect(entity?.name).toBe("主角")
    expect(entity?.equipmentStatus).toBe("schema-corrupt")
    expect(entity?.equipment).toBeUndefined()
  })

  it("requires valid attributes and container roots before accepting equipment", () => {
    expect(parseCharacter(characterRaw({
      attributes: { 力量: 1.5 },
      equipment: { 手部: [{ ref: null }] },
    }))?.equipmentStatus).toBe("schema-corrupt")

    expect(parseCharacter(characterRaw({
      containers: [{ ref: "item:not-a-container" }],
      equipment: { 手部: [{ ref: null }] },
    }))?.equipmentStatus).toBe("schema-corrupt")
  })
})

describe("item and container equipment parsing", () => {
  it("accepts only the flat slotType/add/percent/effects equipment shape", () => {
    const entity = parseItem({
      id: "item:blade",
      name: "旧刃",
      brief: "仍然锋利",
      type: "equipment",
      equipment: {
        slotType: "手部",
        add: { 力量: 2 },
        percent: { 敏捷: -50 },
        effects: ["寒光逼人"],
      },
    })

    expect(entity?.equipmentStatus).toBe("ready")
    expect(entity?.equipment).toEqual({
      slotType: "手部",
      add: { 力量: 2 },
      percent: { 敏捷: -50 },
      effects: ["寒光逼人"],
    })
  })

  it("retains readable item metadata when managed equipment data is corrupt", () => {
    const entity = parseItem({
      id: "item:blade",
      name: "旧刃",
      brief: "仍然锋利",
      type: "equipment",
      equipment: { slot: "手部", mods: ["力量+=2"] },
    })

    expect(entity).toMatchObject({
      id: "item:blade",
      name: "旧刃",
      equipmentStatus: "schema-corrupt",
    })
    expect(entity?.equipment).toBeUndefined()
  })

  it("marks equipment items without rules corrupt and ordinary items without rules absent", () => {
    expect(parseItem({
      id: "item:blade",
      name: "旧刃",
      brief: "仍然锋利",
      type: "equipment",
    })?.equipmentStatus).toBe("schema-corrupt")
    expect(parseItem({
      id: "item:ore",
      name: "矿石",
      brief: "一块矿石",
      type: "material",
    })?.equipmentStatus).toBe("absent")
  })

  it("validates exact container edges and type-specific counts", () => {
    expect(parseContainer({
      id: "container:pack",
      name: "背包",
      brief: "旧背包",
      type: "container",
      contents: [
        { ref: "container:pouch", count: 1 },
        { ref: "item:ore", count: Number.MAX_SAFE_INTEGER },
      ],
    })?.contents).toHaveLength(2)

    expect(parseContainer({
      id: "container:pack",
      name: "背包",
      brief: "旧背包",
      type: "container",
      contents: [{ ref: "container:pouch", count: 2 }],
    })).toBeNull()
    expect(parseContainer({
      id: "container:pack",
      name: "背包",
      brief: "旧背包",
      type: "container",
      contents: [{ ref: "item:ore", count: 0 }],
    })).toBeNull()
  })
})

describe("inventory entity load statuses", () => {
  it("distinguishes invalid references, read failures, missing files, and invalid JSON", async () => {
    const neverRead = vi.fn()
    expect(await loadInventoryEntityWith(neverRead as unknown as InventoryRead, "character:hero"))
      .toEqual({ entity: null, status: "wrong-entity-type", path: null })
    expect(neverRead).not.toHaveBeenCalled()

    const path = "save/entities/item/blade.json"
    expect(await loadInventoryEntityWith(jsonRead(new Map([[path, new Error("offline")]])), "item:blade"))
      .toEqual({ entity: null, status: "read-failed", path })
    expect(await loadInventoryEntityWith(jsonRead(new Map()), "item:blade"))
      .toEqual({ entity: null, status: "missing", path })
    expect(await loadInventoryEntityWith(jsonRead(new Map([[path, "{"]])), "item:blade"))
      .toEqual({ entity: null, status: "invalid-json", path })
  })

  it("distinguishes identity/type mismatch from schema corruption", async () => {
    const path = "save/entities/item/blade.json"
    const mismatch = await loadInventoryEntityWith(jsonRead(new Map([[path, {
      id: "item:other",
      name: "错置物品",
      brief: "错误身份",
      type: "equipment",
      equipment: { slotType: "手部" },
    }]])), "item:blade")
    expect(mismatch.status).toBe("wrong-entity-type")

    const wrongType = await loadInventoryEntityWith(jsonRead(new Map([[path, {
      id: "item:blade",
      name: "错置容器",
      brief: "错误类型",
      type: "container",
      contents: [],
    }]])), "item:blade")
    expect(wrongType.status).toBe("wrong-entity-type")

    const corrupt = await loadInventoryEntityWith(jsonRead(new Map([[path, {
      id: "item:blade",
      name: "旧刃",
      brief: "仍然锋利",
      type: "equipment",
      equipment: { slotType: " 手部" },
    }]])), "item:blade")
    expect(corrupt.status).toBe("schema-corrupt")
    expect(corrupt.entity?.type).toBe("equipment")
  })
})

describe("recursive character inventory discovery", () => {
  it("marks a presentation count as large instead of rounding an unsafe aggregate", async () => {
    const files = new Map<string, unknown>([
      ["save/entities/container/root.json", {
        id: "container:root",
        name: "根容器",
        brief: "根",
        type: "container",
        contents: [
          { ref: "item:ore", count: Number.MAX_SAFE_INTEGER },
          { ref: "item:ore" },
        ],
      }],
      ["save/entities/item/ore.json", {
        id: "item:ore",
        name: "矿石",
        brief: "一批矿石",
        type: "material",
      }],
    ])
    const character: CharacterEntity = {
      id: "character:hero",
      name: "主角",
      brief: "旅行者",
      containers: [{ ref: "container:root" }],
      equipmentStatus: "absent",
    }

    const result = await discoverCharacterInventory(character, jsonRead(files))
    expect(result.candidates).toMatchObject([{
      ref: "item:ore",
      availableCount: null,
      status: "ready",
    }])
  })

  it("terminates cycles, deduplicates diamonds, accumulates authored counts, and tracks every read path", async () => {
    const files = new Map<string, unknown>([
      ["save/entities/container/root.json", {
        id: "container:root",
        name: "根容器",
        brief: "根",
        type: "container",
        contents: [
          { ref: "container:left" },
          { ref: "container:right" },
          { ref: "item:root-item", count: 2 },
        ],
      }],
      ["save/entities/container/left.json", {
        id: "container:left",
        name: "左袋",
        brief: "左",
        type: "container",
        contents: [
          { ref: "container:shared" },
          { ref: "item:blade" },
        ],
      }],
      ["save/entities/container/right.json", {
        id: "container:right",
        name: "右袋",
        brief: "右",
        type: "container",
        contents: [
          { ref: "container:shared" },
          { ref: "item:blade", count: 2 },
        ],
      }],
      ["save/entities/container/shared.json", {
        id: "container:shared",
        name: "共享内袋",
        brief: "菱形汇合点",
        type: "container",
        contents: [
          { ref: "item:gem", count: 3 },
          { ref: "container:root" },
        ],
      }],
      ...["root-item", "blade", "gem"].map((id) => [
        `save/entities/item/${id}.json`,
        {
          id: `item:${id}`,
          name: id,
          brief: id,
          type: "equipment",
          equipment: { slotType: "手部" },
        },
      ] as const),
    ])
    const read = vi.fn(jsonRead(files))
    const character: CharacterEntity = {
      id: "character:hero",
      name: "主角",
      brief: "旅行者",
      containers: [{ ref: "container:root" }],
      equipmentStatus: "absent",
    }

    const result = await discoverCharacterInventory(character, read as unknown as InventoryRead)
    expect(result.candidates.map(({ ref, availableCount, status }) => ({ ref, availableCount, status })))
      .toEqual([
        { ref: "item:gem", availableCount: 3, status: "ready" },
        { ref: "item:blade", availableCount: 3, status: "ready" },
        { ref: "item:root-item", availableCount: 2, status: "ready" },
      ])
    expect(result.readPaths).toEqual([
      "save/entities/container/root.json",
      "save/entities/container/left.json",
      "save/entities/container/shared.json",
      "save/entities/item/gem.json",
      "save/entities/item/blade.json",
      "save/entities/container/right.json",
      "save/entities/item/root-item.json",
    ])
    expect(read.mock.calls.filter(([path]) => path === "save/entities/container/root.json")).toHaveLength(1)
    expect(read.mock.calls.filter(([path]) => path === "save/entities/container/shared.json")).toHaveLength(1)
    expect(read.mock.calls.filter(([path]) => path === "save/entities/item/blade.json")).toHaveLength(1)
  })
})

describe("equipment Action output parsing", () => {
  const request: EquipmentActionInput = {
    mode: "preview",
    operation: "equip",
    characterRef: "character:hero",
    slotType: "手部",
    slotIndex: 0,
    expectedCurrentRef: null,
    itemRef: "item:blade",
  }

  it("accepts a closed safe-integer output that matches the request identity", () => {
    expect(parseEquipmentActionOutput(mutationOutput(request), request)).toMatchObject({
      mode: "preview",
      operation: "equip",
      slot: { beforeRef: null, afterRef: "item:blade" },
    })
  })

  it("rejects inconsistent projection identity, unsafe numbers, and extra fields", () => {
    const wrongProjection = mutationOutput(request) as Record<string, JsonValue>
    wrongProjection.equipment = { 手部: [{ ref: "item:other" }] }
    expect(parseEquipmentActionOutput(wrongProjection, request)).toBeNull()

    const unsafe = mutationOutput(request) as Record<string, JsonValue>
    unsafe.attributes = {
      before: { 力量: 10, 敏捷: 8 },
      after: { 力量: Number.MAX_SAFE_INTEGER + 1, 敏捷: 8 },
      delta: { 力量: 2 },
    }
    expect(parseEquipmentActionOutput(unsafe, request)).toBeNull()

    const extra = mutationOutput(request) as Record<string, JsonValue>
    extra.debug = true
    expect(parseEquipmentActionOutput(extra, request)).toBeNull()
  })

  it("rejects request/output identity mismatches", () => {
    const output = mutationOutput(request) as Record<string, JsonValue>
    output.characterRef = "character:other"
    expect(parseEquipmentActionOutput(output, request)).toBeNull()
  })
})
