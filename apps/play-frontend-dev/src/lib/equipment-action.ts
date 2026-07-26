import type { JsonValue } from "@tsian/play-bridge"
import type { CharacterEquipment } from "./character-types"
import { parseEntityRef, validManagedName } from "./entity-ref"

export interface EquipmentMutationResult {
  kind: "mutation"
  mode: "preview" | "commit"
  operation: "equip" | "unequip"
  characterRef: string
  slot: {
    slotType: string
    slotIndex: number
    beforeRef: string | null
    afterRef: string | null
  }
  attributes: {
    before: Record<string, number>
    after: Record<string, number>
    delta: Record<string, number>
  }
  equipment: CharacterEquipment
}

export type EquipmentActionInput =
  | {
      mode: "preview" | "commit"
      operation: "equip"
      characterRef: string
      slotType: string
      slotIndex: number
      expectedCurrentRef: string | null
      itemRef: string
    }
  | {
      mode: "preview" | "commit"
      operation: "unequip"
      characterRef: string
      slotType: string
      slotIndex: number
      expectedCurrentRef: string
    }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  const allowed = new Set([...required, ...optional])
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && Object.keys(value).every((key) => allowed.has(key))
}

function numericMap(value: unknown): value is Record<string, number> {
  return isRecord(value)
    && Object.entries(value).every(([key, entry]) => validManagedName(key) && Number.isSafeInteger(entry))
}

function validItemRef(value: unknown): value is string {
  return parseEntityRef(value, "item") !== null
}

function equipment(value: unknown): value is CharacterEquipment {
  if (!isRecord(value)) return false
  return Object.entries(value).every(([slotType, slots]) => validManagedName(slotType)
    && Array.isArray(slots)
    && slots.length > 0
    && slots.every((slot) => {
      if (!isRecord(slot)) return false
      if (slot.ref === null) return exactKeys(slot, ["ref"])
      return validItemRef(slot.ref)
        && exactKeys(slot, ["ref"], ["applied"])
        && (slot.applied === undefined || numericMap(slot.applied))
    }))
}

export function parseEquipmentActionOutput(
  value: JsonValue,
  request: EquipmentActionInput,
): EquipmentMutationResult | null {
  if (!isRecord(value)
    || !exactKeys(value, ["kind", "mode", "operation", "characterRef", "slot", "attributes", "equipment"])
    || value.kind !== "mutation"
    || value.mode !== request.mode
    || value.operation !== request.operation
    || value.characterRef !== request.characterRef
    || parseEntityRef(value.characterRef, "character") === null) return null

  const slot = value.slot
  if (!isRecord(slot)
    || !exactKeys(slot, ["slotType", "slotIndex", "beforeRef", "afterRef"])
    || slot.slotType !== request.slotType
    || !validManagedName(slot.slotType)
    || slot.slotIndex !== request.slotIndex
    || !Number.isSafeInteger(slot.slotIndex)
    || slot.beforeRef !== request.expectedCurrentRef
    || (slot.beforeRef !== null && !validItemRef(slot.beforeRef))
    || (request.operation === "equip" ? slot.afterRef !== request.itemRef : slot.afterRef !== null)
    || (slot.afterRef !== null && !validItemRef(slot.afterRef))) return null

  const attributes = value.attributes
  if (!isRecord(attributes)
    || !exactKeys(attributes, ["before", "after", "delta"])) return null
  const before = attributes.before
  const after = attributes.after
  const delta = attributes.delta
  if (!numericMap(before)
    || !numericMap(after)
    || !numericMap(delta)
    || Object.keys(before).length !== Object.keys(after).length
    || Object.keys(before).some((key) => !Object.prototype.hasOwnProperty.call(after, key))
    || Object.keys(delta).some((key) => !Object.prototype.hasOwnProperty.call(before, key))
    || !equipment(value.equipment)) return null

  const targetSlots = value.equipment[slot.slotType]
  if (!targetSlots
    || slot.slotIndex < 0
    || slot.slotIndex >= targetSlots.length
    || targetSlots[slot.slotIndex]?.ref !== slot.afterRef) return null

  return value as unknown as EquipmentMutationResult
}

export interface EquipmentPreviewIdentity {
  characterRef: string
  slotType: string
  slotIndex: number
  expectedCurrentRef: string | null
  itemRef: string | null
  operation: "equip" | "unequip"
}

export function previewIdentity(request: EquipmentActionInput): EquipmentPreviewIdentity {
  return {
    characterRef: request.characterRef,
    slotType: request.slotType,
    slotIndex: request.slotIndex,
    expectedCurrentRef: request.expectedCurrentRef,
    itemRef: request.operation === "equip" ? request.itemRef : null,
    operation: request.operation,
  }
}

export function samePreviewIdentity(left: EquipmentPreviewIdentity | null, right: EquipmentPreviewIdentity): boolean {
  return left !== null
    && left.characterRef === right.characterRef
    && left.slotType === right.slotType
    && left.slotIndex === right.slotIndex
    && left.expectedCurrentRef === right.expectedCurrentRef
    && left.itemRef === right.itemRef
    && left.operation === right.operation
}
