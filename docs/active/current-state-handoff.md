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
- 官方默认前端位于 `builtin/play-frontends/official-default`，负责内容为空的会话聊天、AI debug、checkpoint 和 snapshot 展示。
- `/play` 会解析 active Game Card 的 frontend binding：`builtin/official-default` 继续走内置前端，`remote` URL 会以 sandboxed iframe 加载，`packaged` 会以本地 Service Worker 虚拟资源 URL 加载已导入的静态前端文件；远程/打包前端都通过 `tsian.play-bridge.v1` postMessage bridge 调用 runtime snapshot、玩家输入、query、platform context 和 platform action。远程 bridge 会过滤 mounted iframe source、handshake session 和 origin，默认屏蔽 `ai-debug` raw records；workspace write/delete 对远程/打包前端仍是即时 `platform.runAction`。当前本地 packaged frontend 依赖 Service Worker 控制同源 iframe client，因此 sandbox 保留 `allow-same-origin`。
- 本地 Dexie schema 已重置为 `meta / gameCards / gameCardFrontendFiles / saves / saveSnapshots / saveHistory / checkpoints / workspaceFiles`。
- Game Card / Save Instance 本地模型已建立：Game Card 是可复用 workspace 模板和前端绑定，Save Instance 是从 Game Card 创建的独立游玩副本，checkpoint 仍是 Save Instance 内部回滚点。
- Game Card 本地包格式已建立：`*.tsian-card.zip` 包含 `game-card.json`、`workspace/*` 和可选 `frontend/*` built static files；导入会创建/更新 reusable Game Card，不会默认创建 Save Instance；导出不会包含 save history、checkpoint 或玩家演进后的 save workspace。
- 平台会 seed 内置空白 Game Card；现有 `createPlatformSave()` 兼容路径会从这张卡复制默认 workspace 模板并创建初始 checkpoint。
- 平台可在没有内置内容包的情况下启动，并可创建内容为空的 AIRP 会话。
- Runtime Workspace storage/API 已实现，工作区文件随 save 和 checkpoint 生命周期保存、恢复和删除。
- 新存档默认包含 master/narrative/memory `AGENT.md`、workspace assistant `agents/studio-assistant/AGENT.md`、agent notes/session、官方共享 `memory-maintenance` Skill、助手本地 `framework-knowledge` Skill、临时官方知识库 `docs/tsian-framework-knowledge.md`、共享目录 README、state/world/memory/frontend/archive 入口文件和 `.tsian` 平台目录；旧存档会通过 workspace manifest 版本安全补入缺失的官方默认文件，且不覆盖同路径用户文件。
- `agent-registry` / `skill-registry` bridge query 已实现，可从 workspace 扫描轻量 Agent/Skill 索引。
- `skill-detail` bridge query 已实现，可按选中的 `SKILL.md` path 加载 Skill 正文和资源索引，并保持资源内容按需读取。
- `agent-context` bridge query 已实现，可为指定 Agent 组装 `AGENT.md`、notes/session、可见 Skill Index 和声明的 context files。
- 当前 AIRP 回合已开始消费 Runtime Workspace 中的 `agents/master/AGENT.md` 与 `agents/narrative/AGENT.md`，并将 Agent context 注入 master/narrative 两次模型调用。
- 默认 AIRP 回合已支持 runtime 工具循环：Agent 可通过 `<tsian-tool-call>` 请求 `skill_load`、`action_call`、`agent_call`、`workspace_read`、`workspace_list`、`workspace_search`，runtime 将 observation 回灌给同一 Agent。Skill 详情主路径是 `skill_load(name)`；workspace 工具用于 `SKILL.md` 链式引用后的第三层资源读取；`agent_call` 只暴露当前 Agent 的 contacts。
- `skill_load` 会解析已加载 `SKILL.md` 中的 `tsian-actions` fenced JSON 声明，并在同一 Agent 工具循环中解锁对应 action；`action_call` 会先做 loaded Skill gating、action 存在性校验、输入 schema 校验和轻量 executor-class policy 检查，再路由到 action executor registry。默认 policy 代码级允许现有 `builtin`、`platform_action` 和 `browser_script`，可由 runtime capability 注入覆盖，不提供 Settings/localStorage 开关、运行时弹窗或 per-Skill trust 状态。action 可选声明 `outputSchema`；声明后成功 executor 输出会按轻量 type/required/properties 子集校验，不声明则保持旧行为。当前支持 `builtin/validation`、`builtin/echo`、allow-listed `platform_action` 和 strong-SDK `browser_script`。`platform_action` 通过 runtime capability 调用 platform-host 受控动作，当前允许 `workspace-write` / `workspace-delete`；`browser_script` 执行 Skill 目录下的浏览器 Worker 脚本，通过 Tsian SDK 暴露 workspace read/list/search/write/delete、fetch、log/trace 和 timeout/abort，不把 raw DOM、`window`、内部 bridge、Vue 状态或 platform-host 内部对象作为受支持 API。`interaction.sendMessage` 内的 Agent Runtime workspace 写入/删除走 staged transaction，同轮可读，成功回合与 snapshot/history/checkpoint 原子提交，失败/abort 丢弃普通 workspace mutation；前端 bridge `platform.runAction` 仍是即时平台动作。
- contacts-gated `agent_call` 已实现并完成有限嵌套策略。默认 master contacts 包含 memory；被调用 Agent 使用自己的 `AGENT.md`、context、Skill Index 和工具循环，结果作为 observation 返回调用方；协作策略当前为代码级默认值：`maxCallsPerTurn=4`、`maxDepth=2`、`historyMode=minimal/recent/scene` 对应平台控制的窗口大小，并共享 root turn 调用预算。每一跳都必须通过调用方自己的 contacts，depth `2` 再调用会返回带 caller/target/depth/budget 事实的结构化 observation。
- Runtime Trace Persistence MVP 已实现。每个成功回合会写入 `.tsian/traces/turns/turn-*.jsonl`，失败回合在可写时写入 failed trace；trace 记录回合、Agent step、模型调用摘要、Skill 加载、Agent 调用、workspace 工具、action executor policy 检查、action 调用和 workspace mutation。`.tsian/*` 是平台 metadata 空间，普通 bridge/runtime/Skill SDK `workspace_read` / `workspace_list` / `workspace_search` 不暴露它，普通 workspace 写删也不能改它；trace 作为 workspace 文件跟随 checkpoint/restore 回滚，并通过专用诊断资源消费。
- Agent-Facing Runtime Diagnostics 已实现。`runtime-diagnostics` bridge query 会按需从 `.tsian/traces/turns/*.jsonl` 生成 bounded facts-only summary，默认聚焦失败/异常，显式请求时可返回成功回合极简 health summary；它不持久化派生文件、不做 pruning、不提供平台硬编码修复建议或 `nextChecks`，也不默认暴露给普通 master/narrative/memory live-turn Agent。
- Native AIRP History Writeback MVP 已实现。每个成功回合会写入 `history/turns/turn-*.json`，只包含玩家输入和最终 narrative 输出；这些文件是普通 Runtime Workspace 文件，可被 read/list/search 命中并随 checkpoint/restore 回滚，失败回合不会留下普通 raw history 记录。raw history 现在随成功回合 staged transaction 一起提交。
- Agent Session Transcript MVP 已实现。成功回合会把参与 Agent 的 Agent-facing 模型消息、输出、工具调用和 observation 追加到对应 `agents/<agent>/session.jsonl`；失败或 abort 不留下普通 session transcript 写入。该文件是会话记录，不是 bounded operational log。
- Skill-triggered Memory Maintenance MVP 已实现。默认共享 `memory-maintenance` Skill 需要先 `skill_load` 再 `action_call apply_maintenance_plan`，通过 `browser_script` 和 Tsian SDK 在 staged transaction 中写入 `agents/<agent>/notes.md`、`history/timeline.md`、`memory/summaries/current.md` 或 `memory/summaries/long-term.md`。没有显式 Skill action 就不会运行增强记忆维护；空 `writes` 代表显式 no-op。
- Workspace Assistant Template MVP 已实现。内置空白 Game Card 的 `manifest.assistant.agentId` 指向 `studio-assistant`；助手、助手 notes/session、本地 `framework-knowledge` Skill 和临时官方知识库都作为普通 workspace 模板文件分发。它只提供事实查询和管理入口底座，不包含最终助手聊天 UI 或完整首次启动世界创建流程。

