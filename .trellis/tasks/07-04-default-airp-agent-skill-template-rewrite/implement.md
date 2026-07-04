# 默认 AIRP Agent 与 Agent-local Skill 模板重写实施计划

## Scope

重写默认 Game Card / Runtime Workspace 模板，使新建默认卡使用 `storyteller` 玩家回合入口和新的 AIRP 后台剧组 Agent-local Skill 结构。当前任务不实现回合后前端场记编排、开局多 Agent 调用和完整行动裁定脚本。

## Implementation Steps

### 1. 更新默认卡 manifest 入口

- 修改 `apps/platform-web/src/storage/game-cards.ts`：
  - 内置 blank card manifest 的 `runtime.entrypoints.playerTurn` 从 `master` 改为 `storyteller`。
  - `isCurrentBuiltinBlankGameCard` 的 staleness 检查同步改为 `storyteller`。
- 确认 create/copy 默认卡路径保留该 runtime 配置。

### 2. 重写 DEFAULT_WORKSPACE_FILES Agent 区块

修改 `apps/platform-web/src/storage/workspace-templates.ts`：

- 删除/替换旧默认 Agent content entries：
  - `agents/master/*`
  - `agents/retrieval/*`
  - `agents/post-processing/*`
  - 旧版 `agents/world-architect/*`（保留 id 但重写职责/contacts/skills）
- 新增：
  - `agents/storyteller/agent.json`, `AGENT.md`, `SOUL.md`
  - `agents/researcher/agent.json`, `AGENT.md`, `SOUL.md`
  - `agents/stage-manager/agent.json`, `AGENT.md`, `SOUL.md`
  - `agents/world-architect/agent.json`, `AGENT.md`, `SOUL.md`
  - `agents/director/agent.json`, `AGENT.md`, `SOUL.md`
- 更新 contacts：
  - storyteller -> researcher
  - researcher -> storyteller/stage-manager/world-architect/director
  - stage-manager -> researcher/world-architect/director
  - world-architect -> researcher/stage-manager/director
  - director -> researcher/stage-manager/world-architect
- 设置 `storyteller` 为 `entryMode: "persistent"` 和 `system: true`。
- 保持 runtime game agent `workspaceAccess.level = 1`，不要提高到可写 card-content。

### 3. 新增 Agent-local Skills

在 `DEFAULT_WORKSPACE_FILES` 中新增 Agent-local Skill entries：

- `agents/storyteller/skills/行动裁定/SKILL.md`
- `agents/researcher/skills/实体读取/SKILL.md`
- `agents/researcher/skills/资料检索/SKILL.md`
- `agents/stage-manager/skills/状态栏维护/SKILL.md`
- `agents/stage-manager/skills/schema演进检查/SKILL.md`
- `agents/stage-manager/skills/行动裁定/SKILL.md`
- `agents/world-architect/skills/开局建模/SKILL.md`
- `agents/world-architect/skills/玩法启用/SKILL.md`
- `agents/world-architect/skills/行动裁定/SKILL.md`
- `agents/director/skills/剧情指导维护/SKILL.md`

Skill 文档要求：

- frontmatter 使用 `name`（可中文）、`title`、`description`、`triggers`。
- 不声明尚未实现的 `tsian-actions` 浏览器脚本，除非复用现有脚本且路径真实存在。
- “行动裁定”只描述第一版占位/后续脚本依赖，不让 Agent 假装已有完整投骰执行器。
- 不把 mode 规则写给无关 Agent。

### 4. 处理共享 Skills

- 检查现有 `skills/*` 默认 entries 和 agent.json 引用。
- 若新 Agent 全部使用 Agent-local Skill，则可删除旧共享 Skill entries 与 `skills/README.md`，或保留 `skills/README.md` 说明 shared skill 是可选共享层但默认核心 Skill 在 Agent-local。
- 不保留指向旧 shared Skill 的 `skills.enabled`。

### 5. 更新 save runtime 默认文件

- 新增 `save/playthrough/mode.json` 默认内容：

```json
{
  "行动裁定": "deferred"
}
```

- 新增对应路径到 `DEFAULT_SAVE_RUNTIME_UPGRADE_FILE_PATHS`。
- 更新 `DEFAULT_WORKSPACE_VERSION`（默认 save runtime 文件集合变更）。
- 更新 `save/playthrough/README.md` 说明 mode 是玩法启用状态表，不是 UI 渲染模块表。
- 替换默认 notes：
  - `save/agents/storyteller/notes.md`
  - `save/agents/researcher/notes.md`
  - `save/agents/stage-manager/notes.md`
  - `save/agents/world-architect/notes.md`
  - `save/agents/director/notes.md`

### 6. 更新默认 docs / AI-facing 文本

- 更新 `docs/novel-airp-schema-guide.md` / reference 中旧 Agent 名称和职责。
- 更新 `docs/active/novel-airp-workspace-schema-direction.md` 如仍描述旧 `master/retrieval/post-processing`。
- 更新 `.trellis/spec/platform-web/storage/index.md` 的默认模板说明。
- 保持 `docs/sdk/play-frontend-api.md` 的 entrypoint 说明不回退到 master。

### 7. 搜索检查

运行并人工分类：

```bash
rg -n 'agents/(master|retrieval|post-processing)|save/agents/(master|retrieval|post-processing)|id: "master"|id: "retrieval"|id: "post-processing"|playerTurn": "master"|Master Agent|Post-Processing Agent|Retrieval Agent|master-safe|主述者|场记（post-processing）|资料员（retrieval）' apps/platform-web/src/storage docs .trellis/spec -S
```

允许保留：

- archived task/research 历史；
- specs 中明确描述旧兼容字段的 historical note；
- 非默认模板的历史 docs，若非当前 AI-facing 默认卡输入。

不允许保留：

- active 默认模板生成旧核心 Agent；
- default manifest 入口仍为 master；
- 新默认 Agent docs 中要求说书人每轮自行 call 场记。

### 8. Validation

必跑：

```bash
npm run build:web
```

如果实现中触及 contracts 类型，补跑：

```bash
npm run build:contracts
```

Trellis 检查：

```bash
python ./.trellis/scripts/task.py validate .trellis/tasks/07-04-default-airp-agent-skill-template-rewrite
```

可选快速 smoke：

- 用 registry 相关搜索确认 `agents/<agent>/skills/<skill>/SKILL.md` 路径符合现有 regex。
- 检查 `agent.json.skills.enabled` 路径与模板文件路径一一存在。

## Rollback Points

- 如果 registry 无法识别中文 Skill 目录名或中文 frontmatter name，停止并报告；不要临时改成共享 Skill 绕过用户已确认的 Agent-local 方向。
- 如果 workspace version 升级机制影响范围比预期大（需要迁移/删除旧 save 文件），停止并报告；本任务不做旧存档破坏性迁移。
- 如果发现默认开局向导代码强依赖 `world-architect` 同时写开局正文/brief，记录为 `07-04-opening-multi-agent-orchestration` 的依赖，不在本任务强行重写向导流程。
