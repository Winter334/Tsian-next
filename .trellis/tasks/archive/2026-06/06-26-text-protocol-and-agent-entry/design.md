# Design: 文本协议完善与任意agent入口

## 架构总览

三个方向按依赖序实施：B（文本协议流式）→ C（子代理可见性）→ A（任意 agent 入口）。
B 和 C 都在 agent-runtime + runtime-host 层内闭环，不跨包改契约；A 跨 contracts + runtime-core + platform-web 三层。

```
┌─ contracts ──────────────────────────────────────────────────┐
│  AgentConfig +entryMode +system                               │
│  PlayFrontendBridge +invokeAgent                              │
│  RemotePlayBridgeMethod +"interaction.invokeAgent"            │
│  MessageInteractionRequest 不变 (sendMessage 保持 master 独占) │
│  InvokeAgentRequest / InvokeAgentResult 新增                  │
└───────────────────────────────────────────────────────────────┘
        │
┌─ runtime-core ────────────────────────────────────────────────┐
│  RuntimeEngine +invokeAgent(input): Promise<InvokeAgentResult>│
└───────────────────────────────────────────────────────────────┘
        │
┌─ platform-web / agent-runtime ────────────────────────────────┐
│  context-lifecycle: AGENT_CONTEXT_PATH → agentContextPath(id) │
│  index.ts: text 循环 +onRoundEnd, delegated +onTool, B2/B3    │
│  workspace-tools.ts: stripThinkBlocks 并列 stripToolBlocks     │
└───────────────────────────────────────────────────────────────┘
        │
┌─ platform-web / runtime-host ─────────────────────────────────┐
│  ai.ts: streamAssistantReplyText (新) + 廉价 strip            │
│  engine.ts: invokeAgent 转发                                  │
└───────────────────────────────────────────────────────────────┘
        │
┌─ platform-web / platform-host ────────────────────────────────┐
│  index.ts: invokeAgent handler (按 entryMode 分流)            │
│  bridge: PlayFrontendBridge.invokeAgent 实现                  │
│  remote-iframe-bridge: dispatch + normalize                   │
└───────────────────────────────────────────────────────────────┘
        │
┌─ platform-web / bridge → 游戏前端 ────────────────────────────┐
│  游戏前端调 interaction.invokeAgent({agentId, input})         │
│  返回 { response: string }，不进 runtimeSnapshot              │
└───────────────────────────────────────────────────────────────┘
```

## 方向 B — 文本协议流式

### B1: 解除 streaming 强制 false

**改动文件**: `apps/platform-web/src/config/ai.ts`

- `normalizeStreaming`：移除 `toolCallMode === "text" → return false` 分支。text 和 native 统一逻辑：`input === true || input === "true"`。
- `validateBrowserPlatformConfigDraft`：移除 text+streaming=true 的拦截。
- 存储值推导逻辑（缺失时按 toolCallMode defaulted）改为：native → true, text → **true**（不再强制 false）。或保守：text → false 仍为缺省默认，但用户可显式设 true。倾向后者——避免老 text 配置突然开始流式（端点可能不支持 SSE）。

### B2: text 模式流式实现

**新函数**: `apps/platform-web/src/runtime-host/ai.ts` — `streamAssistantReplyText`

```
streamAssistantReplyText(messages: AiChatMessage[], options): Promise<string>
```

结构镜像 `streamAssistantReplyNative`，差异：
- 入参 `AiChatMessage[]`（text 协议格式，非 `RuntimeChatMessage[]`）
- body：`adapter.buildRequestBody(config, messages)` + `body.stream = true`（不调 `buildStreamRequestBody`，因为后者接受 `RuntimeChatMessage[]`）
- URL：复用 `adapter.buildStreamUrl(config)`（OpenAI/Gemini stream URL 和非 stream URL 相同或只差 query param）
- SSE 解析：复用现有 adapter 的 `extractStreamDelta`（content delta）和 `extractStreamFinish`（按 SSE payload 解析，与 message 格式无关）。text 模式**不用** `extractStreamToolCalls`（工具调用在 content 文本里）和 `extractStreamReasoningDelta`（思考在 content 文本里，由 stripThinkBlocks 处理）。
- 流期：每 delta 累积到 `textBuffer`，调 `onDelta(stripForDisplay(textBuffer), round, "content")`。`stripForDisplay` 是廉价正则——剥离已闭合的 `<tsian-tool-call>` / `<thought>` / `<thinking>` / `` 块，未闭合尾部块保留原文。
- round 结束（SSE close 或 finish reason）：返回完整 `textBuffer`（未剥离，交给 runtime 层 post-hoc 解析）。
- 非流 fallback：endpoint 不返回 `text/event-stream` → 降级到 `generateAssistantReply`（一次性 JSON），无 onDelta。

