# Design: 助手上下文模型 — 工具调用跨 turn 保留（双层存储）

## 1. 架构与边界

### 1.1 核心思路

工具调用分双层存储，与 ZCode 的"UI 渲染上下文 ≠ agent 上下文"一致：

- **agent 层**（context.json，`AgentContextSnapshot`）：工具调用跟正文同寿命压缩——最近 K 轮原文保留，早期随正文压缩进 summary。agent rebuild 时还原为 tool_call + tool_result message
- **UI 层**（会话消息存储，`ConversationMessageRecord[]`）：工具调用挂在 assistant 消息上，**不压缩**，随消息截到 200 条保留/丢弃。UI 重建历史 tool 节点从此层读，能见到 agent 已压缩丢弃的早期工具调用

两层已存在（正文就是双层），只是都不含工具调用。本任务给两层都加 toolCalls。

### 1.2 边界

- **contracts**：`AgentContextToolCall` 新增；`AgentContextTurnEntry` + `ConversationMessageRecord` 各加可选 `toolCalls`
- **runtime context-lifecycle**：append 接收工具、rebuild 还原工具、压缩适配含工具、估算计入
- **runtime index**：`contextUpdate` 带回工具调用记录
- **platform-host assistant-chat**：`stageAssistantContextFile` 透传工具到 context.json；`saveAssistantSessionMessages` 透传工具到会话消息存储
- **AssistantView / useAssistantTimeline**：加载会话从会话消息存储重建历史 tool 节点
- **master 路径**：完全不变（两结构都不填 toolCalls、rebuild 忽略、压缩叙事梗概）

## 2. 数据结构与契约

### 2.1 AgentContextToolCall（contracts/runtime.ts 新增）

```ts
/** 单个工具调用记录（跨 turn/UI 保留的最小形态）。截断后 observation 带 truncated 标记。 */
export interface AgentContextToolCall {
  /** 工具调用 id（native: toolCallId；text: `tool-${index}`）。UI 去重用。 */
  id: string
  /** 工具名（workspace_read / agent_call / inspect_frontend …）。 */
  name: string
  /** 调用参数（JSON 序列化字符串）。UI 展示 + 压缩 prompt 用。 */
  arguments: string
  /** 工具返回 observation（文本化）。直接存工具返回层结果，持久化层不二次截断。
 *  workspace_read 等有分页的工具返回层已截断（DEFAULT_READ_LIMIT=2000行）+ 带元数据；
 *  agent_call/inspect_frontend 等无分页工具暂不截断（无分页是工具缺陷，后续补齐）。 */
  observation: string
  /** observation 是否被截断。来自工具返回层（如 workspace_read 的 truncated），非持久化层造。 */
  truncated?: boolean
  /** 失败时填（observation 放 error.message）。 */
  failed?: boolean
}
```

### 2.2 两层结构扩展

```ts
// agent 层（contracts/runtime.ts）
export interface AgentContextTurnEntry {
  turn: number
  role: "user" | "assistant"
  content: string
  /** 该 turn 工具调用（仅助手填，master 不填）。 */
  toolCalls?: AgentContextToolCall[]
}

// UI 层（contracts/runtime.ts）
export interface ConversationMessageRecord {
  role: string
  content: string
  attachments?: AttachmentRef[]
  /** assistant 消息的工具调用（仅助手填，挂消息上不占条数）。 */
  toolCalls?: AgentContextToolCall[]
}
```

**不做向后兼容**：无实际数据。toolCalls 可选，parse 时缺失即 undefined，不写降级逻辑。

### 2.3 截断策略（持久化层不截断）

**工具返回层已管控体积的工具**（workspace_read 等）：返回层截断（`DEFAULT_READ_LIMIT=2000` 行 / `MAX_READ_LIMIT=5000` 行）+ 带 `truncated/totalLines/returnedLines/offset` 元数据。agent 续读靠 offset（工具调用层面，现状不变）。持久化层直接存这个已截断的结果，**不二次截断**——二次截断会让 observation 比 agent 当时见到的还少，信息损失。

**无分页机制的工具**（agent_call、inspect_frontend 等）：当前工具返回层不截断，持久化层也不截断。无分页是工具自身缺陷（后续补齐分页机制后自然解决），不在本任务范围。

`AgentContextToolCall.truncated` 字段保留，值来自工具返回层（如 workspace_read 已有 truncated），为后续无分页工具补齐分页时复用。

**两层共用同一 observation 副本**（agent 层 context.json 和 UI 层会话消息存储存一样的 observation）。

## 3. 数据流

### 3.1 turn 结束双层写入

```
callAgentModelWithWorkspaceTools 工具循环
  → 内部 toolCalls 采集器累积（从 observations + callId/name，直接取工具返回层结果，不二次截断）
runAgentRuntimeTurn 结束
  → contextUpdate 增加 toolCalls: AgentContextToolCall[]（工具返回层结果，truncated 来自工具层）
assistant-chat turn 成功
  → ① stageAssistantContextFile → appendTurnToContext(base, turn, user, assistant, toolCalls)
       → context.json recentTurns assistant entry 带 toolCalls（压缩后稳态）
  → ② saveAssistantSessionMessages(fullMessages)
       → fullMessages 的 assistant 条带 toolCalls（UI 层，不压缩，截到 200 条）
```

**采集点**：`callAgentModelWithWorkspaceTools` 内部新增 toolCalls 采集器（独立累积器，不复用 onTool UI 回调）。native + text 统一取文本化 observation。callId：native 原生 toolCallId；text 模式 `tool-${index}`。

