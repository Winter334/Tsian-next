# 开局建模脚本基础设施

## Goal

为开局建模补回脚本基础设施：world-architect 通过脚本校验并写入开局产物，而非自由 `workspace_write`。脚本在写入时校验结构和 ref 引用，返回错误让 agent 当场修正重试。同时修复 `understanding-summary.json` 的 schema 不一致 bug（prompt 不规定格式 + 前端强制校验 → agent 自由发挥格式不对 → Step 2 报失败）。

## Background · 缺口来源

旧模板有完整的开局脚本体系（`inspect_source_opening` + `read_opening_slice` + `commit_opening_understanding`），在 `95e392c`（default AIRP agent template rewrite）时被删，改成 agent 自由 `workspace_write`。后果：
- 产物格式不可控（`understanding-summary.json` 缺 `status`/`summary` 字段，前端校验不过）。
- ref 指针错误延迟暴露（runtime.json 的 activeSceneIds 指向不存在的 scene，后续回合才报错）。
- 无校验环节，agent 写错不知道，直到前端消费时才发现。

旧 `commit_opening_understanding` 一次性提交全部产物（entities + scenes + relationships + runtime + frontier + summary），API 复杂、失败时定位难。本任务拆成聚焦脚本，分步提交，每步独立校验。

## Design · 脚本体系

### 脚本清单

| 脚本 | 职责 | 输入要点 | 校验要点 |
|---|---|---|---|
| `inspect_source_opening` | 读源 manifest + 章节预览 | `{previewCount?, previewCharacters?}` | source ready 状态 |
| `read_opening_slice` | 连续读开头章节 | `{startIndex?, endIndex?, maxCharacters?}` | 章节范围合法 |
| `commit_entities` | 校验 + 写 entity 文件 | `{entities: [{id, name, brief, ...}]}` | id 格式 `<type>:<localId>` + 必填字段 + sourceRefs 指向真实章节 |
| `commit_scenes` | 校验 + 写 scene 文件 | `{scenes: [{id, name, location, present}]}` | scene id 格式 `scene:<localId>` + present/location ref 指向已存在 entity |
| `commit_relationships` | 校验 + 写 relationship 文件 | `{relationships: [{subject, edges}]}` | subject/to ref 指向已存在 entity |
| `commit_runtime` | 校验 + 写 runtime.json | `{turn, activeSceneIds, player, status, extensions}` | activeSceneIds 指向已存在 scene + player.character 指向已存在 entity |
| `commit_frontier` | 校验 + 写 frontier.json | `{sourceWindow, extractedThrough}` | chapter path 存在性 |
| `commit_understanding_summary` | 校验 + 写 understanding-summary.json | `{title, candidateCharacters: [{id, name, brief, gender?}]}` | 三字段必填 + candidateCharacters id 格式 |
| `commit_opening_narrative` | 校验 + 写 opening-narrative.json | `{narrative: string}` | narrative 非空 |

### 调用顺序（Skill 明确规定）

```
1. inspect_source_opening → 观察源结构
2. read_opening_slice → 读开头剧情（可多次调用，读到足够为止）
3. commit_entities → 写实体（先写，后续 ref 依赖）
4. commit_scenes → 写场景（校验 present ref → 已写实体）
5. commit_relationships → 写关系（校验 ref → 已写实体）
6. commit_runtime → 写 runtime（校验 activeSceneIds → 已写 scene + player → 已写 entity）
7. commit_frontier → 写 frontier
8. commit_understanding_summary → 写 summary（candidateCharacters 从已写 character entity 提取）
9. agent_call 导演写 brief
10. [设定收尾] commit_opening_narrative → 写开局正文
```

ref 交叉校验：`commit_scenes`/`commit_relationships`/`commit_runtime` 通过 `tsian.workspace.list` + `tsian.workspace.read` 读取已写入的 entities，校验 ref 存在性。旧脚本的 `loadExistingEntityIds` / `normalizeRef` / `normalizeScene` / `normalizeRelationships` 校验逻辑直接复用。

### understanding-summary.json 新 schema

```jsonc
{
  "status": "ready",
  "title": "<书名>",
  "candidateCharacters": [
    { "id": "character:<localId>", "name": "<角色名>", "brief": "<一句话简介>", "gender": "<可选>" }
  ]
}
```

三字段全部必填。`candidateCharacters` 从 agent 建的 character 类型 entity 中提取。

### 脚本技术机制

- 脚本声明：Skill《开局建模》SKILL.md 内 `tsian-actions` JSON 块（`{name, description, inputSchema, executor: {type: "browser_script", path: "scripts/<name>.js"}}`）。
- 脚本文件：`agents/world-architect/skills/开局建模/scripts/<name>.js`，作为 `DEFAULT_WORKSPACE_FILES` 条目。
- 脚本共享：复用旧 `OPENING_SCRIPT_COMMON` 模式（共享工具函数：`loadSource`/`readJson`/`cleanText`/`normalizeString`/`normalizeEntityId`/`fail` 等）。
- 执行：agent 通过 `use_skill` → 脚本 runner 执行，复用当前 turn 的 workspace 事务（写入走 staged transaction）。
- 错误处理：脚本 `fail(code, message, details)` 抛错，agent 收到错误后按 code/message 修正重试。

