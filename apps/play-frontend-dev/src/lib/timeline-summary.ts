import type { SourceAnchor } from "./frontier-types"

export type SourceSummaryState = "hidden" | "visible" | "spoiler"

export function sourceSummaryState(
  anchor: SourceAnchor,
  plotOrder: number,
  expandedFutureOrders: ReadonlySet<number>,
): SourceSummaryState {
  if (!anchor.summary?.trim()) return "hidden"
  if (anchor.order <= plotOrder || expandedFutureOrders.has(anchor.order)) return "visible"
  return "spoiler"
}
