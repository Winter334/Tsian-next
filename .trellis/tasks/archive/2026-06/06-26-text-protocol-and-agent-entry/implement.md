# Implement: 文本协议完善与任意agent入口

## 实现顺序

按依赖序：B（文本协议流式）→ C（子代理可见性）→ A（任意 agent 入口）。
B 和 C 在 agent-runtime + runtime-host 内闭环；A 跨包改契约。

---

## Phase B: 文本协议流式

### B1: 解除 text 模式 streaming 强制 false
- [ ] `apps/platform-web/src/config/ai.ts` — `normalizeStreaming`：移除 text → false 短路。text 模式缺省仍 false（保守），但显式 `streaming: true` 不再被覆盖。
- [ ] `apps/platform-web/src/config/ai.ts` — `validateBrowserPlatformConfigDraft`：移除 text+streaming=true 拦截。
- [ ] 验证：`npm run build:web` 通过。

### B2: streamAssistantReplyText 新函数
- [ ] `apps/platform-web/src/runtime-host/ai.ts` — 新增 `streamAssistantReplyText(messages: AiChatMessage[], options): Promise<string>`。
  - 结构镜像 `streamAssistantReplyNative`，入参用 `AiChatMessage[]`。
  - 发 `stream: true`（adapter 的 `buildStreamRequestBody` 或直接 `buildRequestBody` + `body.stream = true`）。
  - SSE 循环：复用 adapter `extractStreamDelta` + `extractStreamFinish`。不用 `extractStreamToolCalls`。
  - 流期：`textBuffer += delta`；`onDelta(stripForDisplay(textBuffer), round, "content")`。
  - 非 `text/event-stream` fallback：降级 `generateAssistantReply` 逻辑（一次性 JSON + `extractText`），无 onDelta。
  - 返回完整 `textBuffer`（未剥离）。
- [ ] `apps/platform-web/src/runtime-host/ai.ts` — 新增 `stripForDisplay(text: string): string`：剥离已闭合的 tool-call + think 块，未闭合尾部块保留。
- [ ] 验证：`npm run build:web` 通过。

### B2-gate: text 模式 callModel 流式 gate
- [ ] `apps/platform-web/src/platform-host/index.ts` — master `callModel` 闭包（~786-792）：加 `!options.onDelta || !streamingEnabled` gate。true → `streamAssistantReplyText`，false → `generateAssistantReply`。
- [ ] `apps/platform-web/src/platform-host/assistant-chat.ts` — assistant `callModel` 闭包（~473）：同上 gate。
- [ ] `apps/platform-web/src/platform-host/frontend-inspector.ts` — inspector `callModel` 闭包：同上 gate（如果 inspector 用 text 模式）。
- [ ] 验证：`npm run build:web` 通过。

### B2-runtime: text 工具循环绑 onDelta
- [ ] `apps/platform-web/src/agent-runtime/index.ts` — text 工具循环（~1998）：`capabilities.callModel(nextMessages, { ...options, onDelta: (delta, _r, kind) => { if (kind === "content" && options.onDelta) options.onDelta(agentContext.agent.id, delta, round, "content") } })`。
- [ ] 验证：`npm run build:web` 通过。

### B3: 思维块剥离
- [ ] `apps/platform-web/src/agent-runtime/workspace-tools.ts`（或 index.ts）— 新增 `stripThinkBlocks(text: string): string` + `THINK_BLOCK_PATTERNS`（`<thought>`/`<thinking>`/``）。
- [ ] `apps/platform-web/src/agent-runtime/index.ts` — text 循环 round 结束：`const cleanContent = stripThinkBlocks(stripRuntimeWorkspaceToolCallBlocks(response))`。喂回模型的 content 用 `cleanContent`。
- [ ] `apps/platform-web/src/agent-runtime/index.ts` — text 循环 round 结束：从 `response` 提取 think 块内容 → 推入 `collectedProcessNodes` thought 节点（与 native 同构）。
- [ ] 验证：`npm run build:web` 通过。

