# 执行计划：存储架构与渲染流程重构

## Phase 1：存储架构改造（本次会话）

### Step 1 — 定义 TurnProcessNode 类型（contracts）

- [ ] 文件 `packages/contracts/src/runtime.ts`：新增 `TurnProcessNode` discriminated union（thought/tool/interim，带可选 agentId），从 `bridge.ts` 导入 `TurnToolOutput`。放在 `ConversationMessageRecord` 之后。
- [ ] 验证：`npm run build:contracts`

### Step 2 — 扩展 turn 文件 schema + 新建读取函数

- [ ] 文件 `apps/platform-web/src/platform-host/history-turns.ts`：
  - `RawAirpHistoryTurnRecord` 加 `processNodes?: TurnProcessNode[]`（可选字段，向前兼容）
  - `serializeRawAirpHistoryTurnRecord` / `stageRawAirpHistoryTurnFile` 增加 `processNodes` 入参
  - 新建 `parseRawAirpHistoryTurnRecord(content: string)`：JSON.parse + 字段校验 + 兜底返回 null
  - 新建 `getHistoryFromTurnFiles(workspaceFiles: WorkspaceFile[])`：过滤 turn 文件 → parse → 按 turn 排序 → 展平 messages
- [ ] 验证：tsc 编译此文件无报错

### Step 3 — 新建过程节点累积器

- [ ] 新文件 `apps/platform-web/src/platform-host/turn-timeline-collector.ts`：
  - `createTurnTimelineCollector()` 返回 `{ onDelta, onRoundEnd, onTool, getProcessNodes }`
  - 复刻 useAssistantTimeline 纯累积逻辑（去 Vue 依赖），节点带 agentId
- [ ] 验证：tsc 编译此文件无报错

### Step 4 — host 层接线（platform-host/index.ts）

- [ ] 文件 `apps/platform-web/src/platform-host/index.ts`（sendMessage ~L738）：
  - 创建 `const timelineCollector = createTurnTimelineCollector()`
  - onDelta/onRoundEnd/onTool 回调同时 emit 事件 + 喂 collector
  - turn 成功收尾时 `stageRawAirpHistoryTurnFile` 传入 `processNodes: timelineCollector.getProcessNodes()`
- [ ] 验证：tsc 编译此文件无报错

### Step 5 — 去掉 saveHistory 表

- [ ] 文件 `apps/platform-web/src/storage/db.ts`：
  - 删 `LocalSaveHistoryRecord` 接口（L65-68）
  - 删 `saveHistory!: Table<...>` 字段（L170）
  - 删 stores schema 行 `saveHistory: "&saveId"`（L193）
- [ ] 文件 `apps/platform-web/src/storage/saves.ts`：
  - 删 `LocalSaveHistoryRecord` 导入（L9）
  - `createLocalSaveFromGameCard`：删 historyRecord（L126-129）+ 事务表清单移除 saveHistory（L150）+ 删 put（L157）
  - `saveRuntimeForSave`：事务表清单移除（L196）+ 删 put（L202-205）
  - `commitSuccessfulRuntimeTurnForSave`：事务表清单移除（L259）+ 删 put（L268-271）
  - `deleteLocalSave`：事务表清单移除（L320）+ 删 delete（L324）
  - `getHistoryForSave`（L337）换实现：调 `listWorkspaceFilesForSave` + `getHistoryFromTurnFiles`
  - 删 `saveHistoryForSave` 死代码（L344-356）
- [ ] 文件 `apps/platform-web/src/storage/checkpoints.ts`：
  - 删 `LocalSaveHistoryRecord` 导入（L5）
  - `restoreCheckpointForSave`：事务表清单移除 saveHistory（L103）+ 删 put（L111-113）
  - 类型标注 `LocalSaveHistoryRecord["messages"]` → `ConversationMessageRecord[]`（L42, L67）

### Step 6 — checkpoint.history 改造

- [ ] 文件 `apps/platform-web/src/storage/db.ts`：`LocalCheckpointRecord` 删 `history` 字段（L94）
- [ ] 文件 `apps/platform-web/src/storage/checkpoints.ts`：
  - `createCheckpointRecordForSave`：删 `input.history` 入参 + record.history 赋值（L42, L58）
  - `createCheckpointForSave`：删 `input.history` 入参（L67）
  - `toCheckpointSummary`：`messageCount` 改用 `record.snapshot.state.messages.length`（L33）
- [ ] 文件 `apps/platform-web/src/storage/saves.ts`（3 处 checkpoint 写入调用点删 history 传参）：
  - `createLocalSaveFromGameCard`（L137-143）
  - `commitSuccessfulRuntimeTurnForSave`（L247-252）
  - `createCheckpointFromCurrentSave`（L358-369）

### Step 7 — 验证

- [ ] `npm run build:contracts`
- [ ] `npm run build:web`
- [ ] grep 确认 saveHistory / LocalSaveHistoryRecord / saveHistoryForSave 全库零残留
- [ ] 手动验证：新存档对话一轮 → turn 文件含 processNodes → 重载 → getHistoryForSave 从 turn 文件重建正确

---

