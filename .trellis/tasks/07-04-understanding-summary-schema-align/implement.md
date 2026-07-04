# 开局建模脚本基础设施 — 实施计划

## Validation Commands

```bash
npm run build:web         # platform-web 构建 + vue-tsc 类型检查（含模板 + 前端）
npm run build:contracts   # 契约层（本任务不改 contracts，但保持绿）
```

端到端验收（手动，需运行时会话 + 新建游戏卡）：
- 导入小说 → Step 2 → DebugView 确认 agent 调用脚本（inspect/read/commit_*）→ understanding-summary.json 含三字段 → 前端校验通过 → ready 态。
- 故意让 agent 写错 ref（如 scene present 指向不存在的 entity）→ 脚本返回校验错误 → agent 修正重试。
- Step 3 角色候选从 candidateCharacters 渲染。
- 设定收尾 → commit_opening_narrative 写入 → StoryView 渲染开局正文。

## Reference Input

旧脚本实现（`git show 95e392c^:apps/platform-web/src/storage/workspace-templates.ts`）：
- `OPENING_SCRIPT_COMMON` — 共享工具函数（行 702-727）
- `OPENING_INSPECT_SOURCE_SCRIPT_JS` — inspect 脚本（行 727-751）
- `OPENING_READ_SLICE_SCRIPT_JS` — read 脚本（行 751-781）
- `OPENING_COMMIT_UNDERSTANDING_SCRIPT_JS` — commit 脚本（行 781-910），含 `normalizeEntity`/`normalizeCandidate`/`normalizeScene`/`normalizeRelationships`/`normalizeRef`/`loadExistingEntityIds`/`ensureSourceRefsKnown`/`normalizeWindow`

校验函数从旧 commit 脚本提取，按拆分后的脚本分配。直接复用，不重新发明。

## Implementation Steps

### 1. 定义共享工具常量

**文件**：`apps/platform-web/src/storage/workspace-templates.ts`

定义 `OPENING_SCRIPT_COMMON` 常量（从 `git show 95e392c^` 行 702-727 提取），包含：`isRecord`/`fail`/`parseJson`/`readJson`/`readText`/`cleanText`/`clipText`/`normalizePositiveInt`/`normalizeString`/`normalizeSegment`/`normalizeEntityId`/`loadSource`/`loadExistingEntityIds`。

追加校验函数到 COMMON 或单独常量：
- `normalizeEntity` + `ensureSourceRefsKnown`（给 commit_entities）
- `normalizeRef`（给 commit_scenes/commit_relationships/commit_runtime）
- `normalizeScene`（给 commit_scenes）
- `normalizeRelationships`（给 commit_relationships）
- `normalizeCandidate`（给 commit_understanding_summary）
- `normalizeWindow`（给 commit_frontier）

### 2. 实现 9 个脚本 JS 常量

每个脚本用 `` `${OPENING_SCRIPT_COMMON}${text([...])}` `` 拼接：

- `INSPECT_SOURCE_OPENING_SCRIPT_JS` — 直接复用旧 `OPENING_INSPECT_SOURCE_SCRIPT_JS`
- `READ_OPENING_SLICE_SCRIPT_JS` — 直接复用旧 `OPENING_READ_SLICE_SCRIPT_JS`
- `COMMIT_ENTITIES_SCRIPT_JS` — `normalizeEntity` 校验 + 逐个 `tsian.workspace.write`
- `COMMIT_SCENES_SCRIPT_JS` — `normalizeScene`（含 `loadExistingEntityIds` ref 校验）+ 逐个 write
- `COMMIT_RELATIONSHIPS_SCRIPT_JS` — `normalizeRelationships`（含 ref 校验）+ 逐个 write
- `COMMIT_RUNTIME_SCRIPT_JS` — activeSceneIds → `tsian.workspace.list("save/scenes")` 校验 + player.character → `loadExistingEntityIds` 校验 + write
- `COMMIT_FRONTIER_SCRIPT_JS` — `normalizeWindow`（chapter path 校验）+ write
- `COMMIT_UNDERSTANDING_SUMMARY_SCRIPT_JS` — `normalizeCandidate` 校验 + write `{status: "ready", title, candidateCharacters}`
- `COMMIT_OPENING_NARRATIVE_SCRIPT_JS` — narrative 非空校验 + write `{narrative, createdAt}`

每个脚本签名：`async function(input, tsian, signal) → result`，含 `try/catch` + `tsian.trace` 记录成功/失败。

### 3. 注册脚本文件到 DEFAULT_WORKSPACE_FILES

**文件**：`apps/platform-web/src/storage/workspace-templates.ts`

