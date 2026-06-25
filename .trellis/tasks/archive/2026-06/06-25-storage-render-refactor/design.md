# 设计：存储架构与渲染流程重构

## 1. 数据流总览（改造前 → 改造后）

### 改造前（三处冗余）

```
turn 结束
  ├─ snapshot → saveSnapshots 表（state.messages = 累积正文）
  ├─ saveHistory → saveHistory 表（messages = 同一份累积正文，冗余）
  ├─ turn 文件 → workspaceFiles 表（save/history/turns/turn-NNNNNN.json，只存 user+assistant 正文）
  └─ checkpoint → checkpoints 表（snapshot + history + workspaceFiles，history 又一份冗余）
```

过程节点：前端 `turnProcessLog` 内存数组，刷新即丢。

### 改造后（workspace 为中心）

```
turn 结束
  ├─ snapshot → saveSnapshots 表（runtime engine 内部状态，保留）
  ├─ turn 文件 → workspaceFiles 表（save/history/turns/turn-NNNNNN.json）
  │    ├─ messages: [{role, content}]（正文，agent 可读）
  │    └─ processNodes: TurnProcessNode[]（thought/tool/interim，agent 可读，新增）
  └─ checkpoint → checkpoints 表（snapshot + workspaceFiles，无独立 history 字段）
```

`getHistoryForSave` 从 turn 文件重建 `ConversationMessageRecord[]`（替代读 saveHistory 表）。
过程节点持久化在 turn 文件。

**Phase 2 渲染方向（已确认）**：前端从 turn 文件单源重建完整对话——`createSessionHistory` 从 turn 文件读 messages + processNodes，一次拼成完整玩家视角（正文 + 过程节点），不再从 snapshot 读渲染数据。snapshot 彻底退化为 runtime engine 内部运行状态（loadSnapshot 用），不参与渲染。turn 号从文件列表的最大 turn 推算。

## 2. 关键技术决策

### 2.1 过程节点数据来源：事件流 vs runtimeMessages

**决策：用事件流（onDelta/onRoundEnd/onTool）。**

| 维度 | 事件流（来源 A） | runtimeMessages（来源 B） |
|------|------------------|---------------------------|
| interim 语义 | ✅ 完整——thought 轮的 content delta 经 onRoundEnd(kind=thought) 固化为 interim | ❌ 无法区分——assistant.content 无法区分过渡叙事 vs 最终回复，区分靠 finishReason（循环局部变量，turn 结束即丢） |
| agent_call 结构化 | ✅ onTool 的 output 带 agent_call 结构化分支（title+response） | ❌ runtimeMessages 里是 formatNativeToolObservationContent 扁平字符串 |
| delegated agent 过程 | ✅ 子循环的 onTool/onDelta/onRoundEnd 已透传到外层 host 回调 | ❌ 嵌套 runtimeMessages 不在外层数组里 |
| 实现成本 | 需复刻 useAssistantTimeline 累积逻辑（纯函数，无 Vue 依赖） | 需重新解析 assistant/tool 消息对 + 推断 finishReason |
| text-protocol 路径 | 不发事件 → processNodes 为空（与现状一致） | 有 runtimeMessages 但无 finishReason → 同样无法区分 |

结论：事件流在所有维度上优于或等于 runtimeMessages，且与前端 timeline 节点结构同构（可直接喂回前端重建过程历史区）。

### 2.2 turn 文件 schema 演进

当前（`tsian.airp.history.turn.v1`）：
```json
{ "schema": "...", "turn": 1, "createdAt": "...", "source": {...}, "messages": [{role, content}] }
```

改造后（schema 标记不变，加字段）：
```json
{ "schema": "...", "turn": 1, "createdAt": "...", "source": {...}, "messages": [{role, content}], "processNodes": [...] }
```

无向前兼容负担——目前无真实数据，直接加 `processNodes` 字段。`processNodes` 用可选类型（`processNodes?: TurnProcessNode[]`），因为 text-protocol 路径不产生过程节点，native 路径才写。parse 时不需旧数据兜底。

### 2.3 TurnProcessNode 类型设计

```ts
export type TurnProcessNode =
  | { type: "thought"; id: string; round: number; agentId?: string; text: string; collapsed: boolean }
  | { type: "tool"; id: string; round: number; agentId?: string; name: string;
      status: "loading" | "running" | "success" | "failed"; output?: TurnToolOutput; collapsed: boolean }
  | { type: "interim"; id: string; round: number; agentId?: string; text: string; collapsed: boolean }
```

