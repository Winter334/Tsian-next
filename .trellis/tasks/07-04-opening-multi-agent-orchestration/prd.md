# 开局向导多 Agent 编排

## Goal

将默认 novel AIRP 开局向导从 world-architect 一人包揽，重构为 world-architect 作为编排者通过 `agent_call` 自主调度导演与说书人的多 Agent 自编排：world-architect 负责建模与编排，导演负责写初始 brief，说书人负责写开局正文。同时让访谈阶段 UI 接入 `onAgentInvocation` 流式事件，使玩家在向导对话中看到流式文本而非等 Promise resolve 后一次性渲染。

## Background · 方案演进

原 PRD 设想前端按序调用 3 次 `invokeAgent`（world-architect 建模 → 导演写 brief → 说书人写正文）串联编排。经评估，该方案让前端隐式承担 pipeline 编排，且需前端分别消费多 Agent 事件流，改动面大。

本任务改为 **agent_call 自编排**：前端仍只发起一次 `invokeAgent("world-architect", ...)`，world-architect 在运行中通过 `agent_call` 自主调用导演与说书人，由 Agent 自主决定何时 call 谁、如何汇总。这符合 PRD R15（`agent_call` 是一次调用内自主协作机制）和 R5（平台不硬编码 novel pipeline）。

## Current State

### 平台层（已就绪，无需改动）

- `invokeAgent` 流式事件 `onAgentInvocation`（started/delta/round-end/tool/completed/failed）已实现（`agent-invocation-streaming` 归档任务）。
- SDK `tsian.onAgentInvocation(cb)` 已暴露（`play-bridge/src/tsian-api.ts:389`）。
- `agent_call` 在 `invokeAgent` 路径内可用（复用 `runAgentRuntimeTurn`，被叫方共享同一 `workspaceTransaction`，有 `workspace_write` 权限的 Agent 可直接落盘）。
- `workspace-with-checkpoint` 提交模式已实现（刚归档的 `invoke-agent-workspace-with-checkpoint` 任务）。

### 前端消费端（本任务改动）

`apps/play-frontend-dev/src/composables/useSetupState.ts`：
- Step 2 understanding（`startUnderstanding`，293 行）调 `invokeAgent("world-architect", ...)`，用 `onAgentActivity` 旧心跳做"活着"脉冲。
- Step 4 play-setup（`startPlaySetupDialog` 594 行 / `sendPlaySetupMessage` 630 行）调 `invokeAgent("world-architect", ...)`，同样用旧心跳，等 Promise resolve 后一次性渲染 `result.response`。
- **未接入 `onAgentInvocation` delta 流**——`useSyncAfterTurn.ts:104` 已有先例（监听 completed/failed），但 setup 路径未消费 delta。

### Agent 模板（本任务改动）

`apps/platform-web/src/storage/workspace-templates.ts`：
- world-architect `contacts: ["researcher", "stage-manager", "director"]`——**缺 storyteller**，需追加才能 agent_call 说书人。
- world-architect AGENT.md 明确写"不写开局正文"——需改为"通过 agent_call 说书人写开局正文"。
- storyteller `platformTools: ["agent_call", "workspace_read"]`——**无 `workspace_write`**，无法自写 `opening-narrative.json`（影响 D1 决策）。
- director `platformTools: ["workspace_read", "workspace_write", "agent_call"]`——可自写 `current-brief.md`。
- 当前 `buildOpeningInitializationPrompt`（source.ts:490）指示 world-architect 直接写 director brief；`buildPlaySetupPrompt`（source.ts:460）指示 world-architect 直接写 opening-narrative.json。

### 开局正文文件

`save/playthrough/opening-narrative.json`（`{ narrative: string }`）——独立于 turn 历史，StoryView 特殊渲染为"接在正式历史前方的第一条消息"（`StoryView.vue:348-353`）。正式 turn 从玩家第一次输入开始编号。

## Requirements

