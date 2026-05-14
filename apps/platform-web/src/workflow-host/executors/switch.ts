/**
 * switch 节点 executor
 *
 * 职责（design.md §13.2）：
 *   - 入边端口名固定 `value`
 *   - 按 `String(inputs.value) === case.when` 等值匹配（原型期不做字段路径访问 / 复杂表达式）
 *   - 命中：outputs[case.outputName] = inputs.value
 *   - 未命中 + 有 default：outputs[config.defaultOutputName] = inputs.value
 *   - 未命中 + 无 default：返回空 outputs（下游端口 undefined，自处理"未到达"）
 */

import type { NodeExecutor } from "@tsian/workflow-engine"
import type { SwitchNodeConfig } from "@tsian/contracts"

function readSwitchConfig(raw: unknown): SwitchNodeConfig {
  if (
    typeof raw !== "object" ||
    raw === null ||
    !Array.isArray((raw as { cases?: unknown }).cases)
  ) {
    throw new Error(
      `switch node config is invalid: expected { cases: Array<{when, outputName}> }`,
    )
  }
  const cfg = raw as SwitchNodeConfig
  for (const item of cfg.cases) {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof item.when !== "string" ||
      typeof item.outputName !== "string"
    ) {
      throw new Error(
        `switch node case must be { when: string; outputName: string }`,
      )
    }
  }
  return cfg
}

export const switchExecutor: NodeExecutor = {
  async execute({ node, inputs }) {
    const config = readSwitchConfig(node.config)
    const upstream = inputs.value
    const key = String(upstream)
    const outputs: Record<string, unknown> = {}

    for (const item of config.cases) {
      if (item.when === key) {
        outputs[item.outputName] = upstream
        return { outputs }
      }
    }

    if (typeof config.defaultOutputName === "string" && config.defaultOutputName) {
      outputs[config.defaultOutputName] = upstream
    }
    return { outputs }
  },
}
