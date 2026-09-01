# Implement — runtime/scene/character schema UI 对齐

## 执行顺序

按依赖顺序推进：先动平台模板与开局脚本（决定新存档 shape），再动前端类型/解析（消费新 shape），再动状态栏组件（消费新类型），最后同步 schema/current.md 与相关 Trellis 子任务 PRD。

任何一步失败即停下，先修好再继续。

## Step 1 — 平台默认模板 runtime shape

文件：`apps/platform-web/src/storage/workspace-templates.ts`

- [ ] 递增 `DEFAULT_WORKSPACE_VERSION` 从 `12` 到 `13`。
- [ ] 更新默认 `save/playthrough/runtime.json` 模板（`DEFAULT_SAVE_RUNTIME_FILES` 中 runtime.json 项）：
  - 字段：`turn`、`worldTime`、`location`、`weather`、`activeSceneRefs`、`protagonistRef`、`extensions`、`updatedAtTurn`、`updatedBy`。
  - 初始值：`turn: 0`、`worldTime: ""`、`location: null`、`weather: ""`、`activeSceneRefs: []`、`protagonistRef: null`、`extensions: {}`、`updatedAtTurn: 0`、`updatedBy: null`。
- [ ] 删除模板里旧字段：`activeSceneIds`、`activeScene`、`player`、`inventory`、`status`。

## Step 2 — 开局脚本 commit_runtime_and_frontier

文件：`apps/platform-web/src/storage/workspace-templates.ts` 中 `COMMIT_RUNTIME_AND_FRONTIER_SCRIPT_JS`。

- [ ] 输入合约按新字段：`runtime.activeSceneRefs`（数组 of `{ ref, name }` 或 `ref` 字符串）、`runtime.protagonistRef`、`runtime.location`、`runtime.weather`、`runtime.worldTime`。
- [ ] 移除 `activeSceneIds` / `player.character` / `player.location` / `inventory` / `status` 处理逻辑。
- [ ] 场景 ref 校验：`activeSceneRefs` 至少一项；每项 ref 归一为 `scene:<localId>` 且指向已写 scene；`name` 从 ref 目标 scene 文件取（若脚本能读取），否则接收调用方给的 name。
- [ ] 主角 ref 校验：`protagonistRef.ref` 归一为 `character:<localId>` 且指向已写 entity；`name` 来自实体或调用方。
- [ ] 地点 ref 校验：`location.ref` 归一为 `location:<localId>` 且指向已写 entity；缺省时 `location: null`。
- [ ] 写入内容按新 schema；`updatedBy: 'world-architect'`。
- [ ] 更新 `WORLD_ARCHITECT_OPENING_SKILL_MD` 中 `commit_runtime_and_frontier` action description 与 `执行步骤 5.` 说明文本。

## Step 3 — 开局脚本 scene present ref-only

文件：`apps/platform-web/src/storage/workspace-templates.ts`

- [ ] `OPENING_VALIDATION_JS` 中 `normalizeScene`：`present` 项归一为 `{ ref }`，去掉 `name` / `brief` / `status` 归一。至少一项要求保留。
- [ ] `normalizeRef` 保留（仍用于 `location`）。
- [ ] `COMMIT_SCENES_AND_RELATIONSHIPS_SCRIPT_JS`：写入的 `present` 数组只含 `{ ref }`；场景文件其它字段（`id`、`name`、`location`、`status`、`updatedTurn`、`updatedBy`、`updatedAt`）保留。
- [ ] `SCENES_README_MD`：字段说明中 `present` 改为 "在场实体引用，每项 `{ ref }`"。

## Step 4 — Skill / 指南文档同步

文件：`apps/platform-web/src/storage/workspace-templates.ts`

- [ ] `NOVEL_AIRP_SCHEMA_GUIDE_MD`：
  - Runtime 示例替换为新 shape（含 `worldTime`、`activeSceneRefs`、`protagonistRef`、`location`、`weather`、`extensions`）。
  - 权威归属小节：runtime 是"当前上下文索引 + 世界变量"；`activeSceneRefs` 是入口指针，非场景内容权威；scene.present 是 ref 列表，人物权威在 entity。
  - 实体基础小节：character 补 `identity` / `appearance` / `attributes` / `gauges` / `status.polarity` 简要示例（不写死完整 shape，指向 reference 文档）。
- [ ] `NOVEL_AIRP_SCHEMA_REFERENCE_MD`：
  - Runtime 变量小节按新 shape 重写。
  - 场景分片格式小节：present 改为 ref-only。
  - 实体推荐元数据：示例中移除 `status[].level`；补 `status[].name` + `status[].polarity`；`fields`/`sections` 示例替换为 `identity` / `appearance` / `background` / `goals` / `attributes` / `gauges` 示例。
- [ ] `STAGE_MANAGER_STATUS_SKILL_MD`：
  - 更新 runtime 字段清单描述为 `worldTime`、`activeSceneRefs`、`protagonistRef`、`location`、`weather`、`extensions`。
  - character status 维护改用 `polarity`（positive/negative/neutral），不再使用 `level`。
  - 明确 runtime 不再存 `player` / `inventory` / `status` 摘要。
- [ ] `save/schema/current.md`（`DEFAULT_SAVE_RUNTIME_FILES` 中）：
  - Frontend-readable Fields 小节：runtime.json 高频字段列表按新 shape 更新。
  - character 推荐字段清单加入 `identity`、`appearance`、`attributes`、`gauges`、`status.polarity`；从推荐字段中去掉 `fields`、`sections`。
  - 加入基础维度基准语句（普通健康成年人 = 5）。

## Step 5 — 前端 runtime 类型与解析

文件：
- `apps/play-frontend-dev/src/lib/runtime-types.ts`
- `apps/play-frontend-dev/src/lib/parse-runtime.ts`

