# Assistant Authoring Skills

## Parent

- `.trellis/tasks/06-20-content-generation-foundation`

## Goal

给桌面助手补齐创作类 Skills，使其能引导 / 生成 / 校验卡内容。让助手从"只能查框架知识"升级为"能帮你造 agent、造 skill、起草世界与卡内容"。配合子1 产出的可游玩模板卡，形成"创建卡 → 助手定制内容 → 游玩"闭环。

## Requirements

每个 skill = 一个 `.tsian/local/assistant/skills/<name>/SKILL.md`（+ 可选 `scripts/*.js`）+ 加进 `.tsian/local/assistant/agent.json` 的 `skills.enabled`。seed 位置在 `apps/platform-web/src/storage/local-assistant-files.ts` 的 `defaultLocalAssistantFileMap()`，出厂自带。

### 1. agent-authoring

- 引导/生成/校验 `agents/<id>/{agent.json, AGENT.md, SOUL.md}`。
- `agent.json` 须符合 `AgentConfig` schema（`packages/contracts/src/runtime.ts:181`）：`id/title/summary/contacts[]/contextPaths[]/skills{enabled,disabled}/platformTools{enabled,disabled}/workspaceAccess{level}` + 可选 `knowledgeMount/providerPresetId`。
- 指导权限层级约定：运行时 agent `level 1`（save-runtime 可写）；助手 `level 4`（platform-meta 可写）。新增 agent 默认 level 1。
- 指导 `AGENT.md`（SOP/程序）vs `SOUL.md`（持久身份/风格）的内容边界。
- 触发：用户要新建/改 agent、问 agent 配置/schema/权限。

### 2. skill-authoring

- 引导/生成/校验 `skills/<id>/SKILL.md`（共享）或 `.tsian/local/assistant/skills/<id>/SKILL.md`（助手本地）。
- frontmatter 规范：`name/title/description/triggers/appliesTo`。
- 可选 `tsian-actions` fence：声明 action，`executor.type` 仅 `browser_script`，`path` 在 skill 目录内（相对 `scripts/<x>.js`），`timeoutMs ≤ 60000`。
- 校验动作声明合规性（executor 类型、path 边界、timeout 上限、inputSchema root 为 object）。
- 触发：用户要新建/改 skill、问 skill 机制/action 声明。

### 3. card-content-drafting

- 引导/生成卡内容草稿：`world/canon.md`、角色档案、`history/timeline.md`、`memory/summaries/current.md`/`long-term.md`、`state/` 数据等。
- 替代现状空壳（`# Canon\n\n` / `# Timeline\n\n`），按用户给的世界设定填实质内容。
- 可带一个 `validate_workspace_layout` browser_script action：校验目录约定（README 存在性、关键路径），只读不写。
- 触发：用户要建世界/角色/时间线/记忆、起草卡内容。

### 4. framework-knowledge 增强

- 在现有 `framework-knowledge` skill 基础上补 authoring/maintenance/权限层级的决策细节（不重写，扩展 SKILL.md 内容）。
- 补：workspace 三层 scope（card-content/save-runtime/platform-meta）的读写权限矩阵（`workspace-operations.ts:93` 的 `DEFAULT_SCOPE_ACCESS`）；skill 索引/激活/run_script 流程；助手 vs 运行时 agent 边界。
- 触发不变（框架/authoring/workspace/diagnostics 问题）。

### agent.json enabled 更新

`defaultAssistantConfig()` 的 `skills.enabled` 从 `["framework-knowledge"]` 扩为 `["framework-knowledge", "agent-authoring", "skill-authoring", "card-content-drafting"]`。

## Acceptance Criteria

- [ ] 4 个 skill 的 SKILL.md（+ 可选 scripts）seed 进 `defaultLocalAssistantFileMap()`，出厂自带。
- [ ] `agent.json` 的 `skills.enabled` 含全部 4 名。
- [ ] 每个 skill 出现在助手 Skill Index（`formatSkillIndex` 渲染）——dev server `/workspace` 见文件 + `/assistant` 无 key 验 index（需 key 才能真 use_skill，但 index 在会话初始化时构建）。
- [ ] frontmatter 合规（parseMarkdown 不报错，triggers/appliesTo 正确）。
- [ ] 带 action 的 skill 的 `tsian-actions` fence 合规（executor.type=path=timeoutMs 校验通过，`actionDeclarationErrors` 为空）。
- [ ] `npm run build:web` 通过。
- [ ] 真实 LLM 往返（use_skill → 注入 SKILL.md → run_script/写入）登记 PV，待 provider + key。

## Constraints

- 纯 `.tsian/local/assistant/` 内容（SKILL.md + scripts + agent.json enabled）。
- 不动 agent-runtime / registry / workspace-tools / contracts。
- 落地靠助手 level-4 `workspace_write`（SDK 只放行 `workspace.*`，已确认）。
- skill 文件 seed 用字符串常量（同 `DEFAULT_FRAMEWORK_KNOWLEDGE_SKILL_MD` 模式）。
- `appliesTo: ["assistant"]`（agent-local skill 自动归属 assistant，但显式标注便于 clarity）。

## Out Of Scope

- 平台级建卡 / 导入 platform action（后续任务）。
- 运行时 agent（master/narrative/memory）的 skills（本任务只做桌面助手 skill）。
- 真实 LLM 往返验证（需 provider + API key）。
- 给 `platform.runAction` 加 create-card action（你已确认后续再考虑）。

## Dependencies

- 端到端验证依赖子1 产出的可游玩卡（助手往该卡工作区写内容 → 前端能读）。
- skill 文件落地与 index 验证不依赖子1（可独立 build + dev 冒烟）。
