# 扁平化 timeline 模型替代 messages+processNodes 分裂结构

## Goal

用单一有序 `TurnTimelineItem[]` 数组替代 `SessionHistoryEntry` 的 `messages: ConversationMessageRecord[]` + `processNodes: TurnProcessNode[]` 分裂结构，彻底解决 turn 重建时过程节点顺序错乱问题。

### 用户价值

- 重载/回溯后，过程节点（thought/tool/interim）保持与流式时一致的穿插顺序，不再整块堆到 assistant 正文前
- 剧情选项按钮（story options）重载后天然恢复，不再因重建 DOM 被冲掉
- streaming 和 rebuild 两条渲染路径统一为"从 timeline 逐项渲染"，消除分叉风险

## Confirmed Facts（代码探索确认）

### 根因

`messages + processNodes` 分裂结构只能表达 `user → [processNodes 整块] → assistant`，无法表达真实穿插顺序 `user → interim-r1 → thought-r1 → tool-r1 → … → assistant 最终正文`。processNodes 永远是一整块。

两条渲染路径（streaming in-place vs rebuild from file）完全独立，靠人保证一致，已经分叉出 bug（重建把 processNodes 整块排到正文前 + 冲掉选项按钮）。

### 数据流（当前）

1. `turn-timeline-collector.ts` 按 round 正确穿插累积 `TurnProcessNode[]`
2. host `history-turns.ts` 序列化为 `{ messages: [user, assistant], processNodes: [...] }` —— 两个独立数组
3. `getSessionHistoryFromTurnFiles` 返回 `SessionHistoryEntry { messages, processNodes }`
4. play-frontend `renderSessionHistory` 手动拼 `user → [processNodes 整块] → assistant`
5. streaming `beginTurn` 建 `processZone + streamEl`，`finalizeRound` 按 round 穿插插入

### 两个持久化面

1. **workspace turn 文件** `save/history/turns/turn-NNNNNN.json`（schema `tsian.airp.history.turn.v1`）—— play-frontend 路径
2. **assistant 会话存储** `ConversationMessageRecord.processNodes`（Dexie `localDb.meta`）—— desktop Assistant 路径

### 受影响消费端

- `SessionHistoryEntry`：play-frontend main.ts、DebugView.vue、play-bridge session-history.ts
- `TurnProcessNode`：turn-timeline-collector、agent-runtime index/turn-types、assistant-chat、assistant-message-mappers、assistant-conversations、play-frontend main.ts
- `ConversationMessageRecord.processNodes`：assistant-conversations normalizeMessages、assistant-message-mappers 双向映射

### 不受影响

- **agent 上下文完全不受影响**——两条历史注入路径都不碰 processNodes/timeline：
  - 主路径 `buildAgentContextMessages`：数据源 `AgentContextSnapshot.recentTurns`（`AgentContextTurnEntry[]`，只含 turn/role/content/toolCalls），`context.json` 本来就不存过程节点
  - 兜底路径 `normalizeHistory`（agent-runtime index.ts:228-238）：显式只取 `role + content`，丢弃所有其他字段；`formatHistory` 拍扁成文本
  - 改造后 `getHistoryFromTurnFiles` 从 timeline 过滤 user/assistant → 映射 `{role, content}`，产出内容不变
- `AgentContextTurnEntry` / `AgentContextSnapshot`（agent context.json）—— 只存干净正文，不含 processNodes
- `getHistoryFromTurnFiles`（agent 注入路径）—— 只提取 messages 展平，需改为从 timeline 提取 user/assistant（产出内容不变，只是提取方式改）
- `ConversationMessageRecord.toolCalls` —— agent context 仍用，保留

### ask 节点（已与用户确认）

ask 是活跃 turn 内的运行时交互，回答后只需 Q&A 记录，选项信息可丢弃。未回答的 ask 不持久化（turn 未完成，无 turn 文件写入；reload 时丢失，已有行为）。

决策：**ask 不入 `TurnTimelineItem`**。`AssistantTimelineNode.ask` 仍存在于内存 composable 层，持久化边界拍平成 interim 文本（与现状一致）。

## Requirements

### R1：新契约类型 `TurnTimelineItem`

- 判别联合，按真实发生顺序排列：`user | assistant | interim | thought | tool | options`
- 每个 process item 带 `round` + `agentId?`
- `options` 变体 `{ kind: "options"; items: string[] }` —— 剧情选项持久化进 turn 文件
- `assistant` 变体可带 `stats?: TurnStats`

### R2：`SessionHistoryEntry` 改为 timeline 单数组

- `messages` + `processNodes` → `timeline: TurnTimelineItem[]`
- 保留 `turn` / `createdAt`，`stats` 移入 `assistant` item 内或保留在 entry 层（决策见 design）

### R3：删除 `TurnProcessNode`

- collector 直接产出 `TurnTimelineItem[]`（process items），减少一层类型转换
- `AssistantTimelineNode` 保留（内存类型，含 ask），mapper 边界转 `TurnTimelineItem`

### R4：turn 文件 schema 升 v2，不做 v1 兼容

- `AIRP_HISTORY_TURN_SCHEMA` → `"tsian.airp.history.turn.v2"`
- 旧 v1 文件 parse 返回 null（被当损坏跳过）——无真实数据，全是测试数据

### R5：剧情选项入 timeline 持久化

- host `extractStoryOptions` 剥离选项后，把 `{kind:"options", items}` 写入 timeline
- reload 时从 timeline 的 options item 渲染按钮，不再仅靠运行时事件 + pendingOptions

### R6：两条路径统一

- play-frontend：streaming 和 rebuild 都从 timeline 逐项渲染
- desktop Assistant：会话存储 `processNodes` 字段 → `timeline` 字段，mapper 双向映射改用 `TurnTimelineItem`

### R7：`ConversationMessageRecord` 保留 toolCalls，删 processNodes

- agent context 仍需 toolCalls
- processNodes 被 timeline 取代

## Acceptance Criteria

- [ ] `TurnTimelineItem` 类型定义在 contracts，含 6 个变体（user/assistant/interim/thought/tool/options）
- [ ] `SessionHistoryEntry.timeline` 替代 messages + processNodes
- [ ] `TurnProcessNode` 类型删除，collector 产出 `TurnTimelineItem[]`
- [ ] turn 文件 schema v2，旧 v1 parse 返回 null
- [ ] 剧情选项持久化进 timeline，reload 后按钮天然恢复
- [ ] play-frontend rebuild 后过程节点保持穿插顺序（非整块堆顶）
- [ ] desktop Assistant 刷新/重进会话后 timeline 重建正确
- [ ] `getHistoryFromTurnFiles` 从 timeline 提取干净正文给 agent 注入
- [ ] DebugView sessionHistory 适配新结构
- [ ] contracts build + platform-web typecheck + play-frontend build 全通过
- [ ] 浏览器复测：重载后过程节点穿插顺序 + 选项按钮渲染正确

## Out of Scope

- 向后兼容旧 v1 turn 文件（无真实数据）
- ask 节点持久化为一等公民（保持拍平 interim 现状）
- `AgentContextSnapshot` / `AgentContextTurnEntry` 改动（agent context 不含 processNodes）
- `ConversationMessageRecord.toolCalls` 改动（agent context 仍用）
- platform-config 任务（独立任务）

## Open Questions

无（关键决策已与用户确认：两条路径都改、不做向后兼容、ask 不入持久化 timeline）。
