# Implement — 在场人物与角色卡

## 执行顺序

按依赖顺序推进：先动 platform 模板（schema 微调），再动前端类型/解析/composable，再动 UI 组件（自底向上：原子组件 → pane → card → view），最后 App.vue 接线 + 验证。

任何一步失败即停下，先修好再继续。

## Step 1 — platform 模板 character schema 微调

文件：`apps/platform-web/src/storage/workspace-templates.ts`

- [ ] `NOVEL_AIRP_SCHEMA_REFERENCE_MD` 实体推荐元数据示例：
  - `identity` 改为 `{ "age": 17, "gender": "男", "role": "外门弟子", "affiliation": "青玄门", "realm": "炼气后期" }`。
  - `appearance` 改为单段字符串 `"身着青玄门外门弟子袍，衣袖被剑气割裂……"`。
  - `gauges` 改为自由命名数组 `[{ "id": "cultivation-progress", "name": "修炼进度", "value": 24, "max": 100, "tone": "accent" }, ...]`。
  - 新增 `"goals": { "current": "...", "shortTerm": "...", "longTerm": "..." }`。
  - 新增 `"background": "..."`。
- [ ] `NOVEL_AIRP_SCHEMA_GUIDE_MD`：
  - 实体基础小节 character 字段清单加入 `goals`/`background`；`identity` 键改为 `age/gender/role/affiliation/realm`；`gauges` 描述改为"自由命名量表数组"；`appearance` 描述改为"当前形象叙事字符串"。
  - `identity`/`appearance`/`attributes`/`gauges`/`status`/`goals`/`background` 权威说明段落更新。
- [ ] `STAGE_MANAGER_STATUS_SKILL_MD`：
  - character 字段清单更新（identity 键名、gauges 数组、appearance 字符串、goals、background）。
- [ ] `save/schema/current.md`（在 `DEFAULT_SAVE_RUNTIME_FILES` 中）：
  - character 推荐字段清单更新（identity 键、gauges 数组、appearance 字符串、goals、background）。
  - 移除 race/class/title 与固定 5 key gauges 描述。

## Step 2 — 前端 character 类型与解析

文件：
- 新增 `apps/play-frontend-dev/src/lib/character-types.ts`
- 新增 `apps/play-frontend-dev/src/lib/parse-character.ts`

- [ ] `character-types.ts`：按 design §3.1 + §3.2 定义 `Polarity` / `CharacterIdentity` / `CharacterGauge` / `CharacterStatus` / `CharacterGoals` / `CharacterAttributes` / `CharacterEntity` / `RelationshipEdge` / `RelationshipFile`。
- [ ] `parse-character.ts`：
  - `parseCharacter(raw: unknown): CharacterEntity | null`：必检 `id`/`name`/`brief`，缺一返回 null。
  - `identity` 对象逐键归一（age 允许 string|number，其余 string）。
  - `gauges` 数组逐项校验 `id`/`name`/`value`，缺则丢弃；`tone` 归一 union。
  - `attributes` 对象逐键校验 number，非 number 丢弃。
  - `status` 数组逐项校验 `id`，`polarity` 归一。
  - `goals` 对象逐键校验 string。
  - `appearance` / `background` 校验 string。
  - `aliases` 校验 string[]。
- [ ] `parseRelationships(raw: unknown): RelationshipFile | null`：必检 `subject`/`edges`；逐 edge 校验 `to`/`type`。

## Step 3 — useRelationships composable

文件：新增 `apps/play-frontend-dev/src/composables/useRelationships.ts`

- [ ] 输入 `subjectRef: string`（如 `character:萧玄`）。
- [ ] 路径：`save/relationships/character-<localId>.json`（去 `type:` 前缀；与现有 `save/relationships/<scope>.json` 命名一致）。
- [ ] 输出 `{ data: Ref<RelationshipFile | null>, error: Ref<"load-failed" | "not-found" | null>, load: () => Promise<void> }`。
- [ ] 错误策略与 `useEntity`/`useScene` 同构：not-found / load-failed，不抛错。
- [ ] 不自动 onMounted 加载——由 UI 决定。

## Step 4 — 原子组件

文件：新增 `apps/play-frontend-dev/src/components/character/`

- [ ] `AttributeCard.vue`：props `{ name: string, value: number | null }`；渲染 name + 大数字；value null 时展示"—"。
- [ ] `GaugeBar.vue`：props `{ gauge: CharacterGauge }`；渲染 name + progress bar（width = value/max）+ value；tone 决定 bar 颜色。
- [ ] `IdentityFacts.vue`：props `{ identity?: CharacterIdentity }`；逐键渲染 fact chip（label + value）；缺省键不展示。
- [ ] `StatusChips.vue`：props `{ status: CharacterStatus[] }`；逐项 chip；polarity 决定颜色；`title` 挂 `description`；只显示 `name`。
- [ ] `RelationshipList.vue`：props `{ edges: RelationshipEdge[] }`；逐项 useEntity(edges[i].to) 取 name/brief；单行 `name + brief`；点击 emit `select(ref)`；不显示 raw ref。
- [ ] `GoalsBlock.vue`：props `{ goals?: CharacterGoals }`；三行 label-text（当前/短期/长期）；缺省项不展示。
- [ ] `CharacterPortrait.vue`：props `{ name: string }`；3:4.15 比例；首字占位；暗色仪式风边框 + 渐变蒙层。

