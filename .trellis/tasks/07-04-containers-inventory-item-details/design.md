# Design — 容器背包与物品详情

## 1. 范围与不做

本任务定义 container/item entity schema 并实现角色卡背包 tab 的图标网格 + 模态详情 UI。

命中改动的层：

- **platform-web 模板**：`apps/platform-web/src/storage/workspace-templates.ts` 中新增 container/item entity schema 示例与 guide/reference/current.md/stage-manager skill 文本更新；character entity 加 `containers` 字段。
- **前端类型/解析层**：新增 `apps/play-frontend-dev/src/lib/item-types.ts` + `parse-item.ts`；`character-types.ts` 加 `containers` 字段。
- **新增组件**：`apps/play-frontend-dev/src/components/inventory/` 下网格、图标、模态、面包屑组件。
- **修改组件**：`apps/play-frontend-dev/src/components/character/InventoryPane.vue`（替换占位为真实实现）。
- **不动**：runtime/scene/character schema 主体（已在 07-05 完成）；状态栏组件；角色卡其它 tab（概况/属性）；扩展项分桶基础设施。

## 2. container entity schema

```json
{
  "id": "container:储物袋",
  "name": "储物袋",
  "brief": "萧玄的外门弟子储物袋，空间有限。",
  "type": "container",
  "contents": [
    { "ref": "item:玉瓶", "count": 3 },
    { "ref": "container:小木匣" }
  ],
  "status": [],
  "extensions": {},
  "updatedAtTurn": 6,
  "updatedBy": "stage-manager"
}
```

字段权威说明：

- `id`/`name`/`brief`：必填，沿用实体约定。
- `type`：固定 `"container"`。用于图标映射与 entity 类型识别。
- `contents`：`Array<{ ref: string, count?: number }>`。`ref` 指向 item 或嵌套 container entity；`count` 缺省 1。空数组表示空容器。
- `status`：可选，沿用 character status shape（`{id, name?, description?, polarity?}`）。多数容器无 status。
- `extensions`：动态字段，沿用 render preset 体系。
- 无容量字段。

## 3. item entity schema

```json
{
  "id": "item:玉瓶",
  "name": "玉瓶",
  "brief": "青玄门制式储物玉瓶，可盛放丹药。",
  "type": "consumable",
  "tags": ["丹药容器"],
  "extensions": {},
  "updatedAtTurn": 6,
  "updatedBy": "stage-manager"
}
```

字段权威说明：

- `id`/`name`/`brief`：必填，沿用实体约定。
- `type`：`equipment` / `material` / `consumable` / `special` / `other`。用于图标映射。
- `tags`：可选 string[]，用于详情展示与后续筛选。
- `extensions`：动态字段。
- 无 `status`（损坏直接改 name/brief）。
- 无 `quantity`（数量由 container.contents[*].count 表达）。

## 4. character entity containers 字段

character entity 新增可选字段：

```json
"containers": [
  { "ref": "container:储物袋", "count": 1 }
]
```

- `containers`：`Array<{ ref: string, count?: number }>`。ref 指向 container entity。
- 缺省或为空表示角色未持有容器。
- 这是角色持有容器的权威入口；runtime 不保存背包摘要。

## 5. 前端类型契约

### 5.1 item-types.ts

```ts
export type ItemType = "equipment" | "material" | "consumable" | "special" | "other"
export type ContainerType = "container"

export interface ContainerContent {
  ref: string
  count?: number
}

export interface ContainerEntity {
  id: string
  name: string
  brief: string
  type: "container"
  contents: ContainerContent[]
  status?: Array<{ id: string; name?: string; description?: string; polarity?: "positive" | "negative" | "neutral" }>
  extensions?: Record<string, unknown>
  updatedAtTurn?: number
  updatedBy?: string | null
}

export interface ItemEntity {
  id: string
  name: string
  brief: string
  type: ItemType
  tags?: string[]
  extensions?: Record<string, unknown>
  updatedAtTurn?: number
  updatedBy?: string | null
}

/** 容器或物品的联合类型，用于模态详情卡 props。 */
export type InventoryEntity = ContainerEntity | ItemEntity

/** 类型守卫：是否为容器。 */
export function isContainerEntity(e: InventoryEntity): e is ContainerEntity {
  return e.type === "container"
}
```