**gate 改动**: platform-host 三处 `callModel` 闭包（index.ts:786-792 / assistant-chat.ts:473 / frontend-inspector.ts）：
- 当前 text 模式只有 `callModel`（调 `generateAssistantReply`），无流式 gate。
- 改为：text 模式也走 `!options.onDelta || !streamingEnabled` gate。`streamingEnabled` 从 agent config 取。true → `streamAssistantReplyText`，false → `generateAssistantReply`。
- 注意：text 模式的 `callModel` 返回 `Promise<string>`（不像 `callModelNative` 返回 `ModelCallResult`），`streamAssistantReplyText` 也返回 `Promise<string>`，签名兼容。

**runtime 层改动**: `agent-runtime/index.ts` text 工具循环（1812 起）：
- `capabilities.callModel(nextMessages, options)` 的 options 里绑 `onDelta`：`(delta, _round, kind) => { if (kind === "content" && options.onDelta) options.onDelta(agentContext.agent.id, delta, round, "content") }`。
- text 模式 onDelta 的 `kind` 只有 `"content"`（text 协议无独立 reasoning stream；思考内容在 content 文本里，被 stripForDisplay 剥离）。

### B3: 思维块剥离

**新函数**: `apps/platform-web/src/agent-runtime/workspace-tools.ts`（或 index.ts，与 `stripRuntimeWorkspaceToolCallBlocks` 同文件）

```typescript
const THINK_BLOCK_PATTERNS = [
  /<thought>\s*([\s\S]*?)\s*<\/thought>/g,
  /<thinking>\s*([\s\S]*?)\s*<\/thinking>/g,
  /<think>\s*([\s\S]*?)\s*<\/think>/g,
]

function stripThinkBlocks(text: string): string {
  return THINK_BLOCK_PATTERNS.reduce((acc, re) => acc.replace(re, ""), text).trim()
}
```

- **调用点**: text 模式 round 结束，对完整 `response` 先 `stripRuntimeWorkspaceToolCallBlocks` 再 `stripThinkBlocks`，得到喂回模型的干净 content。与现有工具块剥离并列，不互相依赖。
- **native 模式不调此函数**——native 的 reasoning 走 provider 专属字段，不进 `result.text`。
- **stripForDisplay**（B2 用的廉价显示 strip）复用同一组正则 + 工具块正则，在流期对累积 buffer 调用。

### B4: 渲染分工

- **sendMessage / invokeAgent 回复**：平台返回原始 `replyText`（runtime 层 `stripThinkBlocks` 只用于喂回模型，不修改返回给调用方的文本）。游戏前端自己解析渲染。
- **助手 UI**：`useAssistantTimeline` 在 text 模式下，round 结束时从 `streamingText`（已含 stripForDisplay 后的文本）构建 interim/thought 节点。thought 节点需要从原始 buffer 提取思考块内容（非剥离后的文本）——这意味着 `streamAssistantReplyText` 的 onDelta 需要额外提供"被剥离的思考内容"供 UI 构建 thought 节点，或者在 round 结束时从完整 buffer 提取。
- 倾向：round 结束时，runtime 层从完整 `response` 提取 think 块内容 → 推入 `collectedProcessNodes` 的 thought 节点（与 native 模式的 thought 节点同构）。UI 拿到 thought 节点直接渲染，不需要从 onDelta 解析。

## 方向 C — text 模式子代理可见性

### C1: 补发 onRoundEnd

**改动文件**: `agent-runtime/index.ts` text 工具循环（1857-2121）

- round 结束（`toolCalls.length === 0` → stop，或有 toolCalls → tool_calls）时，发 `options.onRoundEnd?.(agentContext.agent.id, round, finishReason)`。
- finishReason 判定：`toolCalls.length > 0` → `"tool_calls"`；`toolCalls.length === 0` → `"stop"`。
- 插入位置：在 `executeRuntimeWorkspaceToolCalls` 之前（解析出 toolCalls 后、执行前）发 tool_calls 的 onRoundEnd；在 return 之前（stop 轮）发 stop 的 onRoundEnd。

### C2: delegated 路径补绑 onTool

**改动文件**: `agent-runtime/index.ts` text 工具循环

- 当前 entry 路径已绑 onTool（2054-2067）。delegated 路径走同一条 `callAgentModelWithWorkspaceTools` 函数，onTool 绑定是同一处代码——实际上 entry 和 delegated 共用 text 循环，onTool 绑定不区分 entry/delegated。
- **待验证**：delegated 路径是否真的没绑 onTool，还是注释过时。从探索结果看 text 循环的 onTool 绑定（2054）是无条件的（不检查 isEntry），所以 delegated 路径**已经绑了**。注释 "text-protocol delegated agents stay silent" 可能指的是 onDelta/onRoundEnd 没发（C1 补的），不是 onTool。
- 如果 onTool 已绑：C2 实际工作量 = 0，只需更新注释。如果未绑：补绑。