---

## Phase C: text 模式子代理可见性

### C1: 补发 onRoundEnd
- [ ] `apps/platform-web/src/agent-runtime/index.ts` — text 工具循环：
  - tool_calls 轮：解析出 toolCalls 后、`executeRuntimeWorkspaceToolCalls` 之前，发 `options.onRoundEnd?.(agentContext.agent.id, round, "tool_calls")`。
  - stop 轮：return 之前，发 `options.onRoundEnd?.(agentContext.agent.id, round, "stop")`。
- [ ] 更新注释（1322-1323 "text-protocol delegated agents stay silent" → 已补发 onRoundEnd）。
- [ ] 验证：`npm run build:web` 通过。

### C2: 验证 delegated onTool 绑定
- [ ] 确认 text 循环 onTool 绑定（2054-2067）是否无条件（不区分 entry/delegated）。如果已无条件绑定 → 更新注释，C2 工作量=0。如果 delegated 路径有条件跳过 → 补绑。
- [ ] 验证：`npm run build:web` 通过。

---

## Phase A: 任意 agent 为入口

### A1-A3: 契约 + registry 扩展
- [ ] `packages/contracts/src/runtime.ts` — `AgentConfig` 加 `entryMode?: "persistent" | "ephemeral"` + `system?: boolean`。
- [ ] `packages/contracts/src/runtime.ts` — `AgentRegistryEntry` 加 `entryMode: "persistent" | "ephemeral"` + `system: boolean`。
- [ ] `apps/platform-web/src/agent-runtime/registry.ts` — `buildAgentRegistryEntry` 解析 `config.entryMode`（枚举校验，缺省 persistent）+ `config.system`（布尔，缺省 false）。
- [ ] `npm run build:contracts` 通过。

### A4: context 落盘路径泛化
- [ ] `apps/platform-web/src/agent-runtime/context-lifecycle.ts` — `AGENT_CONTEXT_PATH` 常量改为 `agentContextPath(agentId: string): string` 函数。
- [ ] `apps/platform-web/src/platform-host/history-turns.ts` — `readAgentContextFromWorkspace` + `stageAgentContextFile` 参数化 agentId。调用点传 "master"。
- [ ] `apps/platform-web/src/platform-host/index.ts` — 更新 import（`AGENT_CONTEXT_PATH` → `agentContextPath`），调用点传 "master"。
- [ ] 全仓搜索 `AGENT_CONTEXT_PATH` 确认无遗漏引用。
- [ ] `npm run build:web` 通过。

### A5: bridge 契约新增 invokeAgent
- [ ] `packages/contracts/src/runtime.ts` — 新增 `InvokeAgentRequest { agentId: string; input: string }` + `InvokeAgentResult { response: string }`。
- [ ] `packages/contracts/src/bridge.ts` — `InteractionBridge` 加 `invokeAgent(input: InvokeAgentRequest): Promise<InvokeAgentResult>`。
- [ ] `packages/contracts/src/bridge.ts` — `RemotePlayBridgeMethod` 加 `"interaction.invokeAgent"`。
- [ ] `packages/runtime-core/src/engine.ts` — `RuntimeEngine` 加 `invokeAgent(input: InvokeAgentRequest): Promise<InvokeAgentResult>`。
- [ ] `npm run build:contracts` + `npm run build:runtime-core` 通过。