在 `DEFAULT_WORKSPACE_FILES` 数组中追加 9 个脚本文件条目：
```ts
{ path: "agents/world-architect/skills/开局建模/scripts/inspect-source-opening.js", content: INSPECT_SOURCE_OPENING_SCRIPT_JS },
{ path: "agents/world-architect/skills/开局建模/scripts/read-opening-slice.js", content: READ_OPENING_SLICE_SCRIPT_JS },
{ path: "agents/world-architect/skills/开局建模/scripts/commit-entities.js", content: COMMIT_ENTITIES_SCRIPT_JS },
{ path: "agents/world-architect/skills/开局建模/scripts/commit-scenes.js", content: COMMIT_SCENES_SCRIPT_JS },
{ path: "agents/world-architect/skills/开局建模/scripts/commit-relationships.js", content: COMMIT_RELATIONSHIPS_SCRIPT_JS },
{ path: "agents/world-architect/skills/开局建模/scripts/commit-runtime.js", content: COMMIT_RUNTIME_SCRIPT_JS },
{ path: "agents/world-architect/skills/开局建模/scripts/commit-frontier.js", content: COMMIT_FRONTIER_SCRIPT_JS },
{ path: "agents/world-architect/skills/开局建模/scripts/commit-understanding-summary.js", content: COMMIT_UNDERSTANDING_SUMMARY_SCRIPT_JS },
{ path: "agents/world-architect/skills/开局建模/scripts/commit-opening-narrative.js", content: COMMIT_OPENING_NARRATIVE_SCRIPT_JS },
```

### 4. 改写 Skill《开局建模》SKILL.md

**文件**：`apps/platform-web/src/storage/workspace-templates.ts` — `WORLD_ARCHITECT_OPENING_SKILL_MD`

改动（见 design.md "Skill 改动"）：
- description 去掉"当前模板不声明执行脚本"，改为"通过脚本校验并写入开局产物"。
- 正文改为：执行步骤（10 步，标注脚本名）+ 产物落点（直接 write 的两项）+ `tsian-actions` JSON 声明块（9 个 action）。
- 保留 agent_call 导演 + commit_opening_narrative 编排指令。

`tsian-actions` 块格式（参照旧模板）：
```json tsian-actions
[
  {"name": "inspect_source_opening", "description": "...", "inputSchema": {...}, "executor": {"type": "browser_script", "path": "scripts/inspect-source-opening.js", "timeoutMs": 10000}},
  ...
]
```

### 5. 更新 prompt 构建函数

**文件**：`apps/play-frontend-dev/src/lib/source.ts`

**5a. `buildOpeningInitializationPrompt`**：
- 正面引导："用 `inspect_source_opening` 和 `read_opening_slice` 读源文本；用 `commit_*` 脚本写入开局产物，按 Skill《开局建模》的步骤执行。"
- 删除旧的第 3 条"写入初始理解包、实体..."（格式细节由脚本保证，prompt 不重复）。
- 删除第 5 条目标路径列表（Skill 产物落点已说明）。
- 保留 agent_call 导演写 brief 指令。
- 遵循 ai-facing-content-changes 规范：不提"不要直接 workspace_write"等禁令。

**5b. `buildPlaySetupPrompt`**：
- 改"你把结果写入 opening-narrative.json（格式 {...}）"为"调 `commit_opening_narrative` 写入开局正文"。
- 删除格式细节（脚本保证）。

### 6. 改写 10 个 Skill 描述

**文件**：`apps/platform-web/src/storage/workspace-templates.ts`

改写原则：去掉"当前模板不声明执行脚本"；去掉主体名前缀；去掉前端实现细节；触发条件留给 triggers。

| Skill | 新 description |
|---|---|
| 说书人·行动裁定 | "在叙事中发起行动裁定、调用裁定脚本、把结果融入正文。" |
| 资料员·实体读取 | "按实体、场景、关系或直接路径读取事实，压缩成精炼结论返回调用方。" |
| 资料员·资料检索 | "在源文本、schema、entity、scene、relationship、brief 中按问题检索材料并给出结论。" |
| 场记·状态栏维护 | "回合后维护 runtime/entity 中玩家可见的状态、属性和场景信息。" |
| 场记·schema演进检查 | "回合后发现新概念、结构空缺或过期字段，直接维护或提交待确认方案。" |
| 场记·行动裁定 | "根据已发生的裁定后果维护 runtime/entity/status。" |
| 世界架构师·开局建模 | "为刚导入的小说建立初始 schema、entities、scenes、relationships、runtime 与 mode 骨架，通过脚本校验并写入。" |
| 世界架构师·玩法启用 | "维护玩法系统的 enabled/disabled/deferred 状态。" |
| 世界架构师·行动裁定 | "在行动裁定启用时设计基础规则、schema 示例和状态落点。" |
| 导演·剧情指导维护 | "维护剧情方向 brief、节奏、伏笔、原著/分支平衡和刷新元数据。" |

