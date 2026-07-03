import type { AgentConfig, MarketResourceType, WorkspaceFile } from "@tsian/contracts"
import { strToU8, unzipSync, zipSync } from "fflate"
import { inferMediaTypeFromPath } from "../lib/media-type"
import { emitGameCardsChanged } from "../lib/platform-events"
import {
  getLocalGameCard,
  listLocalGameCardContentFiles,
  loadLocalAssistantFiles,
  LOCAL_ASSISTANT_AGENT_ID,
  LOCAL_ASSISTANT_DIR,
  replaceLocalAssistantFiles,
  replaceLocalGameCardContentDirectory,
} from "../storage"

const RESOURCE_PACKAGE_SCHEMA = "tsian.resource.package.v1"
const RESOURCE_PACKAGE_MANIFEST_PATH = "resource-package.json"
const DEFAULT_RESOURCE_VERSION = "0.1.0"
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true })

export interface ResourcePackageFileEntry {
  path: string
  mediaType?: string
}

export interface ResourcePackageManifest {
  schema: typeof RESOURCE_PACKAGE_SCHEMA
  resourceType: Exclude<MarketResourceType, "game_card">
  resourceId: string
  name: string
  summary: string
  author: string
  version: string
  files: ResourcePackageFileEntry[]
}

export type AgentPackageSource =
  | { kind: "card-agent"; cardId: string; agentId: string }
  | { kind: "assistant" }

export type SkillPackageSource =
  | { kind: "card-shared"; cardId: string; skillId: string; skillPath?: string }
  | { kind: "agent-local"; cardId: string; agentId: string; skillId: string; skillPath?: string }
  | { kind: "assistant-local"; skillId: string; skillPath?: string }

export type AgentInstallTarget =
  | { kind: "card"; cardId: string }
  | { kind: "assistant" }

export type SkillInstallTarget =
  | { kind: "card-shared"; cardId: string }
  | { kind: "agent-local"; cardId: string; agentId: string }
  | { kind: "assistant-local" }

export interface ResourcePackageInspection {
  resourceType: "agent" | "skill"
  resourceId: string
  name: string
  summary: string
  version: string
  files: Array<{ path: string; content: string }>
}

interface TextPackageFile {
  path: string
  content: string
}

interface ParsedResourcePackage {
  manifest: ResourcePackageManifest
  files: TextPackageFile[]
}

export async function exportAgentPackage(source: AgentPackageSource): Promise<Blob> {
  const sourceFiles = source.kind === "assistant"
    ? await assistantDefinitionPackageFiles()
    : await cardDirectoryPackageFiles(source.cardId, `agents/${source.agentId}`)
  const agentConfigFile = sourceFiles.find((file) => file.path === "agent.json")
  if (!agentConfigFile) {
    throw new Error("Agent 缺少 agent.json，无法导出。")
  }
  const agentConfig = parseAgentConfig(agentConfigFile.content)
  const fallbackId = source.kind === "assistant" ? LOCAL_ASSISTANT_AGENT_ID : source.agentId
  const resourceId = cleanString(agentConfig.id) ?? fallbackId
  const name = cleanString(agentConfig.title) ?? resourceId
  const summary = cleanString(agentConfig.summary) ?? "Agent resource package."

  return buildResourcePackage({
    resourceType: "agent",
    resourceId,
    name,
    summary,
    author: "",
    version: DEFAULT_RESOURCE_VERSION,
  }, sourceFiles)
}

export async function exportSkillPackage(source: SkillPackageSource): Promise<Blob> {
  const sourceFiles = source.kind === "assistant-local"
    ? await assistantSkillPackageFiles(source)
    : await cardSkillPackageFiles(source)
  const skillFile = sourceFiles.find((file) => file.path === "SKILL.md")
  if (!skillFile) {
    throw new Error("Skill 缺少 SKILL.md，无法导出。")
  }
  const metadata = parseMarkdownMetadata(skillFile.content)
  const fallbackId = source.skillId
  const resourceId = cleanString(metadata.name) ?? cleanString(metadata.id) ?? fallbackId
  const name = cleanString(metadata.title) ?? cleanString(metadata.name) ?? firstHeading(skillFile.content) ?? resourceId
  const summary = cleanString(metadata.description) ?? cleanString(metadata.summary) ?? firstParagraph(skillFile.content) ?? "Skill resource package."

  return buildResourcePackage({
    resourceType: "skill",
    resourceId,
    name,
    summary,
    author: "",
    version: DEFAULT_RESOURCE_VERSION,
  }, sourceFiles)
}

export async function inspectResourcePackage(blob: Blob): Promise<ResourcePackageInspection> {
  const parsed = await parseResourcePackage(blob)
  return {
    resourceType: parsed.manifest.resourceType,
    resourceId: parsed.manifest.resourceId,
    name: parsed.manifest.name,
    summary: parsed.manifest.summary,
    version: parsed.manifest.version,
    files: parsed.files,
  }
}

