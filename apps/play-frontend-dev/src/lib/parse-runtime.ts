/**
 * lib/parse-runtime.ts — runtime JSON → RuntimeData 纯函数 + extensions 共享解析。
 *
 * 纯函数：无 Vue/Dexie/bridge 依赖，可被 composable 与单测直接 import。
 * 对齐 design.md §4.3 与 schema design §4 扩展项形状。
 *
 * 错误策略（D6/D7/D8）：
 * - 读取级错误（非对象/缺固定字段）→ load-failed 路径，runtime=null（D7）。
 * - 未知 render → itemErrors，不降级（D6）。
 * - 字段缺失/类型不符 → 按 render 类型降级展示并打 fallback: true，不进 itemErrors（D8）。
 */
import type {
  Runtime,
  RuntimeData,
  DisplayItem,
  DisplayItemError,
  DisplayItems,
  RenderPreset,
} from "./runtime-types"
import { emptyDisplayItems } from "./runtime-types"
import { RENDER_TO_CATEGORY, KNOWN_RENDERS } from "./render-mapping"

/** extensions 子项的公共形状（schema design §4.1，宽松以容错）。 */
interface ExtensionItem {
  render?: unknown
  value?: unknown
  label?: unknown
  tone?: unknown
  description?: unknown
  group?: unknown
  order?: unknown
  priority?: unknown
  visibility?: unknown
  max?: unknown
  min?: unknown
  unit?: unknown
  items?: unknown
  ref?: unknown
  name?: unknown
  title?: unknown
  body?: unknown
}

interface RuntimeLikeInput extends Runtime {
  // worldTime 等固定字段进入必检；详见 isRuntimeLike。
}

/** 读取失败兜底 RuntimeData。 */
function loadFailedData(error: "load-failed" | "not-found"): RuntimeData {
  return {
    runtime: null,
    error,
    displayItems: emptyDisplayItems(),
    itemErrors: [],
    status: "error",
  }
}

/**
 * 校验 runtime.json 固定字段是否齐备。
 * 对齐 workspace-templates.ts 默认模板：turn/worldTime/activeSceneIds/player/extensions
 * 为必检；activeScene/inventory/status/updatedAtTurn/updatedBy 允许 null/缺省。
 */
function isRuntimeLike(raw: unknown): raw is RuntimeLikeInput {
  if (typeof raw !== "object" || raw === null) return false
  const r = raw as Record<string, unknown>
  if (typeof r.turn !== "number") return false
  if (typeof r.worldTime !== "string") return false
  if (!Array.isArray(r.activeSceneIds)) return false
  if (typeof r.player !== "object" || r.player === null) return false
  if (typeof r.extensions !== "object" || r.extensions === null) return false
  return true
}

/** 取 tone 字符串并归一到 union（未知值丢弃，不抛错）。 */
function normalizeTone(raw: unknown): DisplayItem["tone"] {
  const allowed = ["neutral", "accent", "success", "warning", "danger", "muted"]
  return typeof raw === "string" && allowed.includes(raw)
    ? (raw as DisplayItem["tone"])
    : undefined
}

/** 取 number 或 undefined（非数字丢弃，不抛错）。 */
function normalizeNumber(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined
}

/** 取 string 或 undefined（非字符串丢弃，不抛错）。 */
function normalizeString(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.length > 0 ? raw : undefined
}

/** 取数组或 undefined（非数组丢弃，不抛错）。 */
function normalizeArray(raw: unknown): unknown[] | undefined {
  return Array.isArray(raw) ? raw : undefined
}

/**
 * 按 render 类型检查字段缺失并打 fallback（D8，design.md §3.2）。
 * 返回带 fallback 标记与归一字段的 DisplayItem（不含 category——由调用方按映射填）。
 */
function buildDisplayItem(
  render: RenderPreset,
  label: string,
  item: ExtensionItem,
): DisplayItem {
  const base: DisplayItem = {
    category: RENDER_TO_CATEGORY[render],
    render,
    label,
  }
  // 公共可选字段透传（归一后赋值，避免类型污染）
  const tone = normalizeTone(item.tone)
  const description = normalizeString(item.description)
  if (tone !== undefined) base.tone = tone
  if (description !== undefined) base.description = description

  switch (render) {
    case "progress": {
      // 缺 value → 当作 0；缺 max → 默认 100（D8）
      const value = normalizeNumber(item.value)
      const max = normalizeNumber(item.max) ?? 100
      const min = normalizeNumber(item.min) ?? 0
      const fallback = value === undefined
      base.value = fallback ? 0 : value
      base.max = max
      base.min = min
      if (fallback) base.fallback = true
      return base
    }
    case "number": {
      // 缺 value → 不展示该项但记 fallback（数字无法猜，仍推入桶让 UI 决定省略）
      const value = normalizeNumber(item.value)
      const unit = normalizeString(item.unit)
      const fallback = value === undefined
      if (value !== undefined) base.value = value
      if (unit !== undefined) base.unit = unit
      if (fallback) base.fallback = true
      return base
    }
    case "tag": {
      // 缺 value → 展示 label 单标签（D8）
      const value = normalizeString(item.value)
      const fallback = value === undefined
      if (value !== undefined) base.value = value
      if (fallback) base.fallback = true
      return base
    }
    case "tags": {
      // 缺 items → 展示 label 单标签（D8）
      const items = normalizeArray(item.items)
      const fallback = items === undefined
      if (items !== undefined) base.items = items
      if (fallback) base.fallback = true
      return base
    }
    case "text": {
      // 缺 value → 标 fallback
      const value = normalizeString(item.value)
      const fallback = value === undefined
      if (value !== undefined) base.value = value
      if (fallback) base.fallback = true
      return base
    }
    case "ref": {
      // 缺 ref → 降级成纯文本展示 name 或 label（D8）
      const ref = normalizeString(item.ref)
      const name = normalizeString(item.name)
      const fallback = ref === undefined
      if (ref !== undefined) base.ref = ref
      if (name !== undefined) base.name = name
      if (fallback) base.fallback = true
      return base
    }
    case "cards": {
      // 缺 items → 空卡片组或省略（D8）
      const items = normalizeArray(item.items)
      const fallback = items === undefined
      if (items !== undefined) base.items = items
      if (fallback) base.fallback = true
      return base
    }
    case "list": {
      // 缺 items → 标 fallback
      const items = normalizeArray(item.items)
      const fallback = items === undefined
      if (items !== undefined) base.items = items
      if (fallback) base.fallback = true
      return base
    }
    case "section": {
      // 缺 body → 省略该项；缺 title → 用 label 作标题（D8）
      const title = normalizeString(item.title)
      const body = normalizeString(item.body)
      const fallback = body === undefined
      if (title !== undefined) base.title = title
      else base.title = label
      if (body !== undefined) base.body = body
      if (fallback) base.fallback = true
      return base
    }
    default: {
      // 穷尽检查：RenderPreset 全集已覆盖
      return base
    }
  }
}

