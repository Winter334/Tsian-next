import type { WorkflowDefinition } from "@tsian/contracts"
import { createDefaultAirpWorkflow } from "./default-airp-workflow"

export const GREY_SALT_TOWN_WORKFLOW_PRESET_ID =
  "builtin.mod.grey-salt-town.workflow"

export interface BuiltinWorkflowPresetSeed {
  id: string
  modId: string
  name: string
  description: string
  tags: string[]
  workflow: WorkflowDefinition
}

export const builtinWorkflowPresetSeeds: BuiltinWorkflowPresetSeed[] = [
  {
    id: GREY_SALT_TOWN_WORKFLOW_PRESET_ID,
    modId: "grey-salt-town",
    name: "灰盐镇测试模组 工作流",
    description: "灰盐镇内置模组使用的默认 AIRP 工作流预设。",
    tags: ["builtin", "mod", "grey-salt-town", "workflow-preset"],
    workflow: createDefaultAirpWorkflow(),
  },
]