## Step 5 — Pane 组件

- [ ] `OverviewPane.vue`：props `{ entity: CharacterEntity, relationships: RelationshipFile | null, displayItems: DisplayItems }`；按 design §4.4 顺序渲染：IdentityFacts → 当前形象（appearance）→ StatusChips → RelationshipList → GoalsBlock → 背景摘记（background）→ extensions 分区（metrics/tags/refs/sections）。
- [ ] `AttributesPane.vue`：props `{ attributes?: CharacterAttributes, gauges?: CharacterGauge[] }`；六维 AttributeCard 网格 + gauges GaugeBar 列表；缺省维度展示"—"。
- [ ] `InventoryPane.vue`：占位 icon + 文案"背包 / 容器详情由后续任务填充"。

## Step 6 — CharacterDetail + CharacterCard

- [ ] `CharacterDetail.vue`：props `{ entity: CharacterEntity, relationships: RelationshipFile | null, displayItems: DisplayItems }`；tab state（overview/attributes/inventory）；渲染 tabs + 当前 pane；切换时只换 pane 内容。
- [ ] `CharacterCard.vue`：props `{ entity: CharacterEntity | null, loading: boolean, relationships: RelationshipFile | null }`；左侧固定 `CharacterPortrait` + 右侧 `CharacterDetail`；entity null 时降级显示 ref/localId + "档案缺失"。

## Step 7 — CharacterList + CharacterView

- [ ] `CharacterList.vue`：props `{ presentRefs: Array<{ ref: string }>, selectedRef: string | null, protagonistRef: string | null, relationships: RelationshipFile | null }`；在场人物分组逐项 useEntity 取 name/brief；关联人物分组从 relationships.edges[*].to 过滤在场后剩余；点击 emit `select(ref)`。
- [ ] `CharacterView.vue`：从 `useRuntime` 取 runtime；从 `activeSceneRefs[0].ref` 取 scene ref；`useScene` 读 scene.present；默认选中 `protagonistRef.ref` 或 present[0].ref；`useEntity(selectedRef)` + `useRelationships(selectedRef)`（用 `:key="selectedRef"` 触发 remount）；渲染 `CharacterList` + `CharacterCard`；空态/降级处理。

## Step 8 — App.vue 接线

文件：`apps/play-frontend-dev/src/App.vue`

- [ ] import `CharacterView`。
- [ ] 把 `navCurrent === "character"` 分支的占位 div 替换为 `<CharacterView v-if="navCurrent === 'character'" />`。
- [ ] 删除 `.view-stage-character` 占位相关样式（保留 `.view-stage` 给 settings 占位）。
- [ ] 验证 `:has(.status-bar.collapsed) .view-stage` padding 联动对新 character 视图仍生效（CharacterView 自身布局应继承 view-stage 的 padding 行为；若不兼容，单独处理 character 视图的 padding 联动）。

## Step 9 — 验证

- [ ] `npm run build --workspace play-frontend-dev` 通过。
- [ ] `npm run build:web` 通过。
- [ ] `git diff --check` 无空白问题。
- [ ] grep 核对：`git grep -n "race.*class.*title\|hp.*mp.*sp.*hunger.*stamina" apps/platform-web/src/storage/workspace-templates.ts` 应只剩"已废弃"注释或为空。
- [ ] 手动核对：`apps/play-frontend-dev/src/components/character/` 下所有组件 props 类型与 `character-types.ts` 一致。

## Rollback

- 若 platform build 失败：先回退 `workspace-templates.ts` Step 1 改动，调查 character 字段示例 JSON 是否有引号/逗号问题（多行字符串拼接易错）。
- 若前端 build 失败：先回退 App.vue Step 8 接线，保留组件文件调查 type 错误。
- 若运行时 UI 黑屏：检查 `useRuntime` / `useScene` / `useEntity` / `useRelationships` 的 ref 传递是否正确，特别是 `:key` remount 时机。

## Review Gates

- Step 4 完成后：跑一次 `npm run build --workspace play-frontend-dev` 确认原子组件类型无错。
- Step 7 完成后：跑一次 build 确认 CharacterView 与现有 useRuntime/useScene/useEntity 接口契合。
- Step 8 完成后：跑一次 `npm run build:web` 确认 platform 模板改动无误。

## 不做

- 不引入图片上传/持久化。
- 不实现背包/容器/物品详情。
- 不实现状态栏钉选。
- 不实现 storyteller injection。
- 不修改 runtime/scene schema。
- 不修改状态栏组件（已就绪）。
- 不递增 DEFAULT_WORKSPACE_VERSION（维持 13）。