## Requirements

- R1: 新增 9 个开局建模脚本（见上表），作为 `DEFAULT_WORKSPACE_FILES` 条目 + Skill `tsian-actions` 声明。
- R2: 脚本复用旧 `OPENING_SCRIPT_COMMON` 共享工具函数模式；ref 交叉校验逻辑从旧 `commit_opening_understanding` 提取。
- R3: Skill《开局建模》改写：description 去掉"不声明执行脚本"；产物落点标注走脚本 vs 直接 write；明确调用顺序；加 `tsian-actions` 声明。
- R4: `buildOpeningInitializationPrompt`（`source.ts`）更新：指示 agent 用脚本读源文本 + 用 `commit_*` 脚本写入产物，按调用顺序执行。
- R5: 前端 `OpeningUnderstandingSummary` 类型改为 `{status: "ready"; title: string; candidateCharacters: ReadonlyArray<OpeningCandidateCharacter>}`，删除 `summary`/`entityCount`/`sourceWindow`/`extractedThrough`/`committedAt`/`schema`。
- R6: `isOpeningUnderstandingSummary` 校验三字段：`status === "ready"` + `typeof title === "string"` + `Array.isArray(candidateCharacters)`。
- R7: `UnderstandingReady.vue` 删除 `entityCount` 展示；`candidateCharacters.length` + `title` 保留。
- R8: prompt 改动遵循 `ai-facing-content-changes.md` 规范：正面引导（"用 commit_* 脚本写入"），不提禁令（不写"不要直接 workspace_write"等否定句——脚本存在本身就是正面引导，agent 有脚本可用时自然倾向调脚本）。
- R9: `buildPlaySetupPrompt`（`source.ts`）更新：设定收尾时用 `commit_opening_narrative` 脚本写入开局正文（替代"你把结果写入 opening-narrative.json"）。
- R10: `commit_opening_narrative` 脚本接收 `{narrative: string}`，校验非空后写入 `{narrative, createdAt}` 结构。world-architect agent_call 说书人拿正文后调此脚本落盘（D1 落盘责任方案 b 不变：说书人无 write 权限，world-architect 调脚本落盘）。
- R11: Skill Index（`formatSkillIndex`）精简：不再列出 action 名、scope 标记、appliesTo——use_skill 前 agent 只需知道 Skill 名称和描述；action + inputSchema 在 use_skill 后从 SKILL.md 全文获取。
- R12: 移除 SKILL.md 截断机制（`formatActivatedSkillMessageBody`）：use_skill 后直接全文注入 SKILL.md，不截断——Skill 是卡模板精心设计的可控内容，截断会导致 `inputSchema` 丢失这种难以察觉的问题。

## Acceptance Criteria

- [ ] 新卡导入小说 → Step 2 understanding 完成 → agent 通过脚本写入开局产物 → 前端读到 `understanding-summary.json` 且校验通过 → 进入 ready 态。
- [ ] `understanding-summary.json` 含 `status: "ready"` + `title` + `candidateCharacters`（`{id, name, brief, gender?}` 对象数组）。
- [ ] agent 写入 entity/scene/relationship/runtime 时 ref 指向不存在的实体 → 脚本返回校验错误 → agent 修正后重试成功。
- [ ] Step 2 `UnderstandingReady` 展示书名 + 候选角色数（不再展示 entityCount）。
- [ ] Step 3 `CanonCharacterSelect` 从 `candidateCharacters` 渲染角色候选列表。
- [ ] 设定收尾时 agent 调 `commit_opening_narrative` 写入开局正文 → StoryView 渲染。
- [ ] Skill《开局建模》含 `tsian-actions` 声明 + 调用顺序说明 + 产物落点标注。
- [ ] Skill Index 不再列出 action 名/scope/appliesTo（`formatSkillIndex` 精简）。
- [ ] SKILL.md use_skill 后全文注入，无截断（`formatActivatedSkillMessageBody` 移除截断分支）。
- [ ] `npm run build:web` 通过。
- [ ] prompt 改动无禁令（grep prompt 文本，只出现正面"用 commit_* 脚本"，不出现"不要直接 write"等否定句）。

## Dependencies

- 无前置依赖；`opening-multi-agent-orchestration` 已归档（agent_call 编排已就绪）。
- 旧脚本实现（`git show 95e392c^`）作为参考输入，校验逻辑直接复用。

## Notes

- 旧 `commit_opening_understanding` 的校验函数（`normalizeEntityId`/`normalizeEntity`/`normalizeCandidate`/`normalizeScene`/`normalizeRelationships`/`normalizeRef`/`loadExistingEntityIds`/`ensureSourceRefsKnown`）从 git 历史提取，按拆分后的脚本分配。
- `entityCount` 展示直接删除（不改为前端自己数）。
- 旧存档不兼容新校验——本任务是修 bug + 补基础设施，不做向后兼容。
- design.md 需详细设计：脚本 API 签名 + 共享函数拆分 + ref 交叉校验机制 + Skill 改动 + prompt 改动。