## Phase 2：渲染流程重构（后续会话，框架占位）

- [ ] 去掉 handleSnapshot 的全清 renderMessages
- [ ] 改成事件流积累（过程节点原地晋升为历史，不重建 DOM）
- [ ] 前端从 turn 文件单源重建完整对话：createSessionHistory 从 turn 文件读 messages + processNodes，一次拼成完整玩家视角（正文 + 过程节点），不再从 snapshot 读渲染数据
- [ ] snapshot 彻底退化为 runtime engine 内部运行状态（loadSnapshot 用），不参与渲染
- [ ] createSessionHistory 封装到 @tsian/play-bridge

## Phase 3：AIRP 剧情选项（已完成）

格式语法（已定稿）：
```
正文正文正文...

[[选项]]
- 前往北方的雪原
  那里覆盖着万年不化的寒冰
- 查看地上的卷轴
- 询问老人关于钥匙的事
[[/选项]]
```
- 外层 `[[选项]]...[[/选项]]`：类 BBCode 配对标记,避开 markdown `[text](url)` 单方括号链接冲突
- 内层 `- `：markdown 无序列表分隔选项,长选项可续行（非 `- ` 非空行拼入上一选项,保留换行）
- 多块合并提取；cleanText = 原文剥离所有块后收敛多换行

数据流：剥离发生在 host 单点（sendMessage 收尾），下游 snapshot/turn 文件/context.json 全部用 cleanReply，零冗余。

- [x] **Step 1** — 选项块解析/剥离纯函数
  - host 侧 `apps/platform-web/src/platform-host/story-options.ts`：`extractStoryOptions(text) → { options, cleanText }`
  - 前端侧 `packages/play-bridge/src/story-options.ts`：`parseStoryOptions(text) → { options, cleanText }`（同语义,前端不依赖 platform-web）
  - `packages/play-bridge/src/index.ts` 导出 `parseStoryOptions` + `ParsedStoryOptions`
- [x] **Step 2** — host 层接线（platform-host/index.ts sendMessage ~L869）
  - `extractStoryOptions(result.replyText)` → cleanReply 喂给 nextHistory/snapshot/turn 文件
  - `stageAgentContextFile` 的 assistant 改传 cleanReply（contextUpdate.assistant 原始 replyText,需覆盖）
  - `emitTurnOptions(nextTurn, storyOptions)` 若有选项
  - trace replyLength 改用 cleanReply.length,加 storyOptions 计数
- [x] **Step 3** — 新事件 turn-options
  - `packages/contracts/src/bridge.ts`：RemotePlayBridgeEventName 加 `"turn-options"`；payload 加 `{ turn, options }` 分支
  - `apps/platform-web/src/streaming-events.ts`：`TurnOptionsListener` + `subscribeTurnOptions` + `emitTurnOptions`
  - `apps/platform-web/src/bridge/remote-iframe-bridge.ts`：订阅 turn-options → postEvent,dispose 时退订
  - `packages/play-bridge/src/bridge.ts`：BridgeHandlers 加 `onTurnOptions?`,event 路由识别 turn-options
- [x] **Step 4** — 前端渲染（apps/play-frontend-dev/src/main.ts）
  - 模块级 `pendingOptions` 缓存；beginTurn 重置
  - `onTurnOptions` 回调：缓存 options（不立即渲染）
  - `finalizeTurn`：用 `parseStoryOptions(turnState.content).cleanText` 重写 streamBody（剥离本地流式选项块）+ 渲染选项按钮区
  - 选项按钮点击 = 填 $input.value + sendMessage（复用发送链路,选项 = 正常新 turn）
  - `renderSessionHistory` 不改（turn 文件存 cleanReply,重载正文已无选项块；历史选项不重建）
- [x] **Step 5** — AI prompt 指引（agent-runtime/index.ts ENTRY_AGENT_PLATFORM_GUARD 末尾）
  - 加一行剧情选项格式约定（平台级,所有 AIRP card master 生效）
- [x] **Step 6** — 样式（apps/play-frontend-dev/src/style.css）
  - `.story-options` + `.story-option`：复用 ask-option 视觉语言,容器更轻（左竖线 + 半透明底）,`white-space: pre-wrap` 支持长选项换行

验证：
- [x] `npm run build:contracts` 通过
- [x] `npm run build:web` 通过
- [x] `npm run build --workspace @tsian/play-bridge` 通过
- [x] `npm run build --workspace play-frontend-dev` 通过
- [x] parseStoryOptions 逻辑测试：无块/单块/长选项续行/空块/markdown 链接不误触 全部正确
- [x] host 与 bridge 两侧正则一致（同源逻辑）
- [ ] 手动验证：master 回复含 [[选项]] 块 → 前端显示按钮 + 干净正文 → 重载后正文无选项块 → 点选项 = 发送新 turn

---

## 验证命令

```bash
npm run build:contracts   # contracts 包构建
npm run build:web         # platform-web 构建（含 tsc 全量类型检查）
```

## 回滚点

每个 Step 完成后可独立验证。如 Step 5/6（去表 + checkpoint 改造）发现问题，git revert 即可——无真实数据需要保护，回滚后重建存档。
