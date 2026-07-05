/**
 * lib/render-mapping.ts — render → category 固定映射表。
 *
 * 对齐 design.md §3.1 与 schema design §3.3 槽位建议：
 * - progress, number → metric（数值/仪表区）
 * - tag, tags, text   → tag（状态标签区；text 单段文本在标签区最自然）
 * - ref, cards, list  → ref（关联入口/背包/装备/在场对象区；list 多用于关联入口）
 * - section           → section（详情段落区）
 *
 * 未在表中的 render → itemErrors（D6：不降级展示）。
 * 新增 render 需改此映射表——这本就是 schema 演进该走的路径。
 */
import type { RenderPreset, DisplayCategory } from "./runtime-types"

/** render → category 固定映射（9 种预设全覆盖）。 */
export const RENDER_TO_CATEGORY: Record<RenderPreset, DisplayCategory> = {
  progress: "metric",
  number: "metric",
  tag: "tag",
  tags: "tag",
  text: "tag",
  ref: "ref",
  cards: "ref",
  list: "ref",
  section: "section",
}

/** 已知 render 预设集合（用于未知 render 判定，D6）。 */
export const KNOWN_RENDERS: ReadonlySet<string> = new Set<string>(
  Object.keys(RENDER_TO_CATEGORY),
)