/**
 * 解析 extensions 对象，返回按 category 分桶的 display items + 未知 render 错误。
 * runtime 与 entity/scene 共享同一套解析逻辑（R7），避免 4 个 UI 子任务重复实现。
 *
 * @param ext extensions 对象（record<string, unknown>）；非对象时返回空桶。
 * @returns 分桶结果与错误列表。
 */
export function parseExtensions(
  ext: unknown,
): { displayItems: DisplayItems; itemErrors: DisplayItemError[] } {
  const displayItems = emptyDisplayItems()
  const itemErrors: DisplayItemError[] = []

  if (typeof ext !== "object" || ext === null) {
    return { displayItems, itemErrors }
  }

  const record = ext as Record<string, unknown>
  for (const key of Object.keys(record)) {
    const child = record[key]
    if (typeof child !== "object" || child === null) {
      // 非对象子项：跳过（extensions 子项应为公共形状对象）
      continue
    }
    const item = child as ExtensionItem
    // label 优先取 item.label，否则用 extensions 子 key
    const label = normalizeString(item.label) ?? key
    const renderRaw = item.render
    const renderStr = typeof renderRaw === "string" ? renderRaw : undefined

    // render 缺省 → 当作 text 朴素文本（schema OQ-2：render 可省略 → 朴素文本展示）
    const effectiveRender = renderStr ?? "text"

    if (!KNOWN_RENDERS.has(effectiveRender)) {
      // 未知 render → itemErrors，不降级（D6），保留原 render 字符串
      itemErrors.push({
        label,
        render: renderStr,
        error: "unknown-render",
      })
      continue
    }

    const displayItem = buildDisplayItem(
      effectiveRender as RenderPreset,
      label,
      item,
    )
    // 按 category 推入对应桶
    switch (displayItem.category) {
      case "metric":
        displayItems.metrics.push(displayItem)
        break
      case "tag":
        displayItems.tags.push(displayItem)
        break
      case "ref":
        displayItems.refs.push(displayItem)
        break
      case "section":
        displayItems.sections.push(displayItem)
        break
    }
  }

  return { displayItems, itemErrors }
}

/**
 * 解析 runtime.json 为 RuntimeData。
 *
 * 1. 校验 raw 是对象且含 turn/activeSceneIds/player/extensions 等固定字段；
 *    不通过 → load-failed 路径，runtime=null（D7）。
 * 2. 遍历 extensions：render 不在 9 种预设 → itemErrors（D6）；在预设 → 按
 *    RENDER_TO_CATEGORY 取 category，按 design §3.2 检查字段缺失打 fallback（D8）。
 * 3. 固定字段（turn/activeScene/player/inventory/status）原样放进 runtime，
 *    不转 display item——由 UI 子任务按各自专门 UI 消费。
 */
export function parseRuntime(raw: unknown): RuntimeData {
  if (!isRuntimeLike(raw)) {
    return loadFailedData("load-failed")
  }

  // 固定字段原样保留（runtime 模板对齐）
  const runtime: Runtime = {
    turn: raw.turn,
    worldTime: raw.worldTime,
    activeSceneIds: raw.activeSceneIds,
    activeScene: raw.activeScene as Runtime["activeScene"],
    player: raw.player as Runtime["player"],
    inventory: (raw.inventory ?? null) as Runtime["inventory"],
    status: Array.isArray(raw.status) ? raw.status : [],
    extensions: raw.extensions,
    updatedAtTurn: typeof raw.updatedAtTurn === "number" ? raw.updatedAtTurn : 0,
    updatedBy: typeof raw.updatedBy === "string" ? raw.updatedBy : null,
  }

  const { displayItems, itemErrors } = parseExtensions(raw.extensions)

  return {
    runtime,
    error: null,
    displayItems,
    itemErrors,
    status: "ready",
  }
}
