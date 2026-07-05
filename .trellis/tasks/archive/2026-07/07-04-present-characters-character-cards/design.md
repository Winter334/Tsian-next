# Design — 在场人物与角色卡

## 1. 范围与不做

本任务实现角色卡全屏 UI 与左侧在场人物列表，并顺手完成 character schema 微调（identity/gauges/appearance 形态修正 + 补 goals/background）。

命中改动的层：

- **platform-web 模板**：`apps/platform-web/src/storage/workspace-templates.ts` 中 character `identity` / `gauges` / `appearance` 形态修正，新增 `goals` / `background`，更新 guide/reference/current.md/stage-manager skill 文本。
- **前端类型/解析层**：`apps/play-frontend-dev/src/lib/runtime-types.ts` 与 `apps/play-frontend-dev/src/lib/parse-entity.ts` —— 新增 character 强类型契约（仅本任务用到的字段）+ relationships 分片类型 + parseRelationships。
- **新增 composable**：`apps/play-frontend-dev/src/composables/useRelationships.ts` —— 读取 `save/relationships/character-<localId>.json` 分片。
- **新增视图组件**：`apps/play-frontend-dev/src/components/character/CharacterView.vue`（全屏视图根） + 子组件。
- **App.vue**：把 `navCurrent === "character"` 的占位替换为 `CharacterView`。
- **不动**：runtime/scene schema（已在 07-05 完成）、状态栏组件（已就绪）、`useEntity`/`useScene`、扩展项分桶基础设施（`DisplayItems`/`parseExtensions`/`render-mapping`）。

不实现：

- 角色图片上传/持久化（占位首字）。
- 背包/容器/物品详情（占位 tab）。
- 装备页。
- 状态栏钉选机制。
- storyteller injection。

## 2. character schema 微调

### 2.1 新 identity

```json
"identity": {
  "age": 17,
  "gender": "男",
  "role": "外门弟子",
  "affiliation": "青玄门",
  "realm": "炼气后期"
}
```

所有键可选；缺省时 UI 不展示该 fact chip。`realm` 在非修仙世界观可缺省。

### 2.2 新 gauges（数组）

```json
"gauges": [
  { "id": "cultivation-progress", "name": "修炼进度", "value": 24, "max": 100, "tone": "accent" },
  { "id": "corruption", "name": "腐化值", "value": 37, "max": 100, "tone": "danger" },
  { "id": "mana-deficit", "name": "法力亏空", "value": 10, "max": 100, "tone": "warning" }
]
```

每项 `{ id, name, value, max?, min?, unit?, tone? }`。`id` 必填（用于 v-for key），`name` 必填（UI 主显示），`value` 必填（数字）。`max` 缺省 100，`min` 缺省 0，`tone` 缺省 `neutral`。

### 2.3 新 appearance（字符串）

```json
"appearance": "身着青玄门外门弟子袍，衣袖被剑气割裂，右臂缠着临时止血布。脸色略白，但目光仍然清醒。"
```

单段叙事字符串，不再是 label/value 键值对。

### 2.4 新 goals

```json
"goals": {
  "current": "证明自己没有私通外敌，并从山门冲突中脱身。",
  "shortTerm": "查清禁地异动与玄衣少女出现之间的关联。",
  "longTerm": "在青玄门站稳脚跟，找出山门内暗藏的叛徒线索。"
}
```

所有键可选；缺省项 UI 不展示该行。

### 2.5 新 background

```json
"background": "萧玄入门时间不长，但剑法基础稳。本轮前，他被卷入山门冲突。"
```

单段字符串。

### 2.6 relationships 不变

继续走 `save/relationships/character-<localId>.json` 分片，UI 通过新增 `useRelationships` 读取。分片形态（已有，不改）：

```json
{
  "subject": "character:萧玄",
  "edges": [
    { "to": "character:玄衣少女", "type": "相识", "since": 1, "note": "山门冲突中突然出现的未知人物。" }
  ],
  "updatedTurn": 6,
  "updatedBy": "stage-manager"
}
```

## 3. 前端类型契约

### 3.1 character entity 强类型

新增 `apps/play-frontend-dev/src/lib/character-types.ts`（独立文件，避免 `runtime-types.ts` 臃肿）：

