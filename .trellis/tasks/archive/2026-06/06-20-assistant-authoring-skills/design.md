# Design: Assistant Authoring Skills

## Boundaries

本任务只改 1 处代码：`apps/platform-web/src/storage/local-assistant-files.ts`。在 `defaultLocalAssistantFileMap()` 加 4 skill 的 SKILL.md（+ 可选 scripts）+ 改 `defaultAssistantConfig()` 的 `skills.enabled`。

不碰：agent-runtime、registry、workspace-tools、contracts、platform-host。

## Skill 机制回顾（勘察结论）

- skill 路径 `.tsian/local/assistant/skills/<skill>/SKILL.md` 被索引（`registry.ts:40-42` 的 `.tsian/local/<agent>` 分支）。
- `enabled` 非空时白名单短路（`registry.ts:711`）——必须把新 skill 名加进 `agent.json` 的 `skills.enabled`。
- `use_skill` 按需注入完整 SKILL.md；`run_script` 跑 `browser_script`（Web Worker，`tsian.workspace.*` SDK）。
- action 声明在 SKILL.md 的 ```` ```json tsian-actions ```` fence，`executor.type` 仅 `browser_script`，`path` 在 skill 目录内，`timeoutMs ≤ 60000`。
- 脚本路径 `scripts/<x>.js` 相对 skill 目录，运行时自动 prepend skill directory（`workspace-tools.ts:1474`）。

## Each Skill Design

### agent-authoring（纯指导，无 action）

```yaml
---
name: agent-authoring
title: Agent Authoring
description: Generate and validate agent.json / AGENT.md / SOUL.md files for the Runtime Workspace.
triggers:
  - The user wants to create or modify an Agent
  - The user asks about agent.json schema, permissions, contacts, or contextPaths
appliesTo:
  - assistant
---
```

body：AgentConfig schema 速查（字段表）+ 权限层级约定（level 1 运行时 / level 4 助手）+ AGENT.md vs SOUL.md 内容边界 + 生成流程（问 id/title/summary/contacts → 生成 agent.json → 生成 AGENT.md 骨架 → 可选 SOUL.md）+ 校验清单（id 非空、contextPaths 存在、skills/platformTools 格式）。

无 action——生成靠助手用 `workspace_write` 直接写文件（level 4）。

### skill-authoring（纯指导，无 action）

```yaml
---
name: skill-authoring
title: Skill Authoring
description: Generate and validate SKILL.md files with frontmatter and optional tsian-actions declarations.
triggers:
  - The user wants to create or modify a Skill
  - The user asks about SKILL.md format, action declarations, or browser_script executors
appliesTo:
  - assistant
---
```

body：frontmatter 规范（name/title/description/triggers/appliesTo）+ `tsian-actions` fence 模板 + executor 约束（type=workerscript, path 相对 scripts/, timeoutMs≤60000）+ inputSchema/outputSchema 规范 + 生成流程 + 校验清单（path 在 skill 目录内、executor.type 仅 browser_script、timeout 上限、inputSchema root object）。

无 action——校验靠助手读文件 + 比对规则。

### card-content-drafting（带 1 个校验 action）

```yaml
---
name: card-content-drafting
title: Card Content Drafting
description: Draft world canon, characters, timeline, and memory summaries for game card content.
triggers:
  - The user wants to build a world, characters, timeline, or memory
  - The user wants to draft or flesh out game card content
appliesTo:
  - assistant