export async function installAgentPackage(blob: Blob, target: AgentInstallTarget): Promise<void> {
  const parsed = await parseResourcePackage(blob, "agent")
  if (target.kind === "assistant") {
    const files = parsed.files.map((file) => file.path === "agent.json"
      ? { ...file, content: rewriteAgentId(file.content, LOCAL_ASSISTANT_AGENT_ID) }
      : file)
    await replaceAssistantDefinition(files)
    return
  }

  await replaceCardContentDirectory(target.cardId, `agents/${parsed.manifest.resourceId}`, parsed.files)
}

export async function installSkillPackage(blob: Blob, target: SkillInstallTarget): Promise<void> {
  const parsed = await parseResourcePackage(blob, "skill")
  if (target.kind === "assistant-local") {
    await replaceAssistantSkillDirectory(parsed.manifest.resourceId, parsed.files)
    return
  }

  const directory = target.kind === "agent-local"
    ? `agents/${target.agentId}/skills/${parsed.manifest.resourceId}`
    : `skills/${parsed.manifest.resourceId}`
  await replaceCardContentDirectory(target.cardId, directory, parsed.files)
}

export async function replaceCardContentDirectory(
  cardId: string,
  directoryPath: string,
  files: TextPackageFile[],
): Promise<void> {
  const card = await getLocalGameCard(cardId)
  if (!card) {
    throw new Error(`游戏卡 "${cardId}" 不存在。`)
  }
  await replaceLocalGameCardContentDirectory(card.id, directoryPath, files.map((file) => ({
    relativePath: file.path,
    content: file.content,
  })))
  emitGameCardsChanged()
}

export async function replaceAssistantDefinition(files: TextPackageFile[]): Promise<void> {
  await replaceLocalAssistantFiles([
    `${LOCAL_ASSISTANT_DIR}/agent.json`,
    `${LOCAL_ASSISTANT_DIR}/AGENT.md`,
    `${LOCAL_ASSISTANT_DIR}/SOUL.md`,
    `${LOCAL_ASSISTANT_DIR}/skills`,
  ], files.map((file) => assistantWorkspaceFile(file.path, file.content)), { skipDefaultMerge: true })
}

export async function replaceAssistantSkillDirectory(skillId: string, files: TextPackageFile[]): Promise<void> {
  const directory = `${LOCAL_ASSISTANT_DIR}/skills/${normalizePackagePath(skillId)}`
  await replaceLocalAssistantFiles([
    directory,
  ], files.map((file) => ({
    path: `${directory}/${file.path}`,
    content: file.content,
    createdAt: 0,
    updatedAt: Date.now(),
  })))
}

async function cardDirectoryPackageFiles(cardId: string, directoryPath: string): Promise<TextPackageFile[]> {
  const card = await getLocalGameCard(cardId)
  if (!card) {
    throw new Error(`游戏卡 "${cardId}" 不存在。`)
  }
  const directory = normalizePackagePath(directoryPath)
  const prefix = `${directory}/`
  const files = (await listLocalGameCardContentFiles(card.id))
    .filter((file) => file.path.startsWith(prefix))
    .map((file): TextPackageFile => {
      if (file.data) {
        throw new Error(`资源包 v1 只支持文本文件，无法导出二进制文件：${file.path}`)
      }
      return {
        path: normalizePackagePath(file.path.slice(prefix.length)),
        content: file.content,
      }
    })
  return sortPackageFiles(files)
}

async function cardSkillPackageFiles(
  source: Extract<SkillPackageSource, { kind: "card-shared" | "agent-local" }>,
): Promise<TextPackageFile[]> {
  const skillDirectory = source.skillPath
    ? skillDirectoryFromSkillPath(source.skillPath)
    : source.kind === "agent-local"
      ? `agents/${source.agentId}/skills/${source.skillId}`
      : `skills/${source.skillId}`
  return cardDirectoryPackageFiles(source.cardId, skillDirectory)
}

async function assistantDefinitionPackageFiles(): Promise<TextPackageFile[]> {
  const prefix = `${LOCAL_ASSISTANT_DIR}/`
  const files = (await loadLocalAssistantFiles())
    .flatMap((file): TextPackageFile[] => {
      if (!file.path.startsWith(prefix)) {
        return []
      }
      const relativePath = file.path.slice(prefix.length)
      if (
        relativePath === "agent.json"
        || relativePath === "AGENT.md"
        || relativePath === "SOUL.md"
        || relativePath.startsWith("skills/")
      ) {
        return [{ path: normalizePackagePath(relativePath), content: file.content }]
      }
      return []
    })
  return sortPackageFiles(files)
}

