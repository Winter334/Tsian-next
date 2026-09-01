# world-architect Skill 体系完善与 use_skill 优化 — 实施计划

## Validation Commands

```bash
npm run build:web
npm run build:contracts
```

端到端验收（手动）：
- 导入小说 → Step 2 → 确认 AI 调用轮次减少（对比之前 ~14 轮 → 预期 ~11 轮）。
- Step 4 访谈 → 确认后 commit_setup_summary 写入 → 前端校验通过 → 进入 Step 5。
- DebugView 确认 use_skill observation 含 content + inputSchema。

## Implementation Steps

### 1. AGENT.md 精简

**文件**：`apps/platform-web/src/storage/workspace-templates.ts` — world-architect AGENT.md content

精简为（见 design.md D1）：
```
# 世界架构师
你负责为当前小说和本次游玩设计世界资料结构：schema、实体、场景、关系、runtime 指针、mode 状态。
常驻原则：
- 从最小可用模型开始，只在当前游玩确实需要时增加字段或结构。
- 安全小改可直接维护；有风险或需要决策的变更写 pending patch。
- 需要源文本或实体事实时 call 资料员。
- 不维护每回合 runtime。
```

### 2. 合并 commit 脚本（7→5）

**文件**：`apps/platform-web/src/storage/workspace-templates.ts`

2a. 新增 `COMMIT_SCENES_AND_RELATIONSHIPS_SCRIPT_JS`：合并 `COMMIT_SCENES_SCRIPT_JS` + `COMMIT_RELATIONSHIPS_SCRIPT_JS` 的校验 + 写入逻辑。input `{scenes: [...], relationships: [...]}`，共享一次 `loadExistingEntityIds` 调用。

2b. 新增 `COMMIT_RUNTIME_AND_FRONTIER_SCRIPT_JS`：合并 `COMMIT_RUNTIME_SCRIPT_JS` + `COMMIT_FRONTIER_SCRIPT_JS`。input `{runtime: {...}, frontier: {...}}`，runtime 校验 activeSceneIds + player ref，frontier 校验 chapter path。

2c. 删除旧的 4 个脚本常量（`COMMIT_SCENES_SCRIPT_JS` / `COMMIT_RELATIONSHIPS_SCRIPT_JS` / `COMMIT_RUNTIME_SCRIPT_JS` / `COMMIT_FRONTIER_SCRIPT_JS`）。

2d. 更新 DEFAULT_WORKSPACE_FILES：删除 4 个旧脚本文件条目，新增 2 个合并脚本文件条目。

2e. 更新 Skill《开局建模》tsian-actions 声明 + 执行步骤（7 action 替代 9 action；8 步替代 10 步）。

### 3. 新增 Skill《游玩设定》+ commit_setup_summary

**文件**：`apps/platform-web/src/storage/workspace-templates.ts`

3a. 新增 `COMMIT_SETUP_SUMMARY_SCRIPT_JS`：复用 OPENING_SCRIPT_COMMON，input `{summary: string}`，校验非空（≤2000），写入 `save/playthrough/setup-summary.json` 为 `{status: "complete", summary, committedAt}`。

3b. 新增 `PLAY_SETUP_SKILL_MD` 常量：Skill《游玩设定》SKILL.md（frontmatter + 正文 + tsian-actions 声明 commit_setup_summary）。

3c. 在 DEFAULT_WORKSPACE_FILES 注册：
- `agents/world-architect/skills/游玩设定/SKILL.md`
- `agents/world-architect/skills/游玩设定/scripts/commit-setup-summary.js`

3d. 在 world-architect agent.json 的 skills.enabled 追加 `agents/world-architect/skills/游玩设定/SKILL.md`。

### 4. 玩法启用 Skill 补 commit_mode

**文件**：`apps/platform-web/src/storage/workspace-templates.ts`

4a. 新增 `COMMIT_MODE_SCRIPT_JS`：复用 OPENING_SCRIPT_COMMON，input `{mode: Record<string, "enabled"|"disabled"|"deferred">}`，校验三态值，读取现有 mode.json 合并写入。

4b. 更新 `WORLD_ARCHITECT_GAMEPLAY_ENABLEMENT_SKILL_MD`：正文指示用 `commit_mode` 脚本；加 tsian-actions 声明 commit_mode。

4c. 在 DEFAULT_WORKSPACE_FILES 注册 `agents/world-architect/skills/玩法启用/scripts/commit-mode.js`。

### 5. use_skill 当轮返回 SKILL.md

**文件**：`apps/platform-web/src/agent-runtime/workspace-tools.ts` — `activateSkillByName`（1700-1752）

5a. observation 返回值新增 `content: file.content`（SKILL.md 全文）。

5b. `actions` 每项新增 `inputSchema: action.inputSchema`（从 parseActionDeclarations 结果取）。

5c. `registerLoadedSkill` 后立即 `context.sessionState.injectedSkillPaths.push(skill.path)`，跳过下一轮 `collectActivatedSkillContents` 注入。

5d. 确认 `parseActionDeclarations` 返回的 action 含 `inputSchema`（查 ParsedSkillAction 类型）。若不含需补解析。

### 6. prompt 更新

**文件**：`apps/play-frontend-dev/src/lib/source.ts`

6a. `buildPlaySetupPrompt` 改为指示 agent 用 Skill《游玩设定》引导对话 + `commit_setup_summary` 提交 + `commit_opening_narrative` 落盘。删除格式细节。

6b. `buildOpeningInitializationPrompt` 微调：执行步骤引用合并后的脚本名（commit_scenes_and_relationships / commit_runtime_and_frontier）。提示无依赖的 commit 可一轮内并行调用。

6c. 遵循 ai-facing-content-changes 规范：正面引导，无禁令。

### 7. 构建验证

```bash
npm run build:contracts
npm run build:web
```

### 8. prompt 禁令 grep 验证

```bash
grep -n "不要.*write\|不要直接\|不要用 workspace_write" apps/play-frontend-dev/src/lib/source.ts apps/platform-web/src/storage/workspace-templates.ts
```

要求零命中。

### 9. 端到端验收（手动）

- 新建卡 → 导入小说 → Step 2 → 确认轮次减少 → understanding-summary 三字段 → ready。
- Step 4 访谈 → 确认 → commit_setup_summary → 前端校验通过 → Step 5。
- DebugView 确认 use_skill observation 含 content + inputSchema。
- 玩法启用 → commit_mode 写入 mode.json。

## Risky Files & Rollback Points

| 文件 | 风险 | 回滚 |
|---|---|---|
| `workspace-templates.ts` | 脚本合并可能有校验遗漏 | 恢复 7 个独立脚本 |
| `workspace-tools.ts` | use_skill observation 改动影响所有 Skill | 恢复下一轮注入 + 去掉 content/inputSchema |
| `source.ts` prompt | prompt 改动影响 agent 行为 | 恢复旧 prompt |

## Review Gates

- [ ] world-architect AGENT.md 不含开局建模步骤、agent_call 编排指令。
- [ ] Skill《游玩设定》含 commit_setup_summary 脚本 + tsian-actions。
- [ ] 玩法启用 Skill 含 commit_mode 脚本。
- [ ] commit 脚本 5 个（scenes+relationships 合并、runtime+frontier 合并）。
- [ ] Skill《开局建模》tsian-actions 7 action + 执行步骤 8 步。
- [ ] use_skill observation 含 content + inputSchema；下一轮不重复注入。
- [ ] build:contracts + build:web 通过。
- [ ] prompt 无禁令（grep 零命中）。
