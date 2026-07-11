# 完善人类与桌面助手可读项目文档

## Goal

完善 Tsian 项目文档，使其同时服务两类读者：

1. **人类读者**：开发者、内容作者、玩家/测试者能快速理解 Tsian 是什么、当前实现到哪一步、如何开始使用或继续开发。
2. **桌面助手**：平台内的桌面助手能够读取稳定、权威、平台通用的项目知识，从而更好地解释 Tsian 概念、区分平台知识与游戏卡知识，并在需要时读取当前游戏卡随卡分发的 `docs/`。

## Confirmed Facts

### Human documentation topology

- 根 `README.md` 已将 Tsian 定位为面向 AIRP 的 Agent 编排运行时平台，并说明核心概念包括 Game Card、Save Instance、Agent、Skill、游戏前端和桌面助手（`README.md:7`, `README.md:13`, `README.md:21`）。
- 根 `README.md` 已导向 `docs/`，并提到桌面助手内置框架知识（`README.md:140`）。
- `docs/README.md` 声明 `docs/` 只保留当前仍有用的文档，并定义冲突优先级：当前代码表示当前实现，active docs 表示当前方向，Trellis tasks 表示历史（`docs/README.md:3`, `docs/README.md:15`, `docs/README.md:40`）。
- 活跃文档入口是 `docs/active/README.md`，其中声明 active 文档的推荐阅读顺序和维护规则；若 active 文档与旧任务、旧 reference 或 archive 冲突，优先相信 active 文档和当前代码（`docs/active/README.md:3`, `docs/active/README.md:5`, `docs/active/README.md:14`, `docs/active/README.md:23`）。
- 当前状态权威汇总在 `docs/active/current-state-handoff.md`，记录 Agent Runtime MVP、Game Card / Save Instance、Runtime Workspace、play bridge、默认卡内容、桌面助手模板等当前实现事实（`docs/active/current-state-handoff.md:16`, `docs/active/current-state-handoff.md:22`, `docs/active/current-state-handoff.md:29`, `docs/active/current-state-handoff.md:42`）。
- 产品与架构方向分别在 `docs/active/airp-workflow-platform-direction.md` 和 `docs/active/agent-framework-runtime-workspace-direction.md`，明确 Tsian 不是旧 workflow 主线，平台不硬编码玩法字段语义，Agent/Skill/Runtime Workspace 是当前主线（`docs/active/airp-workflow-platform-direction.md:7`, `docs/active/airp-workflow-platform-direction.md:17`, `docs/active/airp-workflow-platform-direction.md:82`; `docs/active/agent-framework-runtime-workspace-direction.md:7`, `docs/active/agent-framework-runtime-workspace-direction.md:13`, `docs/active/agent-framework-runtime-workspace-direction.md:20`）。
- 游戏前端开发者已有 SDK 文档入口 `docs/sdk/play-frontend-api.md`，说明 `@tsian/play-bridge` 作为领域 API，目标读者包括前端开发者和生成前端的助手 agent（`docs/sdk/play-frontend-api.md:1`, `docs/sdk/play-frontend-api.md:3`, `docs/sdk/play-frontend-api.md:5`）。
- 桌面助手前端自检能力已有方向文档 `docs/active/assistant-frontend-inspection-direction.md`，说明 `inspect_frontend` 面向真实 `/play` 场景、返回过滤后的 Agent-facing 页面快照，并限制直接调用 play bridge interaction API（`docs/active/assistant-frontend-inspection-direction.md:5`, `docs/active/assistant-frontend-inspection-direction.md:63`, `docs/active/assistant-frontend-inspection-direction.md:90`）。
- `docs/README.md` 与 `docs/active/README.md` 的 active 文档推荐集合不完全一致：前者只推荐部分 active docs，后者列出更多当前 active 文档（`docs/README.md:15`, `docs/active/README.md:5`, `docs/active/README.md:25`）。

### Desktop assistant runtime knowledge sources

