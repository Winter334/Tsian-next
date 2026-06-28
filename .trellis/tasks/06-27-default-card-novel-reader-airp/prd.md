# 默认游戏卡小说阅读器 AIRP 重构

## Goal

把默认游戏卡从“空白 AIRP 对话模板”推进为“小说导入 + 阅读器式 AIRP 入口”：玩家进入游戏前端后，通过引导流程导入一本小说到当前存档 workspace，选择扮演原著人物或原创人物，并让 Agent 阵容围绕小说文本组织剧情体验、分支改写和后续同人 AIRP。

## User Value

- 玩家不需要先手工设计世界观、Agent、Skill 或状态文件，也能从一本小说开始游玩。
- 小说文本成为本次存档的可检索 canon/source material，Agent 可按原著合理安排剧情。
- 玩家可以选择“体验原著剧情”或“改变剧情创造分支”，后续可偏离原作但仍维持世界观一致性。
- 默认游戏卡成为 Tsian 的核心样板，展示 workspace、Agent 协作、Skill、状态模型、前端 SDK 的完整闭环。

## Confirmed Facts From Repository

- Tsian 当前定位是 AIRP Agent-Orchestrated Runtime；平台托管模型调用、存储、存档生命周期和前端桥，玩法语义通过 workspace 文件约定表达，不硬编码到平台表模型（`README.md`, `docs/active/airp-workflow-platform-direction.md`）。
- Runtime Workspace 是存档级虚拟文件系统；Game Card 提供初始模板，Save Instance 持有玩家实际游玩的副本；结构化状态、记忆、前端数据都应是 workspace 文件（`docs/active/agent-framework-runtime-workspace-direction.md`）。
- 默认 workspace 已包含 `world/`, `save/world/`, `save/state/`, `save/memory/`, `save/frontend/` 等目录，以及默认 Agent 阵容 master / retrieval / post-processing / studio-assistant 和 world-state-maintenance 等 Skill（`apps/platform-web/src/storage/workspace-templates.ts`）。
- Agent 配置来自 `agents/<agent>/agent.json` + `AGENT.md`，支持 contacts、contextPaths、skills、platformTools、workspaceAccess、knowledgeMount 等字段（`apps/platform-web/src/agent-runtime/registry.ts`）。
- 游戏前端应通过 `@tsian/play-bridge` 领域 API 调平台能力，而不是直接写 postMessage/RPC method。SDK 已暴露 `tsian.send`, `tsian.invokeAgent`, `tsian.history.get`, `tsian.workspace.read/list/search/write`, injection, ask/answer, checkpoints 等能力（`packages/play-bridge/src/tsian-api.ts`, `docs/sdk/play-frontend-api.md`）。
- 当前默认 packaged 前端仍在 `apps/platform-web/src/storage/default-frontend-files.ts` 中以内联字符串形式注入新游戏卡，但项目方向文档要求默认前端应以 `apps/play-frontend-dev/src/main.ts` 为三合一单真相源，打包进默认卡、作为助手起点、作为测试基准（`docs/active/play-frontend-sdk-direction.md`）。这意味着后续可能需要先补齐默认前端构建/注入链路。
- 当前 createDefaultPlatformGameCard 会复制 builtin blank card，然后注入默认 packaged frontend files + binding，并设为 active card（`apps/platform-web/src/platform-host/game-cards.ts`）。

## Product Direction

默认游戏卡应成为一个小说 AIRP 样板，而不是只提供通用聊天框。本任务按“父任务 / 玩法主线任务”处理：先搭建完整玩法骨架与工程化处理管线，再拆分多个可验收子任务逐步实现。

目标方向：

