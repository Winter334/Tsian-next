/**
 * 工作流加载期校验器
 *
 * 实现 workflow DAG 的加载期校验。
 * 任一失败立即 throw WorkflowValidationError（fail loud），不允许延迟到执行期。
 *
 * 校验项：
 *   1. 节点 ID 全局唯一（DUPLICATE_NODE_ID）
 *   2. 无环：拓扑排序成功（CYCLE_DETECTED）
 *   3. 无悬挂边：edge.from.nodeId / edge.to.nodeId 必须存在（DANGLING_EDGE）
 *   4. apply-patch 节点 input ports 完整性（APPLY_PATCH_INPUT_INCOMPLETE）
 *   5. 必须存在至少 1 个 result 节点（MISSING_RESULT_NODE）
 *   6. result 节点 config.name 唯一（DUPLICATE_RESULT_NAME）
 *   7. 节点 type 必须在平台支持集合内（UNKNOWN_NODE_TYPE）
 */

import type {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowNodeType,
  ResultNodeConfig,
} from "@tsian/contracts"
import { WorkflowValidationError } from "./errors"

const VALID_NODE_TYPES: ReadonlySet<WorkflowNodeType> = new Set<WorkflowNodeType>([
  "ai-call",
  "result",
  "switch",
  "apply-patch",
  "compute",
  "memory-query",
  "memory-write",
  "template-compose",
])

/**
 * apply-patch 节点必备的 4 个 input port 名（来自 §13.3 配套约束）。
 * patchVarName 在 config 中声明，但 edge 必须把上游的 patch 端口接到这个 varName。
 *
 * H3 阶段简化策略（保守）：
 *   - 仅校验 apply-patch 节点声明的 patchVarName 必须在入边 varName 中出现
 *   - "完整性"在 H3 范围 = 至少有一条入边覆盖 patchVarName
 */
function validateApplyPatchInputPorts(
  node: WorkflowNode,
  incomingVarNames: ReadonlySet<string>,
): void {
  const cfg = node.config as { patchVarName?: unknown }
  const patchVarName = cfg?.patchVarName
  if (typeof patchVarName !== "string" || patchVarName.length === 0) {
    throw new WorkflowValidationError(
      "APPLY_PATCH_INPUT_INCOMPLETE",
      `apply-patch node "${node.id}" must declare config.patchVarName as non-empty string`,
    )
  }
  if (!incomingVarNames.has(patchVarName)) {
    throw new WorkflowValidationError(
      "APPLY_PATCH_INPUT_INCOMPLETE",
      `apply-patch node "${node.id}" requires incoming edge with varName "${patchVarName}"`,
    )
  }
}

/**
 * 校验 1：节点 ID 全局唯一。
 */
export function validateUniqueNodeIds(def: WorkflowDefinition): void {
  const seen = new Set<string>()
  for (const node of def.nodes) {
    if (seen.has(node.id)) {
      throw new WorkflowValidationError(
        "DUPLICATE_NODE_ID",
        `duplicate node id "${node.id}"`,
      )
    }
    seen.add(node.id)
  }
}

/**
 * 校验 2：无环（Kahn 拓扑排序）。
 * 同时返回拓扑排序结果（节点 id 数组），供调度器复用。
 */
export function validateAcyclic(def: WorkflowDefinition): string[] {
  const inDegree = new Map<string, number>()
  const adj = new Map<string, string[]>()
  for (const node of def.nodes) {
    inDegree.set(node.id, 0)
    adj.set(node.id, [])
  }
  for (const edge of def.edges) {
    // 此处假设 dangling edge 已由 validateNoDanglingEdges 拦截；防御性跳过未知节点
    if (!inDegree.has(edge.to.nodeId) || !adj.has(edge.from.nodeId)) continue
    inDegree.set(edge.to.nodeId, (inDegree.get(edge.to.nodeId) ?? 0) + 1)
    adj.get(edge.from.nodeId)!.push(edge.to.nodeId)
  }

  const queue: string[] = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }
  const ordered: string[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    ordered.push(id)
    for (const next of adj.get(id) ?? []) {
      const remaining = (inDegree.get(next) ?? 0) - 1
      inDegree.set(next, remaining)
      if (remaining === 0) queue.push(next)
    }
  }

  if (ordered.length !== def.nodes.length) {
    throw new WorkflowValidationError(
      "CYCLE_DETECTED",
      `workflow contains a cycle (only ${ordered.length}/${def.nodes.length} nodes are reachable via topological order)`,
    )
  }
  return ordered
}

