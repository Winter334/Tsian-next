# 开局建模脚本基础设施 — 技术设计

## Scope

为开局建模补回 9 个脚本（inspect/read + 7 个 commit_*），替代 agent 自由 `workspace_write`。脚本复用旧 `commit_opening_understanding` 的校验逻辑，拆成聚焦的单产物脚本。同时修复 `understanding-summary.json` schema 不一致 bug。

## Architecture · 脚本基础设施

### 脚本声明机制（已存在，复用）

- Skill SKILL.md 内 ` ```tsian-actions ` JSON 块声明 `{name, description, inputSchema, executor: {type: "browser_script", path: "scripts/<name>.js"}}`。
- 脚本文件放在 `agents/world-architect/skills/开局建模/scripts/<name>.js`，作为 `DEFAULT_WORKSPACE_FILES` 条目。
- agent 通过 `use_skill` 激活 Skill 后，`test_skill_script` 或脚本 runner 执行。
- 脚本通过 `tsian.workspace.read`/`tsian.workspace.list`/`tsian.workspace.write` 操作 workspace（`scope: "save-runtime"` 写入走当前 turn 的 staged transaction）。
- 脚本签名：`async function(input, tsian, signal) → result`，`tsian.trace` 记录执行轨迹。

### 共享工具函数（OPENING_SCRIPT_COMMON 模式）

复用旧 `OPENING_SCRIPT_COMMON`，提取为共享 JS 片段拼接进每个脚本：

```js
// 共享工具（从旧 OPENING_SCRIPT_COMMON 提取）
const MANIFEST_PATH = 'save/source/manifest.json';
const CHAPTER_INDEX_PATH = 'save/source/chapters.index.json';
function isRecord(v) { ... }
function fail(code, message, details) { ... }
function parseJson(content, path) { ... }
async function readJson(tsian, path) { ... }
async function readText(tsian, path) { ... }
function cleanText(text) { ... }
function clipText(text, limit) { ... }
function normalizePositiveInt(v, fallback, min, max) { ... }
function normalizeString(v, code, label, maxLength) { ... }
function normalizeSegment(v, label) { ... }
function normalizeEntityId(rawId, label) { ... }  // → {id, type, localId}
async function loadSource(tsian) { ... }  // → {manifest, chapters}
async function loadExistingEntityIds(tsian) { ... }  // → Set<entityId>
```

实现方式：定义 `const OPENING_SCRIPT_COMMON = text([...])` 常量，每个脚本 JS 用模板字符串拼接：`` `${OPENING_SCRIPT_COMMON}${text([...])}` ``。与旧模板完全一致的模式。

### ref 交叉校验机制

旧 `commit_opening_understanding` 的核心校验逻辑拆分到各 commit 脚本：

- `commit_entities`：`normalizeEntity` + `ensureSourceRefsKnown`（sourceRefs 指向真实章节）。
- `commit_scenes`：`normalizeScene` + `normalizeRef`（present/location ref → `loadExistingEntityIds` 校验）。
- `commit_relationships`：`normalizeRelationships` + `normalizeRef`（subject/to ref → `loadExistingEntityIds` 校验）。
- `commit_runtime`：activeSceneIds ref → `tsian.workspace.list("save/scenes")` 校验存在；player.character ref → `loadExistingEntityIds` 校验。
- `commit_frontier`：chapter path → `loadSource` 的 knownPaths 校验。
- `commit_understanding_summary`：candidateCharacters id 格式校验（`normalizeEntityId`）；不校验 entity 存在性（candidateCharacters 的 id 应指向已写 character entity，但脚本只校验格式，存在性由调用顺序保证）。
- `commit_opening_narrative`：narrative 非空字符串。

`loadExistingEntityIds` 通过 `tsian.workspace.list({scope: "effective", path: "save/entities"})` 列出已写入的 entity 文件，解析路径为 entityId Set。这是旧脚本的现成实现，直接复用。

## Script API Design

### 1. inspect_source_opening（复用旧脚本）

- **input**: `{previewCount?: number, previewCharacters?: number}`
- **output**: `{title, totalCharacters, chapterCount, earlyChapters: [{index, title, path, preview}]}`
- **校验**: source manifest ready 状态
- **实现**: 直接从 `git show 95e392c^` 提取 `OPENING_INSPECT_SOURCE_SCRIPT_JS`

### 2. read_opening_slice（复用旧脚本）

- **input**: `{startIndex?: number, endIndex?: number, maxCharacters?: number}`
- **output**: `{window: {startIndex, endIndex, maxCharacters, totalCharacters, chapters}, text}`
- **校验**: 章节范围合法
- **实现**: 直接从 `git show 95e392c^` 提取 `OPENING_READ_SLICE_SCRIPT_JS`

### 3. commit_entities

- **input**: `{entities: [{id, name, brief, gender?, sourceRefs?, tags?, aliases?, origin?, ...}]}`
- **output**: `{writes: [{path, size}], entityCount, entityIds}`
- **校验**:
  - `normalizeEntityId`：id 格式 `<type>:<localId>`，不含 `/ \ : NUL . ..`
  - `normalizeString`：name（≤120）/ brief（≤1000）必填非空
  - `ensureSourceRefsKnown`：sourceRefs 指向 `loadSource` 的 knownPaths
- **写入**: 每个 entity → `save/entities/<type>/<localId>.json`，追加 `updatedBy: "world-architect"` + `updatedAt: ISOString`

### 4. commit_scenes

- **input**: `{scenes: [{id, name, location: {ref, name}, present: [{ref, name, brief, status?}]}]}`
- **output**: `{writes: [{path, size}], sceneCount, sceneIds}`
- **校验**:
  - `normalizeEntityId`：scene id 格式 `scene:<localId>`
  - `normalizeRef`：location/present ref → `loadExistingEntityIds` 校验存在
  - present 数组非空
- **写入**: 每个 scene → `save/scenes/<localId>.json`，追加 `status: "active"` + `updatedTurn: 0` + `updatedBy`

### 5. commit_relationships

- **input**: `{relationships: [{subject, edges: [{to, type, since?, until?, note?}]}]}`
- **output**: `{writes: [{path, size}], relationshipCount}`
- **校验**:
  - `normalizeEntityId`：subject/to id 格式
  - `normalizeRef`：subject/to → `loadExistingEntityIds` 校验存在
  - 每个 subject 不重复（scope 去重）
  - edges 非空
- **写入**: 每个 relationship → `save/relationships/<type>-<localId>.json`，追加 `updatedTurn: 0` + `updatedBy`

### 6. commit_runtime

- **input**: `{turn, activeSceneIds: [sceneRef], player: {character?, location?}, status?, extensions?}`
- **output**: `{write: {path, size}}`
- **校验**:
  - activeSceneIds 每个 ref → `tsian.workspace.list("save/scenes")` 校验 scene 文件存在
  - player.character ref → `loadExistingEntityIds` 校验存在
  - turn 非负整数
- **写入**: `save/playthrough/runtime.json`，合并默认字段（`inventory: null, status: [], extensions: {}, updatedAtTurn, updatedBy`）

### 7. commit_frontier

- **input**: `{sourceWindow: {start, end, chapters: [{index, title, path}]}, extractedThrough?, notes?}`
- **output**: `{write: {path, size}}`
- **校验**:
  - chapters path → `loadSource` 的 knownPaths 校验
  - extractedThrough path → knownPaths 校验
- **写入**: `save/playthrough/frontier.json`，追加 `updatedAt` + `updatedBy`

### 8. commit_understanding_summary

- **input**: `{title, candidateCharacters: [{id, name, brief, gender?}]}`
- **output**: `{write: {path, size}}`
- **校验**:
  - title 非空字符串（≤120）
  - candidateCharacters 数组（可为空，但字段必须在）
  - 每个 candidate：`normalizeEntityId` id 格式校验 + name（≤120）/ brief（≤500）非空 + gender 可选
- **写入**: `save/playthrough/understanding-summary.json`，结构 `{status: "ready", title, candidateCharacters}`

### 9. commit_opening_narrative

- **input**: `{narrative: string}`
- **output**: `{write: {path, size}}`
- **校验**: narrative 非空字符串
- **写入**: `save/playthrough/opening-narrative.json`，结构 `{narrative, createdAt: ISOString}`

## Skill《开局建模》改动

### frontmatter

```yaml
name: 开局建模
title: 开局建模
description: 世界架构师为刚导入的小说建立初始 schema、entities、scenes、relationships、runtime 与 mode 骨架；通过脚本校验并写入开局产物。
triggers:
  - 小说导入后需要建立开局世界资料
  - 需要根据玩家设定补齐开局实体、场景或 runtime 指针