1. 首次进入前端展示引导流程。
2. 玩家导入小说文本，系统写入当前存档 workspace。
3. 系统基于导入内容建立可供 Agent 使用的资料目录、分章、索引/摘要、角色候选、地点/势力、时间线、canon 约束等。
4. 玩家选择游玩身份：原著人物或原创人物。
5. 玩家选择初始模式：尽量体验原著剧情、从某个节点改写、或自由同人 AIRP。
6. Agent 根据小说材料、玩家身份、当前进度和状态文件组织每回合剧情。
7. 前端以小说阅读器为主体验，同时保留 AIRP 操作输入、选项、分支状态、角色档案/世界信息入口。
8. 后续子任务逐步补齐底层能力缺口，例如长文本分块、语义索引、导入格式、状态 action、前端构建链路、Agent/Skill 专门化等。

## Strategy Choice

用户明确倾向 B：先把当前任务变成父任务，一点点搭建整个玩法，而不是只做“导入后立刻能玩”的最小垂直薄片。

进一步决策：第一版应支持“整本导入，但不一次性抽取整本”。整本小说作为当前存档的原始 source corpus 存入 workspace；导入后只抽取起始窗口（例如前 10 章）的主要角色、设定、地点、势力、剧情事件等。玩家选定视角后，由专门 Agent/Skill 基于已抽取资料组装开局。后续随着玩家推进剧情，Agent 一边游玩一边按需阅读、检索、抽取后续章节，并逐步扩展设定集。

这意味着小说 AIRP 的核心不是“一次性建完整世界书”，而是“原文常驻 + 设定集增量派生”：

- 原文是不可变或尽量少改的事实来源。
- 设定集是可更新的派生缓存，服务当前游玩进度与创作需要。
- 角色、地点、事件、势力、关系、时间线等都可以随着剧情发展慢慢积累。
- 人物状态需要支持在场人物、未登场人物、已登场人物、已退场人物等生命周期视图；地点、事件、势力也需要类似的出现/活跃/退场/已知范围管理。
- Agent 可随时阅读/检索源文件，但前端和玩家可见信息不必等同于 Agent 可访问的全部信息。

因此本任务的成功不以一次 PR 完成全部功能为目标，而是：

- 定义小说 AIRP 的长期玩法架构。
- 定义 workspace 数据契约和渐进式处理管线。
- 明确默认前端、Agent 阵容、Skill、状态模型、底层平台能力之间的边界。
- 拆出第一批子任务，每个子任务都能独立验收，并逐步接近完整默认小说游戏卡。

## Initial Recommended Entry Point

在 B 路线下，建议第一阶段不是直接写 UI，而是先完成“玩法地基设计 + 第一批子任务拆解”：

1. 定义小说 AIRP workspace 信息架构：原文、分章/切片、schema、entities、playthrough runtime/frontier/branch、director brief 的目录和最小字段。
2. 定义小说处理管线：导入 → 正规化 → 分章/切片 → 摘要/索引 → 角色/地点/事件抽取 → 玩家开局配置 → 回合中检索/状态维护。
3. 定义 Agent/Skill 分工：哪些职责留给 master/retrieval/post-processing，哪些需要小说专用 Skill 或新 Agent。
4. 定义默认前端演进路线：引导、阅读器、配置页、剧情/分歧可视化、角色档案入口。
5. 定义平台缺口清单：前端文件导入、长文本存储/写入限制、语义索引、后台任务、SDK action 等是否需要补。
6. 拆出第一批可实现子任务，先从不会阻塞后续架构的基础设施开始。

仍然建议保留一个早期“可玩薄片”作为阶段里程碑，但它不再是第一件事；第一件事应是避免后面反复推翻的数据契约和管线边界。

## Spoiler Control Direction

默认玩法采用“Agent 可拥有全局创作视野，但玩家视角严格过滤剧透”的方向。剧透控制不只依赖平台级硬隔离，而应由多层运行模型共同实现：

