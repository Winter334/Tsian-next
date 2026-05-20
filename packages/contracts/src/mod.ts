import type {
  ArchiveRecord,
  JsonValue,
  RuntimeGlobalsMap,
  RuntimeSnapshotShell,
} from "./runtime"
import type { WorkflowDefinition } from "./workflow"

export interface ModManifest {
  id: string
  name: string
  version: string
  author?: string
  description?: string
  /**
   * 模组自定义工作流；缺省时平台使用默认工作流（design.md §8）。
   * HC-13：不允许包含 type: "apply-patch" 的节点（runtime 守卫由工作流引擎在加载期校验，design.md §13.4 第 5 条）。
   */
  workflow?: WorkflowDefinition
  /**
   * 模组私有 preset 库；ai-call 节点 config.presetId 引用其 key。
   * 形状由 @tsian/prompt-engine 在加载/使用期校验为 PresetInfo；contracts 层不收紧（避免反向依赖）。
   */
  presets?: Record<string, unknown>
  /**
   * 模组扩展占位符；与平台内置宏 / edge 注入的覆盖顺序见 design.md §13.5。
   */
  customMacros?: Record<string, string>
  /**
   * 模组世界书（Lorebook）库；ai-call 节点 config.worldBookKeys 引用其 key。
   * 形状由 @tsian/prompt-engine 在使用期校验为 WorldBook；contracts 层不收紧（与 presets 同策略，避免反向依赖）。
   */
  worldBooks?: Record<string, unknown>
  /**
   * HC-13 编译期辅助守卫：原型期不允许模组注册自定义节点类型。
   * 模组若声明此字段会触发 TS 编译错误（because never）；runtime 守卫由工作流引擎执行。
   */
  customNodeTypes?: never
}

export interface ModFrontendConfig {
  frontendId?: string
  [key: string]: JsonValue | undefined
}

export interface EntityFieldDefinition {
  key: string
  label: string
  valueType: "string" | "number" | "boolean" | "string[]" | "json"
  required?: boolean
  description?: string
}

export interface EntityTypeDefinition {
  type: string
  label: string
  fields: EntityFieldDefinition[]
  description?: string
}

export interface CatalogEventTrigger {
  notBefore?: string
  notAfter?: string
  requiredGlobals?: Record<string, JsonValue | JsonValue[]>
  requiredEntityNames?: string[]
}

export interface CatalogEventRecord {
  id: string
  name: string
  entityTags: string[]
  content: string
  trigger?: CatalogEventTrigger
  guidance?: string
}

export interface ModStaticContent {
  manifest: ModManifest
  frontendConfig: ModFrontendConfig
  entityTypeDefinitions: EntityTypeDefinition[]
  archiveCatalog: Array<Omit<ArchiveRecord, "id">>
  eventCatalog: CatalogEventRecord[]
  globalsDefaults: RuntimeGlobalsMap
  /**
   * 模组世界书实际数据（与 manifest.worldBooks 对齐）。
   * 模组不带世界书时缺省为 undefined / 空对象。
   */
  worldBooks?: Record<string, unknown>
}

export interface ModInitialSavePayload {
  snapshot: RuntimeSnapshotShell
  events: Array<{
    time: string
    status: string
    entityTags: string[]
    content: string
  }>
  archives: Array<Omit<ArchiveRecord, "id">>
}
