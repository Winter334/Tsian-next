# 正式玩家回合重构 — 执行计划

> 技术设计见 `design.md`。本文档是有序执行清单。

## 实施步骤

### 1. roll_dice Tool 扩展

- [ ] 1.1 `apps/platform-web/src/storage/workspace-templates.ts`：修改 `tools/roll_dice/tool.json` 的 `modifier` 和 `opposed.modifier` schema 为 `["number", "string"]`，更新 description 说明表达式支持。
- [ ] 1.2 修改 `tools/roll_dice/run.js`：
  - 新增 `evalExpr(expr)` 函数（白名单校验 + Function 构造器求值 + `^`→`**` + `sqrt`→`Math.sqrt`）。
  - `normalizeModifier` 扩展：string 类型调用 `evalExpr` 求值。
  - `rollOnce` 后 count===1 时检查 `kept[0]`，设置 `criticalSuccess`/`criticalFailure`。
  - 单方检定：critical 优先于 `success = total >= dc`。
  - 对抗检定：双方各自 critical 判定，criticalSuccess vs criticalFailure 优先于 margin。
  - trace 新增 critical 字段。
- [ ] 1.3 验证：`npm run build:web` 通过。

### 2. storage spec 更新

- [ ] 2.1 `.trellis/spec/platform-web/storage/index.md` roll_dice 场景：
  - Signatures：`modifier` 改为 `number | string`。
  - Contracts：移除"不添加表达式求值"；新增大成功/大失败说明。
  - Validation：新增表达式求值失败错误。
  - Good/Base/Bad cases：新增表达式和大成功/大失败示例。

### 3. storyteller agent.json + 默认文件

- [ ] 3.1 `workspace-templates.ts`：storyteller agent.json 移除 `roll_dice` from `tools.disabled`；`platformTools` 新增 `workspace_write`；`contextPaths` 新增 `save/agents/storyteller/writing-styles.md`；`skills.enabled` 新增文风学习 Skill 路径。
- [ ] 3.2 `DEFAULT_SAVE_RUNTIME_FILES` 新增 `save/agents/storyteller/writing-styles.md`（初始 `# 文风学习记录\n\n`）。

### 4. storyteller AGENT.md 重写

- [ ] 4.1 `workspace-templates.ts`：重写 storyteller AGENT.md，包含写正文方法论 + 裁定方法论（按 design §3.2）。

### 5. storyteller 文风学习 Skill

- [ ] 5.1 新增 `WRITING_STYLE_SKILL_MD` 常量（frontmatter + 正文按 design §3.3）。
- [ ] 5.2 `DEFAULT_WORKSPACE_FILES` 新增 `agents/storyteller/skills/文风学习/SKILL.md`。

### 6. storyteller 查询 Tool ×3

- [ ] 6.1 新增 `read_entity` Tool：`tool.json` + `run.js`（读 entity JSON → 格式化文本返回，按 design §3.4）。
- [ ] 6.2 新增 `read_scene` Tool：`tool.json` + `run.js`（读 scene + present entities → 格式化文本返回）。
- [ ] 6.3 新增 `read_relationships` Tool：`tool.json` + `run.js`（读 relationships → 格式化文本返回）。
- [ ] 6.4 `DEFAULT_WORKSPACE_FILES` 新增三个 Tool 的文件路径。

### 7. researcher agent.json + AGENT.md + Skills

- [ ] 7.1 `workspace-templates.ts`：researcher agent.json `platformTools` 移除 `workspace_semantic_search`；`contextPaths` 新增 `save/playthrough/frontier.json`。
- [ ] 7.2 重写 researcher AGENT.md（按 design §4.2）。
- [ ] 7.3 轻改 `RESEARCHER_ENTITY_READ_SKILL_MD`：确认不提 semantic_search。
- [ ] 7.4 重写 `RESEARCHER_RETRIEVAL_SKILL_MD`：timeline 映射 + read 流程（按 design §4.3）。

### 8. 父任务更新

- [ ] 8.1 `.trellis/tasks/07-06-agent-roster-progressive-refactor/prd.md`：
  - Child Task Map D 标记 ✅ 已完成。
  - Player Flow Map 步骤 2 标记 ✅。
  - Current Agent / Skill / Tool Ledger 更新 storyteller（方法论 + roll_dice + workspace_write + 文风学习 Skill + 查询 Tool ×3）和 researcher（移除 semantic_search + timeline 映射 + frontier contextPaths）。
  - Acceptance Criteria 勾选「正式玩家回合 storyteller + researcher 重构完成」。

### 9. 构建与检查

- [ ] 9.1 `npm run build:web`（含 vue-tsc）。
- [ ] 9.2 `npm run build --workspace play-frontend-dev`。
- [ ] 9.3 `npm run build:contracts`。
- [ ] 9.4 grep 验证：
  - `rg "semantic_search" apps/platform-web/src/storage/workspace-templates.ts` — researcher agent.json 和 Skill 区域零命中。
  - `rg "roll_dice" apps/platform-web/src/storage/workspace-templates.ts` — storyteller `tools.disabled` 不含 roll_dice。
  - 确认三个查询 Tool 和文风学习 Skill 已注册。

## 验证命令

```bash
npm run build:web
npm run build --workspace play-frontend-dev
npm run build:contracts

rg "semantic_search" apps/platform-web/src/storage/workspace-templates.ts
rg "roll_dice.*disabled" apps/platform-web/src/storage/workspace-templates.ts
```

## 风险与回滚

| 风险 | 缓解 |
| - | - |
| roll_dice 表达式求值安全风险 | 白名单校验只允许数字和运算符；Function 严格模式无作用域访问 |
| 大成功/大失败改变现有存档掷骰行为 | 只在 count===1 时新增字段，不改变原有 success/winner 逻辑（critical 优先但常规逻辑保留） |
| researcher 移除 semantic_search 后检索能力下降 | 当前已读范围小，read/list/glob/search 够用；RAG 重构后续补 |
| storyteller workspace_write 可能误写 runtime/entity | AGENT.md 已有"不维护 runtime、entity、schema 或 status bar"原则约束 |
| 文风学习 Skill 增加每回合 contextPaths 注入量 | writing-styles.md 按场景类型组织，随遇随学不一次写满；如过长可后续压缩 |

## 浏览器验证（用户自行，不阻塞归档）

- [ ] 正式玩家回合：storyteller 能用 roll_dice 判定（含大成功/大失败）。
- [ ] storyteller 能 call researcher 查素材，researcher 在已读范围内找到返回。
- [ ] researcher 找不到时返回含已读范围的简短说明。
- [ ] storyteller 用查询 Tool 快速读实体/场景/关系。
- [ ] 文风学习 Skill 能 call researcher 找章节并写入 writing-styles.md。
- [ ] roll_dice 表达式 modifier 工作（如 `"15-12"` → 3）。
