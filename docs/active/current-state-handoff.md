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
- Runtime Workspace storage/API 已实现，工作区文件随 save 和 checkpoint 生命周期保存、恢复和删除。
- 新存档默认包含 `AGENT.md`、agent notes/session、共享目录 README、world/memory/frontend/archive 入口文件和 `.tsian` 平台目录。
- `agent-registry` / `skill-registry` bridge query 已实现，可从 workspace 扫描轻量 Agent/Skill 索引。
- `skill-detail` bridge query 已实现，可按选中的 `SKILL.md` path 加载 Skill 正文和资源索引，并保持资源内容按需读取。
- `agent-context` bridge query 已实现，可为指定 Agent 组装 `AGENT.md`、notes/session、可见 Skill Index 和声明的 context files。
- 当前 AIRP 回合已开始消费 Runtime Workspace 中的 `agents/master/AGENT.md` 与 `agents/narrative/AGENT.md`，并将 Agent context 注入 master/narrative 两次模型调用。
- 默认 AIRP 回合已支持 runtime 工具循环：Agent 可通过 `<tsian-tool-call>` 请求 `skill_load`、`action_call`、`workspace_read`、`workspace_list`、`workspace_search`，runtime 将 observation 回灌给同一 Agent。Skill 详情主路径是 `skill_load(name)`；workspace 工具用于 `SKILL.md` 链式引用后的第三层资源读取。
- `skill_load` 会解析已加载 `SKILL.md` 中的 `tsian-actions` fenced JSON 声明，并在同一 Agent 工具循环中解锁对应 action；`action_call` 当前只做 loaded Skill gating、action 存在性校验和输入 schema 校验，不执行脚本、远程调用、平台 action 或状态写入。

当前代码尚未实现 `agent_call` 协作、真实 action executor registry、脚本/远程执行适配、Agent notes/session 写回，或把工具/action 调用 trace 持久化。默认回合仍是 master -> narrative 两个 Agent 步骤；每个步骤可能因为 `skill_load`、`action_call` 或 workspace 工具 observation 产生额外模型调用。

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

1. 设计并实现统一 action executor registry，包括平台 action、浏览器脚本、远程执行和状态写入。
2. 实现通用 `agent_call` Skill / action，让 Agent 协作从联系人声明自然形成。
3. 将 loaded Skill、action 调用、文件读写和 Agent 调用 trace 持久化。
4. 写回 Agent session/notes、history timeline、memory summaries 等 Runtime Workspace 文件。
5. 将当前 `stateRecords` 语义迁入 workspace 文件/目录，或作为过渡兼容层。
6. 增加记忆 Agent、状态 Agent 或相关 Skill，但不要把默认事件/档案模型写回平台。
7. 为 Runtime Workspace、Agent、Skill 提供浏览和编辑 UI。
8. 规划前端包 sandbox/RPC bridge，而不是恢复平台级 renderer DSL。

## 6. 历史来源

旧开发历史优先查：

- `.trellis/tasks/archive/`
- `.trellis/workspace/`
- git history

不要把已退役的旧 workflow/prompt/memory 文档当作当前规划依据。