- 提示词工程：在 master / director / retrieval / post-processing 的 AGENT.md 中明确玩家沉浸、视角限制、剧透边界和 canon 使用方式。
- Skill 指导：提供 spoiler-safety / perspective-filter / canon-briefing 等 Skill，告诉玩家可见叙事在不同情况下该怎么处理未来信息、伏笔、未登场角色和原著结局。
- 工具脚本：必要时提供带 browser_script executor 的 Skill action，快速读取已抽取或已积累的叙事实体信息，并把查询范围限制在“允许被当前叙事使用”的设定集、当前场景、已登场实体或玩家可知范围内，而不是随意扩散到全本小说。
- 专门 Agent：可引入 director / canon-keeper 等非玩家直面 Agent。master 可向它们询问“接下来怎么创作、哪些 canon 约束需要注意、哪些信息不能泄露”，由它们返回经过过滤的创作 brief。
- 可见性标记：派生实体与事件应携带类似 `known-to-player` / `unrevealed` / `future-spoiler` / `director-only` 的可见性或使用限制，支持在场人物、未登场人物、已登场人物、已退场人物，以及地点、事件、势力等的生命周期管理。

该方向仍需讨论具体运行模型：哪些 Agent 能读全书原文，哪些 Agent 只能读派生设定或 filtered brief；哪些约束通过 prompt/Skill 软执行，哪些需要通过 workspaceAccess、工具 action 或目录契约硬化。

## Director Brief Cache Direction

默认运行模型采用“soft restriction + cached director brief”：

- master 默认不直接检索或阅读全本小说原文，但第一版不做平台级硬限制；通过 AGENT.md、Skill 和流程提示引导它优先读取玩家可见设定、当前场景、当前创作方向文件和受限查询结果。
- director / canon-keeper / retrieval 可以在需要时读取更大范围乃至全书原文，用于理解 canon、未来因果、伏笔和分支风险。
- director 不需要每回合都通过 `agent_call` 介入。它可以在开局组装、剧情明显偏离、source frontier 接近耗尽、玩家进入新地点/新事件线、master 判断方向不明、或固定若干回合后，更新一个 workspace 中的创作方向缓存文件。
- post-processing 默认负责每回合结束后的维护判断：检查当前创作方向是否缺失、过期、与玩家行动冲突、或剧情偏离超过阈值；必要时 call director/canon-keeper 刷新缓存。master 每回合优先读取缓存文件，只有当缓存明显不适用且后台尚未刷新时才主动请求 director。
- 创作方向缓存应是 master-safe 的 filtered brief，但不应写成过细的分镜或剧情脚本。AIRP 需要保留玩家与 master 的创作自由度，因此 brief 主要提供：当前阶段目标、剧情基调边界、可用叙事实体清单、需要避免的走偏方向和必要 canon 约束。
- 可用叙事实体包括但不限于人物、事件、地点、势力、物品、传闻、冲突、关系、谜团、资源等，只要能拿来创造剧情即可。brief 里只放简短介绍和使用提示；详细信息放在 workspace 对应实体文件中，或通过 Skill action / 工具脚本按允许范围读取。
- brief 的目标是避免 master 不知道素材而硬编，同时避免把未来剧透、director 私有计划或过细剧情安排暴露给玩家可见叙事出口。
- 如果需要保存 director-only 的未来规划或 canon 风险，可以单独放在明确标记的目录/文件中，并通过提示词约束 master 不读取；第一版不依赖硬权限隔离，后续如有必要再引入更硬的 workspace access 或专用查询 action。

建议的文件形态示例：

```text
save/director/current-brief.md              # master 每回合可读的当前创作方向，必须防剧透
save/director/current-brief.meta.json       # 基于哪些章节/实体/turn 生成，何时过期
save/playthrough/frontier.json              # 当前 source frontier、已抽取窗口、剧情偏离度
save/entities/<type>/<localId>.json         # 派生实体设定，带 visibility/sourceRefs/lifecycle
save/playthrough/branch.json                # 玩家分支摘要，不改写原著 source corpus
```

`current-brief.md` 的内容应更接近：