- R1: world-architect 作为开局编排者，在建模阶段通过 `agent_call` 调用导演写初始 `save/director/current-brief.md`，而不是自己代写。
- R2: world-architect 在游玩设定对话收尾时通过 `agent_call` 调用说书人写开局正文到 `save/playthrough/opening-narrative.json`。
- R3: world-architect 不再直接代写 director brief 和 opening-narrative；它的角色是建模者 + 编排者 + 汇总者。
- R4: world-architect `contacts` 追加 `storyteller`，使其可 agent_call 说书人。
- R5: 访谈阶段（Step 4 play-setup）UI 接入 `onAgentInvocation` delta 事件，流式展示 world-architect 输出文本；保留 completed/failed 驱动状态转换。流式用轻量文本块渲染，落定后 push 为 NarrativeMessage，不混用。
- R6: Step 2 understanding 阶段接入 `onAgentInvocation` 的 `tool` 事件，映射成面向玩家的术式阶段文案（单调推进），替代现有按时间硬切的阶段文案；去掉底部固定提示行。不展示 delta 文本和工具名列表（映射美化，保持沉浸感）。
- R7: 落盘责任（代写 vs 自写）在 design.md 评估后确定；MVP 可接受任一方案，但需记录权衡。
- R8: 开局正文沿用独立文件 `opening-narrative.json`（`{ narrative: string }`），不进 turn 历史；未来可扩展为富渲染 segments schema，但本任务不实现。
- R9: 开局访谈保持极简；只对真正玩法系统提供三态选择（如"行动裁定"），不让玩家设计系统细节。
- R10: 前端调用方式不变——仍是一次 `invokeAgent("world-architect", ...)`，不改为前端串行多次调用。
- R11: 旧 `onAgentActivity` 心跳在 Step 4 和 Step 2 路径都用 `onAgentInvocation` 替代；全局 `onAgentActivity` API 清理若确认无其他引用则一并完成，否则留给 `setup-invoke-agent-streaming`。
- R12: 前端不硬编码 novel AIRP 的 world-architect → director → storyteller pipeline；编排逻辑在 Agent 指令层（AGENT.md / Skill），不在前端代码里串行调用。

## Acceptance Criteria

- [ ] world-architect 在开局建模阶段 agent_call 导演写 initial brief，不再自己代写 `current-brief.md`。
- [ ] world-architect 在设定收尾阶段 agent_call 说书人写开局正文到 `opening-narrative.json`。
- [ ] world-architect `contacts` 包含 `storyteller`。
- [ ] Step 4 访谈对话流式展示 world-architect 输出（delta 累积渲染），不再等 Promise resolve 一次性渲染。
- [ ] Step 4 流式用轻量文本块渲染，落定后 push 为 NarrativeMessage，不混用。
- [ ] 流式展示能正确处理 `completed`（落定文本 + 检查 setup-summary）和 `failed`（显示错误 + 重试）。
- [ ] Step 2 阶段文案由 agent 工具调用事件驱动（单调推进），不再按时间硬切。
- [ ] Step 2 底部固定提示行已移除，魔法阵动画保留。
- [ ] 开局正文仍落在 `save/playthrough/opening-narrative.json`，StoryView 渲染逻辑不破坏。
- [ ] 正式 turn 编号仍从玩家第一次输入开始，开局正文不占 turn 号。
- [ ] 落盘责任方案在 design.md 记录并落地实施，不遗留为 TODO。
- [ ] `npm run build:web` 通过；若改 contracts 或 bridge，`npm run build:contracts` 也通过。
- [ ] 旧心跳在访谈路径不再驱动渲染（被 onAgentInvocation 替代）；全局清理状态记录在 design/implement。

## Dependencies

- 平台层 `onAgentInvocation` 流式事件（已就绪）。
- 平台层 `agent_call` 在 `invokeAgent` 路径可用（已就绪）。
- Agent 模板新阵容（storyteller/director/world-architect 已重写，已就绪）。

## Notes

- 落盘责任（D1）和开局文件格式（D2/D3）在 design.md 评估。
- 本任务不实现开局富渲染（HTML/segments），只记录扩展方向。
- `setup-invoke-agent-streaming`（P1）的旧心跳全局清理可与本任务合并或保持独立；design 评估后确定边界。
