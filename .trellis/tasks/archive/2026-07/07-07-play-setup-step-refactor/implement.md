# 游玩设定步重构 — 执行计划

> 技术设计见 `design.md`。本文档是有序执行清单。

## 实施步骤

### 1. 前端类型与解析：`character.traits[]`

- [ ] 1.1 `apps/play-frontend-dev/src/lib/character-types.ts`：新增 `CharacterTrait` 接口 + `CharacterEntity.traits?: CharacterTrait[]`。
- [ ] 1.2 `apps/play-frontend-dev/src/lib/parse-character.ts`：新增 `parseTraits(raw)`，逐项校验 `id` 必填，`name`/`description` 可选，`effects` 可选字符串数组；`parseCharacter` 中调用。
- [ ] 1.3 验证：`pnpm --filter @tsian/play-frontend-dev typecheck`（或项目实际命令）。

### 2. 前端 context injection：protagonist block 输出 traits

- [ ] 2.1 `apps/play-frontend-dev/src/lib/context-injection.ts` `formatProtagonistBlock`：在 status/gauges 之后追加 traits block（按 design §6 代码）。
- [ ] 2.2 验证：类型检查通过。

### 3. 前端 Step 4 prompt 清理

- [ ] 3.1 `apps/play-frontend-dev/src/lib/source.ts` `buildPlaySetupPrompt`：删除 mode.json / 三态玩法 / 玩法启用 / commit_mode / agent_call storyteller 步骤；改为精简指令（请作为 world-architect 使用 Skill《游玩设定》引导玩家；附书名 + 玩家角色信息；开始第一轮对话）。
- [ ] 3.2 grep 验证：`rg "mode\.json|玩法启用|commit_mode|三态" apps/play-frontend-dev/src` — 期望零命中。

### 4. 前端 Step 4 UI：complete 时隐藏选项

- [ ] 4.1 `apps/play-frontend-dev/src/components/setup/step4/PlaySetupDialog.vue`：`StoryOptions` 的 `v-if` 增加 `&& status !== 'complete'`。
- [ ] 4.2 验证：类型检查通过。

### 5. 默认模板：`commit_play_setup` 脚本

- [ ] 5.1 `apps/platform-web/src/storage/workspace-templates.ts`：新增 `COMMIT_PLAY_SETUP_SCRIPT_JS` 常量，按 design §4 实现。
  - 校验 protagonistRef 指向已存在 entity。
  - 校验 summary 非空 ≤ 2000、openingNarrative 非空。
  - 校验 traits[] 每项 id（`trait:<localId>`）+ name 必填。
  - read-modify-write 主角 entity：合并 traits（按 id 去重覆盖）。
  - 写 setup-summary.json + opening-narrative.json。
  - 返回值不含 narrative 正文。
- [ ] 5.2 在 `DEFAULT_WORKSPACE_FILES` 中登记 `agents/world-architect/skills/游玩设定/scripts/commit-play-setup.js`。

### 6. 默认模板：Skill《游玩设定》重写

- [ ] 6.1 `apps/platform-web/src/storage/workspace-templates.ts` `PLAY_SETUP_SKILL_MD`：按 design §3 重写 frontmatter + 正文。
  - 访谈问题 + 选项模板。
  - 开局钩子由 Agent 安排。
  - 收尾：agent_call storyteller → commit_play_setup → 不展示正文 → 附 [[选项]]。
  - tsian-actions 块声明 `commit_play_setup`。
  - 不含 mode.json / 玩法启用 / commit_mode / director / brief。
- [ ] 6.2 grep 验证：`rg "mode\.json|玩法启用|commit_mode|director|brief" apps/platform-web/src/storage/workspace-templates.ts` — 期望在 PLAY_SETUP_SKILL_MD 区域零命中（其他区域可能仍有引用，需区分）。

### 7. 默认模板：schema 文档更新

