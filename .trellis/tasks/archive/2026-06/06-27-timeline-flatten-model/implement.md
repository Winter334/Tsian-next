# Implement：扁平化 timeline 模型

## 执行顺序（按依赖层，每层完成后 build 验证）

### 第 1 层：contracts 类型定义

**`packages/contracts/src/runtime.ts`**
- 新增 `TurnTimelineItem` 判别联合（6 变体：user/assistant/interim/thought/tool/options）
- `ConversationMessageRecord`：删 `processNodes` 字段，新增 `timeline?: TurnTimelineItem[]`
- 删除 `TurnProcessNode` 类型定义
- 保留 `TurnToolOutput`（tool item 的 output 仍用）

**`packages/contracts/src/bridge.ts`**
- `SessionHistoryEntry`：`messages` + `processNodes` + `stats` → `timeline: TurnTimelineItem[]`（stats 移入 assistant item）
- 删除 `TurnProcessNode` 的 re-export
- 新增 `TurnTimelineItem` 的 re-export

**验证**：`npm run build --workspace @tsian/contracts`

### 第 2 层：持久化格式（host turn 文件）

**`apps/platform-web/src/platform-host/history-turns.ts`**
- `AIRP_HISTORY_TURN_SCHEMA` → `"tsian.airp.history.turn.v2"`
- `RawAirpHistoryTurnRecord`：`messages` + `processNodes` + `stats` → `timeline: TurnTimelineItem[]`
- `serializeRawAirpHistoryTurnRecord`：签名改为 `(turn, createdAt, entryAgentId, timeline, stats?)`。stats 可选保留在 record 层做冗余（或完全移入 assistant item，决策见下）。实际：stats 移入 timeline 的 assistant item，serialize 不再单独接 stats 参数
- `parseRawAirpHistoryTurnRecord`：校验 schema v2，读 `timeline` 数组；v1 返回 null
- `stageRawAirpHistoryTurnFile`：input 改为 `{ turn, entryAgentId, timeline }`
- `getHistoryFromTurnFiles`：从 `timeline` 过滤 `{kind:"user"|"assistant"}` → 映射 `ConversationMessageRecord[]`（干净正文）
- `getSessionHistoryFromTurnFiles`：返回 `SessionHistoryEntry[]` with `timeline`

**验证**：此时 platform-web build 会报错（其他文件还引用旧类型），记录错误继续往下改

### 第 3 层：collector 输出类型

**`apps/platform-web/src/platform-host/turn-timeline-collector.ts`**
- 内部累积类型 `TurnProcessNode[]` → `TurnTimelineItem[]`（process items）
- `type` 字段名 → `kind` 字段名
- `getProcessNodes()` → `getTimelineItems(): TurnTimelineItem[]`
- 逻辑不变（onDelta/onRoundEnd/onTool 的穿插规则不变，只改类型名）

### 第 4 层：agent-runtime

**`apps/platform-web/src/agent-runtime/turn-types.ts`**
- `AgentRuntimeTurnContextUpdate.processNodes?: TurnProcessNode[]` → `timelineItems?: TurnTimelineItem[]`

**`apps/platform-web/src/agent-runtime/index.ts`**
- `collectedProcessNodes` → `collectedTimelineItems`，类型 `TurnTimelineItem[]`
- `contextUpdate.processNodes` → `contextUpdate.timelineItems`
- import 调整

### 第 5 层：host turn 收尾 + query resource

**`apps/platform-web/src/platform-host/index.ts`**
- master turn 收尾（~910行）：拼接完整 timeline `[{kind:"user",content}, ...collectorItems, {kind:"assistant",content:cleanReply,stats}, {kind:"options",items}]`，传给 `stageRawAirpHistoryTurnFile`
- 剧情选项：`extractStoryOptions` 剥离后，把 options 写入 timeline `{kind:"options",items}`
- `session-history` query resource：`getSessionHistoryFromTurnFiles` 返回值自动跟随
- `history` query resource：`getHistoryFromTurnFiles` 已在第 2 层改

**验证**：`npm run build --workspace platform-web`（vue-tsc + vite build）—— 此时应该大部分类型错误消除

### 第 6 层：assistant 路径

**`apps/platform-web/src/platform-host/assistant-chat.ts`**（~641行）
- 不再从 `contextUpdate.processNodes` 写 `ConversationMessageRecord.processNodes`
- 改为从 `contextUpdate.timelineItems` 写 `ConversationMessageRecord.timeline`

