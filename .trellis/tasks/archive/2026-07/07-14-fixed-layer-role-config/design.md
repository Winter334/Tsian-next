# Design：固定注入层 role 可配置

## 架构概述

在 agent.json 新增 `messageLayers` 可选字段，配置 4 个固定注入层的 role。固定层消息产出时加 `<!-- tsian-layer: xxx -->` 前缀，locateHistorySpan 改为按前缀识别边界（不依赖 role）。发送给模型前，`stripInternalMarkers` 剥离所有内部标记前缀（`<!-- tsian-layer: -->` 和 `<!-- source: -->`）。

## 数据契约变更

### MessageLayerConfig / MessageLayersConfig（packages/contracts/src/runtime.ts）

```typescript
/** 单个固定注入层的 role 配置。 */
export interface MessageLayerConfig {
  /** 注入消息角色。不写则保持该层默认 role。 */
  role?: "system" | "user" | "assistant"
}

/** 固定注入层 role 配置。所有字段可选，不写 = 该层保持默认 role。 */
export interface MessageLayersConfig {
  /** 早期剧情/任务摘要。默认 role: user */
  historySummary?: MessageLayerConfig
  /** Agent 上下文元信息。默认 role: user */
  workspaceContextMeta?: MessageLayerConfig
  /** 工具记忆日志（task-mode 助手）。默认 role: user */
  toolMemory?: MessageLayerConfig
  /** 当前回合号。默认 role: user */
  turnRuntime?: MessageLayerConfig
}
```

### AgentConfig 加字段

```typescript
export interface AgentConfig {
  // ... 现有字段不变 ...
  /** 固定注入层的 role 配置。可选，不写则全部默认。 */
  messageLayers?: MessageLayersConfig
}
```

### AgentRegistryEntry 加字段

```typescript
export interface AgentRegistryEntry {
  // ... 现有字段不变 ...
  /** 解析后的固定层 role 配置。空对象 = 全部默认。 */
  messageLayers: MessageLayersConfig
}
```

## 层标记前缀

### 标记规则

| 消息类型 | 前缀 | 备注 |
|---|---|---|
| systemPrompt | 无 | 始终 index 0，无前缀 |
| before-history 注入 | `<!-- source: xxx -->` | 已有，不改 |
| history（summary + recentTurns） | 无 | 不改，history 段无前缀 |
| workspaceContextMeta | `<!-- tsian-layer: workspace-context-meta -->` | 新增 |
| workspace-context 注入 | `<!-- source: xxx -->` | 已有，不改 |
| toolMemory | `<!-- tsian-layer: tool-memory -->` | 新增 |
| turnRuntime | `<!-- tsian-layer: turn-runtime -->` | 新增 |
| playerInput | `<!-- tsian-layer: player-input -->` | 新增 |
| after-input 注入 | `<!-- source: xxx -->` | 已有，不改 |
| tail 注入 | `<!-- source: xxx -->` | 已有，不改 |

### 标记常量

```typescript
const LAYER_PREFIX = "<!-- tsian-layer:"
const WORKSPACE_CONTEXT_META_TAG = "<!-- tsian-layer: workspace-context-meta -->"
const TOOL_MEMORY_TAG = "<!-- tsian-layer: tool-memory -->"
const TURN_RUNTIME_TAG = "<!-- tsian-layer: turn-runtime -->"
const PLAYER_INPUT_TAG = "<!-- tsian-layer: player-input -->"
```

## locateHistorySpan 重构

### 当前逻辑（要改的）

```
start:
  - messages[0].role === "system"（L323）
  - 跳过 <!-- source: 前缀消息
  - role === "user" && startsWith("最近对话：") / startsWith("调用方 Agent：") → {-1,-1}（L345/L352）

end:
  - role === "user" && startsWith(5个锚点前缀之一)（L357-368）
```

### 新逻辑

```
start:
  - messages[0] 存在（去掉 role 检查，systemPrompt 始终在 index 0 且不可禁用）
  - 从 index 1 跳过 <!-- source: 前缀消息（before-history 注入）
  - 第一条无前缀消息 = history 起点
  - 兜底：startsWith("最近对话：") / startsWith("调用方 Agent：") → {-1,-1}（去掉 role 检查）

end:
  - 从 start+1 扫描，第一条以 <!-- tsian-layer: 开头的消息 = history 终点
  - 去掉 role 检查，去掉 5 个内容锚点前缀列表
```

### 为什么安全

- history 段消息（summary + recentTurns）无前缀，不会误匹配 `<!-- tsian-layer:`
- `<!-- tsian-layer:` 是唯一的内部标记，contextPath 注入内容不可能以这个开头（它以 `<!-- source:` 开头）
- systemPrompt 无前缀但在 index 0，start 从 index 1 开始扫描，不会误匹配

## stripInternalMarkers 函数