### 7. 前端类型 + 校验 + 展示改动

**文件**：`apps/play-frontend-dev/src/lib/source.ts`

- `OpeningUnderstandingSummary` 改为 `{status: "ready"; title: string; candidateCharacters: ReadonlyArray<OpeningCandidateCharacter>}`。
- `isOpeningUnderstandingSummary` 校验三字段。
- 删除 `summary`/`entityCount`/`sourceWindow`/`extractedThrough`/`committedAt`/`schema` 字段。

**文件**：`apps/play-frontend-dev/src/components/setup/step2/UnderstandingReady.vue`

- 删除 `entityCount` 展示（`.meta-item` 含 `summary.entityCount`）。
- 保留 `candidateCharacters.length` + `title`。

### 7. 平台层优化——Skill Index 精简

**文件**：`apps/platform-web/src/agent-runtime/index.ts` — `formatSkillIndex`（491-520）

改动：
- 去掉 `scope` 标记（`[local]`/`[shared]`）。
- 去掉 `actions:` 列表（`actionLines`）。
- 去掉 `appliesTo`。
- 只保留 `- name: description`（+ triggers 如果有）。

### 8. 平台层优化——移除 SKILL.md 截断

**文件**：`apps/platform-web/src/agent-runtime/index.ts` — `formatActivatedSkillMessageBody`（534-552）

改动：
- 删除 `SKILL_INLINE_CHAR_LIMIT` / `SKILL_PREVIEW_CHAR_LIMIT` 常量。
- `formatActivatedSkillMessageBody` 直接返回 `[header, "", skill.content].join("\n")`，删除截断分支。

### 9. 构建验证

```bash
npm run build:contracts
npm run build:web
```

两者全通过。

### 10. prompt 禁令 grep 验证（ai-facing-content-changes 规范）

```bash
grep -n "不要.*write\|不要直接\|不要用 workspace_write\|不要写.*premise\|不要写.*worldOverview" apps/play-frontend-dev/src/lib/source.ts apps/platform-web/src/storage/workspace-templates.ts
```

要求：零命中。prompt 里只出现正面"用 commit_* 脚本"指令。

### 11. 端到端验收（手动）

如条件允许：
- 新建游戏卡 → 导入小说 → Step 2 → DebugView 确认脚本调用 → understanding-summary.json 三字段 → ready 态。
- Step 3 角色候选渲染。
- 设定收尾 → commit_opening_narrative → StoryView 渲染。
- 故意写错 ref → 脚本校验错误 → agent 修正重试。

## Risky Files & Rollback Points

| 文件 | 风险 | 回滚 |
|---|---|---|
| `workspace-templates.ts` | 脚本 JS 可能有 bug（校验过严/过松） | 删脚本文件 + Skill 回退到"不声明执行脚本" |
| `source.ts` prompt | prompt 改动影响 agent 行为 | 恢复旧 prompt |
| `source.ts` 类型 | 类型改动可能漏改消费方 | 恢复旧 OpeningUnderstandingSummary |
| `UnderstandingReady.vue` | UI 改动 | 恢复 entityCount 展示 |
| `agent-runtime/index.ts` | Skill Index 精简 + 截断移除影响所有 Skill | 恢复 formatSkillIndex 旧逻辑 + 恢复截断常量 |

**回滚锚点**：三条独立线——脚本基础设施（模板）、前端类型改动、平台层 Skill 机制优化。任一出问题可独立回退。

## Review Gates

- [ ] 9 个脚本文件注册到 DEFAULT_WORKSPACE_FILES。
- [ ] Skill《开局建模》含 tsian-actions 声明（9 个 action）+ 执行步骤 + 产物落点。
- [ ] Skill description 不再说"不声明执行脚本"。
- [ ] commit_understanding_summary 写入 `{status: "ready", title, candidateCharacters}` 三字段。
- [ ] commit_opening_narrative 写入 `{narrative, createdAt}`。
- [ ] ref 交叉校验：commit_scenes/commit_relationships/commit_runtime 校验 ref 存在性。
- [ ] 前端 OpeningUnderstandingSummary 三字段 + isOpeningUnderstandingSummary 校验。
- [ ] UnderstandingReady 删除 entityCount 展示。
- [ ] 10 个 Skill description 改写：无"不声明执行脚本"、无主体名前缀、无前端实现细节、无触发条件混入。
- [ ] formatSkillIndex 不再列 action/scope/appliesTo。
- [ ] formatActivatedSkillMessageBody 全文注入，无截断。
- [ ] prompt 无禁令（grep 零命中）。
- [ ] build:contracts + build:web 通过。
- [ ] prompt 无禁令（grep 零命中）。
- [ ] build:contracts + build:web 通过。