- 现有桌面助手实现是平台本地助手，而不是卡内 `studio-assistant`：默认文件由 TypeScript 常量生成，并以虚拟 workspace 文件形式存储在 `.tsian/local/assistant/`（`apps/platform-web/src/storage/local-assistant-files.ts:7`, `apps/platform-web/src/storage/local-assistant-files.ts:19`, `apps/platform-web/src/storage/local-assistant-files.ts:1432`）。
- 默认助手 `AGENT.md` 声明 `knowledge/` 会挂载当前卡的 `docs/`（`apps/platform-web/src/storage/local-assistant-files.ts:28`）。默认助手配置中 `knowledgeMount` 为 `docs/`，workspace access level 为 `4`（`apps/platform-web/src/storage/local-assistant-files.ts:1403`, `apps/platform-web/src/storage/local-assistant-files.ts:1426`）。
- 桌面助手聊天会从 active card/save 构造有效 workspace，然后合并本地助手文件，再通过普通 Agent Runtime 执行（`apps/platform-web/src/platform-host/assistant-chat.ts:334`, `apps/platform-web/src/platform-host/assistant-chat.ts:347`, `apps/platform-web/src/platform-host/assistant-chat.ts:461`）。
- Agent context 会组装 `AGENT.md`、`SOUL.md`、notes、声明的 context files、knowledge files、Skill index 和 Tool index；`knowledgeMount` 文件包含发生在 context 构建中（`apps/platform-web/src/agent-runtime/context.ts:81`, `apps/platform-web/src/agent-runtime/context.ts:124`）。
- `knowledge/...` 到真实 `docs/...` 的路径映射在 runtime workspace operation 层处理（`apps/platform-web/src/agent-runtime/workspace-operations.ts:457`）。
- 默认 Game Card / Runtime Workspace 内容来自 `DEFAULT_WORKSPACE_FILES`，包括 `docs/README.md`、`docs/tsian-framework-knowledge.md`、`docs/novel-airp-schema-guide.md`、`docs/novel-airp-schema-reference.md`（`apps/platform-web/src/storage/workspace-templates.ts:2110`, `apps/platform-web/src/storage/workspace-templates.ts:2393`）。
- 已有用户的本地助手默认文件只会合并缺失路径，不会覆盖已有旧内容；这会影响 AI-facing 文档修复的落地方式（`apps/platform-web/src/storage/local-assistant-files.ts:1495`, `apps/platform-web/src/storage/local-assistant-files.ts:1519`）。

### Known documentation / AI-facing conflicts

- active docs 仍声称 Workspace Assistant Template / `manifest.assistant.agentId` / `studio-assistant` 已实现，但当前 `GameCardManifest` contract 不含 `assistant` 字段，内置空白卡 manifest 当前只有 frontend/runtime，实际助手使用 `.tsian/local/assistant`（`docs/active/current-state-handoff.md:42`, `docs/active/agent-framework-runtime-workspace-direction.md:330`, `packages/contracts/src/game-card.ts:1`, `apps/platform-web/src/storage/game-cards.ts:420`, `apps/platform-web/src/storage/local-assistant-files.ts:7`）。
- active docs 声称默认新 Game Card 包含 `director` Agent；当前默认模板已确认包含 `storyteller`、`researcher`、`stage-manager`、`world-architect`，未在默认模板扫描中发现 `agents/director/*`（`docs/active/current-state-handoff.md:29`, `docs/active/agent-framework-runtime-workspace-direction.md:68`, `apps/platform-web/src/storage/workspace-templates.ts:2143`, `apps/platform-web/src/storage/workspace-templates.ts:2217`, `apps/platform-web/src/storage/workspace-templates.ts:2252`, `apps/platform-web/src/storage/workspace-templates.ts:2314`）。
- active docs 仍有 `activeSceneIds` 表述，但默认模板和助手/card-facing 内容已使用 `activeSceneRefs` 并标记旧字段为 deprecated（`docs/active/current-state-handoff.md:29`, `docs/active/agent-framework-runtime-workspace-direction.md:340`, `apps/platform-web/src/storage/workspace-templates.ts:650`, `apps/platform-web/src/storage/workspace-templates.ts:2674`）。
- 本地助手知识仍包含较旧的 `state/README.md`、`world/`、`save/state/`、`save/history/timeline.md`、event-card memory graph、`save/world/characters/...` 等路径或模型，可能诱导桌面助手推荐旧 schema（`apps/platform-web/src/storage/local-assistant-files.ts:74`, `apps/platform-web/src/storage/local-assistant-files.ts:391`, `apps/platform-web/src/storage/local-assistant-files.ts:1298`, `apps/platform-web/src/storage/local-assistant-files.ts:1393`）。当前 novel AIRP schema 方向强调 `save/entities/<type>/<localId>.json`，避免旧 `save/world/...`（`docs/active/novel-airp-workspace-schema-direction.md:8`, `docs/active/novel-airp-workspace-schema-direction.md:66`）。
- 顶层 `CLAUDE.md` 仍描述旧 `master-agent -> narrative-agent` 模型；当前代码/active docs 的正式玩家回合入口是 `storyteller`，按需联系 `researcher`（`CLAUDE.md:6`, `docs/active/current-state-handoff.md:20`, `apps/platform-web/src/storage/game-cards.ts:430`）。
- `.trellis/spec/guides/ai-facing-content-changes.md` 要求修改 AI-facing surface 时避免留下旧概念残留；删除或替换模型可见概念时应追求 zero surface trace，并对新增限制做 “would it happen anyway?” 测试（`.trellis/spec/guides/ai-facing-content-changes.md:18`, `.trellis/spec/guides/ai-facing-content-changes.md:31`, `.trellis/spec/guides/ai-facing-content-changes.md:52`）。

