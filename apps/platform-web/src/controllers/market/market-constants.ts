import { resourceTypeOption, type MarketResourceTypeOption } from "@/components/market/types"
import { resourceTypeVisuals } from "@/components/market/resource-type-visual"

export const marketResourceTypeOptions: MarketResourceTypeOption[] = [
  resourceTypeOption("game_card", resourceTypeVisuals.game_card, "完整卡包"),
  resourceTypeOption("agent", resourceTypeVisuals.agent, "角色与流程代理"),
  resourceTypeOption("skill", resourceTypeVisuals.skill, "可复用能力"),
  resourceTypeOption("tool", resourceTypeVisuals.tool, "原生函数工具"),
]
