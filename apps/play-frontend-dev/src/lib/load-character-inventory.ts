import type { TsianApi } from "@tsian/play-bridge"
import type { CharacterEntity } from "./character-types"
import type { InventoryEntityLoadStatus, ItemEntity } from "./item-types"
import { loadInventoryEntityWith, type InventoryRead } from "./load-inventory-entity"
import { parseEntityRef } from "./entity-ref"

export interface EquipmentCandidate {
  ref: string
  item: ItemEntity | null
  status: InventoryEntityLoadStatus | "cycle"
  readPaths: string[]
  /** Exact reachable count when safely representable; null means the presentation-only total exceeded it. */
  availableCount: number | null
}

export interface CharacterInventoryDiscovery {
  candidates: EquipmentCandidate[]
  readPaths: string[]
}

export async function discoverCharacterInventory(
  character: CharacterEntity,
  read: InventoryRead,
): Promise<CharacterInventoryDiscovery> {
  const readPaths = new Set<string>()
  const candidates = new Map<string, EquipmentCandidate>()
  const completed = new Set<string>()
  const active = new Set<string>()

  async function walk(containerRef: string): Promise<void> {
    const parsed = parseEntityRef(containerRef, "container")
    if (!parsed) return
    readPaths.add(parsed.path)
    if (active.has(containerRef) || completed.has(containerRef)) return

    active.add(containerRef)
    try {
      const result = await loadInventoryEntityWith(read, containerRef)
      if (result.status !== "ready" || result.entity?.type !== "container") return
      for (const entry of result.entity.contents) {
        const nested = parseEntityRef(entry.ref)
        if (nested?.type === "container") {
          await walk(entry.ref)
          continue
        }
        if (nested?.type !== "item") continue
        readPaths.add(nested.path)
        const count = entry.count ?? 1
        const existing = candidates.get(entry.ref)
        if (existing) {
          if (existing.availableCount !== null) {
            const aggregate = BigInt(existing.availableCount) + BigInt(count)
            existing.availableCount = aggregate <= BigInt(Number.MAX_SAFE_INTEGER)
              ? Number(aggregate)
              : null
          }
          if (!existing.readPaths.includes(nested.path)) existing.readPaths.push(nested.path)
          continue
        }
        const itemResult = await loadInventoryEntityWith(read, entry.ref)
        candidates.set(entry.ref, {
          ref: entry.ref,
          item: itemResult.entity?.type !== "container" ? itemResult.entity : null,
          status: itemResult.status,
          readPaths: itemResult.path ? [itemResult.path] : [],
          availableCount: count,
        })
      }
    } finally {
      active.delete(containerRef)
      completed.add(containerRef)
    }
  }

  for (const root of character.containers ?? []) await walk(root.ref)
  return { candidates: Array.from(candidates.values()), readPaths: Array.from(readPaths) }
}

export function discoverCharacterInventoryWithTsian(
  character: CharacterEntity,
  tsian: Pick<TsianApi, "workspace">,
): Promise<CharacterInventoryDiscovery> {
  return discoverCharacterInventory(character, tsian.workspace.read)
}
