# 容器背包与物品详情

## Goal

支持玩家在角色卡背包 tab 中以图标网格查看当前选中角色的容器与物品，点击物品弹出模态详情卡；容器可嵌套，模态内通过面包屑导航回上层。补齐 container/item entity schema（当前 platform 模板未定义），并完成前端 UI 实现。

## User Value

- 玩家可以集中查看角色持有的容器与物品，不必从对话历史里回忆"我捡了什么"。
- 图标网格 + 模态详情的组合视觉紧凑，符合 RPG 背包心智模型。
- 嵌套容器支持逐层查看（储物袋里的木匣里的玉瓶）。
- container/item schema 固定后，场记/世界架构师可按 schema 维护物品实体。

## Confirmed UI/UX Decisions

### D1: 任务范围划分

- 本任务实现：container/item entity schema 定义、角色卡背包 tab UI（图标网格 + 模态详情 + 嵌套容器面包屑）、物品/容器 entity 读取与渲染。
- 不实现：装备槽系统、物品图标上传、AI 生图、物品合成/使用玩法。
- 物品图标用类型图标 + 首字 fallback（D5）。

### D2: 背包入口

- 入口在角色卡背包 tab（已在 `07-04-present-characters-character-cards` 中作为占位实现）。
- 数据源：character entity 的 `containers?: Array<{ ref, count? }>` 字段（本任务新增到 character schema）。
- 角色卡选中角色后，背包 tab 读取该角色的 `containers`，逐个 useEntity 读取容器 entity，展示容器网格。
- 无 containers 字段或为空时，背包 tab 展示空态"未持有容器"。

### D3: 图标网格

- 当前层级 contents 以图标网格展示：每格一个物品/嵌套容器，展示类型图标（或首字 fallback）+ 数量角标（count > 1 时）+ 短名（hover/底部）。
- 网格响应式自适应背包 tab 区域宽度（固定列宽，如 64px/72px）。
- 容器类型的格子有视觉区分（如边框/角标），提示"可进入"。

### D4: 模态物品详情

- 点击网格格子 → 中央模态弹出物品/容器详情卡。
- 模态内容：
  - 物品：name + brief + type 标签 + tags + extensions 分区（metrics/tags/refs/sections）。
  - 容器：name + brief + type 标签 + status（如有）+ extensions + contents 网格（嵌套）。
- 容器模态内有面包屑导航：`储物袋 > 小木匣 > 玉瓶`；点击面包屑回上层容器网格。
- 模态关闭返回角色卡背包 tab。
- 模态不嵌套弹窗（同一模态内切换内容，避免层叠）。

### D5: 物品图标方案

- 物品 entity 的 `type` 字段映射到内联 SVG 剪影图标（与烛火书卷·重铸主题一致，琥珀色调）。
- 类型→图标映射表（MVP 5 类 + 容器）：
  - `equipment` → 武器剪影
  - `material` → 矿石/草药剪影
  - `consumable` → 瓶/丹剪影
  - `special` → 印章/信物剪影
  - `other` → 通用包裹剪影
  - `container` → 木盒/袋剪影
- 无 `type` 字段、未识别 type、或 type 为 `other` 时 → fallback 首字占位（与角色卡立绘栏视觉一致）。
- 后续 schema 演进加新 type 时，映射表加一条；未映射的 type fallback 首字。

### D6: 嵌套容器

- container entity 的 `contents` 中可以包含指向其它 container 的 ref，支持任意深度嵌套。
- 模态内面包屑记录导航路径；点击面包屑回上层。
- 嵌套深度无硬限制，但 UI 上超过 3-4 层时玩家体验下降（不做硬限制，由剧情/数据自然约束）。

## Confirmed Schema Decisions

### D7: container entity schema（极简，无容量系统）

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

- `id`/`name`/`brief`：沿用实体必填字段。
- `type`：固定 `"container"`（与 item type 字段统一；用于图标映射）。
- `contents`：`Array<{ ref, count? }>`；`count` 缺省 1；ref 指向 item 或嵌套 container。
- `status`：沿用 character status shape（`{id, name?, description?, polarity?}`），可选。
- `extensions`：动态字段。
- **无** `capacityNote` / `maxCapacity` / `currentCapacity`（容量系统费时费力且降低体验，明确不做）。

### D8: item entity schema（极简，无 status）

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

- `id`/`name`/`brief`：沿用实体必填字段。
- `type`：`equipment` / `material` / `consumable` / `special` / `other`。
- `tags`：string[]，可选。
- `extensions`：动态字段。
- **无** `status`（物品损坏直接改 name/brief，如"损坏的玉瓶"）。
- **无** `quantity`（数量由 container.contents[*].count 表达）。

### D9: character entity 新增 containers 字段

character entity 新增可选字段：

```json
"containers": [
  { "ref": "container:储物袋", "count": 1 }
]
```

- `containers`：`Array<{ ref, count? }>`；ref 指向 container entity；`count` 缺省 1（同一容器多个实例的少见情况）。
- 缺省时表示该角色未持有容器，UI 展示空态。
- 这是 character 持有容器的权威入口；runtime 不再保存背包摘要（与 schema 对齐任务的 runtime-as-context-index 方向一致）。

## Requirements

### schema 定义