```ts
export type Polarity = "positive" | "negative" | "neutral"

export interface CharacterIdentity {
  age?: string | number
  gender?: string
  role?: string
  affiliation?: string
  realm?: string
}

export interface CharacterGauge {
  id: string
  name: string
  value: number
  max?: number
  min?: number
  unit?: string
  tone?: "neutral" | "accent" | "success" | "warning" | "danger" | "muted"
}

export interface CharacterStatus {
  id: string
  name?: string
  description?: string
  polarity?: Polarity
}

export interface CharacterGoals {
  current?: string
  shortTerm?: string
  longTerm?: string
}

export interface CharacterAttributes {
  体魄?: number
  悟性?: number
  气运?: number
  根骨?: number
  法力?: number
  魅力?: number
}

export interface CharacterEntity {
  id: string
  name: string
  brief: string
  aliases?: string[]
  identity?: CharacterIdentity
  appearance?: string
  attributes?: CharacterAttributes
  gauges?: CharacterGauge[]
  status?: CharacterStatus[]
  goals?: CharacterGoals
  background?: string
  extensions?: Record<string, unknown>
  updatedAtTurn?: number
  updatedBy?: string | null
}
```

### 3.2 relationships 分片类型

新增到 `character-types.ts`：

```ts
export interface RelationshipEdge {
  to: string  // ref，如 "character:玄衣少女"
  type: string
  since?: number
  until?: number
  note?: string
}

export interface RelationshipFile {
  subject: string
  edges: RelationshipEdge[]
  updatedTurn?: number
  updatedBy?: string | null
}
```

### 3.3 解析层

`parse-entity.ts` 的 `parseEntity` 保持原状（不破坏现有调用方）。新增 `parseCharacter(raw: unknown): CharacterEntity | null` 在 `character-types.ts` 旁的 `parse-character.ts`：

- 校验 `id`(string) / `name`(string) / `brief`(string) 必填；缺一返回 null。
- `identity` 校验为对象；逐键归一（age 允许 string|number，gender/role/affiliation/realm 为 string）。
- `gauges` 校验为数组；逐项校验 `id`/`name`/`value`，缺则丢弃该项；`tone` 归一到 union。
- `attributes` 校验为对象；逐键校验为 number，非 number 丢弃。
- `status` 校验为数组；逐项校验 `id`，`polarity` 归一。
- `goals` 校验为对象；逐键校验为 string。
- `appearance` / `background` 校验为 string。
- 不再校验旧 `fields`/`sections`。

### 3.4 useRelationships composable

新增 `apps/play-frontend-dev/src/composables/useRelationships.ts`：

- 输入：subject ref（如 `character:萧玄`）。
- 路径：`save/relationships/character-<localId>.json`（去 `type:` 前缀，与现有 `save/relationships/<scope>.json` 命名约定一致）。
- 输出：`{ data: Ref<RelationshipFile | null>, error, load }`。
- 错误策略与 `useEntity`/`useScene` 同构：not-found / load-failed，不抛错。
- 不自动 onMounted 加载——由 UI 决定。

## 4. 组件架构

```
CharacterView.vue                       # 全屏视图根，由 App.vue 在 navCurrent==='character' 时挂载
├─ CharacterList.vue                    # 左侧在场人物列表 + 关联人物分组
│  └─ CharacterListItem.vue             # 单行（首字头像 + name + brief）
├─ CharacterCard.vue                    # 右侧角色卡壳：固定立绘栏 + tabs + 内容区
│  ├─ CharacterPortrait.vue             # 固定立绘栏（首字占位，3:4.15 比例）
│  └─ CharacterDetail.vue               # 右侧详情区（tabs 切换）
│     ├─ tabs: 概况 / 属性 / 背包
│     └─ panes:
│        ├─ OverviewPane.vue            # 概况：身份锚点 + 当前形象 + 状态 chips + 关系 + 目标 + 背景
│        │  ├─ IdentityFacts.vue        # 身份锚点 chips
│        │  ├─ StatusChips.vue          # 状态 chips（polarity 视觉）
│        │  ├─ RelationshipList.vue     # 关系列表（读 useRelationships）
│        │  └─ GoalsBlock.vue           # 三行目标
│        ├─ AttributesPane.vue          # 属性：六维卡片 + gauges 量表条
│        │  ├─ AttributeCard.vue        # 单个六维卡片
│        │  └─ GaugeBar.vue             # 单个量表条
│        └─ InventoryPane.vue           # 背包占位
└─ （空态/降级由 CharacterView 内联处理）
```

