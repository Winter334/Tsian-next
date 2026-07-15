import type {
  ContextPathEntry,
  ContextPathObject,
  ContextPathPosition,
  MessageLayersConfig,
} from "@tsian/contracts"
import type { PlatformStudioModuleInfo } from "@/platform-host"

export type ContextPathRole = "system" | "user" | "assistant"
export type ContextPathKind = "path" | "template"
export type MessageLayerKey = keyof MessageLayersConfig
export type MessageLayerRoles = Record<MessageLayerKey, ContextPathRole>

export interface ModuleSwitchGroup {
  key: string
  macroPath: string
  label: string
  modules: PlatformStudioModuleInfo[]
}

export interface EditableContextPathEntry {
  id: string
  kind: ContextPathKind
  path: string
  template: string
  role: ContextPathRole
  position: ContextPathPosition
  originalWasString: boolean
  modified: boolean
}

export const CONTEXT_PATH_POSITIONS: ContextPathPosition[] = [
  "prelude",
  "runtime",
  "framing",
]

export const CONTEXT_PATH_ROLES: ContextPathRole[] = ["system", "user", "assistant"]

export const MESSAGE_LAYER_KEYS: MessageLayerKey[] = [
  "historySummary",
  "contextMeta",
  "toolMemory",
  "turnRuntime",
]

export const DEFAULT_MESSAGE_LAYER_ROLES: MessageLayerRoles = {
  historySummary: "user",
  contextMeta: "user",
  toolMemory: "user",
  turnRuntime: "user",
}

const MODULE_ENABLED_FILE_MACRO_PATTERN = /\{\{\s*file:\s*(modules\/[^}?]*?(?:\.md|\*[^}?]*))\s*\?enabled\s*\}\}/g

const POSITION_LABELS: Record<ContextPathPosition, string> = {
  prelude: "背景层",
  runtime: "状态层",
  framing: "框架层",
}

const POSITION_DESCRIPTIONS: Record<ContextPathPosition, string> = {
  prelude: "放在过往剧情之前，适合长期稳定的规则、参考资料和衔接内容。",
  runtime: "放在过往剧情之后，适合每轮可能变化的状态文件。",
  framing: "放在玩家输入之后、消息末尾，适合输出框架和续写引导。",
}

const ROLE_LABELS: Record<ContextPathRole, string> = {
  system: "System",
  user: "User",
  assistant: "Assistant",
}

let nextEntryId = 0

function newEntryId(): string {
  nextEntryId += 1
  return `ctx-entry-${Date.now().toString(36)}-${nextEntryId.toString(36)}`
}

function normalizeRole(value: unknown): ContextPathRole {
  return value === "system" || value === "user" || value === "assistant"
    ? value
    : "user"
}

export function normalizeMessageLayerRoles(value: MessageLayersConfig | undefined): MessageLayerRoles {
  return {
    historySummary: normalizeRole(value?.historySummary?.role),
    contextMeta: normalizeRole(value?.contextMeta?.role),
    toolMemory: normalizeRole(value?.toolMemory?.role),
    turnRuntime: normalizeRole(value?.turnRuntime?.role),
  }
}

export function serializeMessageLayerRoles(roles: MessageLayerRoles): MessageLayersConfig {
  const result: MessageLayersConfig = {}
  for (const key of MESSAGE_LAYER_KEYS) {
    const role = normalizeRole(roles[key])
    if (role !== DEFAULT_MESSAGE_LAYER_ROLES[key]) {
      result[key] = { role }
    }
  }
  return result
}

function normalizePosition(value: unknown): ContextPathPosition {
  return CONTEXT_PATH_POSITIONS.includes(value as ContextPathPosition)
    ? value as ContextPathPosition
    : "runtime"
}

export function positionLabel(position: ContextPathPosition): string {
  return POSITION_LABELS[position]
}

export function positionDescription(position: ContextPathPosition): string {
  return POSITION_DESCRIPTIONS[position]
}

export function roleLabel(role: ContextPathRole): string {
  return ROLE_LABELS[role]
}

export function roleBadgeClass(role: ContextPathRole): string {
  if (role === "system") {
    return "border-sky-400/45 bg-sky-500/10 text-sky-200"
  }
  if (role === "assistant") {
    return "border-amber-400/45 bg-amber-500/10 text-amber-200"
  }
  return "border-emerald-400/45 bg-emerald-500/10 text-emerald-200"
}

function normalizeModuleMacroText(value: string): string {
  return value.replace(/\\/g, "/")
}

export function extractEnabledModuleMacroPaths(value: string): string[] {
  const normalized = normalizeModuleMacroText(value)
  const paths: string[] = []
  const seen = new Set<string>()
  MODULE_ENABLED_FILE_MACRO_PATTERN.lastIndex = 0

  let match = MODULE_ENABLED_FILE_MACRO_PATTERN.exec(normalized)
  while (match) {
    const path = match[1]?.trim()
    if (path && !seen.has(path)) {
      seen.add(path)
      paths.push(path)
    }
    match = MODULE_ENABLED_FILE_MACRO_PATTERN.exec(normalized)
  }

  return paths
}

function moduleMacroPathPattern(path: string): RegExp | null {
  const normalized = normalizeModuleMacroText(path).trim()
  if (!normalized) {
    return null
  }

  const segments = normalized.split("/")
  const regexParts = segments.map((segment) => {
    const escaped = segment.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    return escaped.replace(/\*/g, "[^/]*")
  })
  try {
    return new RegExp(`^${regexParts.join("/")}$`)
  } catch {
    return null
  }
}

