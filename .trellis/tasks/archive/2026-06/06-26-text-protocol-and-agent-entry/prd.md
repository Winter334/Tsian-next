# 文本协议完善与任意agent入口

## Goal

完善早期设计中遗留的三块欠债：(A) 游戏前端无法以任意 agent 为入口调用 runtime——host 层写死 master、context 落盘写死路径、bridge 层不带 agentId；(B) text 模式无流式、无思维块剥离——推理模型的思考内容污染 content 和上下文窗口；(C) text 模式子代理过程对 UI 不可见——delegated agent 调用是黑盒。

用户价值：游戏前端能实现 NPC 视角对话、UI 触发的单次状态修正等功能；text 模式用户获得流式体验和干净的上下文；子代理调用过程可观测。

## Confirmed Facts

### 方向 A — 任意 agent 为入口

- `runAgentRuntimeTurn(input.agentId)` 已参数化，`assembleAgentContext({agentId})` 能找任意 agent 卡。runtime 层抽象到位。
- host 三处调用点：`platform-host/index.ts:757` 硬编码 `agentId: "master"`；`frontend-inspector.ts:777` 硬编码 master；`assistant-chat.ts:428` 用变量（仅 assistant）。
- `AGENT_CONTEXT_PATH = "save/agents/master/context.json"` 是常量（context-lifecycle.ts:26）。schema/agentId 是 master/assistant 两个并列常量。
- `createInitialAgentContext`/`parseAgentContext` 已参数化 schema/agentId（options 覆盖，缺省回退 master），但**不参数化路径**。路径分别由 master 用常量、assistant 用 `assistantContextPath(sessionId)` 函数，在各 host 调用点构造。
- `AGENT_CONTEXT_PATH` 使用点仅在 `history-turns.ts`（读:73 / 写:105）；index.ts import 但不直接引用（经 helper 间接用）。
- bridge 层 `MessageInteractionRequest` 只有 `{ content: string }`，无 agentId。`RemotePlayBridgeMethod` 共 6 个，无任何 agent 调用 method。`LocalRuntimeEngine.sendMessage` 直接抛错，真正 turn 路径在 `platform-host/index.ts:705` 的 bridge `interaction.sendMessage` handler。
- `AgentConfig` 契约字段：id/title/summary/contacts/contextPaths/skills/platformTools/workspaceAccess/knowledgeMount?/providerPresetId?。无 entryMode、无 system 字段。
- master agent.json：level 1，contacts [retrieval, post-processing]，platformTools [agent_call, workspace_read]。
- assistant agent.json：level 4，contacts []，platformTools [agent_call, workspace_read, workspace_write, inspect_frontend, ask_user]，knowledgeMount "docs/"。

### 方向 B — 文本协议流式

- text 模式 `normalizeStreaming`（config/ai.ts:270-275）强制返回 false。validate 也拦截 text+streaming=true。
- streaming gate 在 platform-host 三处 `callModelNative` 闭包（index.ts:794-823 等）：`!options.onDelta || !streamingEnabled` → 非流 `generateAssistantReplyNative`；否则 `streamAssistantReplyNative`。text 永远走非流。
- text 模式工具循环是 `callAgentModelWithWorkspaceTools`（index.ts:1812 起），用 `capabilities.callModel`（非流 `generateAssistantReply`）。
- 现有 `stripRuntimeWorkspaceToolCallBlocks`（index.ts:2017）已在 round 结束剥离工具调用块。思维块无平行剥离函数。
- native 模式 reasoning 通过 provider 专属 SSE 字段抽取（`extractStreamReasoningDelta`），路由到 thought processNode，刻意不进 `result.text`。

### 方向 C — text 模式子代理可见性

- native 模式子代理已透传 `onDelta/onRoundEnd/onTool/onAskUser`（index.ts:1324-1327），UI 可见过程。回流给主代理模型的只有 `.text`（index.ts:1343），过程事件只进 UI 不进上下文——隔离正确，不用动。
- text 模式工具循环当前**只绑定 onTool**（index.ts:2054-2067），**未绑定 onDelta 和 onRoundEnd**。delegated text 路径连 onTool 都没绑（注释 index.ts:1322-1323 "text-protocol delegated agents stay silent as before"）。
- entry 路径 text 模式已有 onTool + collectedProcessNodes，但缺 onRoundEnd 导致 UI 无 round 边界事件。

## Requirements

### A — 任意 agent 为入口

- **A1**: `AgentConfig` 契约新增 `entryMode?: "persistent" | "ephemeral"`，缺省 `"persistent"`。persistent 入口建独立 context.json 跨 turn 累积；ephemeral 入口无 context.json、调完即弃、每轮从 recentHistory 重建。
- **A2**: `AgentConfig` 契约新增 `system?: boolean`，缺省 false。master 和 assistant 的默认 agent.json 标 `system: true`。前端据此禁删禁改名禁改 id。
- **A3**: `AgentRegistryEntry` 暴露 `entryMode` 和 `system` 字段（registry.ts `buildAgentRegistryEntry` 解析）。
- **A4**: context 落盘路径泛化。`AGENT_CONTEXT_PATH` 从写死常量改为按 agentId 生成（`save/agents/<agentId>/context.json`）。保留 master 路径向后兼容。ephemeral 入口不读写 context.json。
- **A5**: bridge 层新增 `interaction.invokeAgent({ agentId, input })` 方法 + `RemotePlayBridgeMethod` 新增 `"interaction.invokeAgent"`。结果直接返回调用方，**不进 runtimeSnapshot**、不推 turn 计数、不进历史落盘。sendMessage 保持 master 叙事回合独占。
- **A6**: platform-host 新增 invokeAgent handler：按 agentId 装配 entry context → 调 `runAgentRuntimeTurn` → 按 entryMode 决定建/不建 context → 返回回复文本。不经过 save 事务（ephemeral）或经 save 事务但用泛化路径（persistent）。
- **A7**: `system: true` 作为信息字段存在（agent.json + registry 暴露），主要消费者是助手 agent 自身（通过 workspace_read 读到后理解 master/assistant 是系统级、不可随意改名/删除）。工作室（StudioView）当前 agent 面板编辑器是 readonly、无删除/改名入口，不需要 UI 硬拦截。工作室 agent 列表可显示 `entryMode` 标记（区分入口 agent vs 工具 agent），作为轻量展示增强。未来若加 agent 管理 UI，`system` 字段已就位可用。