### 5.2 parse-item.ts

```ts
export function parseContainer(raw: unknown): ContainerEntity | null
export function parseItem(raw: unknown): ItemEntity | null
```

- 必检 id/name/brief，缺一返回 null。
- container：`type` 必须为 `"container"`（缺省或非此值返回 null）；`contents` 校验为数组，逐项校验 `ref` 字符串，`count` 校验 number；`status` 数组逐项校验 `id`。
- item：`type` 必须为 5 类之一（缺省或未识别返回 null）；`tags` 校验 string[]。
- 不抛错，纯函数。

### 5.3 character-types.ts 更新

`CharacterEntity` 接口加：

```ts
containers?: Array<{ ref: string; count?: number }>
```

`parseCharacter` 加 `containers` 归一逻辑：校验为数组，逐项校验 `ref` 字符串，`count` number。

## 6. 组件架构

```
InventoryPane.vue                    # 角色卡背包 tab 内容（替换占位）
├─ InventoryGrid.vue                 # 图标网格
│  └─ ItemIcon.vue                   # 类型图标 + 首字 fallback
├─ ItemDetailModal.vue               # 中央模态详情卡
│  ├─ InventoryBreadcrumb.vue        # 面包屑导航
│  ├─ InventoryGrid.vue              # 容器 contents 网格（复用）
│  └─ ExtensionSlots.vue             # extensions 分区展示（可复用 OverviewPane 的逻辑）
└─ （空态/降级由 InventoryPane 内联处理）
```

### 6.1 InventoryPane.vue

- props: `{ containers: Array<{ref, count?}> | undefined, protagonistRef: string | null }`。
- 内部状态：
  - `modalOpen: boolean` —— 模态是否打开。
  - `modalEntityRef: string | null` —— 模态当前展示的 entity ref。
  - `breadcrumb: Array<{ ref: string, name: string }>` —— 模态内嵌套容器导航路径。
- 行为：
  - 渲染顶层容器网格（从 props.containers 逐个 useEntity 读取 container entity）。
  - 点击网格格 → 打开模态，modalEntityRef = clicked ref，breadcrumb = [{ref, name}]。
  - 模态内进入嵌套容器 → breadcrumb push，modalEntityRef = new ref。
  - 模态内点击面包屑 → breadcrumb slice 到该 index，modalEntityRef = path[index].ref。
  - 模态关闭 → modalOpen=false, modalEntityRef=null, breadcrumb=[]。
- 空态：containers 为空或缺省 → "未持有容器"。

### 6.2 InventoryGrid.vue

- props: `{ contents: Array<{ref, count?}>, getEntity: (ref: string) => InventoryEntity | null }`。
  - 或 alternatively：props 接受已解析的 entity 数组，由父组件负责读取。设计上倾向后者，避免网格内部 useEntity 导致重复读取。
- 渲染：
  - CSS grid，固定列宽 64-72px，自适应列数。
  - 每格：`ItemIcon` + count 角标（count > 1）+ 短名（底部截断或 hover tooltip）。
  - 容器格视觉区分：边框 `--ember` 半透明 + 角标"袋/匣"icon overlay。
  - entity 读取失败的格：首字取 ref localId[0] + 暗化边框 + "档案缺失" tooltip。
- emit: `select(ref: string)`。

### 6.3 ItemIcon.vue

- props: `{ entity: InventoryEntity | null, ref: string }`。
  - entity 为 null 时（读取失败）用 ref localId[0] fallback。
- 渲染：
  - entity.type 在映射表中 → 内联 SVG 剪影图标（amber 色调）。
  - entity.type 不在映射表或为 null → 首字占位（font-display，amber-bright，与 CharacterPortrait 视觉一致）。
  - container type → 容器剪影图标。
- SVG 图标：MVP 6 个（equipment/material/consumable/special/other/container），内联在组件里（不引外部图标库）。

### 6.4 ItemDetailModal.vue