## Scope Decisions

- D1. 本任务覆盖两层文档：
  - 人类可读的仓库文档入口与维护规则。
  - 桌面助手运行时实际会读取的平台内置知识库。
- D2. 平台级文档必须保持泛用，不绑定当前某个游戏卡或某个游戏卡前端的特定内容；后续游戏卡可替换，平台文档只描述通用边界、能力、排查方式和分发约定。
- D3. 游戏卡相关的世界观、玩法 schema、前端约定、特定排查知识应写入随游戏卡分发的 `docs/`，由桌面助手通过 card docs / knowledge mount 读取，而不是沉淀到平台通用助手知识里。
- D4. 已有用户的助手知识更新应采用玩家主动触发的“更新助手知识”机制，而不是启动时自动覆盖。
- D5. “更新助手知识”只更新平台内置知识库内容；不得修改助手 Agent 的 `AGENT.md`、`SOUL.md`、`notes.md`、`agent.json`、模型/权限配置、用户自定义 Tool/Skill，避免覆盖玩家设置和个人助手风格。
- D6. “更新助手知识”按钮纳入本任务 MVP：提供给已有用户获取最新平台助手知识的产品闭环。
- D7. 平台内置知识库更新范围限定为 `.tsian/local/assistant/skills/framework-knowledge/`；不修改当前游戏卡随卡分发的 `docs/`。
- D8. 助手内置知识库 MVP 暂只写平台通用概念知识和边界，不预设通用问题 SOP；后续在真实使用中沉淀出高频问题后，再补通用问题处理材料。
- D9. “更新助手知识”按钮的 MVP 冲突策略为覆盖 `.tsian/local/assistant/skills/framework-knowledge/` 下的官方知识库文件，并在执行前明确提示；暂不做 diff、逐文件确认、自动合并或备份。
- D10. 顶层 `CLAUDE.md` 已不再作为项目 AI 入口使用，本任务应清理该旧入口，而不是继续维护或重写完整 Claude 专用指南。
- D11. 其它过时入口不主动扩展成全仓旧文档治理；本任务只清理已确认的顶层 `CLAUDE.md`，其它入口在实现中若发现明显误导则处理或记录。
- D12. 文档与助手知识语言风格采用中文为主，保留必要英文术语（如 `Game Card`、`Save Instance`、`Runtime Workspace`、`Agent`、`Skill`、`Bridge`、`checkpoint`、字段名和 API 名）。
- D13. 默认 Game Card 模板的随卡 `docs/` 暂不纳入本任务维护；后续计划将默认卡模板替换为更通用、适合创作的模板，因此当前模板 docs 不应在本任务中继续投入维护成本。
- D14. “更新助手知识”按钮放在助手配置面板内，新增独立“助手知识库”区块，说明只刷新平台内置 `framework-knowledge`，不修改助手身份/风格/笔记/模型配置/自定义工具或当前游戏卡 docs，并在执行前弹确认。
- D15. 新增轻量人类文档地图，落点为 `docs/active/documentation-map.md`，并从 `docs/README.md` / `docs/active/README.md` 链接；用于说明人类文档、平台内置助手知识、游戏卡随卡 docs 的边界和维护位置。
- D16. 平台内置助手知识库保持一个 `framework-knowledge` Skill + 少量 reference 文件，不拆成多个知识 Skill；`SKILL.md` 负责使用时机与阅读顺序，reference 文件承载平台通用概念和边界。
- D17. `framework-knowledge` reference 文件按四份组织：`platform-concepts.md`、`documentation-boundaries.md`、`workspace-and-authoring.md`、`frontend-and-bridge.md`。

## Requirements

- R1. 文档应明确区分并连接三类层级：
  - 面向外部/新人快速理解的项目入口文档。
  - 面向开发者/作者的当前架构、SDK、工作区和维护规则文档。
  - 面向桌面助手的稳定平台知识入口、概念解释和边界说明。