### 4.1 CharacterView.vue

- props: 无（自己从 useRuntime 取）。
- 内部：
  - `useRuntime()` 取 runtime；从 `runtime.activeSceneRefs[0].ref` 取当前场景 ref。
  - `useScene(sceneRef)` 读取场景文件，取 `scene.present`（`Array<{ ref }>`）。
  - 默认选中 `runtime.protagonistRef.ref`；若 protagonistRef 为 null，选 present[0].ref。
  - 当前选中 ref 状态 `selectedRef`。
  - `useEntity(selectedRef)` 读取选中角色 entity（通过 `:key="selectedRef"` 触发 remount，沿用 StatusBarStatus 的模式）。
  - `useRelationships(selectedRef)` 读取关系分片（同样 `:key`）。
  - 渲染 `CharacterList`（左）+ `CharacterCard`（右）。
  - 空态：runtime 无 activeSceneRefs / scene.present 为空 → 显示"当前场景无在场人物"。
  - 降级：entity 读取失败 → CharacterCard 显示 ref/localId + "档案缺失"。

### 4.2 CharacterList.vue

- props: `presentRefs: Array<{ ref }>`、`selectedRef: string | null`、`protagonistRef: string | null`、`relationships: RelationshipFile | null`（用于"关联人物"分组）。
- 渲染：
  - "在场人物" 分组：presentRefs 逐项 useEntity 取 name/brief；高亮 selectedRef。
  - "关联人物" 分组：从 relationships.edges[*].to 取 ref；过滤掉已在 presentRefs 中的；逐项 useEntity 取 name/brief。
  - 单行：首字头像 + name + brief（1 行截断）。
  - 点击 emit `select(ref)`。
- 不显示 raw ref/id。

### 4.3 CharacterCard.vue

- props: `entity: CharacterEntity | null`、`loading: boolean`、`relationships: RelationshipFile | null`。
- 内部 tab state：`overview | attributes | inventory`，默认 `overview`。
- 渲染：
  - 左侧固定 `CharacterPortrait`（首字 = entity.name[0]）。
  - 右侧 `CharacterDetail`（tabs + panes）。
- 切换 tab 时**只有右侧 pane 内容变化**，立绘栏不变（预览 HTML 的核心决策）。

### 4.4 OverviewPane.vue

按预览 HTML 分区：

1. **身份锚点** (`IdentityFacts.vue`)：name + brief + aliases + identity.* → fact chips。
2. **当前形象**：`entity.appearance` 单段字符串；缺省不展示。
3. **当前状态** (`StatusChips.vue`)：`entity.status[*]` → chips；polarity 决定颜色 tone；`title` 挂 `description`。
4. **关系** (`RelationshipList.vue`)：从 relationships.edges[*] 取 to ref → useEntity 取 name/brief → 单行 `name + brief`；点击 emit `select(ref)` 切换主角。
5. **意图与目标** (`GoalsBlock.vue`)：`entity.goals.{current,shortTerm,longTerm}` → 三行 label-text。
6. **背景摘记**：`entity.background` 单段字符串；缺省不展示。
7. **extensions**：`displayItems.tags` / `displayItems.refs` / `displayItems.sections` / `displayItems.metrics` 分别进入对应小区域（沿用状态栏的扩展槽策略）。

### 4.5 AttributesPane.vue

- **基础维度** (`AttributeCard.vue` × 6)：体魄/悟性/气运/根骨/法力/魅力。每张卡片：name + 大数字。缺省维度展示"—"。
- **特殊量表** (`GaugeBar.vue` × N)：`entity.gauges[*]` → name + progress bar + value。tone 决定 bar 颜色。
- 不展示基准 5。
- 不展示 HP/MP 默认标签（gauges 是自由命名）。

### 4.6 InventoryPane.vue

- 占位：icon + "背包 / 容器详情由后续任务填充"。
- 不实现任何物品列表。