### B — 文本协议流式

- **B1**: text 模式解除 `streaming: false` 强制。`normalizeStreaming` 允许 text 模式 streaming=true。validate 草稿校验同步放开。
- **B2**: text 模式流式实现：流期累积 `textBuffer`，每 delta 对 buffer 做廉价 strip（闭合块实时隐掉、未闭合尾部块残留显示）供显示层。round 结束（SSE 结束）对完整 buffer 做 post-hoc 正则权威解析，喂同一条现有解析路径（`parseRuntimeWorkspaceToolCalls`）。不做增量标签边界状态机。
- **B3**: 思维块剥离（runtime 层，喂回模型前必须做，防上下文污染）：适配 ``、`<thought>...</thought>`、`<thinking>...</thinking>` 三种常见原生标签。round 结束对完整 buffer 剥离，与 `stripRuntimeWorkspaceToolCallBlocks` 并列。多余格式不管。
- **B4**: 渲染分工：平台对游戏前端透传原始回复文本（含或不含思维块由前端自己解析渲染）；助手 UI 平台自己渲染（strip + thought 节点）。

### C — text 模式子代理可见性

- **C1**: text 模式工具循环补发 `onRoundEnd`：round 结束时按解析结果发 `onRoundEnd(agentId, round, finishReason)`。entry 路径和 delegated 路径都补。
- **C2**: text 模式 delegated 路径补绑 `onTool`：当前 entry 路径已绑（index.ts:2054），delegated 路径未绑。补绑让子代理工具节点也进 UI timeline。
- **C3**: `onDelta` 不发（text 流式由 B2 的廉价 strip 处理显示，不增量发 delta）。流式感由前端动画补。
- **C4**: native 模式子代理隔离不变（只回流 .text 给主代理模型，过程事件只进 UI）。

## Acceptance Criteria

- [ ] A1: `AgentConfig` 包含 `entryMode?: "persistent" | "ephemeral"` 字段；缺省行为等价 persistent。
- [ ] A2: `AgentConfig` 包含 `system?: boolean` 字段；master 和 assistant 默认 agent.json 含 `system: true`。
- [ ] A3: `AgentRegistryEntry` 暴露 `entryMode` 和 `system`；`agent-registry` query 返回值含这两个字段。
- [ ] A4: persistent 入口按 `save/agents/<agentId>/context.json` 读写 context；master 旧路径 `save/agents/master/context.json` 保持兼容；ephemeral 入口不读写 context.json。
- [ ] A5: `interaction.invokeAgent` bridge method 可从游戏前端调用，返回 `{ response: string }`；不修改 runtimeSnapshot、不推进 turn、不写入历史。
- [ ] A6: invokeAgent handler 对 persistent agent 读写泛化路径 context.json；对 ephemeral agent 不建 context、从 recentHistory 重建。
- [ ] A7: `system: true` 字段经 registry 暴露，助手 agent 可经 workspace_read 读到；工作室 agent 列表显示 entryMode 标记（入口 vs 工具 agent）。
- [ ] B1: text 模式 model config 可设 `streaming: true` 且不报错。
- [ ] B2: text 模式 streaming=true 时，流期显示层看到廉价 strip 后的文本（已闭合块不显示、未闭合尾部块可见）；round 结束权威解析正确提取工具调用。
- [ ] B3: text 模式 round 结束，``/`<thought>`/`<thinking>` 块从喂回模型的 content 中剥离；剥离后的正文不含思考标签。
- [ ] B4: 游戏前端经 invokeAgent 或 sendMessage 收到的回复文本为原始文本（平台不替前端做思维块渲染剥离）；助手 UI 正确折叠/隐藏思维块。
- [ ] C1: text 模式 entry + delegated 路径 round 结束发 `onRoundEnd` 事件，UI timeline 出现 round 边界。
- [ ] C2: text 模式 delegated 路径工具节点出现在 UI timeline（loading→success/failed）。
- [ ] C3: text 模式不通过 onDelta 发增量 delta。
- [ ] C4: native 模式子代理行为不变（回归验证）。

## Out of Scope

- 不改变 native 模式的流式/reasoning 机制（已正确）。
- 不改变 native 模式子代理的过程隔离（已正确）。
- 不为 ephemeral 入口建任何持久化存储（无 context.json、无 trace 落盘、无历史记录）。
- 不在工具协议 prompt 中硬性要求模型以特定格式输出思考（思考形态由模型原生能力和玩家提示词引导）。
- 不适配 ``/`<thought>`/`<thinking>` 以外的思考标签格式（非主流格式不管，由提示词层负责）。
- 不做 invokeAgent 的权限细粒度控制（当前 contacts 门控 + workspaceAccess level 已存在，复用即可）。
- 不改变 sendMessage 的 master 独占语义（sendMessage 永远是 master 叙事回合）。
- 不做前端动画的具体实现（平台只提供过程事件，动画由前端自行实现）。

## Open Questions

无。所有决策已通过讨论确认，代码库可回答的问题已通过探查验证。