### A6: platform-host invokeAgent handler
- [ ] `apps/platform-web/src/runtime-host/engine.ts` — `LocalRuntimeEngine.invokeAgent` 转发到 platform-host（同 sendMessage 模式：engine 抛错或转发）。
- [ ] `apps/platform-web/src/platform-host/index.ts` — 新增 `interaction.invokeAgent` handler：
  - 校验 agentId 非空 + input 非空。
  - `assembleAgentContext(workspaceFiles, { agentId })` → 检查 agent 存在。
  - 读 agent entryMode：persistent → `readAgentContextFromWorkspace(files, agentId)`；ephemeral → 不读。
  - 调 `runAgentRuntimeTurn({ agentId, userInput: input, workspaceFiles, agentContext?, ... })`。
  - persistent → `stageAgentContextFile(transaction, updated, agentId)`；ephemeral → 不写。
  - 返回 `{ response: replyText }`。不推 turn、不写历史、不更新 snapshot。
- [ ] `apps/platform-web/src/bridge/play-frontend-bridge.ts` — `interaction.invokeAgent(input)` → `engine.invokeAgent(input)`。
- [ ] `apps/platform-web/src/bridge/remote-iframe-bridge.ts` — `REMOTE_PLAY_BRIDGE_METHODS` 加 `"interaction.invokeAgent"`；`dispatchRemoteBridgeRequest` 加分支；`normalizeInvokeAgentRequest` 校验。
- [ ] `npm run build:web` 通过。

### A7: 默认 agent.json seed + 工作室入口标记
- [ ] `apps/platform-web/src/storage/workspace.ts` — master agent.json seed 加 `"system": true, "entryMode": "persistent"`。
- [ ] `apps/platform-web/src/storage/local-assistant-files.ts` — assistant agent.json seed 加 `"system": true, "entryMode": "persistent"`。
- [ ] `apps/platform-web/src/views/StudioView.vue` — agent 列表项显示 `entryMode` 标记（persistent → "入口"标记；其余不显示或显示"工具"）。轻量展示，不改交互逻辑。
- [ ] `npm run build:web` 通过。

---

## 验证命令

```bash
# 契约变更后
npm run build:contracts

# runtime-core 变更后
npm run build:runtime-core

# platform-web 变更后（覆盖前两者）
npm run build:web

# 全量
npm run build:contracts && npm run build:runtime-core && npm run build:web
```

## 风险文件与回滚点

| 文件 | 风险 | 回滚策略 |
|------|------|---------|
| `config/ai.ts` normalizeStreaming | 老 text 配置突然开始流式 | 保守缺省 false，显式 true 才流式 |
| `context-lifecycle.ts` AGENT_CONTEXT_PATH → 函数 | master 路径值变化 | `agentContextPath("master")` === 旧常量值，等价 |
| `history-turns.ts` 参数化 | 调用点漏传 agentId | 调用点显式传 "master"，编译期类型检查兜底 |
| `ai.ts` streamAssistantReplyText | endpoint 不支持 SSE | 非 text/event-stream fallback 到 generateAssistantReply |
| `platform-host/index.ts` invokeAgent handler | 误进 save 事务 / 误推 turn | 明确不调 save 事务 / 不调 nextTurn 逻辑 |

## Follow-up Checks（task.py start 前）

- [ ] 确认 text 模式 delegated 路径 onTool 是否已无条件绑定（C2）

### 已验证：streamAssistantReplyText 的 adapter 复用方案

`buildStreamRequestBody` 接受 `RuntimeChatMessage[]`（native 格式），text 模式用 `AiChatMessage[]`，不能直接用。
但 `buildRequestBody` 接受 `AiChatMessage[]`，`streamAssistantReplyText` 的实现方案：
- body：`adapter.buildRequestBody(config, messages)` + `body.stream = true`（不调 `buildStreamRequestBody`）
- URL：复用 `adapter.buildStreamUrl(config)`（OpenAI/Gemini stream URL 和非 stream URL 相同或只差 query param）
- SSE 解析：`extractStreamDelta` / `extractStreamFinish` 按 SSE payload 解析，与 message 格式无关，直接复用
- 不用 `extractStreamToolCalls`（text 模式工具调用在 content 文本里）
- 不用 `extractStreamReasoningDelta`（text 模式思考在 content 文本里，由 stripThinkBlocks 处理）