```md
# 当前创作方向

## 阶段目标
维持玩家在客栈夜谈中的悬疑感，让玩家自然意识到门派内部存在异常，但不解释幕后真相。

## 基调边界
- 悬疑、压迫、克制，不要变成插科打诨或无厘头打斗。
- 允许玩家主动调查，也允许玩家绕开原著路径，但世界反应应保持严肃可信。

## 可用叙事实体
- 人物：店小二 —— 熟悉客栈人流，最近说话前后矛盾；详细见 `save/entities/character/...`。
- 地点：二楼东侧客房 —— 夜间出现短暂争执声；详细见 `save/entities/location/...`。
- 事件：北境来客入住 —— 可作为引出紧张气氛的素材；详细见 `save/entities/event/...`。

## 不要走偏
- 不要直接揭示未登场角色的真实身份。
- 不要提前说明三章后的重大灾难。
- 不要用旁白替玩家解释谜底。
```

该方向把 agent_call 从“每回合固定步骤”变成“缓存刷新机制”：降低成本和延迟，也让 master 的叙事连续性更稳定，同时保留 AIRP 的自由创作空间。

## Schema Design Guide / Simple Frontend-readable Fields Direction

默认游戏卡的目标是“小说阅读器 + AIRP”，玩家可能导入任意题材小说。因此不应内置某个专用题材 schema，也不应试图设计一个覆盖所有题材的巨型通用 schema。

正确方向是：提供一套 **Schema Design Guide**，指导 Agent 在导入和初始抽取阶段，根据当前小说的题材、世界观、叙事重点和前端展示需求，为“这本小说 / 这个存档”设计合适的 workspace schema。

小说 AIRP v0 不建立独立 `save/render/` 层，也不把语义数据再投影到单独的前端渲染缓存。前端第一版直接读取 entity/runtime 中少量普通、稳定、容易理解的字段；题材专属细节仍保留在实体 JSON、Markdown 说明或后续可扩展字段中。

新小说模板替换旧默认 workspace 规范。旧存档和其他卡可以继续使用旧约定，但新默认小说卡不应同时分发旧 `save/world` / `_ref` / `_dir` / `save/render` 指南。

默认卡应提供的不是“修仙 schema / 奇幻 schema / 悬疑 schema”，而是：

1. **Schema 设计流程**：Agent 如何阅读小说前若干章、识别题材要素、决定哪些实体类型和规则数据值得结构化。
2. **Schema 文档落点**：本存档采用的 schema 写入 `save/schema/current.md`，演进记录写入 `save/schema/changelog.md`、`save/schema/deprecated.md` 和 Markdown patch。
3. **通用实体核心**：所有题材都大概率需要的最小字段：`id`、`name`、`brief`；推荐字段包括 `aliases`、`visibility`、`lifecycle`、`origin`、`sourceRefs`、`tags`、`status`、`fields`、`sections`、`updatedAtTurn`、`updatedBy`。`visibility` 默认可省略，省略表示普通玩家可见数据；只有 hidden / future-spoiler / director-only 等例外需要显式声明。
4. **实体落点**：实体 id 采用 `<type>:<localId>`，主文件路径为 `save/entities/<type>/<localId>.json`；entity 文件默认不重复写 `type` 或 per-file `schema`。
5. **简单前端可读字段**：默认前端可读取 `name`、`brief`、`tags`、`status`、`fields`、`sections` 和 `save/playthrough/runtime.json` 中的 runtime summaries。
6. **扩展边界**：大部分小说靠普通实体/runtime 字段 + Agent 设计 schema 适配；少数特殊需求允许玩家/助手后续修改前端或新增专用读取逻辑，但不把 v0 做成通用卡片/数值/仪表盘引擎。

普通实体可以长这样：

```json
{
  "id": "character:萧玄",
  "name": "萧玄",
  "brief": "青玄门外门弟子，当前卷入山门冲突。",
  "origin": "canon",
  "sourceRefs": ["save/source/chapters/chapter-0001.md"],
  "tags": ["青玄门", "外门弟子"],
  "status": [
    {
      "id": "injury:右臂轻伤",
      "level": "minor",
      "description": "挥剑时略有迟滞。"
    }
  ],
  "fields": [
    { "label": "当前位置", "value": "青玄门山门" },
    { "label": "境界", "value": "炼气后期" }
  ],
  "sections": [
    { "title": "当前目标", "body": "查清山门冲突的起因。" }
  ]
}
```