与现有 `AssistantTimelineNode`（composable 层，无 agentId）同构 + 多 `agentId?` 字段。
定义在 contracts（`packages/contracts/src/runtime.ts`），`TurnToolOutput` 从 `bridge.ts` 导入（同包内）。
`agentId` 可选——单 agent 场景（桌面助手）可省，多 agent 场景（delegated agent_call）必填。

### 2.4 getHistoryFromTurnFiles 重建逻辑

```
输入: WorkspaceFile[]
  → 过滤 path.startsWith("save/history/turns/") && path.endsWith(".json")
  → 逐个 JSON.parse + 字段校验（schema 匹配 + turn 是 number + messages 是数组）
  → 按 turn 升序排列
  → 展平 messages: ConversationMessageRecord[]
  → 返回（空目录/无文件 → []）
```

放在 `platform-host/history-turns.ts`（与 stageRawAirpHistoryTurnFile 读写对称）。
`getHistoryForSave`（saves.ts）内部改为调此函数（经 `listWorkspaceFilesForSave` 取 workspace 文件），签名不变。

### 2.5 saveHistory 表移除影响面

**需改实现（1 处）**：`getHistoryForSave` → 内部改调 `getHistoryFromTurnFiles`（签名不变，4 调用方零改动）

**直接删（类型/表声明 + 死代码 + 11 处 IO）**：
- `db.ts`: `LocalSaveHistoryRecord` 接口 + `saveHistory` 表字段 + schema 行
- `saves.ts`: 导入 + historyRecord 变量 + 6 处表 IO + 5 处事务表清单 + `saveHistoryForSave` 死代码
- `checkpoints.ts`: 导入 + 事务表清单 + put

**改类型标注（2 处）**：`checkpoints.ts` `LocalSaveHistoryRecord["messages"]` → `ConversationMessageRecord[]`

**透明链路（无需改）**：query "history" 分支、sendMessage recentHistory、frontend-inspector、assistant-chat

### 2.6 checkpoint.history 改造

移除 `LocalCheckpointRecord.history` 字段。影响：
- `toCheckpointSummary.messageCount`：改用 `record.snapshot.state.messages.length`（写入时与 history 同源）
- `restoreCheckpointForSave`：不再回填 saveHistory；checkpoint.workspaceFiles 已含 turn 文件，恢复后 `getHistoryForSave` 自动从 turn 文件重建
- `createCheckpointRecordForSave` / `createCheckpointForSave`：删 `input.history` 入参
- `saves.ts` 3 处 checkpoint 写入调用点：删 `history` 传参

### 2.7 过程节点累积器设计

新建 `apps/platform-web/src/platform-host/turn-timeline-collector.ts`，导出 `createTurnTimelineCollector()`。

复刻 `useAssistantTimeline`（composable）的纯累积逻辑，**去掉 Vue 依赖和 onUpdate 回调**：
- 内部状态：`timeline: TurnProcessNode[]` + `streamingText: string` + `streamingReasoning: string`
- `onDelta(agentId, delta, round, kind)`：reasoning → 累积 streamingReasoning；content → 累积 streamingText
- `onRoundEnd(agentId, round, finishReason)`：tool_calls 轮 → streamingText 非空推 interim + reasoning 非空推 thought；stop 轮 → reasoning 推 thought（streamingText 是最终正文，不入 timeline）
- `onTool(agentId, round, callId, name, status, output)`：按 callId upsert tool 节点
- `getProcessNodes()`：返回 `TurnProcessNode[]`（每个节点带 agentId）

host 层（platform-host/index.ts sendMessage）接线：三个回调同时 emit 事件 + 喂 collector，turn 成功收尾时 `stageRawAirpHistoryTurnFile` 传入 `processNodes: collector.getProcessNodes()`。

## 3. 边界与不改动项

- saveSnapshots 表保留
- assistant-chat 路径不动（不走 saveHistory）
- packages/play-bridge 不动（纯协议层）
- 前端渲染逻辑不动（Phase 2 才做）
- master agent 上下文不读 processNodes（recentHistory 只取 messages，context.json 不含过程节点）

## 4. 回滚

如果发现问题，回滚路径：
1. git revert 本次提交
2. 无真实数据需要保护，回滚后重建存档即可