export function modulePathMatchesEnabledMacroPath(modulePath: string, macroPath: string): boolean {
  const normalizedModulePath = normalizeModuleMacroText(modulePath)
  const segments = normalizedModulePath.split("/")
  const modulesIndex = segments.indexOf("modules")
  if (modulesIndex < 0) {
    return false
  }

  const relativeModulePath = segments.slice(modulesIndex).join("/")
  return moduleMacroPathPattern(macroPath)?.test(relativeModulePath) ?? false
}

export function moduleDirectoryLabel(path: string): string {
  const normalized = normalizeModuleMacroText(path).trim().replace(/\/+$/, "")
  if (!normalized) {
    return "规则模块"
  }

  const wildcardIndex = normalized.indexOf("*")
  const pathForDirectory = wildcardIndex >= 0
    ? normalized.slice(0, wildcardIndex)
    : normalized
  const segments = pathForDirectory.split("/").filter(Boolean)

  if (segments.length === 0) {
    return normalized
  }

  const lastSegment = segments[segments.length - 1]
  const directorySegments = lastSegment?.includes(".")
    ? segments.slice(0, -1)
    : segments
  if (directorySegments.length === 0) {
    return normalized
  }

  return directorySegments.join("/")
}

export function buildModuleSwitchGroups(
  modules: PlatformStudioModuleInfo[],
  macroPaths: string[],
): ModuleSwitchGroup[] {
  const groups: ModuleSwitchGroup[] = []
  const seen = new Set<string>()

  for (const macroPath of macroPaths) {
    const normalizedMacroPath = normalizeModuleMacroText(macroPath).trim()
    if (!normalizedMacroPath || seen.has(normalizedMacroPath)) {
      continue
    }
    seen.add(normalizedMacroPath)

    groups.push({
      key: normalizedMacroPath,
      macroPath: normalizedMacroPath,
      label: moduleDirectoryLabel(normalizedMacroPath),
      modules: modules.filter((module) => modulePathMatchesEnabledMacroPath(module.path, normalizedMacroPath)),
    })
  }

  return groups
}

export function duplicateVisibleModuleStems(groups: ModuleSwitchGroup[]): string[] {
  const counts = new Map<string, number>()
  for (const group of groups) {
    for (const module of group.modules) {
      counts.set(module.stem, (counts.get(module.stem) ?? 0) + 1)
    }
  }

  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([stem]) => stem)
    .sort((a, b) => a.localeCompare(b))
}

export function isModuleMacroTemplate(value: string): boolean {
  return extractEnabledModuleMacroPaths(value).length > 0
}

export function editableEntrySummary(entry: EditableContextPathEntry): string {
  if (entry.kind === "path") {
    return entry.path.trim() || "未填写文件路径"
  }

  const template = entry.template.trim().replace(/\s+/g, " ")
  return template || "未填写内联模板"
}

export function createEditableEntry(
  position: ContextPathPosition = "runtime",
): EditableContextPathEntry {
  return {
    id: newEntryId(),
    kind: "path",
    path: "",
    template: "",
    role: "user",
    position,
    originalWasString: false,
    modified: true,
  }
}

export function normalizeEditableEntry(
  entry: ContextPathEntry,
): EditableContextPathEntry {
  if (typeof entry === "string") {
    return {
      id: newEntryId(),
      kind: "path",
      path: entry,
      template: "",
      role: "user",
      position: "runtime",
      originalWasString: true,
      modified: false,
    }
  }

  const hasTemplate = typeof entry.template === "string" && entry.template.length > 0
  return {
    id: newEntryId(),
    kind: hasTemplate ? "template" : "path",
    path: typeof entry.path === "string" ? entry.path : "",
    template: typeof entry.template === "string" ? entry.template : "",
    role: normalizeRole(entry.role),
    position: normalizePosition(entry.position),
    originalWasString: false,
    modified: false,
  }
}

export function cloneEditableEntry(entry: EditableContextPathEntry): EditableContextPathEntry {
  return {
    ...entry,
    modified: true,
  }
}

export function serializeEditableEntry(entry: EditableContextPathEntry): ContextPathEntry {
  const role = normalizeRole(entry.role)
  const position = normalizePosition(entry.position)
  if (entry.kind === "path") {
    const path = entry.path.trim()
    if (
      entry.originalWasString &&
      !entry.modified &&
      role === "user" &&
      position === "runtime"
    ) {
      return path
    }

    return {
      path,
      role,
      position,
    }
  }

  return {
    template: entry.template,
    role,
    position,
  }
}

export function contextPathEntryKey(entry: ContextPathEntry): string {
  if (typeof entry === "string") {
    return entry.trim().toLowerCase()
  }
  return (entry.path ?? entry.template ?? "").trim().toLowerCase()
}

export function validateSerializedEntries(entries: ContextPathEntry[]): string | null {
  const seen = new Set<string>()
  for (const [index, entry] of entries.entries()) {
    const key = contextPathEntryKey(entry)
    if (!key) {
      return `第 ${index + 1} 个条目缺少 path 或 template。`
    }
    if (seen.has(key)) {
      return `contextPaths 中存在重复条目：${key}`
    }
    seen.add(key)

    if (typeof entry !== "string") {
      const hasPath = Boolean(entry.path?.trim())
      const hasTemplate = Boolean(entry.template?.trim())
      if (hasPath === hasTemplate) {
        return `第 ${index + 1} 个条目必须且只能填写 path 或 template。`
      }
    }
  }
  return null
}

export function normalizeEnabledModules(
  enabledModules: string[],
): Set<string> {
  return new Set(enabledModules)
}