当前 foundation phase 已明确不新增独立的远程 executor、WASM、远程脚本加载或托管执行环境。远程 API 交互优先通过现有 `browser_script` + `fetch` 承载，未来只有具体 Skill 无法合理使用 `browser_script`、`platform_action` 或脚本调用远程 API 时才重开 executor 设计。当前代码尚未实现 session transcript 压缩/归档、标准 operational logging、固定每回合记忆维护，或 `agent_call` 的 UI 配置。默认回合仍是 master -> narrative 两个固定 Agent 步骤；每个步骤可能因为 `skill_load`、`action_call`、`agent_call` 或 workspace 工具 observation 产生额外模型调用。

## 3. 当前有效边界

- Platform：模型调用、桥 API、通用存储、会话生命周期、checkpoint、前端包装载。
- Game Card：可分发的 workspace 模板、前端绑定和默认内容入口。
- Agent Runtime：AIRP 回合组织、Agent 分工、工具使用和运行时数据产出。
- Frontend Package：游戏 UI、交互和渲染，只通过 bridge 访问平台能力。
- Save Instance：由 Game Card 创建的一次 AIRP 会话数据容器，内容语义由 runtime 和前端包约定。

平台不硬编码记忆结构、事件/档案语义、MVU 状态表或前端渲染协议。

