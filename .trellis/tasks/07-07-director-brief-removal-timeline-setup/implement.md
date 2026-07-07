# 执行计划：导演与 brief 移除 + timeline 建立

> 按 `design.md` 的决策边界执行。所有编辑集中在 `apps/platform-web/src/storage/workspace-templates.ts` 与 3 个前端文件，平台运行时代码零改动。

## 执行清单

### Phase 1: workspace-templates.ts 移除类编辑

- [ ] 1.1 `DEFAULT_SAVE_RUNTIME_UPGRADE_FILE_PATHS`：移除 director/brief 相关路径条目（`save/agents/director/notes.md`、`save/director/README.md`、`save/director/current-brief.md`、`save/director/current-brief.meta.json`）。保留 `save/playthrough/frontier.json`（B 要新增 timeline 字段，upgrade 路径仍需要）。
- [ ] 1.2 删除 `DIRECTOR_BRIEF_SKILL_MD` 常量声明（整段）。
- [ ] 1.3 `DEFAULT_WORKSPACE_FILES`：删除 director 的 3 个文件登记（`agents/director/agent.json`、`agents/director/AGENT.md`、`agents/director/SOUL.md`）。
- [ ] 1.4 `DEFAULT_WORKSPACE_FILES`：删除 `agents/director/skills/剧情指导维护/SKILL.md` 文件登记。
- [ ] 1.5 `DEFAULT_SAVE_RUNTIME_FILES`：删除 `save/agents/director/notes.md` 登记行。
- [ ] 1.6 `DEFAULT_SAVE_RUNTIME_FILES`：删除 `save/director/*` 3 个文件登记（`current-brief.md`、`current-brief.meta.json`、`README.md`）。
- [ ] 1.7 storyteller `contextPaths`：移除 `"save/director/current-brief.md"`，保留 `"README.md"`。
- [ ] 1.8 stage-manager `contextPaths`：移除 `"save/director/current-brief.md"`（确认剩余条目仍合理）。
- [ ] 1.9 4 个 Agent 的 `contacts` 数组：各移除 `"director"` 条目（storyteller / researcher / stage-manager / world-architect）。
- [ ] 1.10 `RESEARCHER_RETRIEVAL_SKILL_MD`：移除检索范围中 "brief" 提及。
- [ ] 1.11 `WORLD_ARCHITECT_OPENING_SKILL_MD`：移除"agent_call 导演写初始 brief"步骤（description 中的 `:589` 提及 + 正文 step 7 `:666` + spoiler-safe 注 `:687` 中 brief 提及）。**此步与 Phase 3.1 联动**——同位置补 timeline 锚点步骤。
- [ ] 1.12 `TSIAN_FRAMEWORK_KNOWLEDGE_MD`：从 background specialists 列表移除 `director`。
- [ ] 1.13 顶层 `README.md`：移除 "director files" 提及。
- [ ] 1.14 `agents/README.md`：移除 `director / 导演` 行。
- [ ] 1.15 `save/README.md`：移除 `director/` 路径登记。
- [ ] 1.16 `save/source/README.md`：移除 "director briefs" 提及。
- [ ] 1.17 `NOVEL_AIRP_SCHEMA_GUIDE_MD`：移除"runtime 与 director brief"措辞、`save/director/` 路径、director 职责行。受控词表移除 `director-only`（见 §8 决策）。
- [ ] 1.18 `NOVEL_AIRP_SCHEMA_REFERENCE_MD`：移除 brief/director 相关段落。

### Phase 2: workspace-templates.ts 建立类编辑

- [ ] 2.1 `DEFAULT_SAVE_RUNTIME_FILES` `frontier.json` 种子：新增 `timeline: [{ chapter: 1, time: "元年", label: "开局" }]` 字段。
- [ ] 2.2 `COMMIT_RUNTIME_AND_FRONTIER_SCRIPT_JS`：`frontierFile` 对象新增 `timeline` 字段透传 + 校验逻辑（每项 `{ chapter: number, time: string, label: string }`）。
- [ ] 2.3 `WORLD_ARCHITECT_OPENING_SKILL_MD`：在建模末尾（原 step 7 位置）新增"建第一个 timeline 锚点"步骤——`commit_runtime_and_frontier` 调用时 `runtime.worldTime` 传 `"元年"`、`frontier.timeline` 传 `[{ chapter: <开局起始章>, time: "元年", label: "开局" }]`。步骤写法遵循 Skill 正文规范（需要做什么/怎么做/出问题怎么办，不出现设计决策）。
- [ ] 2.4 `NOVEL_AIRP_SCHEMA_GUIDE_MD`：`frontier.json` 段落补 `timeline` 字段说明（结构 + label 约束 + 与 sourceWindow 关系）。
- [ ] 2.5 `NOVEL_AIRP_SCHEMA_REFERENCE_MD`：frontier 段落补 `timeline`。
- [ ] 2.6 `save/playthrough/README.md`：`frontier.json` 字段列表补 `timeline`。