```typescript
/**
 * 剥离消息内容中的内部标记前缀（<!-- tsian-layer: --> 和 <!-- source: -->）。
 * 在 mergeConsecutiveRoleMessages 之后、API 调用之前执行。
 * 只处理 string content，不处理 ContentPart[]（多模态）。
 */
function stripInternalMarkers(messages: RuntimeChatMessage[]): RuntimeChatMessage[] {
  return messages.map(msg => {
    if (typeof msg.content !== "string") return msg
    const stripped = msg.content
      .replace(/^<!-- tsian-layer: [^>]* -->\n?/m, "")
      .replace(/^<!-- source: [^>]* -->\n?/m, "")
    return { ...msg, content: stripped }
  })
}
```

注意：strip 只剥离消息**开头**的标记前缀（`^` 锚点），不剥离消息内部的注释（如 contextPath 内容里可能合法包含的 HTML 注释）。

## 消息构建改造

### buildAgentContextMessages（index.ts:273-292）

```typescript
function buildAgentContextMessages(
  context: AgentContextSnapshot,
  isAssistant: boolean,
  historySummaryRole?: "system" | "user" | "assistant",
): RuntimeChatMessage[] {
  const messages: RuntimeChatMessage[] = []
  const summaryRole = historySummaryRole ?? "user"
  if (context.summary) {
    const summaryLabel = isAssistant ? "早期任务摘要" : "早期剧情摘要"
    messages.push({ role: summaryRole, content: `${summaryLabel}：\n${context.summary}` })
  }
  // recentTurns 保持原始 entry.role，不改
  // 空占位保持 summaryRole
  return messages
}
```

### buildAgentContextMessages_split（index.ts:779-790）

```typescript
function buildAgentContextMessages_split(
  context: AgentContextEntry,
  label: "Workspace Agent 上下文" | "目标 Agent 上下文",
  metaRole?: "system" | "user" | "assistant",
): RuntimeChatMessage[] {
  const role = metaRole ?? "user"
  const messages: RuntimeChatMessage[] = [
    { role, content: `${WORKSPACE_CONTEXT_META_TAG}\n${label}（元信息）：\n${formatAgentRuntimeContextMeta(context)}` },
  ]
  messages.push(...contextInjectionsToMessages(context.contextInjectionsByPosition["workspace-context"]))
  return messages
}
```

### buildEntryAgentMessages（index.ts:906-997）

读取 `context.agent.messageLayers`，提取各层 role：

```typescript
const ml = context.agent.messageLayers
const historySummaryRole = ml.historySummary?.role
const metaRole = ml.workspaceContextMeta?.role
const toolMemoryRole = ml.toolMemory?.role ?? "user"
const turnRuntimeRole = ml.turnRuntime?.role ?? "user"
```

改动点：
- historyMessages 传 `historySummaryRole`
- workspace-context split 传 `metaRole`
- toolMemory 消息加 `TOOL_MEMORY_TAG` 前缀 + 用 `toolMemoryRole`
- turnRuntime 消息加 `TURN_RUNTIME_TAG` 前缀 + 用 `turnRuntimeRole`
- playerInput 消息加 `PLAYER_INPUT_TAG` 前缀

### buildDelegatedAgentMessages（index.ts:1094-1176）

同样从 `targetContext.agent.messageLayers` 读取配置，应用到对应固定层。

## 发送前处理链

```
构建消息数组（带 <!-- tsian-layer: --> 和 <!-- source: --> 前缀）
  ↓
locateHistorySpan（在前缀数组上操作，按层标记找边界）
  ↓
replaceHistorySpan（splice-replace，重建消息也带前缀）
  ↓
mergeConsecutiveRoleMessages（合并连续同 role，前缀保留在内容里）
  ↓
stripInternalMarkers（剥离前缀，产出干净消息）
  ↓
发送给模型 API
```

### 调用位置

- native 路径：`callAgentModelWithWorkspaceToolsNative`（L1653 附近），在 `mergeConsecutiveRoleMessages` 之后加 `stripInternalMarkers`
- text 路径：`callAgentModelWithWorkspaceTools`（L2057 附近），同理

## registry.ts 解析

`buildAgentRegistryEntry` 中：
```typescript
messageLayers: config.messageLayers ?? {}
```

透传，不做深层校验（校验在 local-assistant-files.ts）。

## local-assistant-files.ts 验证

`validateAgentConfig` 中：如果 `messageLayers` 存在，验证它是对象，每个子项（如果存在）的 `role` 是 `"system" | "user" | "assistant"`。非法值 → 警告。

## 缓存影响

- 剥离前缀后发送给模型的消息内容变了（少了前缀行），但前缀内容是稳定的（每次都一样），所以前缀缓存命中不受影响——缓存匹配的是 token 序列，前缀部分不变。
- role 配置改变后，消息的 role 序列变了，可能影响缓存命中。但这是用户选择改 role 的预期后果。

## 兼容性

| 场景 | 行为 |
|---|---|
| 现有 agent 无 messageLayers | 全部默认 role，消息序列与当前一致 |
| 现有 agent 无 messageLayers | locateHistorySpan 新逻辑：start 从 index 1 跳过 `<!-- source:`，end 找 `<!-- tsian-layer:`。因为固定层现在带前缀了，行为等价 |
| 消息内容变化 | `<!-- source: -->` 前缀被剥离，模型看到的内容变了（少了前缀行），但语义不变 |