- R2. 文档不得引入与当前代码冲突的旧 workflow-as-system、固定 DAG workflow editor、SillyTavern prompt-engine、旧事件/档案记忆主线等残留主线。
- R3. 给人类看的文档应降低入口成本：能回答“Tsian 是什么、现在能做什么、如何运行、核心概念是什么、下一步看哪篇文档”。
- R4. 给桌面助手看的平台内置知识应适合被 Agent 读取和引用：事实明确、边界清晰、按概念组织，并能引导助手在卡相关问题上读取当前游戏卡 `docs/` 与本地 workspace 文件。
- R5. 桌面助手知识不应只停留在仓库 `docs/`；本任务必须更新其真实运行时可读取的平台内置知识来源 `.tsian/local/assistant/skills/framework-knowledge/`。
- R6. 所有新增/修改文档应标明权威性与维护位置，避免 active docs、reference docs、平台内置助手知识、游戏卡随卡 `docs/` 之间互相复制后漂移。
- R7. AI-facing 文档清理必须避免旧概念残留：被替换的旧路径、旧字段和旧 Agent 模型不能继续出现在助手会读取的表面中，除非明确作为历史/迁移说明且不会诱导助手使用。
- R8. 由于已有用户只会自动合并缺失的本地助手文件、不覆盖旧文件，本任务必须提供玩家主动触发的“更新助手知识”入口，使已有用户也能刷新平台内置知识库。
- R9. 更新助手知识的行为必须保护用户设置：不修改助手 `AGENT.md`、`SOUL.md`、`notes.md`、`agent.json`、模型/权限配置、用户自定义 Tool/Skill 或当前游戏卡 `docs/`。

## Acceptance Criteria

- [ ] AC1. 人类入口文档能从根 README 或 docs README 清楚导向当前可信文档集合，且不要求读者理解旧架构历史才能入门。
- [ ] AC2. 新增 `docs/active/documentation-map.md`，并从 `docs/README.md` 与 `docs/active/README.md` 链接，说明人类文档、平台内置助手知识、游戏卡随卡 `docs/` 的边界与维护位置。
- [ ] AC3. 文档中对 Tsian、Game Card、Save Instance、Runtime Workspace、Agent、Skill、游戏前端、桌面助手等核心概念的解释与当前代码和 active docs 保持一致。
- [ ] AC4. 桌面助手可读的平台内置知识入口被明确定位：`framework-knowledge` 是平台通用知识；当前游戏卡 `docs/` 是卡特定知识；仓库 `docs/` 是维护者文档，不等同于运行时注入内容。
- [ ] AC5. `.tsian/local/assistant/skills/framework-knowledge/` 的默认内容更新为中文为主的一个 Skill + 四份 reference：`platform-concepts.md`、`documentation-boundaries.md`、`workspace-and-authoring.md`、`frontend-and-bridge.md`。
- [ ] AC6. 平台内置助手知识只写平台通用概念和边界，不预设通用问题 SOP，不包含具体游戏卡世界观、具体游戏卡前端 UI 手册或当前默认卡模板特定知识。
- [ ] AC7. 助手配置面板新增“助手知识库”区块和“更新助手知识”按钮；点击前有确认说明，执行后只覆盖官方 `framework-knowledge` 文件，并明确不修改助手身份、风格、笔记、模型配置、自定义 Tool/Skill 或当前游戏卡 docs。
- [ ] AC8. 已知高风险冲突被处理或明确登记为暂缓：`studio-assistant`/平台本地助手模型、`director` 默认阵容、`activeSceneIds` vs `activeSceneRefs`、旧 `save/world`/`save/state`/event-card memory graph 路径、顶层 `CLAUDE.md` 旧入口。
- [ ] AC9. 顶层 `CLAUDE.md` 被清理，不再作为可误导 AI 的旧架构入口；不重写完整 Claude 专用指南。
- [ ] AC10. 默认 Game Card 模板随卡 `docs/` 不在本任务内维护或刷新；文档地图应说明它们等后续通用创作模板重做时再更新。
- [ ] AC11. 对助手会读取的 AI-facing 文档执行旧概念文本检查，确保清理后的平台内置助手知识不会继续诱导助手写旧 schema 或推荐旧架构。
- [ ] AC12. 平台 Web 改动通过 `npm run build:web` 验证；若未改 contracts，不要求 `npm run build:contracts`。

## Out of Scope

- 不在本任务内实现新的桌面助手聊天 UI 或新的 runtime tool。
- 不在本任务内实现 `manifest.assistant.agentId` 或卡内 `studio-assistant`。
- 不在本任务内更新或刷新玩家现有游戏卡的随卡 `docs/`。
- 不在本任务内维护当前默认 Game Card 模板随卡 `docs/`；后续默认卡模板将替换为更通用、适合创作的模板。
- 不在本任务内重做旧架构归档或历史任务索引；旧材料只作为必要背景，不作为当前入口主线。
- 不在本任务内承诺完整玩家手册、创作者手册或通用问题处理 SOP。
- 不主动清理全仓所有旧入口；仅清理已确认的顶层 `CLAUDE.md`，其它入口在实现中若发现明显误导则处理或记录。

## Open Questions

- 无阻塞开放问题。
