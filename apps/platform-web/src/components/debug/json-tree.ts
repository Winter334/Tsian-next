export const JSON_TREE_STRING_PREVIEW_LENGTH = 160

export type JsonTreeContainer = Record<string, unknown> | unknown[]

export interface JsonTreeEntry {
  key: string
  path: string
  value: unknown
}

export function isJsonTreeContainer(value: unknown): value is JsonTreeContainer {
  return value !== null && typeof value === "object"
}

export function isLongJsonString(value: unknown): value is string {
  return typeof value === "string"
    && (value.length > JSON_TREE_STRING_PREVIEW_LENGTH || value.includes("\n") || value.includes("\r"))
}

export function jsonTreeChildPath(parentPath: string, key: string): string {
  const escapedKey = key.replace(/~/g, "~0").replace(/\//g, "~1")
  return `${parentPath}/${escapedKey}`
}

export function jsonTreeEntries(value: JsonTreeContainer, nodePath: string): JsonTreeEntry[] {
  return Object.entries(value).map(([key, entryValue]) => ({
    key,
    path: jsonTreeChildPath(nodePath, key),
    value: entryValue,
  }))
}
