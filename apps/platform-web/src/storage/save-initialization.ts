import type { GameCardInitialSaveConfig } from "@tsian/contracts"
import type { CheckpointWorkspaceFile } from "./workspace-types"

export const WORKSPACE_MANIFEST_PATH = ".tsian/manifest.json"

interface TemplateFile {
  path: string
  content?: string
  data?: Blob
}

function relativePath(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Initial save template path is required.")
  }
  const path = value.trim().replace(/\\/g, "/")
  if (path.startsWith("/") || /[:\0]/.test(path)
    || path.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error(`Initial save template path must be a relative path without traversal: ${value}`)
  }
  return path
}

export function normalizeInitialSaveConfig(value: unknown): GameCardInitialSaveConfig | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Game card runtime.initialSave must be an object.")
  }
  const config = value as Record<string, unknown>
  if (Object.keys(config).some(key => key !== "templateRoot")) {
    throw new Error("Game card runtime.initialSave only supports templateRoot.")
  }
  const templateRoot = relativePath(config.templateRoot)
  if (["save", ".tsian", "frontend", "game-card.json"].includes(templateRoot.split("/")[0]!)) {
    throw new Error("Initial save templateRoot cannot use a reserved workspace root.")
  }
  return { templateRoot }
}

/** Pure selection/validation shared by card import and save creation. No schema interpretation. */
export function initialSaveEntries(config: GameCardInitialSaveConfig | undefined, files: readonly TemplateFile[]): TemplateFile[] {
  const initialSave = normalizeInitialSaveConfig(config)
  if (!initialSave) return []
  const prefix = `${initialSave.templateRoot}/`
  const selected = new Map<string, TemplateFile>()
  for (const file of files) {
    const sourcePath = file.path.trim().replace(/\\/g, "/")
    if (sourcePath === initialSave.templateRoot) throw new Error("Initial save templateRoot must be a directory, not a file.")
    if (!sourcePath.startsWith(prefix)) continue
    const suffix = relativePath(sourcePath.slice(prefix.length))
    if (suffix === ".tsian" || suffix.startsWith(".tsian/")) {
      throw new Error("Initial save templates cannot contain platform metadata.")
    }
    const path = `save/${suffix}`
    if (selected.has(path)) throw new Error(`Duplicate initial save file: ${path}`)
    selected.set(path, { path, content: file.content ?? "", ...(file.data ? { data: file.data } : {}) })
  }
  if (selected.size === 0) {
    throw new Error(`Initial save template contains no files: ${initialSave.templateRoot}`)
  }
  for (const path of selected.keys()) {
    const parts = path.split("/")
    for (let i = 1; i < parts.length; i += 1) {
      if (selected.has(parts.slice(0, i).join("/"))) {
        throw new Error(`Initial save file conflicts with a directory: ${path}`)
      }
    }
  }
  return [...selected.values()].sort((a, b) => a.path.localeCompare(b.path))
}

/** Platform metadata is independent of any card's gameplay schema. */
export function createPlatformSaveFiles(now = Date.now()): CheckpointWorkspaceFile[] {
  return [{
    path: WORKSPACE_MANIFEST_PATH,
    content: JSON.stringify({
      version: "1.0.0",
      contentModel: { fileContent: "text", binaryContent: false, cardContentRoot: "/", activeSaveRoot: "save/" },
      platformMetadata: { path: ".tsian/", ordinaryWorkspaceVisible: false },
    }, null, 2) + "\n",
    createdAt: now,
    updatedAt: now,
  }]
}

export function createInitialSaveFiles(
  config: GameCardInitialSaveConfig | undefined,
  files: readonly TemplateFile[],
  now = Date.now(),
): CheckpointWorkspaceFile[] {
  return [
    ...createPlatformSaveFiles(now),
    ...initialSaveEntries(config, files).map(file => ({
      path: file.path,
      content: file.content ?? "",
      ...(file.data ? { data: file.data } : {}),
      createdAt: now,
      updatedAt: now,
    })),
  ]
}