### C3: onDelta 不发

- text 流式由 B2 处理。onDelta 的增量 delta 由 `streamAssistantReplyText` 的 onDelta → runtime 层透传 → UI streamingText 累积。这是**entry 路径**。
- **delegated 路径**：delegated agent 的 `callModel` 闭包不绑 onDelta（与 native 模式一致——delegated 不流式到 UI）。text 模式 delegated 也走非流 `generateAssistantReply`，无 onDelta。过程可见性靠 C1 的 onRoundEnd + 已绑的 onTool。

## 方向 A — 任意 agent 为入口

### A1-A3: AgentConfig 契约 + registry 扩展

**contracts/src/runtime.ts**:
```typescript
export interface AgentConfig {
  // ...existing fields...
  /** 入口模式：persistent 建 context.json 跨 turn 累积；ephemeral 调完即弃。缺省 persistent。 */
  entryMode?: "persistent" | "ephemeral"
  /** 系统级 agent 标记：前端禁删禁改名禁改 id。master + assistant 标 true。 */
  system?: boolean
}
```

**agent-runtime/registry.ts** `buildAgentRegistryEntry`:
- 解析 `config.entryMode`（`jsonString` + 校验枚举，缺省 `"persistent"`）
- 解析 `config.system`（`value === true`，缺省 `false`）
- 挂到 `AgentRegistryEntry`

**AgentRegistryEntry**（contracts）新增 `entryMode` 和 `system` 字段。

**默认 agent.json seed**（workspace.ts / local-assistant-files.ts）:
- master: 加 `"entryMode": "persistent", "system": true`
- assistant: 加 `"entryMode": "persistent", "system": true`
- retrieval/post-processing: 不加 entryMode（缺省 persistent）或显式 `"ephemeral"`（取决于是否希望它们作为独立入口——当前它们只被 master agent_call 调用，不作为入口，entryMode 不影响 agent_call 路径）

### A4: context 落盘路径泛化

**context-lifecycle.ts**:
```typescript
// 旧：export const AGENT_CONTEXT_PATH = "save/agents/master/context.json"
// 新：
export function agentContextPath(agentId: string): string {
  return `save/agents/${agentId}/context.json`
}
// 向后兼容：master 路径不变（agentContextPath("master") === 旧常量值）
```

**history-turns.ts**:
- `readAgentContextFromWorkspace(files, agentId)` — 参数化 agentId，用 `agentContextPath(agentId)` find 文件
- `stageAgentContextFile(transaction, updated, agentId)` — 参数化 agentId，用 `agentContextPath(agentId)` write
- 现有调用点（index.ts:743/896）传 `"master"`，行为不变

**ephemeral 入口**：invokeAgent handler 不调 `readAgentContextFromWorkspace` / `stageAgentContextFile`，不传 `agentContext` 给 `runAgentRuntimeTurn`（走兜底 `createInitialAgentContext` 从 recentHistory 重建，或不传 agentContext 让 runtime 用 recentHistory 兜底）。

### A5-A6: bridge invokeAgent

**contracts/src/runtime.ts**:
```typescript
export interface InvokeAgentRequest {
  agentId: string
  input: string
}

export interface InvokeAgentResult {
  response: string
}
```

**contracts/src/bridge.ts**:
```typescript
export interface InteractionBridge {
  sendMessage(input: MessageInteractionRequest): Promise<MessageInteractionResult>
  invokeAgent(input: InvokeAgentRequest): Promise<InvokeAgentResult>
}

export type RemotePlayBridgeMethod =
  | "runtime.getRuntimeSnapshot"
  | "interaction.sendMessage"
  | "interaction.respond"
  | "interaction.invokeAgent"  // 新增
  | "query.query"
  | "platform.getPlatformContext"
  | "platform.runAction"
```

**runtime-core/src/engine.ts**:
```typescript
export interface RuntimeEngine {
  // ...existing...
  invokeAgent(input: InvokeAgentRequest): Promise<InvokeAgentResult>
}
```

