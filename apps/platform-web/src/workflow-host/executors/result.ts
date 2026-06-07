/**
 * result 节点 executor
 *
 * 职责：把入边的 `value` 端口原样输出，调度器在结尾从 outputs.value 读出。
 *
 * 约定：
 *   - 入边端口名固定 `value`，与 scheduler `outs?.value` 对齐
 *   - 不校验入边数量；缺失时 outputs.value === undefined（下游 results map 仍记录 undefined）
 *   - 不消费 config.name（调度器在 executeWorkflow 末尾按 result 节点 config.name 汇总）
 */

import type { NodeExecutor } from "@tsian/workflow-engine"

export const resultExecutor: NodeExecutor = {
  async execute({ inputs }) {
    return { outputs: { value: inputs.value } }
  },
}