```

### 正文结构

```markdown
# 开局建模

目标是建立后续常态流程能读到的正式路径。所有开局产物通过脚本校验写入——脚本返回错误时按错误修正后重试。

## 执行步骤

1. `inspect_source_opening` → 观察导入源结构和章节预览。
2. `read_opening_slice` → 连续阅读开头剧情（可多次调用）。读够的判据：主要角色登场、冲突建立、开局场景可定。
3. `commit_entities` → 写入实体（先写，后续 ref 依赖）。
4. `commit_scenes` → 写入场景（校验 present ref 指向已写实体）。
5. `commit_relationships` → 写入关系（校验 ref 指向已写实体）。
6. `commit_runtime` → 写入 runtime（校验 activeSceneIds + player ref）。
7. `commit_frontier` → 写入 frontier（记录源窗口）。
8. `commit_understanding_summary` → 写入理解摘要（candidateCharacters 从已写 character entity 提取 {id, name, brief, gender?}）。
9. agent_call 导演写初始 brief。
10. [设定收尾] `commit_opening_narrative` → 写入开局正文。

## 产物落点（直接 workspace_write，不走脚本）

- `save/schema/current.md` 与 `save/schema/changelog.md`
- `save/playthrough/mode.json`

## tsian-actions 声明

（9 个 action 的 JSON 声明块）
```

### prompt 改动（遵循 ai-facing-content-changes 规范）

`buildOpeningInitializationPrompt`：
- 正面引导："用 `inspect_source_opening` 和 `read_opening_slice` 读源文本；用 `commit_*` 脚本写入开局产物，按 Skill《开局建模》的步骤执行。"
- **不提禁令**：不写"不要直接 workspace_write"——脚本存在 + Skill 步骤说明已是正面引导，agent 有脚本时自然倾向调脚本。
- 不描述 understanding-summary 格式细节——格式由 `commit_understanding_summary` 脚本保证，prompt 不需要重复。

`buildPlaySetupPrompt`：
- 正面引导："设定收尾时调 `commit_opening_narrative` 写入开局正文。"
- 不写"你把结果写入 opening-narrative.json（格式 {...}）"——格式由脚本保证。

## 前端改动

### source.ts

```ts
export interface OpeningUnderstandingSummary {
  status: "ready"
  title: string
  candidateCharacters: ReadonlyArray<OpeningCandidateCharacter>
}

