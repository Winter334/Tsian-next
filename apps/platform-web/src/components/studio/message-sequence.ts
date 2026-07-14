import type {
  ContextPathEntry,
  ContextPathObject,
  ContextPathPosition,
  MessageLayersConfig,
} from "@tsian/contracts"

export type ContextPathRole = "system" | "user" | "assistant"
export type ContextPathKind = "path" | "template"
export type MessageLayerKey = keyof MessageLayersConfig
export type MessageLayerRoles = Record<MessageLayerKey, ContextPathRole>

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
  "before-history",
  "workspace-context",
  "after-input",
  "tail",
]

export const CONTEXT_PATH_ROLES: ContextPathRole[] = ["system", "user", "assistant"]

export const MESSAGE_LAYER_KEYS: MessageLayerKey[] = [
  "historySummary",
  "workspaceContextMeta",
  "toolMemory",
  "turnRuntime",
]

export const DEFAULT_MESSAGE_LAYER_ROLES: MessageLayerRoles = {
  historySummary: "user",
  workspaceContextMeta: "user",
  toolMemory: "user",
  turnRuntime: "user",
}

const MODULE_ENABLED_FILE_MACRO_PATTERN = /\{\{\s*file:\s*(modules\/[^}?]*?\.md)\s*\?enabled\s*\}\}/g

const POSITION_LABELS: Record<ContextPathPosition, string> = {
  "before-history": "历史前补充",
  "workspace-context": "常规资料区",
  "after-input": "输入后要求",
  tail: "续写前提示",
}

const POSITION_DESCRIPTIONS: Record<ContextPathPosition, string> = {
  "before-history": "放在过往剧情之前，适合长期稳定、很少变化的基础规则。",
  "workspace-context": "放在过往剧情之后，适合写作规则、资料文件和可选模块。",
  "after-input": "放在玩家本轮输入之后，适合本轮输出格式、检查清单或思考框架。",
  tail: "放在最末尾，最靠近模型开始写作的位置，适合起笔句或预填充。",
}

const ROLE_LABELS: Record<ContextPathRole, string> = {
  system: "规则",
  user: "资料",
  assistant: "预填充",
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
    workspaceContextMeta: normalizeRole(value?.workspaceContextMeta?.role),
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
    : "workspace-context"
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
  position: ContextPathPosition = "workspace-context",
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
      position: "workspace-context",
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
      position === "workspace-context"
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