### 4.7 CharacterPortrait.vue

- 3:4.15 比例（参考预览 HTML）。
- 边框：暗色仪式风 + 内层细线 + 底部渐变蒙层。
- 内容：首字占位（`entity.name[0]`），font-display，amber 色，text-shadow 微光。
- 无图片时不显示任何图片相关 UI；不预留上传按钮。

## 5. App.vue 接线

- 把 `navCurrent === "character"` 分支从占位 div 替换为 `<CharacterView />`。
- `:key="navCurrent === 'character'"` 不需要——v-if 即可（切换走时卸载，回来时重新挂载读取）。
- `onOpenCharacter` 保持现状（设 `navCurrent = "character"`）。

## 6. 主题与样式

- 沿用 `apps/play-frontend-dev/src/lib/tokens.css` 的烛火书卷·重铸主题变量。
- 角色卡容器背景：透明（叠在 AtmosphereLayer 上）。
- 字体：标题用 `--font-display`，正文用 `--font-serif`，label/小标题用 `--font-mono`。
- 颜色：边框 `--line` / `--line-strong`，文字 `--prose` / `--prose-dim` / `--whisper`，强调 `--ember` / `--ember-bright`，负面 `--blood`。
- tab 切换动画：参考预览 HTML，无过度动画；active tab 用 `--ember` 下边框。
- portrait 渐变蒙层与 `StatusBarCharacter` 折叠态保持视觉一致。
- polarity 颜色映射：positive → 成功色（参考 StatusBarStatus 已有的 `#7ea968`），negative → `--blood`/`#c76d5a`，neutral → `--prose-dim`。
- gauge tone 映射：accent → `--ember`，danger → `--blood`，warning → `--ember-bright`，success → 成功色，muted → `--prose-dim`，neutral → `--ember`。

## 7. 数据流

```
useRuntime() ── runtime.activeSceneRefs[0].ref ──┐
                                                  ↓
                                          useScene(sceneRef)
                                                  ↓
                                          scene.present: [{ref}, ...]
                                                  ↓
CharacterList ◄── presentRefs + protagonistRef
    │
    │ select(ref)
    ↓
selectedRef ── useEntity(selectedRef) ── CharacterEntity
            ── useRelationships(selectedRef) ── RelationshipFile
                                                  ↓
                                          CharacterCard
                                            ├─ OverviewPane (entity + relationships + displayItems)
                                            ├─ AttributesPane (entity.attributes + entity.gauges)
                                            └─ InventoryPane (占位)
```

## 8. 错误降级

- runtime 读取失败（`error: load-failed`）→ CharacterView 显示"存档运行时不可读"。
- runtime 无 activeSceneRefs → 显示"当前无活跃场景"。
- scene 读取失败 / present 为空 → 显示"当前场景无在场人物"。
- entity 读取失败 → CharacterCard 显示 ref/localId + "档案缺失"，立绘栏首字取 localId[0]。
- relationships 分片不存在（not-found）→ 关系区段不展示（非错误，可空）。
- character 字段缺失（identity/appearance/goals/background 等）→ 对应区段不展示。

## 9. 已知取舍

- **character 强类型独立文件**：不放进 `runtime-types.ts`，避免该文件膨胀；`character-types.ts` 仅含本任务用到的字段。
- **useRelationships 不在 useEntity 内嵌**：关系是分片文件，与 entity 文件不同路径，独立 composable 更清晰。
- **左侧"关联人物"分组**：从 relationships.edges[*].to 取 ref，过滤已在 present 中的。若实现成本高，可降级为 MVP 只展示在场人物，关联人物留待后续；本任务尝试实现。
- **extensions 在角色卡中的展示位置**：概况页底部按 category 分区展示（metrics/tags/refs/sections）。不强行塞到某个固定区段，避免与固定字段冲突。
- **DEFAULT_WORKSPACE_VERSION 不递增**：本任务只是 character 字段微调，且无生产存档；workspace version 维持 13（schema 对齐任务已递增过）。如果团队习惯字段变更即递增，可在 implement 阶段评估。
- **不引入状态栏钉选**：D8 描述了方向但本任务不实现；状态栏行为不变。
