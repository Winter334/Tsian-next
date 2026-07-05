# Implement — 容器背包与物品详情

## 执行顺序

按依赖顺序推进：先动 platform 模板（定义 container/item schema + character containers 字段），再动前端类型/解析，再动 UI 组件（自底向上：图标 → 网格 → 面包屑 → 模态 → pane），最后验证。

任何一步失败即停下，先修好再继续。

## Step 1 — platform 模板 container/item schema 定义

文件：`apps/platform-web/src/storage/workspace-templates.ts`

- [ ] `NOVEL_AIRP_SCHEMA_GUIDE_MD`：
  - 实体基础小节加入 container/item entity 类型说明与示例（container: id/name/brief/type="container"/contents/{ref,count?}/status?/extensions；item: id/name/brief/type/tags?/extensions）。
  - character 推荐字段清单加入 `containers?: Array<{ref, count?}>`。
  - item type 5 类清单（equipment/material/consumable/special/other）。
- [ ] `NOVEL_AIRP_SCHEMA_REFERENCE_MD`：
  - 新增"容器与物品实体"小节，含 container 与 item 完整 JSON 示例。
  - 实体推荐元数据示例中 character 加 `"containers": [{ "ref": "container:储物袋" }]`。
- [ ] `save/schema/current.md`（在 `DEFAULT_SAVE_RUNTIME_FILES` 中）：
  - Entity Model 小节加入 container/item entity 推荐字段。
  - character 推荐字段加入 `containers`。
  - item type 5 类清单。
- [ ] `STAGE_MANAGER_STATUS_SKILL_MD`：
  - character 字段清单加入 `containers`。
  - 新增 container/item 维护说明（contents 用 ref+count，不存物品摘要；item损坏改 name/brief 不加 status）。
- [ ] `save/entities/README.md`（在 `DEFAULT_SAVE_RUNTIME_FILES` 中）：
  - 加入 container/item entity 示例（如未有）。

## Step 2 — 前端 container/item 类型与解析

文件：
- 新增 `apps/play-frontend-dev/src/lib/item-types.ts`
- 新增 `apps/play-frontend-dev/src/lib/parse-item.ts`
- 修改 `apps/play-frontend-dev/src/lib/character-types.ts`
- 修改 `apps/play-frontend-dev/src/lib/parse-character.ts`

- [ ] `item-types.ts`：按 design §5.1 定义 `ItemType` / `ContainerType` / `ContainerContent` / `ContainerEntity` / `ItemEntity` / `InventoryEntity` / `isContainerEntity`。
- [ ] `parse-item.ts`：
  - `parseContainer(raw): ContainerEntity | null`：必检 id/name/brief/type="container"；contents 数组逐项校验 ref + count；status 数组逐项校验 id；extensions 透传。
  - `parseItem(raw): ItemEntity | null`：必检 id/name/brief/type（5 类之一）；tags 校验 string[]；extensions 透传。
  - 纯函数不抛错。
- [ ] `character-types.ts`：`CharacterEntity` 接口加 `containers?: Array<{ ref: string; count?: number }>`。
- [ ] `parse-character.ts`：`parseCharacter` 加 `containers` 归一逻辑（校验为数组，逐项校验 ref + count）。

## Step 3 — ItemIcon 组件

新增 `apps/play-frontend-dev/src/components/inventory/ItemIcon.vue`

- [ ] props: `{ entity: InventoryEntity | null, ref: string }`。
- [ ] 渲染逻辑：
  - entity 为 null → 首字取 ref localId[0]，font-display，amber-bright。
  - entity.type 在映射表 → 内联 SVG 剪影图标（amber 色调）。
  - entity.type 不在映射表 → 首字 fallback。
  - container type → 容器剪影图标。
- [ ] SVG 图标 6 个内联：equipment（武器剪影）/material（矿石剪影）/consumable（瓶剪影）/special（印章剪影）/other（包裹剪影）/container（木盒剪影）。
- [ ] 视觉与 CharacterPortrait 首字占位一致（font-display, --ember-bright, text-shadow 微光）。

## Step 4 — InventoryGrid 组件

新增 `apps/play-frontend-dev/src/components/inventory/InventoryGrid.vue`

- [ ] props: `{ items: Array<{ ref: string; entity: InventoryEntity | null; count?: number }>` }。
  - 父组件负责 useEntity 读取，网格只管渲染。
- [ ] 渲染：CSS grid，固定列宽 64-72px，自适应列数。
- [ ] 每格：ItemIcon + count 角标（count > 1）+ 短名（底部截断或 hover tooltip）。
- [ ] 容器格视觉区分：边框 --ember 半透明 + 角标提示"可进入"。
- [ ] entity null 的格：ItemIcon fallback 首字 + 暗化边框 + title="档案缺失"。
- [ ] emit: `select(ref: string)`。