- props: `{ entity: InventoryEntity | null, entityRef: string, breadcrumb: Array<{ref, name}>, loading: boolean }`。
- emit: `select(ref: string)`（进入嵌套容器）、`navigate(index: number)`（面包屑回上层）、`close`。
- 渲染：
  - 模态遮罩 + 中央卡片（最大宽 480-560px，最大高 80vh，可滚动）。
  - 顶部：面包屑（若有 > 1 层）。
  - 标题区：name + type 标签 chip。
  - brief 段落。
  - tags chips（若有）。
  - extensions 分区（metrics/tags/refs/sections，复用 parseExtensionsOnly）。
  - **若 isContainerEntity(entity)**：
    - 展示 contents 网格（复用 InventoryGrid）。
    - 点击网格格 emit `select(ref)`。
  - **若是 item**：
    - 不展示 contents 网格。
  - entity null + loading → 加载态。
  - entity null + !loading → 降级"档案缺失"。
- 关闭：点击遮罩、ESC、右上关闭按钮。

### 6.5 InventoryBreadcrumb.vue

- props: `{ path: Array<{ref, name}> }`。
- emit: `navigate(index: number)`。
- 渲染：`储物袋 > 小木匣 > 玉瓶`，每段可点击（除当前层）；分隔符 `>` 或 `›`。

## 7. 数据流

```
CharacterEntity.containers ──┐
                              ↓
                    InventoryPane
                    （逐个 useEntity 读取 container entity）
                              ↓
                    InventoryGrid（顶层容器网格）
                      │ select(ref)
                      ↓
                    modalEntityRef + breadcrumb
                              ↓
                    useEntity(modalEntityRef) ── parseContainer / parseItem
                              ↓
                    ItemDetailModal
                      ├─ ItemEntity → name/brief/type/tags/extensions
                      └─ ContainerEntity → name/brief/type/extensions + contents 网格
                           │ select(ref)（嵌套容器）
                           ↓
                      breadcrumb push + modalEntityRef 更新
```

## 8. 错误降级

- character 无 containers 字段 → InventoryPane 展示"未持有容器"。
- container entity 读取失败 → 网格格降级首字 + "档案缺失" tooltip。
- container contents 为空数组 → 模态内展示"空容器"。
- item entity 读取失败 → 模态展示"档案缺失"。
- item type 未识别 → ItemIcon fallback 首字。
- 嵌套容器 ref 指向不存在的 entity → 模态内网格格降级首字 + "档案缺失"。
- 模态打开时 entity 加载中 → 加载态（spinner 或骨架）。

## 9. 主题与样式

- 沿用 `tokens.css` 烛火书卷·重铸主题变量。
- 网格格：暗色背景 `--void-deep`，边框 `--line`，hover 时 `--ember` 微光。
- 容器格：边框 `--ember` 半透明 + 内层细线（参考 CharacterPortrait 风格）。
- 模态：遮罩 `rgba(6,6,8,0.7)` + backdrop-blur；卡片背景 `--void-deep` + `--line-strong` 边框 + 圆角；内层细线参考 CharacterPortrait。
- 图标 SVG：currentColor `--ember` 或 `--ember-bright`；线条剪影风格。
- type 标签 chip：参考 StatusChips 的 polarity 颜色，但 type 用统一 `--ember` 色调（不区分颜色，仅文字区分）。
- 面包屑：`--whisper` 文字 + `--ember` 分隔符；hover 时 `--ember-bright`。

## 10. 已知取舍

- **网格 vs 表格**：用户选图标网格。信息密度低于表格，但视觉更游戏化、更符合 RPG 背包心智。后续如需高密度查看可加"表格视图"切换。
- **模态 vs 行内展开**：用户选模态。模态遮罩聚焦物品详情，避免嵌套展开在窄区域宽度爆炸。代价是查看多个物品需要反复开合模态。
- **容器无容量系统**：用户明确决策不做。简化 schema 与 UI，避免费时费力且降低体验。
- **item 无 status**：用户明确决策不做。损坏直接改 name/brief。简化 schema。
- **图标用内联 SVG 而非图标库**：MVP 6 个图标，内联成本低于引外部库；与主题色调完全可控。后续图标多了可考虑抽 SVG sprite 或引图标库。
- **InventoryGrid 复用**：顶层容器网格与模态内容器 contents 网格复用同一组件，props 设计上让父组件负责 entity 读取，网格只管渲染。
- **不递归限制嵌套深度**：UI 不硬限制，由数据自然约束。超过 3-4 层体验下降但不崩溃。
- **不在 character-types.ts 重定义 containers**：containers 字段加到现有 `CharacterEntity` 接口，不另开文件。
