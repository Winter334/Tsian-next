# Design：扁平化 timeline 模型

## 架构总览

```
┌─────────────────────────────────────────────────────────┐
│  contracts (TurnTimelineItem)                           │
│  单一判别联合：user | assistant | interim | thought |    │
│               tool | options                            │
└──────────────┬──────────────────────────────────────────┘
               │
      ┌────────┴────────┐
      ▼                 ▼
┌───────────┐    ┌──────────────┐
│ 持久化面 1 │    │ 持久化面 2   │
│ turn 文件  │    │ assistant    │
│ schema v2  │    │ 会话存储     │
└─────┬─────┘    └──────┬───────┘
      │                 │
      ▼                 ▼
┌─────────────┐  ┌────────────────┐
│ play-frontend│  │ desktop        │
│ renderSession│  │ AssistantView  │
│ History      │  │ (mapper 双向)  │
│ + streaming  │  │                │
└─────────────┘  └────────────────┘
```

## 核心契约变更

### TurnTimelineItem（新增，替代 messages + processNodes）

```typescript
// packages/contracts/src/runtime.ts

export type TurnTimelineItem =
  | { kind: "user"; content: string; attachments?: AttachmentRef[] }
  | { kind: "assistant"; content: string; stats?: TurnStats }
  | { kind: "interim"; id: string; round: number; agentId?: string;
      text: string; collapsed: boolean }
  | { kind: "thought"; id: string; round: number; agentId?: string;
      text: string; collapsed: boolean }
  | { kind: "tool"; id: string; round: number; agentId?: string;
      name: string;
      status: "loading" | "running" | "success" | "failed";
      output?: TurnToolOutput; collapsed: boolean }
  | { kind: "options"; items: string[] }
```

设计要点：
- **有序数组**：数组顺序 = 真实发生顺序，渲染器不需要理解 round 语义
- **user/assistant 是 timeline 一等公民**：不再是独立的 messages 数组，穿插在 process items 中
- **options 持久化**：`{kind:"options", items}` 入 timeline，reload 天然恢复
- **stats 归 assistant item**：渲染时遍历到 assistant item 就地取，消除 entry 层关联
- **无 ask 变体**：ask 仅存在于内存 `AssistantTimelineNode`，持久化边界拍平 interim

### SessionHistoryEntry（改）

```typescript
// packages/contracts/src/bridge.ts

export interface SessionHistoryEntry {
  turn: number
  createdAt: string
  timeline: TurnTimelineItem[]  // 替代 messages + processNodes + stats
}
```

### ConversationMessageRecord（改）

```typescript
// packages/contracts/src/runtime.ts

export interface ConversationMessageRecord {
  role: string
  content: string
  attachments?: AttachmentRef[]
  toolCalls?: AgentContextToolCall[]
  // processNodes 字段删除 —— 被 timeline 取代
  timeline?: TurnTimelineItem[]  // 新增：assistant 消息带 timeline 片段
}
```

assistant 会话存储保持 per-message 结构，但 `processNodes` → `timeline`。

### TurnProcessNode（删除）

collector 直接产出 `TurnTimelineItem[]`（process items），不再经过 `TurnProcessNode` 中间类型。

## 数据流（改造后）

### 写入路径（master turn 收尾）

```
turn-timeline-collector.getTimelineItems()
  → TurnTimelineItem[] (process items: interim/thought/tool)
host index.ts 拼接完整 timeline:
  [{kind:"user",content}, ...processItems, {kind:"assistant",content,cleanReply,stats}, {kind:"options",items}]
  → stageRawAirpHistoryTurnFile({ turn, entryAgentId, timeline, stats? })
  → serialize → turn-NNNNNN.json (schema v2)
```

### 写入路径（assistant turn 收尾）

```
agent-runtime contextUpdate.timelineItems → TurnTimelineItem[] (process items)
assistant-chat.ts 拼接:
  history (已存 timeline) + 本轮 user + 本轮 assistant (带 timeline 片段)
  → saveAssistantSessionMessages
  → assistant-conversations normalizeMessages (保留 timeline 字段)
```

### 读取路径（play-frontend reload）

```
query.query({resource:"session-history"})
  → getSessionHistoryFromTurnFiles
  → SessionHistoryEntry[] { turn, createdAt, timeline }
  → createSessionHistory (SDK)
  → renderSessionHistory: for each entry, for each item in timeline:
      switch(item.kind) {
        case "user":      → renderUserMsg(item)
        case "assistant": → renderAssistantMsg(item) + stats meta
        case "interim":   → renderProcessNode(item)
        case "thought":   → renderProcessNode(item)
        case "tool":      → renderProcessNode(item)
        case "options":   → renderStoryOptions(item.items)
      }
```

### 读取路径（agent 注入，getHistoryFromTurnFiles）

```
parse turn files → 从 timeline 过滤 {kind:"user"|"assistant"}
  → 映射成 ConversationMessageRecord[] (干净正文，跳过 process items)
```

### 读取路径（assistant 刷新/重进）

```
getAssistantSessionMessages → normalizeMessages (保留 timeline)
  → mapStoredMessagesToChat: 从 msg.timeline (TurnTimelineItem[]) 重建 AssistantTimelineNode[]
  → AssistantView 渲染 timeline (含 ask 内存节点从 interim 文本还原)
```

## 持久化格式变更

### turn 文件 schema v2