- R1: 在 `apps/platform-web/src/storage/workspace-templates.ts` 中定义 container entity schema：`id`/`name`/`brief`/`type="container"`/`contents: Array<{ref, count?}>`/`status?`/`extensions`/`updatedAtTurn`/`updatedBy`。
- R2: 在同文件中定义 item entity schema：`id`/`name`/`brief`/`type`/`tags?`/`extensions`/`updatedAtTurn`/`updatedBy`。
- R3: 在 character entity 推荐字段中加入 `containers?: Array<{ref, count?}>`。
- R4: 更新 `NOVEL_AIRP_SCHEMA_GUIDE_MD` / `NOVEL_AIRP_SCHEMA_REFERENCE_MD` / `save/schema/current.md` / `STAGE_MANAGER_STATUS_SKILL_MD` 加入 container/item entity 字段说明与示例。
- R5: 更新 `save/entities/README.md` 加入 container/item entity 示例（如未有）。

### 前端类型与解析

- R6: 新增 `apps/play-frontend-dev/src/lib/item-types.ts`：定义 `ItemType` / `ContainerEntity` / `ItemEntity` / `ContainerContent` 类型。
- R7: 新增 `apps/play-frontend-dev/src/lib/parse-item.ts`：`parseContainer(raw): ContainerEntity | null` 与 `parseItem(raw): ItemEntity | null` 纯函数，必检 id/name/brief，逐字段归一。
- R8: 在 `character-types.ts` 的 `CharacterEntity` 接口加入 `containers?: Array<{ ref: string; count?: number }>`。

### 前端 UI

- R9: 新增 `apps/play-frontend-dev/src/components/character/InventoryPane.vue` 的真实实现（替换 07-04 的占位）：从 `entity.containers` 读取容器列表，逐个 useEntity 读取容器 entity，展示容器网格。
- R10: 新增 `apps/play-frontend-dev/src/components/inventory/InventoryGrid.vue`：图标网格组件；props `contents: Array<{ref, count?}>` + `entities` 容器/物品解析结果；每格类型图标 + count 角标 + 短名；点击 emit `select(ref)`。
- R11: 新增 `apps/play-frontend-dev/src/components/inventory/ItemIcon.vue`：根据 entity type 渲染内联 SVG 剪影图标；无 type/未识别时 fallback 首字；type="container" 时用容器图标。
- R12: 新增 `apps/play-frontend-dev/src/components/inventory/ItemDetailModal.vue`：中央模态详情卡；props `entity: ContainerEntity | ItemEntity | null` + `breadcrumb: string[]`；展示 name/brief/type 标签/tags/extensions 分区；容器额外展示 contents 网格 + 面包屑；emit `select(ref)`（进入嵌套容器）与 `close`。
- R13: 新增 `apps/play-frontend-dev/src/components/inventory/InventoryBreadcrumb.vue`：面包屑导航；props `path: Array<{ref, name}>`；点击 emit `navigate(index)`。
- R14: `InventoryPane.vue` 内部持有模态状态与面包屑路径；点击网格格 → 打开模态；模态内进入嵌套容器 → 面包屑推进；模态内点击面包屑 → 回上层；模态关闭 → 清空路径。
- R15: 缺失 ref（entity 读不到）的格子降级展示：首字取 ref localId[0] + "档案缺失" tooltip；不阻塞网格。
- R16: 空容器、无 containers 字段、空 contents 均有降级展示。

### 验证

- R17: 通过 `npm run build --workspace play-frontend-dev`。
- R18: 通过 `npm run build:web`。

## Acceptance Criteria

- [ ] container entity schema 在 platform 模板与 guide 中有定义与示例。
- [ ] item entity schema 在 platform 模板与 guide 中有定义与示例。
- [ ] character entity 含 `containers?: Array<{ref, count?}>` 字段在模板与 guide 中说明。
- [ ] 角色卡背包 tab 展示当前选中角色的容器网格（从 entity.containers 读取）。
- [ ] 点击容器格弹出模态，模态内展示容器 contents 网格。
- [ ] 点击物品格弹出模态，模态内展示物品详情（name/brief/type/tags/extensions）。
- [ ] 嵌套容器可通过模态内面包屑导航进入与回上层。
- [ ] 物品图标按 type 渲染内联 SVG；无 type 时 fallback 首字。
- [ ] 容器格有视觉区分提示"可进入"。
- [ ] count > 1 的物品/容器有数量角标。
- [ ] 缺失 entity、读取失败、空 containers、空 contents 均有降级展示。
- [ ] 容器或物品 extensions 能按渲染类型进入对应槽位（metrics/tags/refs/sections）。
- [ ] 通过 `npm run build --workspace play-frontend-dev`。
- [ ] 通过 `npm run build:web`。

## Out of Scope

- 装备槽系统（装备只作为 item.type="equipment" 存在，不实现装备/卸下玩法）。
- 物品图标上传 / AI 生图。
- 物品合成 / 使用 / 丢弃 玩法。
- 容量系统（capacityNote / maxCapacity / currentCapacity）。
- 物品 status 字段（损坏直接改 name/brief）。
- 背包排序 / 筛选 / 搜索（MVP 不做，后续 polish）。
- 物品数量修改 UI（由场记/剧情维护，不由玩家直接编辑）。
- 多角色背包对比视图。

## Dependencies

- 依赖 `07-04-renderable-runtime-entity-schema`（已归档）。
- 依赖 `07-04-frontend-runtime-render-infra`（已归档，提供扩展项分桶基础设施）。
- 依赖 `07-04-present-characters-character-cards`（已归档，提供角色卡背包 tab 占位与 InventoryPane 入口）。
- 依赖 `07-05-runtime-scene-character-schema-ui-align`（已归档，character schema 已稳定，本任务在其上加 containers 字段）。

## Notes

- 本任务在父任务 `07-03-play-frontend-status-bar` Child Task Map 中的位置：在 `07-04-present-characters-character-cards` 之后，`07-04-runtime-summary-injection` 之前/并行均可。
- 容量系统明确不做（用户决策：费时费力且降低体验）。
- 物品 status 明确不做（用户决策：损坏直接改 name/brief）。
