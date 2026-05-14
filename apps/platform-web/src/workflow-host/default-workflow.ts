/**
 * 平台默认工作流（H6 / design.md §8）
 *
 * 模组未声明 manifest.workflow 时使用。复刻当前三段链路：
 *   retrieval (ai-call) → chat (ai-call) → reply (result)
 *                                       ↓
 *                                   maintenance (ai-call) → applyPatch (apply-patch)
 *
 * preset id 与 builtin-presets/index.ts 中的 Map key 严格对齐：
 *   - builtin.retrieval
 *   - builtin.chat
 *   - builtin.maintenance
 *
 * 本文件仅声明数据，不实例化调度器（H7 之前主链尚未接入）。
 * 加载期 6 条校验（design §13.4）的人工核对见 project_h6_progress.md。
 *
 * H8 期间 retrieval 节点走 β-1 bypass，platform-host 灌入 __retrieval.raw macro。
 * H10 下沉后删除 bypass。
 */

import type { WorkflowDefinition } from "@tsian/contracts"

export const defaultWorkflow: WorkflowDefinition = {
  nodes: [
    {
      id: "retrieval",
      type: "ai-call",
      config: {
        presetId: "builtin.retrieval", // 保留 — bypass 时不走，H10 删除 bypass 后能恢复
        bypass: { rawFromMacro: "__retrieval.raw" },
      },
      outputs: [
        // prompt / directEntities 都用 tag 抽取，避免 raw 端口把整段复合文本（含 directEntities tag 尾巴）
        // 灌给 chat / maintenance 造成视野污染。platform-host 灌入的 __retrieval.raw 须是
        // <prompt>...</prompt><directEntities>[...]</directEntities> 形态。
        { name: "prompt", extract: { type: "tag", tag: "prompt" } },
        {
          name: "directEntities",
          extract: { type: "tag", tag: "directEntities", parse: "json" },
        },
      ],
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
      to: { nodeId: "maintenance", varName: "directEntities" },
    },
    {
      from: { nodeId: "maintenance", outputName: "patch" },
      to: { nodeId: "applyPatch", varName: "patch" },
    },
  ],
}
