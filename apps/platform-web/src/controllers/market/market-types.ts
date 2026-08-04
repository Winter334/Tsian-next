import type { MarketUploadSelectionPayload } from "@/components/market/types"

export type MarketScope = "all" | "mine"

export type MarketScreen =
  | { kind: "list" }
  | { kind: "detail"; id: string }
  | { kind: "upload" }

export type MarketReplacementSelection = MarketUploadSelectionPayload