**UI 层写入复用现有 `saveAssistantSessionMessages`**：host 已在 turn 成功时调它（assistant-chat.ts:630），只需让 fullMessages 的 assistant 条带 toolCalls。

### 3.2 turn 开头 agent rebuild

```
buildAgentContextMessages(context, isAssistant)
  → isAssistant 且 entry.toolCalls 非空：
      user message(entry.content)
      assistant message(entry.content)
      对每个 toolCall:
        native: assistant.toolCalls[{id,name,arguments}] + tool result message
        text:   assistant content 嵌 <tsian-tool-call> blocks + user message(observation)
  → isAssistant 且无 toolCalls：现状
  → !isAssistant（master）：忽略 toolCalls，现状
```

**native rebuild 类型**（风险点 R1）：`buildAgentContextMessages` 返回 `AiChatMessage[]`，native 需 `RuntimeChatMessage[]`（带 toolCalls）。确认 runtime 层 native 路径喂 callModel 前的转换点。

### 3.3 跨 turn 压缩（agent 层，compressContext 适配）

- `buildCompressionPrompt`：被压缩 entry 的 toolCalls 呈现给压缩 model（name/args/observation 格式化）
- `ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT`：从"丢弃工具调用技术细节"改为"保留已读取关键信息与结论，丢弃协议格式与大段原始内容"
- 保留段（最近 K=5）toolCalls 原文保留（已截断带标记）
- `estimateContextTokens`：计入 toolCalls 的 observation + arguments token
- **UI 层不压缩**，不受此影响
- master 路径（默认 prompt）不变

### 3.4 UI 重建历史 tool 节点（从会话消息存储）

```
AssistantView loadActiveSession / handleSelectSession
  → getAssistantSessionMessages(sid) 读会话消息存储（完整不压缩，含 toolCalls）
  → 对每条 assistant 消息，若 toolCalls 非空，重建 tool 节点到 msg.timeline
  → 历史节点：type:"tool"、collapsed:true、status: success/failed
     id: hist-tool-${turn或index}-${callId}（前缀防冲突）
     output: agent_call 结构化 / 普通工具字符串（TurnToolOutput 形态）
  → 当前 turn 流式节点仍动态产生，历史节点静态重建，合并同一 timeline
```

**数据源 = 会话消息存储**（非 context.json）。因为 context.json 是压缩后稳态，早期工具调用原文已丢；会话消息存储不压缩，能提供完整历史。

**节点 id 防冲突**（风险点 R4）：历史节点 `hist-tool-` 前缀 vs 流式节点 callId。

## 4. 兼容性（不做向后兼容）

- **无实际数据**：不写降级逻辑。toolCalls 缺失即 undefined，无特殊处理。
- **master 不变**：两结构都不填 toolCalls、rebuild 忽略、压缩叙事梗概。
- **schema 不升版本**：`tsian.assistant.context.v1` 保持，toolCalls 可选扩展。
- **双层持久化语义**：
  - agent 层（context.json）：压缩后稳态，工具调用与正文同寿命（最近 K 轮原文、早期进 summary）
  - UI 层（会话消息存储）：不压缩，截到 200 条，工具调用挂 assistant 消息上完整保留
  - 两层分离与 ZCode 一致：UI 完整历史 ≠ agent 压缩管理

## 5. 关键权衡

| 决策 | 选择 | 理由 | 反面 |
|---|---|---|---|
| 存储分层 | 双层（agent压缩 + UI完整） | 与 ZCode UI/agent 分层一致；UI 能见完整历史不受压缩影响 | 两处写入、两结构扩展 |
| UI 层存法 | 挂 assistant 消息上 | 不占消息条数名额，随消息保留/丢弃 | 单条消息体积增大 |
| agent 层结构 | 扩展 recentTurns toolCalls | 集中管理、压缩/重建一处 | recentTurns 单条体积增大 |
| observation 体积 | 持久化层不截断，存工具返回层结果 | workspace_read 返回层已截断+分页，二次截断会信息损失；无分页工具是工具缺陷后续补齐 | 无分页工具大 observation 跨 turn 累积可能爆 token（后续工具补齐分页解决） |
| 截断时机 | 工具返回层（上游既有） | agent 见到的本就是返回层截断后的，续读靠 offset | — |
| UI 重建源 | 会话消息存储 | 完整不压缩，能见早期工具调用 | 不从 context.json（已压缩丢早期） |
| master 不变 | 仅助手路径 | 剧情型工具少、正文是真相 | 两路径分化（schema 值层面已区分） |

## 6. 回滚形态

- contracts：toolCalls 可选，移除即回退
- runtime：采集/rebuild/压缩改动集中在助手分支，master 不动
- host：双层写入是新增透传，移除即回退
- UI：重建历史节点是新增逻辑，移除即回退到 timeline 刷新即丢
- 无不可逆数据迁移

## 7. 风险点

1. **native rebuild message 类型**（R1）：`buildAgentContextMessages` 返回 AiChatMessage[]，native 需 RuntimeChatMessage[]。确认转换点。
2. **采集器独立性**（R2）：用单独累积器，不污染 onTool UI 回调。
3. **压缩 prompt 体积**（R3）：含工具后压缩调用 input token 增大，确认不致失败。
4. **UI 节点 id 冲突**（R4）：历史 `hist-tool-` 前缀 vs 流式 callId。
5. **UI 层消息体积**（R5）：toolCalls 挂消息上，200 条消息含工具后存储体积增大。确认 Dexie meta 存储无硬上限问题（当前 JSON.stringify 整列表存单 key）。