```json
{
  "schema": "tsian.airp.history.turn.v2",
  "turn": 1,
  "createdAt": "2026-06-27T...",
  "source": { "kind": "agent-runtime", "entryAgentId": "master" },
  "timeline": [
    { "kind": "user", "content": "你好" },
    { "kind": "interim", "id": "interim-r1", "round": 1, "text": "让我看看...", "collapsed": false },
    { "kind": "thought", "id": "thought-r1", "round": 1, "text": "...", "collapsed": true },
    { "kind": "tool", "id": "call-1", "round": 1, "name": "workspace_read", "status": "success", "collapsed": true },
    { "kind": "assistant", "content": "你好！...", "stats": { "inputTokens": 100, "outputTokens": 50 } },
    { "kind": "options", "items": ["选项A", "选项B"] }
  ]
}
```

### assistant 会话存储

per-message 结构不变，但 assistant 消息的 `processNodes` 字段 → `timeline` 字段：

```json
[
  { "role": "user", "content": "..." },
  {
    "role": "assistant",
    "content": "...",
    "toolCalls": [...],
    "timeline": [
      { "kind": "interim", "id": "...", "round": 1, "text": "...", "collapsed": false },
      { "kind": "tool", "id": "...", "round": 1, "name": "...", "status": "success", "collapsed": true }
    ]
  }
]
```

注意：assistant 会话存储的 timeline 只含 process items（不含 user/assistant items，因为消息本身就是 user/assistant）。turn 文件的 timeline 含全部 items（user + process + assistant + options）。这是两个持久化面的语义差异——assistant 会话存储是 per-message 的，message 本身就是 user/assistant，timeline 挂在 assistant message 上只是过程节点。

## 关键设计决策

### D1：collector 直接产出 TurnTimelineItem，删除 TurnProcessNode

**理由**：collector 已经按正确顺序累积，只需改输出类型名（`type` → `kind`）。减少一层 `TurnProcessNode → TurnTimelineItem` 的类型转换。`AssistantTimelineNode` 保留（内存类型，含 ask），在 mapper 边界转 `TurnTimelineItem`。

**trade-off**：`TurnProcessNode` 被 collector 和 composable 共用。删除后 composable 的 `AssistantTimelineNode` 与 contracts 的 `TurnTimelineItem` 不再同构（AssistantTimelineNode 有 ask，TurnTimelineItem 有 user/assistant/options）。但 mapper 边界本来就需要转换（ask → interim 拍平），所以不增加复杂度。

### D2：stats 归 assistant item，不入 entry 层

**理由**：渲染时遍历到 assistant item 就地取 stats，消除 entry.stats 与 assistant message 的关联跳跃。streaming 路径 turnState.stats 仍在 finalizeTurn 时渲染到 streamBody，与 rebuild 路径一致（遍历到 assistant item 时取 stats）。

### D3：options 入 timeline 持久化

**理由**：reload 时从 timeline 的 `{kind:"options"}` item 渲染按钮，天然恢复。不再仅靠运行时 `turn-options` 事件 + pendingOptions 缓存。turn-completed 时 finalizeTurn 仍用 pendingOptions 就地渲染（事件先于 completed 到达），reload 时从 timeline 读。**两条来源都支持**。

**trade-off**：options 写入 turn 文件意味着选项内容持久化。但选项本就是 AI 输出的一部分（在 `[[选项]]` 块里），host 已经 strip 出来，写入 timeline 只是换了个存储位置。

### D4：assistant 会话存储 timeline 只含 process items

**理由**：per-message 结构中 message 本身就是 user/assistant，timeline 挂在 assistant message 上只需存过程节点。与 turn 文件的"全量 timeline"语义不同但各自自洽。

### D5：不做 v1 兼容

**理由**：用户确认无真实数据，全是测试数据。v1 parse 返回 null 被当损坏跳过，简单干净。

## 渲染统一

### play-frontend renderSessionHistory（rebuild）

```typescript
function renderSessionHistory(entries: SessionHistoryEntry[]): void {
  $story.innerHTML = ""
  const inner = document.createElement("div")
  inner.className = "story-inner"
  for (const entry of entries) {
    for (const item of entry.timeline) {
      switch (item.kind) {
        case "user":      inner.appendChild(renderUserMsg(item)); break
        case "assistant": inner.appendChild(renderAssistantMsg(item)); break
        case "interim":
        case "thought":
        case "tool":      inner.appendChild(renderProcessItem(item)); break
        case "options":   inner.appendChild(renderOptionsZone(item.items)); break
      }
    }
  }
  $story.appendChild(inner)
}
```

### play-frontend streaming（不变的核心逻辑）

streaming 仍用 `beginTurn` 建 processZone + streamEl，`finalizeRound` 按 round 穿插插入 process items 到 `turnState.timeline`。`finalizeTurn` 就地修正流式 DOM。**关键变化**：turn 收尾后不再需要 reloadHistory，因为重建现在也顺序正确了——但保持现状（turn-completed 不 rebuild），因为 in-place 更高效。

### renderProcessItem（共享渲染函数）

`renderTimeline` 改名为 `renderProcessItems`，接受 `TurnTimelineItem[]`（过滤出 process items），逻辑不变（同 round 连续普通 tool 合并）。streaming 和 rebuild 共用。

## 兼容性与回滚

- 无向后兼容（v1 文件 parse 跳过）
- 回滚：git revert 即可，无数据迁移
- 风险点：contracts 类型变更影响面广，需逐层 build 验证