/**
 * 校验 3：无悬挂边。
 */
export function validateNoDanglingEdges(def: WorkflowDefinition): void {
  const ids = new Set(def.nodes.map((n) => n.id))
  for (const edge of def.edges) {
    if (!ids.has(edge.from.nodeId)) {
      throw new WorkflowValidationError(
        "DANGLING_EDGE",
        `edge references unknown source node "${edge.from.nodeId}"`,
      )
    }
    if (!ids.has(edge.to.nodeId)) {
      throw new WorkflowValidationError(
        "DANGLING_EDGE",
        `edge references unknown target node "${edge.to.nodeId}"`,
      )
    }
  }
}

/**
 * 校验 4：apply-patch 节点 input ports 完整性（见 validateApplyPatchInputPorts）。
 */
export function validateApplyPatchPorts(def: WorkflowDefinition): void {
  // 预聚合每个 target 节点的入边 varName 集合
  const incomingByTarget = new Map<string, Set<string>>()
  for (const edge of def.edges) {
    if (!incomingByTarget.has(edge.to.nodeId)) {
      incomingByTarget.set(edge.to.nodeId, new Set())
    }
    incomingByTarget.get(edge.to.nodeId)!.add(edge.to.varName)
  }
  for (const node of def.nodes) {
    if (node.type !== "apply-patch") continue
    const incoming = incomingByTarget.get(node.id) ?? new Set<string>()
    validateApplyPatchInputPorts(node, incoming)
  }
}

/**
 * 校验 5：至少 1 个 result 节点。
 */
export function validateHasResultNode(def: WorkflowDefinition): void {
  const hasResult = def.nodes.some((n) => n.type === "result")
  if (!hasResult) {
    throw new WorkflowValidationError(
      "MISSING_RESULT_NODE",
      "workflow must contain at least one node of type 'result'",
    )
  }
}

/**
 * 附加校验：节点类型必须合法。
 */
export function validateKnownNodeTypes(def: WorkflowDefinition): void {
  for (const node of def.nodes) {
    if (!VALID_NODE_TYPES.has(node.type as WorkflowNodeType)) {
      throw new WorkflowValidationError(
        "UNKNOWN_NODE_TYPE",
        `node "${node.id}" has unknown type "${String(node.type)}"`,
      )
    }
  }
}

/**
 * 附加校验：result 节点 config.name 唯一。
 */
export function validateUniqueResultNames(def: WorkflowDefinition): void {
  const seen = new Set<string>()
  for (const node of def.nodes) {
    if (node.type !== "result") continue
    const cfg = node.config as Partial<ResultNodeConfig>
    const name = cfg?.name
    if (typeof name !== "string" || name.length === 0) {
      throw new WorkflowValidationError(
        "MISSING_RESULT_NODE",
        `result node "${node.id}" must declare config.name as non-empty string`,
      )
    }
    if (seen.has(name)) {
      throw new WorkflowValidationError(
        "DUPLICATE_RESULT_NAME",
        `duplicate result node config.name "${name}"`,
      )
    }
    seen.add(name)
  }
}

/**
 * 校验主入口。
 *
 * @param def 工作流定义
 * @param _options 保留调用方来源元数据兼容位；当前不因 mod 来源禁用 apply-patch。
 * @returns 拓扑排序后的节点 id 数组（调度器复用）
 */
export function validateWorkflowDefinition(
  def: WorkflowDefinition,
  _options: { isModWorkflow?: boolean } = {},
): string[] {
  validateUniqueNodeIds(def)
  validateKnownNodeTypes(def)
  validateNoDanglingEdges(def)
  // 拓扑排序在 dangling 之后做，确保只对合法图做
  const order = validateAcyclic(def)
  validateApplyPatchPorts(def)
  validateHasResultNode(def)
  validateUniqueResultNames(def)
  return order
}