下一阶段的 Save Instance 数据抽象是 Runtime Workspace：一个存档级虚拟文件系统，用工作区文件/目录承载 Agent 定义、Skill、历史、世界数据、记忆、前端数据、归档和平台 metadata。结构化游戏状态也应融入工作区文件，而不是作为平台理解的固定玩法模型。

## 4. 关键代码入口

- `apps/platform-web/src/platform-host/index.ts`
- `apps/platform-web/src/agent-runtime/index.ts`
- `apps/platform-web/src/storage/db.ts`
- `apps/platform-web/src/storage/game-cards.ts`
- `apps/platform-web/src/bridge/play-frontend-bridge.ts`
- `apps/platform-web/src/views/LobbyView.vue`
- `apps/platform-web/src/views/PlayView.vue`
- `apps/platform-web/src/views/DebugView.vue`
- `packages/contracts/src/runtime.ts`
- `packages/contracts/src/bridge.ts`
- `packages/contracts/src/debug.ts`
- `packages/contracts/src/game-card.ts`
- `builtin/play-frontends/official-default/src/index.ts`

## 5. 下一步建议

优先从这些方向继续：

1. 继续实现 Game Card 方向的下一片：新的平台 UI、游戏卡库/导入导出入口、或未来工作坊/账号系统。
2. 按具体 Skill 需求增强现有 `browser_script` / Tsian SDK / 受控平台动作；不要把独立 `remote_http`、WASM 或托管执行作为默认 foundation 后续项。
3. 在现有 `agent_call` 策略之上继续完善协作体验，例如管理 Agent、协作 Skill、调试 UI、可观察性或未来 host-owned 配置；不要恢复固定团队 DAG。
4. 在 `runtime-diagnostics` facts-only 视图之上继续设计未来管理 Agent / 诊断 Skill / UI 体验；若未来出现新 executor，再按事实补充对应诊断字段。
5. 在 raw history 与 session transcript 底账之上继续完善记忆策略，例如维护 Skill 的提示质量、diff/review UI、summary 压缩、检索索引和 transcript 归档。
6. 围绕 workspace-native state 继续完善默认约定、Skill 维护策略和前端可读取数据文件；不要恢复独立平台状态表。
7. 增加记忆 Agent、状态 Agent 或相关 Skill，但不要把默认事件/档案模型写回平台。
8. 为 Runtime Workspace、Agent、Skill 和 workspace assistant 提供浏览、编辑和管理 UI。

## 6. 历史来源

旧开发历史优先查：

- `.trellis/tasks/archive/`
- `.trellis/workspace/`
- git history

不要把已退役的旧 workflow/prompt/memory 文档当作当前规划依据。
