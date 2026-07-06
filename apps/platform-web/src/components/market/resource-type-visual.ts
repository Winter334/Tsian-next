import type { Component } from "vue"
import { Bot, Gamepad2, Sparkles, Wrench } from "lucide-vue-next"
import type { MarketResourceType } from "@tsian/contracts"

/**
 * Per-resource-type visual identity for the Creative Workshop cards.
 *
 * Each type gets a dedicated "programmatic card art" — a radial highlight
 * over a diagonal dark base — so Agent/Skill cards without a cover image
 * still read as distinct collectible cards rather than empty placeholders.
 * All palettes stay inside the warm-amber CRT family (no cool blues).
 */
export interface ResourceTypeVisual {
  icon: Component
  label: string
  /** Tailwind class string for the cover fallback (radial highlight + diagonal base). */
  coverClass: string
  /** Tailwind class string for the type badge / accent border. */
  accentClass: string
}

const GAME_CARD_VISUAL: ResourceTypeVisual = {
  icon: Gamepad2,
  label: "游戏卡",
  coverClass:
    "bg-[radial-gradient(circle_at_30%_20%,rgba(243,197,109,0.28),transparent_30%),linear-gradient(135deg,#3f4d3a,#1e2420)]",
  accentClass: "border-neon text-neon",
}

const AGENT_VISUAL: ResourceTypeVisual = {
  icon: Bot,
  label: "Agent",
  coverClass:
    "bg-[radial-gradient(circle_at_30%_20%,rgba(122,138,106,0.32),transparent_30%),linear-gradient(135deg,#2d3a2a,#1e2420)]",
  accentClass: "border-[#7a8a6a] text-[#a8c08a]",
}

const SKILL_VISUAL: ResourceTypeVisual = {
  icon: Sparkles,
  label: "Skill",
  coverClass:
    "bg-[radial-gradient(circle_at_30%_20%,rgba(168,112,85,0.34),transparent_30%),linear-gradient(135deg,#3a2a22,#1e2420)]",
  accentClass: "border-[#a87055] text-[#d4987a]",
}

const TOOL_VISUAL: ResourceTypeVisual = {
  icon: Wrench,
  label: "Tool",
  coverClass:
    "bg-[radial-gradient(circle_at_30%_20%,rgba(198,149,74,0.34),transparent_30%),linear-gradient(135deg,#3a311d,#1e2420)]",
  accentClass: "border-[#c6954a] text-[#e0b45f]",
}

export const resourceTypeVisuals: Record<MarketResourceType, ResourceTypeVisual> = {
  game_card: GAME_CARD_VISUAL,
  agent: AGENT_VISUAL,
  skill: SKILL_VISUAL,
  tool: TOOL_VISUAL,
}

export function getResourceTypeVisual(type: MarketResourceType): ResourceTypeVisual {
  return resourceTypeVisuals[type]
}
