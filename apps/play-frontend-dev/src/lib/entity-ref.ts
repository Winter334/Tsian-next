/** Canonical entity references shared by character and inventory loaders. */
export type EntityRefType = "character" | "container" | "item"

export interface ParsedEntityRef {
  ref: string
  type: EntityRefType
  localId: string
  path: string
}

export function validManagedName(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value === value.trim()
    && value.length <= 80
}

function validSegment(value: string): boolean {
  return validManagedName(value)
    && value !== "."
    && value !== ".."
    && !value.includes("/")
    && !value.includes("\\")
    && !value.includes(":")
    && !value.includes("\0")
}

export function parseEntityRef(value: unknown, expectedType?: EntityRefType): ParsedEntityRef | null {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim() || value.length > 120) return null
  const colon = value.indexOf(":")
  if (colon <= 0 || colon !== value.lastIndexOf(":")) return null
  const type = value.slice(0, colon)
  const localId = value.slice(colon + 1)
  if ((type !== "character" && type !== "container" && type !== "item")
    || (expectedType !== undefined && type !== expectedType)
    || !validSegment(type)
    || !validSegment(localId)) return null
  return {
    ref: value,
    type,
    localId,
    path: `save/entities/${type}/${localId}.json`,
  }
}

export function refToEntityPath(value: string): string {
  return parseEntityRef(value)?.path ?? ""
}