export function isOpeningUnderstandingSummary(value: unknown): value is OpeningUnderstandingSummary {
  return typeof value === "object"
    && value !== null
    && (value as { status?: unknown }).status === "ready"
    && typeof (value as { title?: unknown }).title === "string"
    && Array.isArray((value as { candidateCharacters?: unknown }).candidateCharacters)
}
```

### UnderstandingReady.vue

- 删除 `entityCount` 展示（`.meta-item` 含 `summary.entityCount`）。
- 保留 `candidateCharacters.length` + `title`。

## Compatibility & Rollback

- **向后兼容**：旧存档不兼容新 `understanding-summary.json` 校验——但旧存档本来就有格式问题，本任务是修 bug。
- **回滚**：脚本文件是新增，Skill 改动可回退到"不声明执行脚本"版本，prompt 可回退到"直接 workspace_write"版本。前端类型改动可回退到旧 8 字段版本。
- **数据迁移**：无需迁移。

### Skill 描述改写（遵循 ai-facing-content-changes 规范）

10 个 Skill 的 `description` 统一改写，原则：
1. 去掉"当前模板不声明执行脚本"——实现状态备注，对 agent 决策无用。
2. 去掉主体名前缀（"资料员按..."→"按..."）——Skill 已绑定 agent，不重复说"我是谁"。
3. 去掉前端实现细节（"可被前端投影到状态栏、人物卡"）——agent 不需要知道产物怎么被前端消费。
4. 触发条件留给 `triggers`——"当 X 时"不进 description。

改写清单见 implement.md 步骤 6。

## 平台层优化（Skill 机制）

本任务脚本基础设施直接受 Skill Index 展示和 SKILL.md 截断机制影响（9 个 action 名占 Index + SKILL.md 可能被截断导致 inputSchema 丢失）。两个优化一并纳入本任务。

### 优化 1：Skill Index 精简

**文件**：`apps/platform-web/src/agent-runtime/index.ts` — `formatSkillIndex`（491-520）

**现状**：每个 Skill 在 system prompt 常驻列出 `name [scope]: description + triggers + appliesTo + actions:` 列表（每个 action 名一行）。

**改动**：只保留 `- name: description`（+ triggers 如果有）。去掉：
- `scope` 标记（`[local]`/`[shared]`）——这是路径解析用的内部信息，agent 不需要知道 Skill 存在哪个目录。
- `actions:` 列表——agent use_skill 后从 SKILL.md 全文获取 action + inputSchema，Index 里的 action 名是冗余信息。
- `appliesTo`——use_skill 后自然知道。

**理由**：use_skill 前 agent 只需知道"有这个 Skill、它是干什么的"。action 名 + 参数在 use_skill 后从 SKILL.md 全文获取。去掉后每轮 system prompt 省掉所有 Skill 的 action 行 token。

### 优化 2：移除 SKILL.md 截断

**文件**：`apps/platform-web/src/agent-runtime/index.ts` — `formatActivatedSkillMessageBody`（534-552）

**现状**：SKILL.md ≤ 6000 字符全文注入；> 6000 字符只注入前 2000 字符 preview，提示续读。

**改动**：直接全文注入，删除 `SKILL_INLINE_CHAR_LIMIT` / `SKILL_PREVIEW_CHAR_LIMIT` 常量和截断分支。

**理由**：Skill 是卡模板精心设计的，内容可控，不会出现意外的超长内容。截断会导致 `tsian-actions` JSON 块的 `inputSchema` 可能丢失——agent 不知道脚本参数，这是难以察觉的问题。移除截断消除这个风险。

## Out of Scope

- 不实现行动裁定玩法脚本（独立任务 `action-resolution-system`）。
- 不改 platform-host 脚本执行机制（已就绪，复用）。
- 不改 `sendMessage` / checkpoint / invokeAgent 机制。
- 不改 storyteller platformTools（D1 落盘责任方案 b 不变）。
- 不实现开局富渲染（opening-narrative.json 保持 `{narrative, createdAt}`）。
