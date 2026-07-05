/**
 * lib/runtime-types.ts — runtime / 实体解析的类型契约。
 *
 * 对齐：
 * - `save/playthrough/runtime.json` 默认模板
 *   （apps/platform-web/src/storage/workspace-templates.ts:1387）
 * - schema design §3.1 render→category 映射、§4.1 扩展项公共形状、§4.2 预设 render。
 *
 * 本文件只出类型，不创 renderer 组件（D2）。UI 子任务按 category 取自己关心的
 * display item 自行渲染。未知 render 走 itemErrors（D6），字段缺失打 fallback（D8），
 * 读取失败返回 error 字段不抛错（D7）。
 */

/** 已知 render 预设集合（9 种）。未知值不入此 union，解析时落 itemErrors。 */
export type RenderPreset =
  | "text"
  | "number"
  | "progress"
  | "tag"
  | "tags"
  | "list"
  | "section"
  | "ref"
  | "cards"

/** display item 的槽位分类，UI 组件按此取自己关心的项。 */
export type DisplayCategory = "metric" | "tag" | "ref" | "section"

/**
 * 成功解析的扩展项。按 category 分桶存放（D1：不扁平透传、不按 9 种 render 分）。
 * render 始终为 RenderPreset（未知 render 走 DisplayItemError）。
 */
export interface DisplayItem {
  /** 槽位分类，UI 组件按此取自己关心的项。 */
  category: DisplayCategory
  /** 原始 render 值，始终为 RenderPreset（未知 render 走 itemErrors）。 */
  render: RenderPreset
  /** 显示名；来自 extensions 子 key 或 item.label。 */
  label: string
  /** 主要值；类型随 render 而定（progress→number, ref→string, …）。 */
  value?: unknown
  /** 字段缺失/类型不符时的降级标记；UI 见此可朴素渲染或省略（D8）。 */
  fallback?: true
  // 以下按 render 类型可选，解析时透传：
  /** progress 的最大值（缺省默认 100）。 */
  max?: number
  /** progress 的最小值（缺省默认 0）。 */
  min?: number
  /** number 的单位。 */
  unit?: string
  /** 色调：中性/强调/成功/警告/危险/弱化。 */
  tone?: "neutral" | "accent" | "success" | "warning" | "danger" | "muted"
  /** 说明文字。 */
  description?: string
  /** tags / list / cards 的子项数组。 */
  items?: unknown[]
  /** ref 的实体引用字符串（`<type>:<localId>`）。 */
  ref?: string
  /** ref / cards 内嵌引用的展示快照（ref.name 语义，非权威）。 */
  name?: string
  /** section 的标题。 */
  title?: string
  /** section 的正文。 */
  body?: string
}

/**
 * 解析失败的扩展项（仅未知 render；字段缺失走 fallback 不进此列，D6/D8）。
 * 原始 render 字符串原样保留以便 log/感知 schema 演进。
 */
export interface DisplayItemError {
  /** 显示名；来自 extensions 子 key 或 item.label。 */
  label: string
  /** 原始 render 值，未知字符串原样保留。 */
  render?: string
  /** 错误类型：未知 render。 */
  error: "unknown-render"
}

/** 按 category 分桶的 display item 集合。 */
export interface DisplayItems {
  metrics: DisplayItem[]
  tags: DisplayItem[]
  refs: DisplayItem[]
  sections: DisplayItem[]
}

/** useRuntime 返回的数据形态。读取失败时 runtime 为 null、error 非 null。 */
export interface RuntimeData {
  /** runtime.json 解析结果；读取失败为 null。 */
  runtime: Runtime | null
  /** 读取级错误（非解析级）；null 表示读取成功。 */
  error: "load-failed" | "not-found" | null
  /** runtime.extensions 解析出的扩展项（按 category 分桶）。 */
  displayItems: DisplayItems
  /** 解析失败的项（未知 render）。 */
  itemErrors: DisplayItemError[]
  /** 加载状态：idle/loading/ready/error。 */
  status: "idle" | "loading" | "ready" | "error"
}

/**
 * runtime.json 结构（与 workspace-templates.ts:1387 默认模板对齐）。
 * 固定字段原样保留，不由 parse 层转成 display item——由 UI 子任务按各自
 * 专门 UI 消费（角色卡、状态栏、场景面板等）。
 */
export interface Runtime {
  turn: number
  activeSceneIds: string[]
  activeScene: { ref: string; name: string } | null
  player: {
    character: { ref: string; name: string } | null
    location: { ref: string; name: string } | null
  }
  inventory: { primaryContainer: { ref: string; name: string }; state?: string } | null
  status: Array<{ id: string; description: string; level?: string }>
  /** 扩展字段：动态玩法字段，render→category 映射后分桶。 */
  extensions: Record<string, unknown>
  updatedAtTurn: number
  updatedBy: string | null
}

/**
 * 实体/场景文件解析结果。实体的 fields/sections/status 是固定 schema，
 * 由 UI 子任务专门渲染，parse 层只处理 extensions。`entity` 保留原始 JSON
 * 供 UI 取固定字段。
 */
export interface EntityData {
  /** 原始实体/场景 JSON（含 id/name/brief/fields/sections/status 等固定字段）。 */
  entity: Record<string, unknown>
  /** extensions 解析出的扩展项（按 category 分桶）。 */
  displayItems: DisplayItems
  /** 解析失败的项（未知 render）。 */
  itemErrors: DisplayItemError[]
}

/** 空的 display items 桶（用于初始化 / 读取失败兜底）。 */
export function emptyDisplayItems(): DisplayItems {
  return { metrics: [], tags: [], refs: [], sections: [] }
}