**platform-host/index.ts** — 新增 invokeAgent handler:
- 不走 save 事务（ephemeral）或走轻量 save 事务（persistent，需落 context.json）
- 不推进 turn 计数
- 不写历史 turn 文件
- 不更新 runtimeSnapshot
- 按 agentId 装配 entry context（`assembleAgentContext`）→ 检查 agent 存在 → 按 entryMode 决定 context 处理 → 调 `runAgentRuntimeTurn` → 返回 `{ response: replyText }`
- 流式回调（onDelta/onRoundEnd/onTool）可选——invokeAgent 是旁路调用，UI 可见性由调用方决定。倾向：**不绑 onDelta**（旁路调用不流式到主 UI），但可绑 onTool/onRoundEnd 供调用方自选处理（通过返回值或事件）。

**remote-iframe-bridge.ts**:
- `REMOTE_PLAY_BRIDGE_METHODS` 加 `"interaction.invokeAgent"`
- `dispatchRemoteBridgeRequest` 加 `if (method === "interaction.invokeAgent")` 分支
- `normalizeInvokeAgentRequest` 校验 agentId 非空 + input 非空

**bridge/play-frontend-bridge.ts**:
- `interaction.invokeAgent(input)` → `engine.invokeAgent(input)`

### A7: system 标记 + 工作室入口标记

**现状**：工作室（StudioView.vue）agent 面板编辑器是 `readonly`（第 119 行），无删除按钮、无重命名入口、无 id 编辑。唯一操作是"打开目录" + skill 勾选。助手 agent 没有直接的用户编辑界面，大部分时候自我维护（通过 workspace_read/write）。

**`system` 标记定位**：信息字段，不是 UI 硬拦截开关。
- agent.json 里 `system: true`（master + assistant），registry 暴露它。
- 主要消费者：助手 agent 通过 `workspace_read` 读到 agent.json 后，理解 master/assistant 是系统级、不可随意改名/删除。这是 AGENT.md/SOUL.md 认知层面的引导，不是平台权限层硬拦截。
- 工作室不需要做硬拦截（因为没有删除/改名入口可拦截）。
- 未来若加 agent 管理 UI（创建/删除/改名），`system` 字段已就位，前端可据此禁操作。

**工作室入口标记**：StudioView agent 列表（第 53-77 行）可显示 `entryMode` 标记：
- persistent 入口 agent 显示"入口"标记（可被 invokeAgent 直接调用）
- ephemeral/工具 agent 不显示（或显示"工具"标记）
- 轻量展示增强，不改现有交互逻辑。

**后端 workspace write 不拦截 system agent 修改**：visible = editable 原则不变。master 的 agent.json 是文件，助手 agent（level 4）有权 workspace_write 它——`system` 标记是认知引导，不是权限门。

## 兼容性与迁移

- **agent.json 无 entryMode/system**：缺省 persistent + system false。旧存档的 agent.json 不需迁移，行为不变。
- **AGENT_CONTEXT_PATH 常量删除**：所有引用改为 `agentContextPath("master")`，master 路径值不变。需检查全仓是否有其他引用点（探索确认仅 history-turns.ts + index.ts import）。
- **text 模式 streaming 默认值**：保守方案——text 缺省仍 false，用户显式设 true 才流式。老配置不突然变流式。
- **MessageInteractionRequest 不变**：sendMessage 签名不变，master 叙事回合不受影响。
- **invokeAgent 新增 method**：游戏前端需用新版 bridge SDK 才能调用。老前端不调即不受影响。

## 数据流

### sendMessage（不变）
```
游戏前端 → interaction.sendMessage({content})
→ engine.sendMessage → platform-host handler
→ runAgentRuntimeTurn({agentId:"master", ...})  // 硬编码 master，不变
→ save 事务落盘 context.json + history turn
→ 返回 {snapshot}
```

### invokeAgent（新增）
```
游戏前端 → interaction.invokeAgent({agentId, input})
→ engine.invokeAgent → platform-host handler
→ assembleAgentContext({agentId})  // 任意 agent
→ if persistent: read context.json (agentContextPath(agentId))
→ runAgentRuntimeTurn({agentId, input, agentContext?})
→ if persistent: write context.json (agentContextPath(agentId))
→ 返回 {response: replyText}  // 不进 snapshot，不推 turn
```

### text 模式流式（新增）
```
streamAssistantReplyText(messages, {onDelta})
→ SSE 流 → 每 delta:
  textBuffer += delta
  onDelta(stripForDisplay(textBuffer), round, "content")
→ SSE 结束:
  return textBuffer  // 完整未剥离
→ runtime text 循环 round 结束:
  toolCalls = parseRuntimeWorkspaceToolCalls(response)
  cleanContent = stripThinkBlocks(stripRuntimeWorkspaceToolCallBlocks(response))
  onRoundEnd(agentId, round, finishReason)
  → 喂回模型: cleanContent (不含工具块/思考块)
  → UI thought 节点: 从 response 提取 think 块内容
```