- [ ] 7.1 `NOVEL_AIRP_SCHEMA_GUIDE_MD`：推荐字段列表加 `traits`；新增 traits 条目。
- [ ] 7.2 `NOVEL_AIRP_SCHEMA_REFERENCE_MD`：character 示例加 `traits`；字段说明加 traits 条目。
- [ ] 7.3 `save/schema/current.md` 默认内容：Recommended fields 加 `traits`。
- [ ] 7.4 grep 验证：`rg "traits" apps/platform-web/src/storage/workspace-templates.ts` — 确认 schema 文档已覆盖。

### 8. 父任务更新

- [ ] 8.1 `.trellis/tasks/07-06-agent-roster-progressive-refactor/prd.md`：
  - Child Task Map 中 C 标记 ✅ 已完成。
  - Player Flow Map 中 1b 标记 ✅。
  - Current Agent / Skill / Tool Ledger 更新 world-architect skills（游玩设定重写 + commit_play_setup）、character schema（新增 traits）。
  - Acceptance Criteria 勾选「游玩设定步完成」。
- [ ] 8.2 父任务 Acceptance Criteria 中「每个已处理 Agent 的分层职责在父任务中可追踪」确认覆盖 traits。

### 9. 构建与检查

- [ ] 9.1 `pnpm --filter @tsian/play-frontend-dev typecheck`（或项目实际类型检查命令）。
- [ ] 9.2 `pnpm --filter @tsian/platform-web typecheck`（或等价）。
- [ ] 9.3 `pnpm build`（或项目实际构建命令）确认无 break。
- [ ] 9.4 grep 终检：
  - `rg "mode\.json|玩法启用|commit_mode" apps/play-frontend-dev/src/lib/source.ts` — 零命中。
  - `rg "traits" apps/play-frontend-dev/src/lib/character-types.ts apps/play-frontend-dev/src/lib/parse-character.ts apps/play-frontend-dev/src/lib/context-injection.ts` — 确认已覆盖。

## 验证命令

```bash
# 类型检查
pnpm --filter @tsian/play-frontend-dev typecheck
pnpm --filter @tsian/platform-web typecheck

# 构建
pnpm build

# grep 终检
rg "mode\.json|玩法启用|commit_mode" apps/play-frontend-dev/src/lib/source.ts
rg "traits" apps/play-frontend-dev/src/lib/character-types.ts apps/play-frontend-dev/src/lib/parse-character.ts apps/play-frontend-dev/src/lib/context-injection.ts
```

## 风险与回滚

| 风险 | 缓解 |
| - | - |
| `commit_play_setup` 脚本校验过严导致 Agent 反复失败 | 脚本返回可操作错误码/message，Agent 可修正重试（对齐原则 1） |
| traits 合并覆盖误删已有 traits | 按 `id` 去重覆盖，保留不在本次提交中的已有 traits |
| 旧存档无 traits 字段 | traits 是可选字段，解析层缺省 undefined，不影响已有存档 |
| Step 4 隐藏选项后玩家看不到初始选项 | 选项仍保留在 context slot，进入 StoryView 后 `loadPlaySetupOptions()` 恢复 |
| `commit_setup_summary` / `commit_opening_narrative` 旧脚本保留但不再被 Skill 引用 | 保留文件不删，避免破坏已有存档；Skill 正文只引导 `commit_play_setup` |

## 浏览器验证（用户自行，不阻塞归档）

- [ ] 开局向导 Step 4：进入后 world-architect 用通俗问题 + 选项引导。
- [ ] 玩家选「不加特殊设定」→ 快速进入收尾 → Step 5 展示简介。
- [ ] 玩家选「特殊体质/天赋」→ 追问名称/说明/效果 → traits 写入主角 entity。
- [ ] Step 4 complete 后对话界面不显示开局正文和选项。
- [ ] 进入 StoryView 后开局正文作为第一条消息展示，初始选项可用。
