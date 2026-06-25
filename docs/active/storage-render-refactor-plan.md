# 存储架构与渲染流程待做事项

本会话讨论了游戏前端的存储架构和渲染流程重构，上下文已重，记此文件供新会话接续。

## 背景：心智模型

**workspace 为中心**：可见即可编辑，可编辑即可管理。UI 和 agent（含助手 agent）都从 workspace 查数据、向 workspace 改。平台内部状态（snapshot/runtime engine）不在 workspace。

**玩家视角与 agent 视角分离**：
- 玩家看到：完整历史（思考过程 + 工具调用 + 过渡叙事 + 正文 + 选项），即使重载也可见
- master agent 看到：干净正文 + 压缩 summary，工具调用被过滤
- 助手/delegated agent 看到：较宽松，能查工具调用事实

参考 ZCode UI：往上翻能看完整历史（含工具调用），即使上下文已压缩。UI 视角和 agent 视角独立。

## 当前问题

### 问题 1：snapshot 全清覆盖渲染
- `handleSnapshot` 里 `renderMessages` 做 `$story.innerHTML = ""` 全清，用 snapshot 的干净正文重建
- 目的是过滤多 round turn 的过渡叙事（Round 1 的 interim），只留 Round 2 最终正文
- 副作用：过程节点差点丢（靠 `turnProcessLog` 内存数组补救）、选项按钮被清掉、DOM 抖动
- **本质**：平台侧替前端做了"什么是正文"的表现层决策，混淆了 agent 视角和玩家视角

### 问题 2：saveHistory 表冗余
- `saveHistory` 存的 messages = `snapshot.state.messages` = 各 turn 文件 messages 的累积拼接
- 同一份数据存三处：snapshot（IndexedDB）+ saveHistory（IndexedDB）+ turn 文件（workspace）
- saveHistory 被 `query.query("history")` 和 `recentHistory` 读取，绕过 workspace

### 问题 3：数据散在 workspace + IndexedDB 两套存储
- workspace 文件（agent 可见）：`save/history/turns/turn-*.json`（每轮对话）
- IndexedDB 表（agent 不可见）：saveSnapshots / saveHistory / saves / checkpoints / workspaceFiles
- 心智模型复杂——同一个对话历史存在三个地方

## 确认的方向

### 存储：过程节点进 workspace turn 文件
- 扩展 `save/history/turns/turn-NNNNNN.json` schema，加 `processNodes` 字段（thought/tool/interim）
- master agent 上下文不读 processNodes（`recentHistory` 只取 messages）——不污染
- 助手 agent 能通过 `workspace_read` 读到过程节点——有能力查
- 玩家通过前端 UI 看到——可见

### 存储：去掉 saveHistory 表
- 其职能（recentHistory + query.history）改为从 workspace turn 文件重建
- 新增 `getHistoryFromTurnFiles(saveId)`：读 workspaceFiles → 过滤 `save/history/turns/turn-*.json` → 按 turn 排序 → 解析拼接
- 5 处事务修改：去掉 `localDb.saveHistory`，删掉对应 put/delete
- checkpoint.history 字段改造：从 turn 文件重建或不再独立存
- attachments 信息缺口：turn 文件 schema 只存 `{role, content}`，丢了 attachments，要补

### 存储：snapshot 不动
- snapshot 是 runtime engine 内部状态（turn + globals + messages），不属于 workspace
- saveSnapshots 表保留

### 渲染：从"snapshot 全清覆盖"改成"事件流积累"
- 去掉 `handleSnapshot` 的全清 `renderMessages`
- turn 结束后不全清，过程节点原地晋升为历史（不重建 DOM）
- snapshot 退化为重载重建用（只在 handleReady 初始拉取时用）
- 过程节点从 workspace turn 文件读（或从事件流积累 + workspace 持久化）
- 选项按钮自然保留（不被全清）

### SDK：createSessionHistory 封装到 @tsian/play-bridge
- 数据层封装，不碰渲染
- 从 workspace 读过程节点 + 从 snapshot 读正文 → 拼合成完整玩家视角
- 用原生 IndexedDB（不加 Dexie）——实际上如果过程节点进 workspace，可能不需要前端独立 IndexedDB，直接从 workspace 读
- 游戏前端 `import { createBridge, createSessionHistory }` 即用，降低玩家开发门槛

