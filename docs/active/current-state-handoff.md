# Tsian Current State Handoff

## 1. 当前方向

Tsian 当前方向是 Agent-Orchestrated AIRP Runtime。

权威方向文档：

- `docs/active/airp-workflow-platform-direction.md`
- `docs/active/agent-framework-runtime-workspace-direction.md`

旧 workflow-as-system、可视 DAG workflow editor、SillyTavern prompt-engine、workflow preset、事件/档案记忆模型不再是当前主线。

## 2. 当前实现状态

当前代码已经完成第一版 Agent Runtime MVP 纵切：

- 平台 WebUI 位于 `apps/platform-web`。
- `interaction.sendMessage` 由 `platform-host` 调度 Agent Runtime，而不是执行旧 workflow。
- Agent Runtime 位于 `apps/platform-web/src/agent-runtime`。
- MVP 每轮调用两次模型：`master-agent` 先产出写作 brief，`narrative-agent` 再产出玩家可读剧情正文。
- 官方默认前端位于 `builtin/play-frontends/official-default`，负责内容为空的会话聊天、AI debug、checkpoint、snapshot 和 stateRecords 展示。
- 本地 Dexie schema 已重置为 `meta / saves / saveSnapshots / saveHistory / checkpoints / stateRecords`。
- 平台可在没有内置内容包的情况下启动，并可创建内容为空的 AIRP 会话。

当前代码尚未实现 Runtime Workspace、`AGENT.md`、`SKILL.md`、Skill 按需加载、agent-call 协作或 action executor registry。这些是下一阶段 Agent Framework 方向，不是当前已落地行为。

## 3. 当前有效边界

- Platform：模型调用、桥 API、通用存储、会话生命周期、checkpoint、前端包装载。
- Agent Runtime：AIRP 回合组织、Agent 分工、工具使用和运行时数据产出。
- Frontend Package：游戏 UI、交互和渲染，只通过 bridge 访问平台能力。
- Save Instance：一次 AIRP 会话的数据容器，内容语义由 runtime 和前端包约定。

平台不硬编码记忆结构、事件/档案语义、MVU 状态表或前端渲染协议。

下一阶段的 Save Instance 数据抽象是 Runtime Workspace：一个存档级虚拟文件系统，用工作区文件/目录承载 Agent 定义、Skill、历史、世界数据、记忆、前端数据、归档和平台 metadata。结构化游戏状态也应融入工作区文件，而不是作为平台理解的固定玩法模型。

## 4. 关键代码入口

- `apps/platform-web/src/platform-host/index.ts`
- `apps/platform-web/src/agent-runtime/index.ts`
- `apps/platform-web/src/storage/db.ts`
- `apps/platform-web/src/bridge/play-frontend-bridge.ts`
- `apps/platform-web/src/views/LobbyView.vue`
- `apps/platform-web/src/views/PlayView.vue`
- `apps/platform-web/src/views/DebugView.vue`
- `packages/contracts/src/runtime.ts`
- `packages/contracts/src/bridge.ts`
- `packages/contracts/src/debug.ts`
- `builtin/play-frontends/official-default/src/index.ts`

## 5. 下一步建议

优先从这些方向继续：

1. 设计 Runtime Workspace 文件 API 和存储形态。
2. 引入 `AGENT.md` / `SKILL.md` 的解析、索引和按需加载。
3. 将当前固定 `master-agent` -> `narrative-agent` 流迁移为 workspace 定义的 Agent。
4. 设计统一 action 调用与执行器适配，包括浏览器脚本和远程执行。
5. 将当前 `stateRecords` 语义迁入 workspace 文件/目录，或作为过渡兼容层。
6. 增加记忆 Agent、状态 Agent 或相关 Skill，但不要把默认事件/档案模型写回平台。
7. 规划前端包 sandbox/RPC bridge，而不是恢复平台级 renderer DSL。

## 6. 历史来源

旧开发历史优先查：

- `.trellis/tasks/archive/`
- `.trellis/workspace/`
- git history

不要把已退役的旧 workflow/prompt/memory 文档当作当前规划依据。
