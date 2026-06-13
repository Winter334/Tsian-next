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
- 本地 Dexie schema 已重置为 `meta / saves / saveSnapshots / saveHistory / checkpoints / stateRecords / workspaceFiles`。
- 平台可在没有内置内容包的情况下启动，并可创建内容为空的 AIRP 会话。
- Runtime Workspace storage/API 已实现，工作区文件随 save 和 checkpoint 生命周期保存、恢复和删除。
- 新存档默认包含 master/narrative/memory `AGENT.md`、agent notes/session、共享目录 README、world/memory/frontend/archive 入口文件和 `.tsian` 平台目录。
- `agent-registry` / `skill-registry` bridge query 已实现，可从 workspace 扫描轻量 Agent/Skill 索引。
- `skill-detail` bridge query 已实现，可按选中的 `SKILL.md` path 加载 Skill 正文和资源索引，并保持资源内容按需读取。
- `agent-context` bridge query 已实现，可为指定 Agent 组装 `AGENT.md`、notes/session、可见 Skill Index 和声明的 context files。
- 当前 AIRP 回合已开始消费 Runtime Workspace 中的 `agents/master/AGENT.md` 与 `agents/narrative/AGENT.md`，并将 Agent context 注入 master/narrative 两次模型调用。
- 默认 AIRP 回合已支持 runtime 工具循环：Agent 可通过 `<tsian-tool-call>` 请求 `skill_load`、`action_call`、`agent_call`、`workspace_read`、`workspace_list`、`workspace_search`，runtime 将 observation 回灌给同一 Agent。Skill 详情主路径是 `skill_load(name)`；workspace 工具用于 `SKILL.md` 链式引用后的第三层资源读取；`agent_call` 只暴露当前 Agent 的 contacts。
- `skill_load` 会解析已加载 `SKILL.md` 中的 `tsian-actions` fenced JSON 声明，并在同一 Agent 工具循环中解锁对应 action；`action_call` 会先做 loaded Skill gating、action 存在性校验和输入 schema 校验，再路由到 action executor registry。当前支持 `builtin/validation`、`builtin/echo`、allow-listed `platform_action` 和 strong-SDK `browser_script`。`platform_action` 通过 runtime capability 调用 platform-host 受控动作，当前允许 `workspace-write` / `workspace-delete`；`browser_script` 执行 Skill 目录下的浏览器 Worker 脚本，通过 Tsian SDK 暴露 workspace read/list/search/write/delete、fetch、log/trace 和 timeout/abort，不把 raw DOM、`window`、内部 bridge、Vue 状态或 platform-host 内部对象作为受支持 API。
- contacts-gated `agent_call` MVP 已实现。默认 master contacts 包含 memory；被调用 Agent 使用自己的 `AGENT.md`、context、Skill Index 和工具循环，结果作为 observation 返回调用方；MVP 禁止嵌套 `agent_call` 并共享 root turn 调用预算。
- Runtime Trace Persistence MVP 已实现。每个成功回合会写入 `.tsian/traces/turns/turn-*.jsonl`，失败回合在可写时写入 failed trace；trace 记录回合、Agent step、模型调用摘要、Skill 加载、Agent 调用、workspace 工具、action 调用和 workspace mutation。普通 bridge/runtime `workspace_list` / `workspace_search` 默认隐藏 `.tsian/traces/`，trace 作为 workspace 文件跟随 checkpoint/restore 回滚。
- Native AIRP History Writeback MVP 已实现。每个成功回合会写入 `history/turns/turn-*.json`，只包含玩家输入和最终 narrative 输出；这些文件是普通 Runtime Workspace 文件，可被 read/list/search 命中并随 checkpoint/restore 回滚，失败回合不会留下普通 raw history 记录。

当前代码尚未实现远程 executor、WASM/托管执行、Agent notes/session 自动写回、timeline/current-summary 自动维护，或 `agent_call` 的有限递归 / UI 配置。默认回合仍是 master -> narrative 两个固定 Agent 步骤；每个步骤可能因为 `skill_load`、`action_call`、`agent_call` 或 workspace 工具 observation 产生额外模型调用。

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

1. 继续完善 action executor registry：远程执行、WASM/托管执行、更丰富的受控平台动作，以及 browser script 的信任/启用策略。
2. 扩展 `agent_call` 到更成熟的协作策略，例如可配置预算、有限递归、协作 Skill 或调试 UI。
3. 扩展 trace 覆盖远程 executor、保留策略、脚本调试 UI 和更细的执行审计。
4. 在 raw history 底账之上写回 Agent session/notes、history timeline、memory summaries 等派生 Runtime Workspace 文件。
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