---
```

body：卡内容目录约定（world/ history/ memory/ state/）+ 起草流程（问世界设定 → canon.md → 角色 → timeline → memory summaries）+ 模板片段（canon/timeline/summary 骨架）+ 引导替代空壳。

带 `validate_workspace_layout` action：

```json tsian-actions
[
  {
    "name": "validate_workspace_layout",
    "description": "Check that key workspace directories and README files exist; report missing conventions.",
    "inputSchema": { "type": "object", "properties": { "paths": { "type": "array" } } },
    "outputSchema": { "type": "object", "required": ["schema","ok","missing"], "properties": { "schema":{"type":"string"}, "ok":{"type":"boolean"}, "missing":{"type":"array"}, "present":{"type":"array"} } },
    "executor": { "type": "browser_script", "path": "scripts/validate-workspace-layout.js", "timeoutMs": 10000 }
  }
]
```

`scripts/validate-workspace-layout.js`：用 `tsian.workspace.list`/`read` 检查 `world/README.md`、`history/README.md`、`memory/README.md`、`agents/README.md`、`skills/README.md` 等存在性，返回 `{schema, ok, missing[], present[]}`。只读不写。复用 `apply-maintenance-plan.js` 的结构模式（PLAN_SCHEMA 常量 + fail() + 返回对象）。

### framework-knowledge 增强（扩展现有 SKILL.md）

扩 `DEFAULT_FRAMEWORK_KNOWLEDGE_SKILL_MD`（`local-assistant-files.ts:54`）内容，补：

- workspace 三层 scope 权限矩阵（card-content: read 0/edit 2；save-runtime: read 0/edit 1；platform-meta: read 4/edit 4，源 `workspace-operations.ts:93`）。
- skill 生命周期（索引→use_skill 注入→run_script 执行）一句话。
- 助手 vs 运行时 agent 边界（助手 level 4 跨 scope，运行时 agent level 1 只 save-runtime）。
- 不改 frontmatter（name/triggers/appliesTo 不变），只扩 body。

## agent.json enabled 更新

`defaultAssistantConfig()`（`local-assistant-files.ts:82`）：

```ts
skills: {
  enabled: ["framework-knowledge", "agent-authoring", "skill-authoring", "card-content-drafting"],
  disabled: [],
},
```

## defaultLocalAssistantFileMap 扩展

加 4 个 key（path → content）：

```ts
[`${LOCAL_ASSISTANT_DIR}/skills/agent-authoring/SKILL.md`]: { content: AGENT_AUTHORING_SKILL_MD, mediaType: "text/markdown" },
[`${LOCAL_ASSISTANT_DIR}/skills/skill-authoring/SKILL.md`]: { content: SKILL_AUTHORING_SKILL_MD, mediaType: "text/markdown" },
[`${LOCAL_ASSISTANT_DIR}/skills/card-content-drafting/SKILL.md`]: { content: CARD_CONTENT_DRAFTING_SKILL_MD, mediaType: "text/markdown" },
[`${LOCAL_ASSISTANT_DIR}/skills/card-content-drafting/scripts/validate-workspace-layout.js`]: { content: VALIDATE_WORKSPACE_LAYOUT_JS, mediaType: "text/javascript" },
```

framework-knowledge 已有 key，只改其 content 常量。

## Migration Consideration

`loadLocalAssistantFiles` 首次运行 seed defaults（`local-assistant-files.ts:152`）。已存在的用户：map 已持久化，新 skill 不会自动出现。需在 `loadLocalAssistantFiles` 加 merge 逻辑——检查缺失的 default key 补上（类似 `saveLocalAssistantFiles` 的合并模式）。或接受"老用户手动"——但出厂自带是需求，故加 merge。

merge 策略：load 时若 stored map 缺某 default key，补入并 persist（仅补不覆盖用户改过的）。这复用现有 `saveLocalAssistantFiles` 的合并写法。

## Tradeoffs

- **校验脚本 vs 纯指导**：card-content-drafting 带一个只读校验 action 演示 run_script 闭环；agent/skill-authoring 纯指导（生成靠 workspace_write，校验靠助手读+比对，避免每个 skill 都带脚本）。
- **framework-knowledge 增量 vs 重写**：增量扩 body，保 frontmatter 不变，避免破坏现有触发。
- **merge 逻辑 vs 老用户手动**：加 merge，保证出厂自带对老用户也生效。

## Compatibility / Rollback

- 纯数据扩展，不改现有行为。
- 回滚：还原 `local-assistant-files.ts`（git checkout）。老用户已 persist 的 map 不受影响（merge 只补不删）。
