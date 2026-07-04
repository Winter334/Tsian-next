# 默认 AIRP Agent 与 Agent-local Skill 模板重写设计

## 1. Scope Decision

本任务只重写默认卡模板与 AI-facing 文档，使新建默认 Game Card 进入新的 AIRP 后台剧组架构。平台能力已满足本任务前置条件：

- `send` 的正式回合入口来自 `game-card.json` 的 `runtime.entrypoints.playerTurn`。
- `invokeAgent` 支持 invocationId 与流式事件，后续前端可指定 `stage-manager` 等 Agent。
- Agent-local Skill registry 已支持 `agents/<agent>/skills/<skill>/SKILL.md`。

本任务不实现后续前端编排和行动裁定脚本，只确保默认模板具备这些任务的目标 Agent / Skill / mode 文件。

## 2. Manifest Entrypoint

当前默认内置卡 manifest 显式配置：

```json
"runtime": {
  "entrypoints": {
    "playerTurn": "master"
  }
}
```

本任务迁移为：

```json
"runtime": {
  "entrypoints": {
    "playerTurn": "storyteller"
  }
}
```

同时更新内置卡 staleness 检查，避免旧 built-in row 被误判为 current。

## 3. Default Agent Roster

默认卡 content files 从旧四 Agent：

```text
master
retrieval
post-processing
world-architect
```

迁移到五 Agent：

```text
storyteller       # title: 说书人
researcher        # title: 资料员
stage-manager     # title: 场记
world-architect   # title: 世界架构师
director          # title: 导演
```

### 3.1 storyteller / 说书人

职责：

- 正式玩家回合入口。
- 读取 brief、runtime、schema、可见实体/场景摘要，续写剧情正文和选项。
- 信息不足时读取少量 workspace 或 `agent_call` 资料员。
- 只使用已启用玩法；不判断 deferred 玩法是否应启用。
- 不维护 runtime/entity/schema/status bar。
- 不每轮自行 call 场记。

建议配置：

- contacts: `researcher`
- contextPaths: `README.md`、`docs/novel-airp-schema-guide.md`、`save/director/current-brief.md`、`save/playthrough/runtime.json`、`save/schema/current.md`
- platformTools: `agent_call`, `workspace_read`
- workspaceAccess.level: `1`
- entryMode: `persistent`
- system: `true`

### 3.2 researcher / 资料员

职责：

- 只读检索 source/entity/scene/relationship/schema/brief。
- 按调用方问题返回精炼事实。
- 不讲故事、不写存档、不判断玩法启用。

建议配置：

- contacts: `storyteller`, `stage-manager`, `world-architect`, `director`
- contextPaths: source/entity/scene/relationship/schema docs
- platformTools: `workspace_read`, `workspace_semantic_search`
- local skills: `实体读取`, `资料检索`

### 3.3 stage-manager / 场记

职责：

- 后续默认 novel 前端在正文完成后通过 `invokeAgent("stage-manager", ...)` 调用。
- 读取刚完成 turn、runtime、active scene、相关 entity。
- 更新 runtime/entities/scenes/relationships/memory/status extensions。
- 已启用玩法的状态维护。
- 对 deferred 玩法提出后台建议；不前台打断玩家。
- 发现 schema 空缺或新长期概念时 call 世界架构师。

建议配置：

- contacts: `researcher`, `world-architect`, `director`
- contextPaths: schema/runtime/director/scenes/relationships/mode
- platformTools: `workspace_read`, `workspace_write`, `agent_call`
- local skills: `状态栏维护`, `schema演进检查`, `行动裁定`

### 3.4 world-architect / 世界架构师

职责：

- 开局理解小说与玩家设定，建立初始 schema/entities/scenes/relationships/runtime/mode。
- 玩法启用时初始化 rules/schema/runtime 骨架。
- 后续处理 schema 空缺、pending patch、玩法启用方案。
- 不写开局正文，不维护每回合 runtime。

建议配置：

- contacts: `researcher`, `stage-manager`, `director`
- contextPaths: schema/source/frontier/mode/scenes/relationships
- platformTools: `workspace_read`, `workspace_write`, `workspace_semantic_search`, `agent_call`
- local skills: `开局建模`, `玩法启用`, `行动裁定`

### 3.5 director / 导演