### AIRP 剧情选项：正文末尾接选项格式块 + 点击发送
- AI 正文里用格式块标记选项（如 `[[选项]]...[[/选项]]`）
- 前端解析格式块渲染选项按钮
- 玩家点选项 = 填入输入框发送 = 正常新 turn
- host 侧在存入 snapshot 前剥离选项块（上下文干净）
- 前端收到 snapshot 覆盖时不清空已渲染的选项按钮
- 不需要工具/阻塞/RPC 回填——全用现有基础设施
- ask_user 工具保留给助手 agent 用（已实现，commit e727987）

## 执行顺序（新会话接续）

1. **存储架构改造**（先做，底层）：
   - 扩展 turn 文件 schema 加 processNodes
   - 去掉 saveHistory 表 + 新增 getHistoryFromTurnFiles
   - checkpoint.history 改造
   - host 侧 turn 结束时把过程节点写入 turn 文件
   - 评估 query.query("history") 是废弃还是改从 workspace 重建

2. **渲染流程重构**（存储定了再做）：
   - 去掉 snapshot 全清覆盖
   - 改成事件流积累
   - createSessionHistory 封装（从 workspace 读过程节点）

3. **AIRP 剧情选项**（渲染模型定后自然落地）：
   - 选项格式块解析 + 点击发送
   - host 剥离选项块

## 关键调研结论（本会话已确认）

- `save/history/turns/` 是 ordinary workspace path，agent 通过 `workspace_read` 可读
- `.tsian/` 才是平台元数据，对 agent 隐藏
- saveHistory 写入点和读取点完整清单见本会话调研
- turn 文件结构：`{ schema, turn, createdAt, source: {kind, entryAgentId}, messages: [{role, content}] }`
- snapshot = `{ version, state: { turn, messages, globals? } }`，存 saveSnapshots 表
- saveHistory = `{ saveId, messages: ConversationMessageRecord[] }`，存 saveHistory 表（和 snapshot.messages 重复）
- `bridge.sessionId` 不是 saveId（每次 mount UUID），saveId 通过 `bridge.call("platform.getPlatformContext")` → `activeSaveId` 获取
- 打包前端（同源）能访问平台 IndexedDB，远程前端（跨源 localhost:5174）只能访问自己的 IndexedDB

## 已完成的任务（本会话）

- `8c6dba7` feat(play-bridge): 抽桥协议层为独立 workspace 包
- `678e9d3` feat(play-frontend-dev): 新建开发前端项目
- `fcbf377` fix(platform-web): 前端 tab Remote URL 补保存按钮
- `85cdb6d` refactor(agent-runtime): native 模式 tool message content 去冗余包装
- `e727987` feat(agent-runtime): ask_user 工具（保留给助手 agent 用）

## 相关文件

- `apps/platform-web/src/storage/db.ts` — Dexie 表定义（saveSnapshots/saveHistory/workspaceFiles 等）
- `apps/platform-web/src/storage/saves.ts` — saveHistory 读写 + 事务
- `apps/platform-web/src/storage/checkpoints.ts` — checkpoint（含 history 字段）
- `apps/platform-web/src/platform-host/history-turns.ts` — turn 文件 schema + 写入
- `apps/platform-web/src/platform-host/index.ts` — sendMessage（recentHistory + commitSuccessfulRuntimeTurn）
- `apps/platform-web/src/agent-runtime/index.ts` — runAgentRuntimeTurn（recentHistory 用途）
- `apps/platform-web/src/agent-runtime/context-lifecycle.ts` — master 上下文（appendTurnToContext 只存正文）
- `apps/platform-web/src/storage/default-frontend-files.ts` — 默认前端（snapshot 全清覆盖逻辑）
- `apps/play-frontend-dev/src/main.ts` — 开发前端（同上，TS 版）
- `packages/play-bridge/src/bridge.ts` — 协议层
- `docs/active/play-frontend-sdk-direction.md` — SDK 方向文档