async function assistantSkillPackageFiles(source: Extract<SkillPackageSource, { kind: "assistant-local" }>): Promise<TextPackageFile[]> {
  const skillDirectory = source.skillPath
    ? skillDirectoryFromSkillPath(source.skillPath)
    : `${LOCAL_ASSISTANT_DIR}/skills/${normalizePackagePath(source.skillId)}`
  const prefix = `${skillDirectory}/`
  const files = (await loadLocalAssistantFiles())
    .flatMap((file): TextPackageFile[] => file.path.startsWith(prefix)
      ? [{ path: normalizePackagePath(file.path.slice(prefix.length)), content: file.content }]
      : [])
  return sortPackageFiles(files)
}

function skillDirectoryFromSkillPath(skillPath: string): string {
  const path = normalizePackagePath(skillPath)
  if (!path.endsWith("/SKILL.md")) {
    throw new Error(`Skill 路径必须指向 SKILL.md：${skillPath}`)
  }
  return path.slice(0, -"/SKILL.md".length)
}

function buildResourcePackage(
  input: Omit<ResourcePackageManifest, "schema" | "files">,
  files: TextPackageFile[],
): Blob {
  const normalizedFiles = sortPackageFiles(files)
  const manifest: ResourcePackageManifest = {
    schema: RESOURCE_PACKAGE_SCHEMA,
    ...input,
    files: normalizedFiles.map((file) => ({
      path: file.path,
      mediaType: inferMediaTypeFromPath(file.path, { fallback: "text/plain" }),
    })),
  }
  validateResourceManifest(manifest)
  validateRequiredFiles(manifest.resourceType, normalizedFiles.map((file) => file.path))

  const zipInput: Record<string, Uint8Array> = {
    [RESOURCE_PACKAGE_MANIFEST_PATH]: strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
  }
  for (const file of normalizedFiles) {
    zipInput[file.path] = strToU8(file.content)
  }
  return new Blob([zipSync(zipInput, { level: 6 })], { type: "application/zip" })
}

async function parseResourcePackage(
  blob: Blob,
  expectedType?: ResourcePackageManifest["resourceType"],
): Promise<ParsedResourcePackage> {
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  const manifestBytes = entries[RESOURCE_PACKAGE_MANIFEST_PATH]
  if (!manifestBytes) {
    throw new Error("资源包缺少 resource-package.json。")
  }
  const manifest = parseResourceManifest(decodeText(manifestBytes, RESOURCE_PACKAGE_MANIFEST_PATH))
  if (expectedType && manifest.resourceType !== expectedType) {
    throw new Error(`资源包类型 ${manifest.resourceType} 与安装类型 ${expectedType} 不匹配。`)
  }

  const listedPaths = new Set<string>()
  const files: TextPackageFile[] = []
  for (const entry of manifest.files) {
    const path = normalizePackagePath(entry.path)
    if (path === RESOURCE_PACKAGE_MANIFEST_PATH) {
      throw new Error("resource-package.json 不能列入资源文件清单。")
    }
    listedPaths.add(path)
    const data = entries[path]
    if (!data) {
      throw new Error(`资源包清单中的文件不存在：${path}`)
    }
    files.push({ path, content: decodeText(data, path) })
  }
  for (const path of Object.keys(entries)) {
    const normalizedPath = normalizePackagePath(path)
    if (normalizedPath !== RESOURCE_PACKAGE_MANIFEST_PATH && !listedPaths.has(normalizedPath)) {
      throw new Error(`资源包含有未列入清单的文件：${normalizedPath}`)
    }
  }
  validateRequiredFiles(manifest.resourceType, files.map((file) => file.path))
  return { manifest, files: sortPackageFiles(files) }
}

function parseResourceManifest(source: string): ResourcePackageManifest {
  const parsed = JSON.parse(source) as unknown
  if (!isRecord(parsed)) {
    throw new Error("resource-package.json 必须是 JSON 对象。")
  }
  const manifest: ResourcePackageManifest = {
    schema: requireString(parsed.schema, "schema") as typeof RESOURCE_PACKAGE_SCHEMA,
    resourceType: requireString(parsed.resourceType, "resourceType") as ResourcePackageManifest["resourceType"],
    resourceId: requireString(parsed.resourceId, "resourceId"),
    name: requireString(parsed.name, "name"),
    summary: requireString(parsed.summary, "summary"),
    author: typeof parsed.author === "string" ? parsed.author.trim() : "",
    version: requireString(parsed.version, "version"),
    files: Array.isArray(parsed.files)
      ? parsed.files.map((item) => {
          if (!isRecord(item)) {
            throw new Error("资源包 files 条目必须是对象。")
          }
          return {
            path: normalizePackagePath(requireString(item.path, "files[].path")),
            ...(typeof item.mediaType === "string" && item.mediaType.trim()
              ? { mediaType: item.mediaType.trim() }
              : {}),
          }
        })
      : [],
  }
  validateResourceManifest(manifest)
  return manifest
}