## Step 5 — InventoryBreadcrumb 组件

新增 `apps/play-frontend-dev/src/components/inventory/InventoryBreadcrumb.vue`

- [ ] props: `{ path: Array<{ ref: string; name: string }> }`。
- [ ] emit: `navigate(index: number)`。
- [ ] 渲染：`储物袋 › 小木匣 › 玉瓶`，每段可点击（除当前层 = path 最后一项）；分隔符 `›` 用 --ember 色。
- [ ] path 长度 ≤ 1 时不渲染面包屑（顶层无导航需求）。

## Step 6 — ItemDetailModal 组件

新增 `apps/play-frontend-dev/src/components/inventory/ItemDetailModal.vue`

- [ ] props: `{ entity: InventoryEntity | null, entityRef: string, breadcrumb: Array<{ref, name}>, loading: boolean, gridItems: Array<{ref, entity, count?}> | null }`。
  - `gridItems` 仅容器 entity 时传入（容器 contents 解析后的网格数据）。
- [ ] emit: `select(ref: string)`, `navigate(index: number)`, `close`。
- [ ] 渲染：
  - 遮罩 + 中央卡片（最大宽 480-560px，最大高 80vh，可滚动）。
  - 顶部面包屑（path > 1 时）。
  - 标题区：name + type 标签 chip。
  - brief 段落。
  - tags chips（item 且有 tags 时）。
  - extensions 分区（用 parseExtensionsOnly 解析 entity.extensions，按 metrics/tags/refs/sections 分区展示）。
  - 容器（isContainerEntity）→ 展示 InventoryGrid（gridItems）。
  - item → 不展示 contents 网格。
  - entity null + loading → 加载态。
  - entity null + !loading → "档案缺失"。
- [ ] 关闭：点击遮罩、ESC、右上关闭按钮 → emit `close`。

## Step 7 — InventoryPane 替换占位

修改 `apps/play-frontend-dev/src/components/character/InventoryPane.vue`

- [ ] 替换 07-04 的占位实现为真实背包 UI。
- [ ] props: `{ containers: Array<{ref, count?}> | undefined, protagonistRef: string | null }`。
- [ ] 内部状态：modalOpen / modalEntityRef / breadcrumb / modalLoading / modalEntity / modalGridItems。
- [ ] 顶层容器网格：从 props.containers 逐个 useEntity 读取 container entity，组装 gridItems。
- [ ] 点击网格格 → 打开模态，breadcrumb = [{ref, name}]。
- [ ] 模态内进入嵌套容器：useEntity 读取新 ref，parseContainer，组装 gridItems，breadcrumb push。
- [ ] 模态内点击面包屑：breadcrumb slice，modalEntityRef 更新，重新读取。
- [ ] 模态关闭：清空状态。
- [ ] 空态：containers 为空或缺省 → "未持有容器"。

## Step 8 — OverviewPane/CharacterSlot 接线（如有需要）

- [ ] 检查 CharacterSlot.vue 是否已把 entity 传给 InventoryPane；若 InventoryPane 需要 containers 字段，确保 props 传递。
- [ ] 检查 OverviewPane.vue 中 extensions refs 分区是否会与 containers ref 冲突（containers 是 character entity 固定字段，不进 extensions；无冲突）。

## Step 9 — 验证

- [ ] `npm run build --workspace play-frontend-dev` 通过。
- [ ] `npm run build:web` 通过。
- [ ] `git diff --check` 无空白问题。
- [ ] grep 核对：container/item schema 在 platform 模板中有定义；character containers 字段在 guide/reference/current.md 中有说明。
- [ ] 手动核对：`apps/play-frontend-dev/src/components/inventory/` 下所有组件 props 类型与 `item-types.ts` 一致。

## Rollback

- 若 platform build 失败：先回退 workspace-templates.ts Step 1 改动，调查 container/item JSON 示例是否有引号/逗号问题。
- 若前端 build 失败：先回退 InventoryPane Step 7，保留组件文件调查 type 错误。
- 若模态 UI 黑屏：检查模态 z-index 与遮罩层级；检查 entity 读取是否在模态打开后才触发。

## Review Gates

- Step 2 完成后：跑一次 `npm run build --workspace play-frontend-dev` 确认类型无错。
- Step 6 完成后：跑一次 build 确认模态组件与现有 type 契约契合。
- Step 7 完成后：跑一次 `npm run build:web` 确认 platform 模板改动无误。

## 不做

- 装备槽系统。
- 物品图标上传 / AI 生图。
- 物品合成 / 使用 / 丢弃玩法。
- 容量系统。
- 物品 status 字段。
- 背包排序 / 筛选 / 搜索。
- 物品数量修改 UI。
- 递增 DEFAULT_WORKSPACE_VERSION（维持 13）。