这不是修仙专用 schema；修仙、现代、科幻、悬疑都可以把需要展示的状态整理为这些普通字段。前端不解析自然语言引用，不理解题材内部语义，只显示稳定字段。需要可解析引用时使用显式结构：`{ "ref": "character:萧玄", "name": "萧玄" }`。

`sourceRefs` 第一版使用简单 path string，例如 `save/source/chapters/chapter-0001.md`。如果后续需要更精确证据，再添加小型 `evidence` 数组；不要默认引入复杂 source span 对象。

## Living Schema / Schema Evolution Direction

小说 schema 不是一次性初始化产物，而是随游玩与抽取进度演进的活文档：

- 导入初期只能看到起始章节窗口，不能假设已理解全书设定。
- 随着剧情推进、source frontier 扩展和玩家分支产生，可能出现新概念、新实体类型、新规则字段、新状态面板。
- 旧概念、旧设定、旧实体类型也可能退场、降级为背景资料，或被玩家分支改写。
- schema 需要支持新增、弃用、兼容和 changelog，而不是“确定后永不变化”。

建议提供专门的 schema-maintenance Skill 给特定后台 Agent 使用。该 Skill 负责：

1. 生成初始 schema 草案，供玩家确认或微调。
2. 读取当前小说抽取进度、已维护实体、前端普通字段需求和 branch 状态。
3. 提出 schema patch：新增实体类型、字段、状态约定、关系结构或玩法规则数据块。
4. 标记旧 schema 的 deprecated 字段或退场概念，而不是直接删除导致旧数据不可读。
5. 维护 schema 变更原因、适用范围和兼容说明。
6. 对需要玩家/作者决策或可能迁移数据的变化，生成 Markdown pending patch。

workspace 落点：

```text
save/schema/current.md                 # 玩家/Agent 可读的当前 schema 说明，v0 权威
save/schema/changelog.md               # schema 演进记录
save/schema/patches/pending/*.md       # 待确认或待应用的 Markdown schema patch
save/schema/patches/applied/*.md       # 已应用 patch 记录
save/schema/deprecated.md              # 已退场概念、字段和兼容策略
```

`current.json` 不默认创建。若后续工具或前端确实需要机器可读索引，它也应是可重建 helper index，不是第二权威来源。

schema 维护应尽量保护前端可读普通字段的稳定性：

- 新增可选实体类型、可选字段、tag/status 约定或 README 说明通常安全，可直接更新 `current.md` + `changelog.md`。
- 删除字段、改名字段、改变字段含义、引入严格数值机制、把背景概念提升为玩法系统、改变前端重要普通字段或要求数据迁移，应写入 `save/schema/patches/pending/*.md` 等待确认。
- patch 使用 Markdown，不引入 JSON Patch 或迁移引擎。
- 退场概念优先用 lifecycle/status/visibility 标记，不优先删除。

## Schema Agent / Opening Setup Direction

需要引入一个专门的后台 Agent，暂称 `schema-curator` / `world-architect`。它不只是维护 schema，也负责小说导入后的开局设计与世界适配。

职责边界：

- **导入后 / 开局前**：读取起始章节窗口与抽取结果，识别题材、核心设定、主要实体类型、前端展示需求和玩家可能关心的玩法维度；生成 schema 草案，供玩家确认或微调。
- **开局组装**：在玩家选择原著人物 / 原创人物、剧情跟随 / 改写 / 自由同人后，基于已确认 schema、已抽取 canon、玩家偏好和防剧透边界，组装开局资料、初始角色状态、初始场景、初始 director brief。
- **后续演进**：当 post-processing 发现当前 schema 过时、source frontier 出现新概念、新规则、新实体类型、前端需要新的普通字段约定，或旧概念退场时，call schema-curator/world-architect 生成 schema patch 或兼容说明。
- **输出形式**：它不直接写玩家可见正文，而是写/更新 schema、开局配置、entity/runtime 字段约定、Markdown schema patch、兼容说明和必要的 director-safe brief。

