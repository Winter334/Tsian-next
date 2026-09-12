import type { TsianApi } from "@tsian/play-bridge"
export interface HistoricalNode { turn: number; time: string; summary: string }
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** Reuse maintenance's recall summary, never source nodes or a second summary. */
export function historicalNode(value: unknown): HistoricalNode | null {
  const history = object(value), recall = object(object(history.meta).recall), receipt = object(object(history.meta).maintenance)
  if (!Number.isSafeInteger(history.turn) || (history.turn as number) < 0 || !Array.isArray(history.timeline)
    || typeof receipt.token !== "string" || receipt.source !== JSON.stringify(history.timeline)
    || recall["重要节点"] !== true || typeof recall["摘要"] !== "string" || !recall["摘要"].trim()) return null
  return { turn: history.turn as number, time: typeof recall["时间"] === "string" ? recall["时间"] : "", summary: recall["摘要"] }
}
export async function loadHistoricalTimeline(workspace: Pick<TsianApi["workspace"], "read" | "list">): Promise<HistoricalNode[]> {
  const entries = await workspace.list("save/history/turns", "save-runtime")
  const nodes: HistoricalNode[] = []
  for (const entry of entries) {
    if (!/^save\/history\/turns\/turn-\d+\.json$/.test(entry.path)) continue
    const file = await workspace.read(entry.path, "save-runtime")
    if (!file) continue
    const node = historicalNode(JSON.parse(file.content))
    if (node) nodes.push(node)
  }
  return nodes.sort((a, b) => a.turn - b.turn)
}
