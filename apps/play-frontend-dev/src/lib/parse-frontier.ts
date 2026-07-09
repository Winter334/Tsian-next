/**
 * lib/parse-frontier.ts — frontier JSON → FrontierData 纯函数。
 *
 * 纯函数：无 Vue/Dexie/bridge 依赖，可被 composable 与单测直接 import。
 * 对齐 task 07-08 design.md §2 timeline 数据模型 + workspace-templates.ts schema 文档。
 *
 * 错误策略：
 * - 读取级错误（非对象/缺 timeline 数组）→ load-failed，frontier=null。
 * - 单个锚点缺 kind/order 必填字段 → 跳过该锚点（不丢弃整个 timeline）。
 * - 未知 kind 值 → 跳过该锚点。
 * - sourceWindow.chapters/notes/updatedAt/updatedBy 缺省 → 不报错，用 null/undefined。
 */
import type { Frontier, FrontierData, TimelineAnchor, SourceAnchor, PlayerAnchor } from "./frontier-types"
import { initialFrontierData } from "./frontier-types"

/** 读取失败兜底 FrontierData。 */
function loadFailedData(error: "load-failed" | "not-found"): FrontierData {
  return { ...initialFrontierData(), frontier: null, error, status: "error" }
}

/**
 * 校验单个锚点是否为合法的 source 或 player 锚点。
 * 返回归一化后的锚点，或 null（跳过无效锚点）。
 */
function parseAnchor(raw: unknown): TimelineAnchor | null {
  if (typeof raw !== "object" || raw === null) return null
  const a = raw as Record<string, unknown>

  // kind + order 是所有锚点的必填字段
  if (typeof a.kind !== "string") return null
  if (typeof a.order !== "number" || !Number.isFinite(a.order)) return null

  if (a.kind === "source") {
    // source 锚点：chapter + time + label 必填
    if (typeof a.chapter !== "number") return null
    if (typeof a.time !== "string") return null
    if (typeof a.label !== "string") return null
    const anchor: SourceAnchor = {
      kind: "source",
      order: a.order,
      chapter: a.chapter,
      time: a.time,
      label: a.label,
    }
    return anchor
  }

  if (a.kind === "player") {
    // player 锚点：turn + time + label + alignment 必填；sourceRef 允许 null
    if (typeof a.turn !== "number") return null
    if (typeof a.time !== "string") return null
    if (typeof a.label !== "string") return null
    if (typeof a.alignment !== "string") return null
    const allowedAlignments = ["diverged", "rejoined", "aligned"]
    if (!allowedAlignments.includes(a.alignment)) return null
    const sourceRef =
      typeof a.sourceRef === "number" ? a.sourceRef : null
    const anchor: PlayerAnchor = {
      kind: "player",
      order: a.order,
      turn: a.turn,
      time: a.time,
      label: a.label,
      alignment: a.alignment as PlayerAnchor["alignment"],
      sourceRef,
    }
    return anchor
  }

  // 未知 kind → 跳过
  return null
}

/**
 * 校验 frontier.json 是否为合法对象（含 timeline 数组）。
 */
function isFrontierLike(raw: unknown): raw is Record<string, unknown> & { timeline: unknown[] } {
  if (typeof raw !== "object" || raw === null) return false
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.timeline)) return false
  return true
}

/**
 * 解析 frontier.json 为 FrontierData。
 *
 * 1. 校验 raw 是对象且含 timeline 数组；不通过 → load-failed（D7）。
 * 2. 遍历 timeline：每个锚点用 parseAnchor 校验，无效锚点跳过。
 * 3. sourceWindow/extractedThrough/notes 等字段宽松容错，缺省用 null/undefined。
 */
export function parseFrontier(raw: unknown): FrontierData {
  if (!isFrontierLike(raw)) {
    return loadFailedData("load-failed")
  }

  // raw 已被 isFrontierLike 窄化为 Record<string, unknown> & { timeline: unknown[] }
  const r = raw

  // 解析 timeline 锚点（跳过无效项）
  const timeline: TimelineAnchor[] = []
  for (const item of r.timeline) {
    const anchor = parseAnchor(item)
    if (anchor !== null) timeline.push(anchor)
  }

  // sourceWindow 宽松解析
  const sw = r.sourceWindow
  const sourceWindow: Frontier["sourceWindow"] =
    typeof sw === "object" && sw !== null
      ? {
          start: typeof (sw as Record<string, unknown>).start === "number" ? (sw as Record<string, unknown>).start as number : null,
          end: typeof (sw as Record<string, unknown>).end === "number" ? (sw as Record<string, unknown>).end as number : null,
          chapters: Array.isArray((sw as Record<string, unknown>).chapters)
            ? (sw as Record<string, unknown>).chapters as Frontier["sourceWindow"]["chapters"]
            : undefined,
        }
      : { start: null, end: null }

  const frontier: Frontier = {
    sourceWindow,
    extractedThrough: typeof r.extractedThrough === "string" ? r.extractedThrough : null,
    timeline,
    notes: typeof r.notes === "string" ? r.notes : undefined,
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : undefined,
    updatedBy: typeof r.updatedBy === "string" ? r.updatedBy : undefined,
  }

  return {
    frontier,
    error: null,
    status: "ready",
  }
}