- [ ] `runtime-types.ts` 的 `Runtime` interface：
  - 保留：`turn`、`worldTime`、`extensions`、`updatedAtTurn`、`updatedBy`。
  - 新增：`location: { ref, name } | null`、`weather: string`、`activeSceneRefs: Array<{ ref, name }>`、`protagonistRef: { ref, name } | null`。
  - 删除：`activeSceneIds`、`activeScene`、`player`、`inventory`、`status`。
- [ ] `parse-runtime.ts` `isRuntimeLike`：
  - 必检 `turn`(number) + `worldTime`(string) + `activeSceneRefs`(array) + `extensions`(object)。
  - 移除 `player` 对象检查（旧必检字段）。
- [ ] `parse-runtime.ts` `parseRuntime` 返回值：
  - 只映射新字段；`activeSceneRefs` 逐项校验为对象 + `ref` 字符串，非对象项跳过；`name` 缺省取空串。
  - `location` / `protagonistRef` 允许 null；非对象或缺 `ref` 时归一 null。
  - `weather` 非字符串时归一空串。
- [ ] `RuntimeData` / `DisplayItems` / `DisplayItem` / `RenderPreset` 保持不变（扩展项渲染基础设施沿用）。

## Step 6 — 状态栏组件对齐

文件：
- `apps/play-frontend-dev/src/App.vue`
- `apps/play-frontend-dev/src/components/StatusBar.vue`
- `apps/play-frontend-dev/src/components/status-bar/StatusBarScene.vue`
- `apps/play-frontend-dev/src/components/status-bar/StatusBarCharacter.vue`
- `apps/play-frontend-dev/src/components/status-bar/StatusBarStatus.vue`
- `apps/play-frontend-dev/src/components/status-bar/StatusBarMetrics.vue`
- `apps/play-frontend-dev/src/components/status-bar/StatusBarRefs.vue`

- [ ] `App.vue`：`StatusBar` 上 `character` prop 来源改为 `runtime.protagonistRef`；`scene`/`worldTime` 来源改为 `runtime.activeSceneRefs[0]` 与 `runtime.worldTime`。
- [ ] `StatusBar.vue`：内部 props/传递按新字段；`open-character` 事件仍用 `protagonistRef.ref` 触发。
- [ ] `StatusBarScene.vue`：从 `runtime.activeSceneRefs[0]?.name` 读场景名；`worldTime` 不变。若无活跃场景，展示 "—" 或 "未设定场景"。
- [ ] `StatusBarCharacter.vue`：`character` snapshot 类型不变（仍 `{ ref, name }`），但 App.vue 传值来源改为 `protagonistRef`。
- [ ] `StatusBarStatus.vue`：
  - 输入源改为主角实体的 `status` 数组；调用方（`StatusBar.vue`）通过 `useEntity(protagonistRef.ref)` 获取主角实体，把 `entity.status` 传给 `StatusBarStatus`。
  - `RuntimeStatus.level?` 字段移除；改为 `polarity?: "positive" | "negative" | "neutral"`。
  - 渲染：每项显示 `name`（若无 name fallback 到 `description`）；`polarity` 影响 chip 颜色 tone（negative → --blood，positive → success 色，neutral → --prose-dim）。
  - `description` 不再作为主展示，可作为 title/tooltip 或后续点击展开（本任务只挂 title 属性够用）。
- [ ] `StatusBarMetrics.vue`、`StatusBarRefs.vue`：数据源仍是 `displayItems.metrics` / `displayItems.refs`（runtime.extensions 派生），无需修改。
- [ ] 状态栏不引入钉选机制；钉选留给后续任务。

## Step 7 — 相关 Trellis 子任务 PRD 更新

- [ ] `.trellis/tasks/07-04-present-characters-character-cards/prd.md`：
  - Dependencies 小节加入本任务：依赖 `.trellis/tasks/07-05-runtime-scene-character-schema-ui-align` 完成后再启动。
  - Confirmed UI/UX Decisions 中如仍出现"schema 稳定后再改"的表述，更新为"schema 由本前置任务对齐完成"。
- [ ] `.trellis/tasks/07-04-runtime-summary-injection/prd.md`：
  - Dependencies 小节加入本任务：依赖新 runtime schema 完成。
- [ ] `.trellis/tasks/07-03-play-frontend-status-bar/task.json`：`children` 已包含本任务，验证顺序即可。

## Step 8 — 验证

- [ ] `npm run build --workspace play-frontend-dev` 通过。
- [ ] `npm run build:web` 通过（platform-web 模板改动需要此 build）。
- [ ] `git diff --check` 无空白问题。
- [ ] 手动核对：`grep -n "activeSceneIds\|activeScene\b\|player.character\|status\\.level" apps/ .trellis/spec/` 只剩下 test / archived task / 本 design.md 引用，运行代码里无旧字段读取。

## Rollback

若前端 build 失败：先回退 `runtime-types.ts` + `parse-runtime.ts` + 状态栏组件对齐部分，保留模板 shape 变更调查根因。

若 `npm run build:web` 失败：优先检查 `_validation.js` 与 `commit_runtime_and_frontier` 的语法（浏览器脚本以字符串拼接形式存在，容易漏引号或分号）。

若发现旧存档无法自动迁移：确认删除本地 IndexedDB 存档后重开一次；本项目无生产存档，不写兼容层。

## Review Gates

Step 5 完成、Step 6 开始前：跑一次 `npm run build --workspace play-frontend-dev` 确认新类型与旧状态栏组件的耦合面。若类型报错超出预期，回到 design.md 更新。

Step 7 完成后：跑 `git status` 检查改动集合，与 PRD 声明的范围一致；`preview-character-card.html` 不合入。