**`apps/platform-web/src/storage/assistant-conversations.ts`**
- `normalizeMessages`：`processNodes` 字段保留逻辑 → `timeline` 字段保留逻辑（`Array.isArray(item.timeline) ? { timeline: item.timeline } : {}`）

**`apps/platform-web/src/views/assistant-message-mappers.ts`**
- `mapStoredMessagesToChat`：从 `msg.timeline`（TurnTimelineItem[]）重建 `AssistantTimelineNode[]`
- `chatToStoredMessages`：从 `msg.timeline`（AssistantTimelineNode[]）转 `TurnTimelineItem[]` 存入 `msg.timeline`。ask → interim 拍平逻辑不变
- import 调整：`TurnProcessNode` → `TurnTimelineItem`

**`apps/platform-web/src/composables/useAssistantTimeline.ts`**
- `AssistantTimelineNode` 保留不变
- import 调整（如有）

**验证**：`npm run build --workspace platform-web`

### 第 7 层：play-bridge

**`packages/play-bridge/src/index.ts`**
- re-export 调整：删 `TurnProcessNode`，加 `TurnTimelineItem`

**验证**：`npm run build --workspace @tsian/play-bridge`

### 第 8 层：play-frontend 渲染

**`apps/play-frontend-dev/src/main.ts`**
- import 调整：`TurnProcessNode` → `TurnTimelineItem`，`SessionHistoryEntry` 跟随
- `ProcessNode` interface → 直接用 `TurnTimelineItem` 或保留本地 alias
- `renderSessionHistory`：从 `entry.timeline` 逐项渲染（switch item.kind），不再拼 user→processNodes→assistant
- `renderTimeline` → `renderProcessItems`：只处理 interim/thought/tool items
- `beginTurn`：不变（仍建 processZone + streamEl）
- `finalizeRound`：process items 类型名调整（type → kind）
- `finalizeTurn`：options 渲染逻辑——pendingOptions 保留（turn-completed 就地渲染），reload 时从 timeline options item 渲染
- `renderSessionHistory` 的 options 渲染：遍历到 `{kind:"options"}` item 时渲染按钮

**验证**：`npm run build --workspace play-frontend-dev`

### 第 9 层：DebugView

**`apps/platform-web/src/views/DebugView.vue`**
- `snapshotMessageCount`：`e.messages.length` → `e.timeline.filter(i => i.kind==="user"||i.kind==="assistant").length`
- `sessionHistory` shallowRef 类型跟随

**验证**：`npm run build --workspace platform-web`

### 第 10 层：最终验证

```bash
npm run build --workspace @tsian/contracts
npm run build --workspace @tsian/play-bridge
npm run build --workspace platform-web
npm run build --workspace play-frontend-dev
```

全部通过后浏览器复测：
1. 新建存档 → 发送消息 → AI 回复带选项 → 回合完成
2. 选项按钮渲染（turn-completed 就地）
3. 刷新页面 → reload → 过程节点穿插顺序正确 + 选项按钮从 timeline 恢复
4. 回溯检查点 → reload → 同上

### 第 11 层：spec 更新 + 提交

**`.trellis/spec/platform-web/frontend/state-management.md`**
- Bridge State 段：更新 turn 文件 schema v2 + timeline 单数组格式
- 删除"重建仅重载时用"的临时约束（重建现在顺序正确）
- 更新 play-frontend turn 渲染：streaming 和 rebuild 共用 timeline 逐项渲染

**`.trellis/spec/platform-web/frontend/type-safety.md`**
- 更新 SessionHistoryEntry / TurnTimelineItem 类型定义引用
- 删除 TurnProcessNode 引用

提交：单个 commit，消息描述架构变更

## 验证命令汇总

```bash
# 逐层验证
npm run build --workspace @tsian/contracts
npm run build --workspace @tsian/play-bridge
npm run build --workspace platform-web
npm run build --workspace play-frontend-dev
```

## 风险文件 / 回滚点

- **contracts 类型变更**：影响面最广，是所有下游的根。先改先验证
- **history-turns.ts 序列化格式**：turn 文件格式变更，无兼容。回滚 = git revert
- **turn-timeline-collector.ts**：类型名变更（type→kind），逻辑不变，低风险
- **assistant-message-mappers.ts**：双向映射逻辑，ask→interim 拍平不变，中风险
- **play-frontend main.ts**：渲染逻辑重写 renderSessionHistory，中风险

## 后续检查（task.py start 前）

- [ ] PRD 验收标准全部覆盖
- [ ] design.md 数据流图与实际代码一致
- [ ] implement.md 步骤无遗漏
- [ ] 用户审阅通过