### Phase 3: 前端清理

- [ ] 3.1 `apps/play-frontend-dev/src/components/setup/step2/UnderstandingRunning.vue`：STAGES 数组精简为 3 项（移除"正在写入…"和"导演正在校准剧情方向…"）。
- [ ] 3.2 `apps/play-frontend-dev/src/composables/useSetupState.ts:85`：注释改为 `// 0 = 观察，1 = 阅读，2 = 整理/写入`。
- [ ] 3.3 `apps/play-frontend-dev/src/composables/useSetupState.ts:118-130` `mapToolToStage`：移除 `if (name === "agent_call") return 3` 分支。保留 write/edit→2、read/list→1 分支。
- [ ] 3.4 `apps/play-frontend-dev/src/lib/source.ts:495` `buildOpeningInitializationPrompt`：删除第 5 条 "agent_call 导演写初始 director brief" 指令。原第 6、7 条顺位上移为 5、6。

### Phase 4: 构建验证

- [ ] 4.1 `npm run build --workspace play-frontend-dev`
- [ ] 4.2 `npm run build:web`
- [ ] 4.3 `git diff --check`（无空白错误）

### Phase 5: 静态残留验证

- [ ] 5.1 `rg -i "director|导演" apps/platform-web/src/storage/workspace-templates.ts` → 零命中或仅历史 changelog
- [ ] 5.2 `rg "current-brief|director brief|剧情指导" apps/platform-web/src/storage/workspace-templates.ts` → 零命中
- [ ] 5.3 `rg -i "director" apps/play-frontend-dev/src` → 零命中或仅注释清理
- [ ] 5.4 `rg "timeline" apps/platform-web/src/storage/workspace-templates.ts` → 命中 frontier 种子 + commit 脚本 + schema 文档 + Skill 步骤

### Phase 6: 浏览器验证

- [ ] 6.1 开局向导导入小说 → Step 2 Understanding 运行 → 完成。
- [ ] 6.2 检查 `save/playthrough/frontier.json`：含 `timeline: [{chapter: <开局章>, time: "元年", label: "开局"}]`。
- [ ] 6.3 检查 `save/playthrough/runtime.json`：`worldTime` 为 `"元年"`。
- [ ] 6.4 检查 `save/director/` 目录不存在；`save/agents/director/` 目录不存在。
- [ ] 6.5 检查 understanding loader 阶段文案：观察→阅读→整理，无"导演校准"。

### Phase 7: 收尾

- [ ] 7.1 更新父任务 `07-06-agent-roster-progressive-refactor/prd.md`：Child Task Map 标记 B 完成；Current Agent / Skill / Tool Ledger 更新 director 为已移除、world-architect 补 timeline 职责、storyteller/stage-manager contextPaths 更新。
- [ ] 7.2 更新父任务 Player Flow Map：Step 1a 状态更新（timeline 已建）。
- [ ] 7.3 记录 journal session。
- [ ] 7.4 `task.py archive`。

## 验证命令汇总

```bash
# 构建
npm run build --workspace play-frontend-dev
npm run build:web
git diff --check

# 静态残留
rg -i "director|导演" apps/platform-web/src/storage/workspace-templates.ts
rg "current-brief|director brief|剧情指导" apps/platform-web/src/storage/workspace-templates.ts
rg -i "director" apps/play-frontend-dev/src
rg "timeline" apps/platform-web/src/storage/workspace-templates.ts
```

## 回滚点

B 是紧耦合原子任务。若 Phase 4 构建失败，整体 `git checkout -- <files>` 后重做；不建议中途保留半移除状态。若 Phase 6 浏览器验证发现 world-architect 未建锚点，检查 Skill 正文清晰度（补强步骤说明，不需回滚移除部分）。
