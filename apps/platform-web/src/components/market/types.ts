import type { MarketPackage, MarketResourceType } from "@tsian/contracts"
import type {
  AgentInstallTarget,
  AgentPackageSource,
  SkillInstallTarget,
  SkillPackageSource,
} from "@/platform-host"

export interface MarketResourceTypeOption {
  type: MarketResourceType
  label: string
  description: string
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

export type MarketUploadSubmitPayload = {
  resourceType: MarketResourceType
  title?: string
  summary?: string
  author?: string
  version?: string
  tags?: string
} & (
  | { resourceType: "game_card"; cardId: string }
  | { resourceType: "agent"; source: AgentPackageSource }
  | { resourceType: "skill"; source: SkillPackageSource }
)

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

export interface MarketInstallDialogState {
  pkg: MarketPackage
  options: MarketInstallTargetOption[]
}