职责：

- 维护 `save/director/current-brief.md` 与 meta。
- 管理节奏、伏笔、原著/分支平衡。
- 开局时在建模后写初始 brief；后续由前端低频调用或由场记标记过期后调用。
- 不整理 runtime/entity，不直接面向玩家。

建议配置：

- contacts: `researcher`, `stage-manager`, `world-architect`
- contextPaths: director brief/meta、schema、runtime、source README
- platformTools: `workspace_read`, `workspace_write`, `agent_call`
- local skills: `剧情指导维护`

## 4. Agent-local Skill Layout

目标文件结构：

```text
agents/storyteller/skills/行动裁定/SKILL.md
agents/researcher/skills/实体读取/SKILL.md
agents/researcher/skills/资料检索/SKILL.md
agents/stage-manager/skills/状态栏维护/SKILL.md
agents/stage-manager/skills/schema演进检查/SKILL.md
agents/stage-manager/skills/行动裁定/SKILL.md
agents/world-architect/skills/开局建模/SKILL.md
agents/world-architect/skills/玩法启用/SKILL.md
agents/world-architect/skills/行动裁定/SKILL.md
agents/director/skills/剧情指导维护/SKILL.md
```

第一版可以把现有共享 Skill 的具体脚本迁移或保留为 shared 视情况处理：

- 如果路径/脚本仍被多个 local Skill 复用且内容完全一致，可保留共享 `skills/` 作为底层 reusable skill/script。
- 如果旧 Skill 文档表达的是旧 Agent 职责，则迁移为 Agent-local 文档或删除默认引用。
- 本任务不必实现完整“行动裁定”脚本；行动裁定 local Skill 应标注完整脚本在后续任务落地，避免默认 Agent 幻想已有随机/数值执行器。

## 5. Mode File

新增默认 save runtime 文件：

```text
save/playthrough/mode.json
```

内容：

```json
{
  "行动裁定": "deferred"
}
```

约定：

- key 是玩法 / Skill 名，可中文。
- value 只允许 `enabled` / `disabled` / `deferred`。
- 不放规则、不放触发条件、不放 UI render 配置。
- 不注入给无关 Agent；资料员、导演通常不需要读 mode。

需要更新：

- `DEFAULT_SAVE_RUNTIME_FILES`
- `DEFAULT_SAVE_RUNTIME_UPGRADE_FILE_PATHS`
- `save/playthrough/README.md`
- 如有 workspace version 约定，提升 `DEFAULT_WORKSPACE_VERSION`。

## 6. Documentation Updates

更新默认卡内文档：

- `docs/novel-airp-schema-guide.md`
- `docs/novel-airp-schema-reference.md`（如有旧 Agent/Skill 名称）
- `README.md` / `agents/README.md` / `skills/README.md`
- `save/director/README.md` 等仍提到 master-safe 的文本

更新项目开发 spec：

- `platform-web/storage/index.md`：内置模板说明从旧 master/studio-assistant/default Skills 改为新 roster + Agent-local Skills。
- `platform-web/frontend/type-safety.md`：如发现旧 master-only 叙述，改为 player-turn entry Agent / default storyteller。

文档语言边界：

- JSON 字段、枚举、render preset 用英文。
- Agent/Skill 显示名、玩法名、entity `name`/`brief`、extension key 用中文。

## 7. Compatibility and Migration

项目未上线，本任务不做旧卡/旧存档迁移。

内置 built-in blank card 会通过 staleness 检查刷新其 card content。已有 save runtime 的非覆盖升级机制只填缺失文件，不删除旧 notes；这是当前 storage 机制，不在本任务强行迁移旧 save。

新建默认卡和新建 save 必须使用新模板。

## 8. Risks

- `workspace-templates.ts` 是大常量文件，容易留下旧 Agent 引用；必须做 targeted grep。
- 如果 `agent.json.skills.enabled` 指向删除后的 shared Skill，Agent context 会看不到预期 Skill；实现后需检查每个 Agent 的 enabled skill path。
- `mode.json` 默认文件加入后若不提升 workspace version，已有 save 的缺失文件补齐可能不触发；需按现有 version 机制处理。
- 不要把“说书人完成后调用场记”写进平台或说书人 AGENT.md；只写成 docs 中的默认前端编排说明。
