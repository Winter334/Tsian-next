import type { Component } from "vue"
import type { MarketPackage, MarketResourceType } from "@tsian/contracts"
import type {
  AgentInstallTarget,
  AgentPackageSource,
  SkillInstallTarget,
  SkillPackageSource,
  ToolInstallTarget,
  ToolPackageSource,
} from "@/platform-host"
import type { ResourceTypeVisual } from "./resource-type-visual"

export interface MarketResourceTypeOption {
  type: MarketResourceType
  label: string
  description: string
  /** Lucide icon component used as the type's visual anchor. */
  icon: Component
  /** Tailwind class string for the cover fallback (radial highlight + diagonal base). */
  coverClass: string
  /** Tailwind class string for the type badge / accent border. */
  accentClass: string
}

/** Convenience: build a MarketResourceTypeOption from a ResourceTypeVisual. */
export function resourceTypeOption(
  type: MarketResourceType,
  visual: ResourceTypeVisual,
  description: string,
): MarketResourceTypeOption {
  return {
    type,
    label: visual.label,
    description,
    icon: visual.icon,
    coverClass: visual.coverClass,
    accentClass: visual.accentClass,
  }
}

export interface AgentUploadOption {
  key: string
  label: string
  summary: string
  source: AgentPackageSource
  resourceId: string
}

export interface SkillUploadOption {
  key: string
  label: string
  summary: string
  source: SkillPackageSource
  resourceId: string
}

export interface ToolUploadOption {
  key: string
  label: string
  summary: string
  source: ToolPackageSource
  resourceId: string
}

export interface MarketUploadMetadata {
  title?: string
  summary?: string
  author?: string
  version?: string
  tags?: string
}

export type MarketUploadSelectionPayload =
  | { resourceType: "game_card"; cardId: string }
  | { resourceType: "agent"; source: AgentPackageSource }
  | { resourceType: "skill"; source: SkillPackageSource }
  | { resourceType: "tool"; source: ToolPackageSource }

export type MarketUploadSubmitPayload = MarketUploadSelectionPayload & MarketUploadMetadata

export type MarketInstallTargetOption =
  | {
      key: string
      label: string
      description: string
      severity?: "normal" | "danger"
      requiresConfirm?: boolean
      confirmTitle?: string
      confirmMessage?: string
      resourceType: "agent"
      target: AgentInstallTarget
    }
  | {
      key: string
      label: string
      description: string
      severity?: "normal" | "danger"
      requiresConfirm?: boolean
      confirmTitle?: string
      confirmMessage?: string
      resourceType: "skill"
      target: SkillInstallTarget
    }
  | {
      key: string
      label: string
      description: string
      severity?: "normal" | "danger"
      requiresConfirm?: boolean
      confirmTitle?: string
      confirmMessage?: string
      resourceType: "tool"
      target: ToolInstallTarget
    }

export interface MarketInstallDialogState {
  pkg: MarketPackage
  options: MarketInstallTargetOption[]
}
