# 存储架构与渲染流程重构

## 背景

游戏前端的对话历史当前存在三处冗余（snapshot.state.messages + saveHistory 表 + turn 文件），过程节点（thought/tool/interim）纯内存累积刷新即丢，前端用 snapshot 全清覆盖渲染导致 DOM 抖动和选项按钮被清。

心智模型：**workspace 为中心**——可见即可编辑，可编辑即可管理。UI 和 agent 都从 workspace 查数据、向 workspace 改。平台内部状态（snapshot/runtime engine）不在 workspace。

玩家视角与 agent 视角分离：
- 玩家看到：完整历史（思考过程 + 工具调用 + 过渡叙事 + 正文 + 选项），即使重载也可见
- master agent 看到：干净正文 + 压缩 summary，工具调用被过滤
- 助手 agent 看到：较宽松，能查工具调用事实

## 需求

### Phase 1：存储架构改造（本次会话）

1. **过程节点进 workspace turn 文件**：扩展 `save/history/turns/turn-NNNNNN.json` schema，加 `processNodes` 字段（thought/tool/interim，带 agentId）。master agent 上下文不读 processNodes（recentHistory 只取 messages），助手 agent 能通过 workspace_read 读到，玩家通过前端 UI 看到。
2. **去掉 saveHistory 表**：其职能（recentHistory + query.history）改为从 workspace turn 文件重建。新增 `getHistoryFromTurnFiles`。
3. **checkpoint.history 改造**：不再独立存 history 字段，从 turn 文件重建（checkpoint.workspaceFiles 已含 turn 文件）。
4. **snapshot 不动**：saveSnapshots 表保留，snapshot 是 runtime engine 内部状态。
5. **host 侧 turn 结束时把过程节点写入 turn 文件**：从事件流（onDelta/onRoundEnd/onTool）累积过程节点，随 turn commit 持久化。

### Phase 2：渲染流程重构（后续会话）

- 去掉 handleSnapshot 的全清覆盖渲染
- 改成事件流积累（过程节点原地晋升为历史，不重建 DOM）
- **前端从 turn 文件单源重建完整对话**：createSessionHistory 从 turn 文件读 messages + processNodes，一次拼成完整玩家视角（正文 + 过程节点），不再从 snapshot 读渲染数据
- snapshot 彻底退化为 runtime engine 内部运行状态（loadSnapshot 用），不参与渲染
- createSessionHistory 封装到 @tsian/play-bridge

### Phase 3：AIRP 剧情选项（后续会话）

- AI 正文里用格式块标记选项（如 `[[选项]]...[[/选项]]`），前端解析渲染按钮
- 玩家点选项 = 填入输入框发送 = 正常新 turn
- host 侧存入 snapshot 前剥离选项块

## 约束

- **无向前兼容负担**：目前无真实数据，turn 文件 schema 直接加 `processNodes` 字段，DB 直接删 saveHistory 表，不需要旧数据迁移或兜底。
- **不改 saveSnapshots 表**：snapshot 是 runtime engine 内部状态，保留。Phase 2 后 snapshot 不参与渲染，但仍作为 runtime engine 运行状态保留。
- **不改 assistant-chat 路径**：桌面助手 recentHistory 来自内存 messages.value，不走 saveHistory 表，不受影响。
- **不改 packages/play-bridge**：纯协议层，零 saveHistory 引用（Phase 2 才加 createSessionHistory）。
- **DB version 保持 v11**：prototype 项目无迁移，Dexie 删 stores 行即更新 schema。
- **getHistoryForSave 签名不变**：4 个调用方（query.history / sendMessage / frontend-inspector / createCheckpointFromCurrentSave）零改动，透明走新实现。
- **text-protocol 路径无过程节点**：text 模式不发 onDelta/onRoundEnd/onTool，processNodes 为空，与现状一致。
- **historyMode / historyWindows 不动**：delegated agent 的历史窗口切分逻辑透明走新数据源，不需要改。

## 验收标准（Phase 1）

- [ ] `TurnProcessNode` 类型定义在 contracts，带 agentId，与 AssistantTimelineNode 同构
- [ ] turn 文件 schema 扩展 `processNodes` 字段
- [ ] `getHistoryFromTurnFiles` 从 workspace 文件重建 ConversationMessageRecord[]，空目录返回 []
- [ ] host 层 turn 结束时把过程节点写入 turn 文件（native 模式）
- [ ] saveHistory 表从 db.ts 完全移除，全库零残留引用
- [ ] `getHistoryForSave` 换实现为 turn 文件重建，签名不变
- [ ] `saveHistoryForSave` 死代码删除
- [ ] checkpoint.history 字段移除，messageCount 改用 snapshot.state.messages.length
- [ ] `restoreCheckpointForSave` 不再回填 saveHistory，靠 workspaceFiles 含 turn 文件 + getHistoryForSave 重建
- [ ] `npm run build:contracts` 通过
- [ ] `npm run build:web` 通过
- [ ] tsc 全量类型检查无报错
- [ ] grep 确认 saveHistory / LocalSaveHistoryRecord / saveHistoryForSave 全库零残留
