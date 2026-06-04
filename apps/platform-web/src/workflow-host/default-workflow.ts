/**
 * 平台默认工作流（H6 / design.md §8）
 *
 * 模组未声明 manifest.workflow 时使用。复刻当前三段链路：
 *   retrieval (memory-query) → chat (ai-call) → reply (result)
 *                                             ↓
 *                                         maintenance (ai-call) → applyPatch (apply-patch)
 *
 * preset id 与资源库内置 prompt preset 种子 id 严格对齐：
 *   - builtin.retrieval
 *   - builtin.chat
 *   - builtin.maintenance
 *
 * 本文件仅声明数据，不实例化调度器（H7 之前主链尚未接入）。
 * 加载期 6 条校验（design §13.4）的人工核对见 project_h6_progress.md。
 *
 * retrieval 由 memory-query 节点执行，platform-host 只提供本轮素材与 debug 回调。
 */

import type { WorkflowDefinition } from "@tsian/contracts"

export const defaultWorkflow: WorkflowDefinition = {
  nodes: [
    {
      id: "retrieval",
      type: "memory-query",
      config: { source: "event-archive" },
    },
    {
      id: "chat",
      type: "ai-call",
      config: { presetId: "builtin.chat", appendUserInput: true },
    },
    {
      id: "reply",
      type: "result",
      config: { name: "reply" },
    },
    {
      id: "maintenance",
      type: "ai-call",
      config: { presetId: "builtin.maintenance" },
      retry: { maxRetries: 0 },
      outputs: [
        { name: "patch", extract: { type: "raw", parse: "json" } },
      ],
    },
    {
      id: "applyPatch",
      type: "apply-patch",
      config: { patchVarName: "patch", pushCheckpointReason: "after-turn" },
    },
  ],
  edges: [
    {
      from: { nodeId: "retrieval", outputName: "prompt" },
      to: { nodeId: "chat", varName: "retrieval.prompt" },
    },
    {
      from: { nodeId: "chat", outputName: "raw" },
      to: { nodeId: "reply", varName: "value" },
    },
    {
      from: { nodeId: "chat", outputName: "raw" },
      to: { nodeId: "maintenance", varName: "lastReply" },
    },
    {
      from: { nodeId: "retrieval", outputName: "directEntities" },
      to: { nodeId: "maintenance", varName: "retrieval.directEntities" },
    },
    {
      from: { nodeId: "retrieval", outputName: "archives" },
      to: { nodeId: "maintenance", varName: "archives.recent.json" },
    },
    {
      from: { nodeId: "maintenance", outputName: "patch" },
      to: { nodeId: "applyPatch", varName: "patch" },
    },
  ],
}
