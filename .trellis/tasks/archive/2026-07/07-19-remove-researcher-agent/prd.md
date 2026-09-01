# 移除资料员 Agent

## Goal

移除已经失去独立职责的 `researcher` / 资料员 Agent，避免其他 Agent 继续通过 `agent_call` 依赖它，也避免新卡/新存档继续生成无用的资料员资源。资料检索、原著剧情方向、实体/场景/关系读取等能力已经拆解到 storyteller 注入、专用工具、Skill 或 world-architect / stage-manager 自身上下文中。

## Background

### 用户意图

用户确认：资料员 Agent 的职责已经被拆解分发，目前没有保留价值，希望移除。

### 已确认引用范围

当前仓库仍有两类 researcher 引用：

1. **当前沉浸阅读器卡内容**
   - `cards/沉浸阅读器.tsian-card/workspace/agents/researcher/`：资料员 Agent 目录，含 AGENT.md / SOUL.md / agent.json / 两个 Skill。
   - `cards/沉浸阅读器.tsian-card/game-card.json`：资源清单列出 5 个 researcher 文件。
   - `cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/agent.json`：contacts 含 `researcher`。
   - `cards/沉浸阅读器.tsian-card/workspace/agents/world-architect/agent.json`：contacts 含 `researcher`。
   - `cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/AGENT.md`：写有“需要事实时 call 资料员”。
   - `cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/skills/schema演进检查/SKILL.md`：写有“需要事实材料时 call 资料员”。
   - `cards/沉浸阅读器.tsian-card/workspace/agents/world-architect/AGENT.md`：写有“需要源文本或实体事实时 call 资料员”。
   - `cards/沉浸阅读器.tsian-card/workspace/README.md`、`docs/tsian-framework-knowledge.md`、`docs/novel-airp-schema-guide.md`、`docs/novel-airp-schema-reference.md`：仍描述 researcher / 资料员。

2. **platform-web 默认 workspace 模板**
   - `apps/platform-web/src/storage/workspace-templates/agents/researcher.ts`：定义并导出 researcher Agent 与 Skill 文件。
   - `apps/platform-web/src/storage/workspace-templates/files.ts`：导入并展开 `RESEARCHER_AGENT_FILES` / `RESEARCHER_SKILL_FILES`，默认 README / agents README / save runtime notes 也提到 researcher。
   - `apps/platform-web/src/storage/workspace-templates/constants.ts`：`DEFAULT_SAVE_RUNTIME_UPGRADE_FILE_PATHS` 包含 `save/agents/researcher/notes.md`。
   - `apps/platform-web/src/storage/workspace-templates/agents/storyteller.ts`：文风学习 Skill 和 storyteller 配置仍提到 call researcher；默认 `contacts: ["researcher"]`。
   - `apps/platform-web/src/storage/workspace-templates/agents/stage-manager.ts`：contacts 和提示词仍提到 researcher / 资料员。
   - `apps/platform-web/src/storage/workspace-templates/agents/world-architect.ts`：contacts 和提示词仍提到 researcher / 资料员。
   - `apps/platform-web/src/storage/workspace-templates/docs/airp.ts`、`docs/framework.ts`：默认阵容和 frontier 说明仍提到 researcher / 资料员。

### 已迁移/替代能力证据

- storyteller 当前卡配置已无 `contacts` / `agent_call`，不再依赖资料员；它已有前端 runtime/scene/protagonist/timeline 注入、read_entity/read_scene/read_relationships 工具、历史召回 Skill。
- stage-manager 的标准流程已经通过 `read_maintenance_context({ includeTimeline: true })` 聚合 turn/runtime/activeScenes/entities/relationships/timeline，并且自身可读 `frontier.json`。
- world-architect 在 frontier 推进流程中通过自身 source/window 工具读取源章节并抽取实体/关系/schema 增量，不需要资料员中转。
- 原著剧情方向已通过本轮完成的 timeline 注入提供给 storyteller；不是由资料员提供。

## Requirements

### R1. 删除 researcher Agent 资源

- 删除当前卡内 `workspace/agents/researcher/` 目录。
- 从 `game-card.json` 资源清单移除所有 `workspace/agents/researcher/**` 条目。
- 若同步修改默认模板，则删除 `apps/platform-web/src/storage/workspace-templates/agents/researcher.ts` 并移除其导入/展开。

### R2. 移除 contacts 中的 researcher

- 从 stage-manager / world-architect / storyteller 的 `contacts` 中移除 `researcher`。
- 若移除后某 Agent 不再需要 `agent_call`，不在本任务强行移除 `agent_call`；只删除失效 contact，避免顺手改变其他协作能力。

### R3. 清理 AI-facing 文本中的资料员依赖

- AGENT.md、Skill、docs、README 中不能再指导 Agent “call 资料员”。
- 替换为当前能力边界：
  - stage-manager：使用 `read_maintenance_context` 和定向读取；缺少 schema 设计判断时 call world-architect。
  - world-architect：使用自身 source/frontier/opening 工具和 workspace 读取；需要开局正文时 call storyteller。
  - storyteller：使用注入上下文、专用工具、历史召回 Skill；不通过资料员查事实。
- 对 AI-facing 内容按“移除概念即零表面残留”原则处理；不要留下“资料员已移除”“以前由资料员负责”这类会让 Agent 继续思考资料员的说明。

### R4. 清理默认 save runtime researcher notes

- 若同步修改默认模板：不再新建 `save/agents/researcher/notes.md`。
- 不对既有用户存档做破坏性删除迁移；升级路径最多停止新增该默认文件。

### R5. 不扩大到历史文档清理

- `docs/active/**` 和 `.trellis/**/archive/**` 是历史记录，本任务不要求清理其中的 researcher 旧设计记录。
- 验收 grep 时应区分历史文档与当前模板/卡内容。

## Acceptance Criteria

- 当前卡中不存在 `workspace/agents/researcher/` 资源和 `game-card.json` 对应条目。
- 当前卡的 active Agent 配置和 AI-facing prompt/doc 不再引用 `researcher` / `资料员` / `资料检索`。
- 若同步修改默认模板：新建默认 workspace 不再包含 researcher Agent、researcher Skill、researcher notes 或 researcher contact。
- `apps/platform-web` 构建通过，或若构建失败需明确失败原因与是否为既有问题。
- 不修改 platform contracts，不引入新 Agent 替代 researcher。

## Scope Decision

用户确认：本任务同时清理当前沉浸阅读器卡内容与 `apps/platform-web/src/storage/workspace-templates/**` 默认模板。目标是当前卡和未来默认 workspace 都不再生成、引用或提示调用 researcher / 资料员。