function validateResourceManifest(manifest: ResourcePackageManifest): void {
  if (manifest.schema !== RESOURCE_PACKAGE_SCHEMA) {
    throw new Error(`不支持的资源包 schema：${manifest.schema}`)
  }
  if (manifest.resourceType !== "agent" && manifest.resourceType !== "skill") {
    throw new Error(`不支持的资源类型：${manifest.resourceType}`)
  }
  if (manifest.files.length === 0) {
    throw new Error("资源包必须列出至少一个文件。")
  }
}

function validateRequiredFiles(resourceType: ResourcePackageManifest["resourceType"], paths: string[]): void {
  const pathSet = new Set(paths)
  if (resourceType === "agent") {
    if (!pathSet.has("agent.json")) {
      throw new Error("Agent 资源包缺少 agent.json。")
    }
    if (!pathSet.has("AGENT.md")) {
      throw new Error("Agent 资源包缺少 AGENT.md。")
    }
    return
  }
  if (!pathSet.has("SKILL.md")) {
    throw new Error("Skill 资源包缺少 SKILL.md。")
  }
}

function assistantWorkspaceFile(relativePath: string, content: string): WorkspaceFile {
  return {
    path: `${LOCAL_ASSISTANT_DIR}/${relativePath}`,
    content,
    createdAt: 0,
    updatedAt: Date.now(),
  }
}

function sortPackageFiles(files: TextPackageFile[]): TextPackageFile[] {
  const filesByPath = new Map<string, TextPackageFile>()
  for (const file of files) {
    filesByPath.set(normalizePackagePath(file.path), {
      path: normalizePackagePath(file.path),
      content: file.content,
    })
  }
  return Array.from(filesByPath.values()).sort((left, right) => left.path.localeCompare(right.path))
}

function normalizePackagePath(value: string): string {
  const raw = value.trim().replace(/\\/g, "/")
  if (!raw) {
    throw new Error("资源包路径不能为空。")
  }
  if (raw.startsWith("/") || raw.includes("\0")) {
    throw new Error(`资源包路径必须是安全相对路径：${raw}`)
  }
  const parts: string[] = []
  for (const part of raw.split("/")) {
    if (!part || part === ".") {
      continue
    }
    if (part === "..") {
      throw new Error(`资源包路径不能包含 '..'：${raw}`)
    }
    parts.push(part)
  }
  if (parts.length === 0) {
    throw new Error("资源包路径不能为空。")
  }
  return parts.join("/")
}

function parseAgentConfig(source: string): Partial<AgentConfig> {
  try {
    const parsed = JSON.parse(source) as unknown
    return isRecord(parsed) ? parsed as Partial<AgentConfig> : {}
  } catch {
    return {}
  }
}

function rewriteAgentId(source: string, agentId: string): string {
  const config = parseAgentConfig(source)
  return `${JSON.stringify({ ...config, id: agentId }, null, 2)}\n`
}

function parseMarkdownMetadata(source: string): Record<string, string> {
  const normalized = source.replace(/\r\n/g, "\n")
  if (!normalized.startsWith("---\n")) {
    return {}
  }
  const endIndex = normalized.indexOf("\n---", 4)
  if (endIndex < 0) {
    return {}
  }
  const metadata: Record<string, string> = {}
  for (const line of normalized.slice(4, endIndex).split("\n")) {
    const separatorIndex = line.indexOf(":")
    if (separatorIndex <= 0) {
      continue
    }
    metadata[line.slice(0, separatorIndex).trim()] = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "")
  }
  return metadata
}

function firstHeading(source: string): string | undefined {
  for (const line of source.split(/\r?\n/)) {
    const match = /^#(?!#)\s+(.+?)\s*#*\s*$/.exec(line.trim())
    if (match?.[1]) {
      return match[1].trim()
    }
  }
  return undefined
}

function firstParagraph(source: string): string | undefined {
  const withoutFrontmatter = source.replace(/^---[\s\S]*?---\s*/, "")
  for (const block of withoutFrontmatter.split(/\n\s*\n/)) {
    const text = block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .join(" ")
      .trim()
    if (text) {
      return text
    }
  }
  return undefined
}

function decodeText(data: Uint8Array, path: string): string {
  try {
    return TEXT_DECODER.decode(data)
  } catch {
    throw new Error(`资源文件不是有效 UTF-8 文本：${path}`)
  }
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`资源包 manifest 缺少字段：${fieldName}`)
  }
  return value.trim()
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
