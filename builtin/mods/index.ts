import type { ModInitialSavePayload, ModStaticContent } from "@tsian/contracts"
import {
  createGreySaltTownInitialSavePayload,
  greySaltTownMod,
} from "./grey-salt-town/src"

interface BuiltinModEntry {
  mod: ModStaticContent
  createInitialSavePayload: (now: number) => ModInitialSavePayload
}

const builtinModEntries: BuiltinModEntry[] = [
  {
    mod: greySaltTownMod,
    createInitialSavePayload: createGreySaltTownInitialSavePayload,
  },
]

export const defaultModId = builtinModEntries[0].mod.manifest.id

function findBuiltinModEntry(modId: string): BuiltinModEntry | null {
  return builtinModEntries.find((entry) => entry.mod.manifest.id === modId) ?? null
}

export function listBuiltinMods(): ModStaticContent[] {
  return builtinModEntries.map((entry) => entry.mod)
}

export function getBuiltinMod(modId: string): ModStaticContent | null {
  return findBuiltinModEntry(modId)?.mod ?? null
}

export function getDefaultBuiltinMod(): ModStaticContent {
  return builtinModEntries[0].mod
}

export function createBuiltinModInitialSavePayload(
  now: number,
  modId = defaultModId,
): ModInitialSavePayload {
  const entry = findBuiltinModEntry(modId) ?? builtinModEntries[0]
  return entry.createInitialSavePayload(now)
}