post-processing 的角色：

- 每回合后检查 schema 是否仍适配当前剧情与抽取资料。
- 发现缺口时 call schema-curator/world-architect，而不是自己临场发明新 schema。
- 应用已批准或可自动应用的 schema patch，并维护 changelog / deprecated 记录。

建议默认 Agent 阵容演进为：

```text
master              # 玩家直面叙事出口
retrieval           # 检索小说 source、canon、实体资料
post-processing     # 回合后维护：状态、记忆、schema 过期检测、brief 刷新判断
world-architect     # schema 设计、开局组装、世界适配、schema patch
# 可后续拆出 director / canon-keeper，但第一版可由 world-architect 或 retrieval 兼任部分职责
```

该设计保留 post-processing 的高频维护优势，同时避免它承担过多“世界模型设计 / 开局策划 / schema 架构”的重职责。

## Requirements Draft

- 默认游戏卡的新建结果应包含小说 AIRP 所需的默认 workspace 文件、Agent 指令、Skill 和前端绑定。
- 游戏前端应提供首次引导状态，而不是直接显示“故事尚未开始”。
- 引导流程至少能把小说内容保存到当前 Save Instance 的 workspace 中，不回写 Game Card 模板。
- 引导流程至少记录玩家选择：扮演原著人物 / 扮演原创人物。
- 引导流程至少记录玩家游玩倾向：体验原著剧情 / 从某点改写 / 自由同人。
- Agent 应能读取小说材料和玩家设置，并在回合中尊重 canon、当前进度和分支意图。
- 结构化状态应以 workspace 文件表达；平台不新增硬编码小说表模型，除非垂直薄片证明必须补平台能力。
- 前端实现应遵守 play-bridge SDK 方向：表现层使用领域 API，不直接操作 postMessage 或 RPC method 字符串。

## Acceptance Criteria Draft

- [ ] 新建默认游戏卡并进入游戏前端时，玩家看到小说导入/设置引导，而不是普通空白聊天。
- [ ] 玩家可以导入或粘贴一段小说文本，完成后可在 workspace 中看到对应源文本和引导状态文件。
- [ ] 玩家可以选择原著人物或原创人物身份，并且该选择被持久化到当前存档 workspace。
- [ ] 玩家可以选择剧情跟随/改写倾向，并且该选择被 Agent 回合使用。
- [ ] 完成引导后，玩家发送第一条行动，Agent 能基于小说内容输出合理剧情正文。
- [ ] 至少一个状态/记忆/剧情进度文件会在成功回合后更新，且 checkpoint/回溯仍按现有存档机制工作。
- [ ] 前端只通过 `@tsian/play-bridge` 领域 API 与平台通信。
- [ ] 规划阶段产出 `design.md` 和 `implement.md`，明确哪些是第一阶段垂直薄片、哪些延后。

## Out Of Scope Draft

- 大规模版权/DRM/云端书库/在线爬书。
- 长篇小说的完美全文理解与全局一致性保证。
- 正式 marketplace、游戏卡分享审核和作者版权声明流程。
- 多格式电子书完整解析（epub/pdf/docx）作为第一阶段目标。
- 平台硬编码小说/角色/事件数据库模型，除非后续设计明确证明必要。

## Open Questions

1. 第一阶段的目标体验应更偏“导入后立刻开始玩”的最小闭环，还是更偏“先做可扩展的小说工程化处理管线”（分章、索引、角色抽取、时间线、canon 校验）？
2. 小说内容第一阶段以什么输入范围为目标：短文本/章节级，还是整本长篇？
3. 默认前端是否应先迁移到 `apps/play-frontend-dev` 单真相源再做小说 UI，还是可先在现有 packaged inline 前端上验证体验？
4. 状态契约第一版应强约束到 JSON schema，还是用 README + 少量 JSON 文件软约定先跑通？
5. Agent 阵容第一版是否沿用 master/retrieval/post-processing，还是引入 novelist/director/canon-keeper 等小说专用 Agent？
