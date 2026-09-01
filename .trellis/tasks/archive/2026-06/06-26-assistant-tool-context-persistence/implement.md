# Implement: 助手上下文模型 — 工具调用跨 turn 保留（双层存储）

## 实现顺序（自底向上：contracts → runtime → host → UI）

### Step 1: contracts — AgentContextToolCall + 双层结构扩展
- 文件：`packages/contracts/src/runtime.ts`
- 新增 `AgentContextToolCall` interface（id/name/arguments/observation/truncated?/failed?）
- `AgentContextTurnEntry` 增加可选 `toolCalls?: AgentContextToolCall[]`（agent 层）
- `ConversationMessageRecord` 增加可选 `toolCalls?: AgentContextToolCall[]`（UI 层，挂 assistant 消息）
- 验证：contracts 类型导出无断裂，下游 import 正常

### Step 2: context-lifecycle — append 扩展 + 估算计入
- 文件：`apps/platform-web/src/agent-runtime/context-lifecycle.ts`
- `appendTurnToContext` 签名扩展：接收可选 `toolCalls?: AgentContextToolCall[]`，追加到 assistant entry。master 不传 → 不变
- `estimateContextTokens`：计入 entry.toolCalls 的 observation + arguments token
- **不做持久化层截断**：observation 直接存工具返回层结果（workspace_read 返回层已截断+分页，无分页工具后续补齐）
- 验证：append 后 recentTurns assistant entry 带 toolCalls；estimate 含工具

### Step 3: context-lifecycle — buildAgentContextMessages 还原工具调用（agent 层 rebuild）
- 文件：`apps/platform-web/src/agent-runtime/index.ts`（buildAgentContextMessages）
- 助手分支（isAssistant && entry.toolCalls 非空）：
  - native：还原 assistant.toolCalls + tool result message
  - text：assistant content 嵌 `<tsian-tool-call>` blocks + user message(observation)
- master 分支（!isAssistant）：忽略 toolCalls，现状
- **风险点 R1**：确认 native 路径 message 类型转换点（AiChatMessage[] vs RuntimeChatMessage[]）
- 验证：rebuild 后 messages 含历史 tool_call + tool_result

### Step 4: context-lifecycle — compressContext 适配含工具的 recentTurns
- 文件：`apps/platform-web/src/agent-runtime/context-lifecycle.ts`
- `buildCompressionPrompt`：被压缩 entry 的 toolCalls 呈现给压缩 model
- `ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT`：从"丢弃工具调用技术细节"改为"保留已读取关键信息与结论，丢弃协议格式与大段原始内容"
- 保留段（最近 K=5）toolCalls 原文保留
- master 路径（默认 prompt）不变
- 验证：压缩后 summary 含工具关键信息，保留段 toolCalls 完整

### Step 5: runtime index — contextUpdate 带回工具调用
- 文件：`apps/platform-web/src/agent-runtime/index.ts`
- `callAgentModelWithWorkspaceTools` 内部新增 toolCalls 采集器（独立累积器，从 observations + callId/name，直接取工具返回层结果，不二次截断；truncated 来自工具返回层如 workspace_read）
- `runAgentRuntimeTurn` 返回的 `contextUpdate` 增加 `toolCalls?: AgentContextToolCall[]`
- **风险点 R2**：采集器独立，不污染 onTool UI 回调
- native + text 统一取文本化 observation
- 验证：contextUpdate.toolCalls 非空，含本轮所有工具调用（截断后）

### Step 6: host — 双层写入
- 文件：`apps/platform-web/src/platform-host/assistant-chat.ts`
- **agent 层**：`stageAssistantContextFile` 接收 `contextUpdate.toolCalls`，传给 `appendTurnToContext` → context.json
- **UI 层**：`saveAssistantSessionMessages` 的 fullMessages 里 assistant 条带 `toolCalls`（host 已在 turn 成功时调它，assistant-chat.ts:630，只需组装时带上）
- 验证：context.json + 会话消息存储两处都含 toolCalls

### Step 7: UI — 从会话消息存储重建历史 tool 节点
- 文件：`apps/platform-web/src/views/AssistantView.vue` + `useAssistantTimeline.ts`
- `loadActiveSession` / `handleSelectSession`：`getAssistantSessionMessages` 已读回 `ConversationMessageRecord[]`（现在带 toolCalls）
- 对 toolCalls 非空的 assistant 消息，重建 tool 节点到 msg.timeline
- 历史节点：`type:"tool"`、`collapsed:true`、`status: success/failed`、`id: hist-tool-${index}-${callId}`、output 用 TurnToolOutput 形态
- **风险点 R4**：历史节点 id `hist-tool-` 前缀 vs 流式 callId 不冲突
- **数据源 = 会话消息存储**（非 context.json，因 context.json 压缩后丢早期）
- 验证：刷新/重进会话后 timeline 显示历史工具调用（折叠可展开），早期工具调用也可见

### Step 8: 类型检查 + 构建
- `vue-tsc -b apps/platform-web`（repo root：`node_modules/.bin/vue-tsc.CMD -b apps/platform-web`）
- `vite build`（`apps/platform-web && node ../../node_modules/vite/bin/vite.js build`）
- 验证：无类型错误、构建通过

## 验证命令

```bash
cd F:/workspace/Tsian && node_modules/.bin/vue-tsc.CMD -b apps/platform-web
cd F:/workspace/Tsian/apps/platform-web && node ../../node_modules/vite/bin/vite.js build
```

## 回滚点

- Step 1-2 后：contracts + lifecycle，toolCalls 可选，无下游强制。可验证类型
- Step 3-4 后：agent rebuild + 压缩。可验证 agent 上下文行为（无 UI）
- Step 5-6 后：双层落盘闭环。可验证 context.json + 会话消息存储持久化
- Step 7 后：UI 闭环。完整验收
- 任一步失败：toolCalls 可选，移除该步改动即回退

## 风险验证清单（对应 design §7）

- [ ] R1: buildAgentContextMessages native 返回类型——确认 runtime 层转换点
- [ ] R2: 采集器独立性——不污染 onTool UI 回调
- [ ] R3: 压缩 prompt 体积——含工具后压缩调用 input token 可接受
- [ ] R4: UI 节点 id 不冲突——历史 `hist-tool-` 前缀 vs 流式 callId
- [ ] R5: UI 层存储体积——200 条消息含 toolCalls 后 Dexie meta 单 key 体积

## 手动回归（无法自动测）

1. 助手 native：turn A workspace_read 文件 X → turn B agent 不重读直接引用 X 内容
2. 助手 text：同上 tool-call blocks 跨 turn
3. master 剧情流：不受影响
4. agent 压缩触发：被压缩轮次工具进 summary，最近 K 轮工具原文保留
5. UI：刷新/重进会话，历史 tool 节点折叠可展开；早期工具调用也可见（不受 agent 压缩影响）
6. workspace_read 大文件：工具返回层已截断（truncated + totalLines），持久化存截断后结果，agent 续读靠 offset（现状不变）
7. 长会话（>200 条消息）：最早消息含工具调用随消息丢弃，UI 不再显示（与正文同寿命截断）
