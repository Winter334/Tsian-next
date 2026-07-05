# 左侧状态栏 MVP

## Goal

在主游玩态左侧实现第一版状态栏，展示 `runtime.json` 中的当前局面与可渲染扩展字段，让玩家在阅读剧情时能快速扫读地点、时间、角色、状态、数值等信息。角色卡（背包/容器/物品详情/关联）通过点击头像进入全屏视图，不在状态栏内承载。

## Confirmed UI/UX Decisions

### D1: 栏形态与宽度

- 固定常驻左侧，默认展开 240px，可折叠成 48px。
- 与右侧 `AppNav`（180px/56px）形成视觉对称。
- 折叠/展开偏好持久化到 localStorage（同 AppNav 模式），不写入 workspace。
- 折叠态只显示角色头像，点击展开。不做分区图标——所有类别点击展开后才能看到，图标只徒增麻烦。重点放在折叠态头像的美化上。

### D2: 内容分区（自上而下）

1. **地点时间**（顶部）：当前场景/位置 + `worldTime`。
2. **角色**（预留图片区域）：显示角色名 + 头像占位（MVP 阶段用默认头像或角色名首字）。点击头像进入角色卡全屏视图。图片上传与持久化归角色卡子任务。
3. **状态**：`runtime.status` 列表 + `displayItems.tags`（tag 类扩展项）。
4. **数值**：`displayItems.metrics`（progress/number 类扩展项）。
5. ~~背包~~：背包/容器/物品详情移到角色卡全屏视图，不在状态栏承载。
6. **关联**（如有空间）：`displayItems.refs` 可作为入口区，点击进入对应实体；MVP 可选。

### D3: 角色卡形态

- 全屏视图切换，作为右侧 nav 的一个视图项（nav 项：故事 / 角色 / 设置）。
- 点击状态栏头像 → 切换到角色视图；点击 nav 的"故事" → 切回剧情流。
- 不在角色卡顶部草率加"返回故事"按钮，通过 nav 切换回故事。
- 角色卡承载：角色档案（name/brief/aliases/fields/sections）、形象图片、状态、数值、背包/容器/物品详情、关联。
- 角色卡的具体 UI 设计与图片上传持久化方案归 `07-04-present-characters-character-cards` 子任务。

### D4: 数据来源

- 通过 `useRuntime()` 读取 runtime 数据，不重复解析 workspace。
- 固定字段（`activeScene`/`player`/`worldTime`/`status`）由状态栏直接消费。
- `displayItems` 四桶（metrics/tags/refs/sections）按 category 进入对应分区。
- 角色实体读取通过 `useEntity(ref)`（已在渲染基础设施中提供）。

## Requirements

- R1: 状态栏位于主游玩态左侧，与顶部 `AppHeader`、右侧 `AppNav`、中间 `StoryView` 共存。
- R2: 不遮挡正文流、剧情选项、Composer、检查点恢复 UI。
- R3: 读取前端 runtime 渲染基础设施提供的数据（`useRuntime`），而不是自己重复解析 workspace 数据。
- R4: 固定区域显示地点/场景、时间（`worldTime`）、角色（含头像占位与点击入口）、状态、数值。
- R5: 扩展字段按 `displayItems` category 进入预留槽位（tags→状态区，metrics→数值区，refs→关联区），不堆到"其它"区域。
- R6: 支持折叠/展开（240px ↔ 48px），偏好持久化到 localStorage。
- R7: 延续"烛火书卷·重铸"暗色仪式系，偏可扫读的信息仪表盘风格。
- R8: 点击角色头像切换到角色卡全屏视图（nav 视图切换机制），不在状态栏内承载背包/容器/物品详情。
- R9: 未知/缺失 runtime 数据有空态或降级展示，不抛错。

## Acceptance Criteria

- [ ] 主游玩态左侧可见 240px 状态栏，可折叠成 48px 图标条。
- [ ] 状态栏展示地点/场景、`worldTime`、角色（含头像占位）。
- [ ] 状态栏展示至少一种 `displayItems` 扩展项（metrics 或 tags）。
- [ ] 点击角色头像切换到角色卡全屏视图；点击 nav"故事"切回剧情流。
- [ ] 折叠/展开状态持久化到 localStorage，不写入 workspace。
- [ ] 折叠态保留可识别的视觉入口（图标/头像），不丢失存在感。
- [ ] 状态栏不破坏发送、停止、剧情选项、历史滚动和检查点恢复。
- [ ] runtime 缺失/错误有空态或降级展示。
- [ ] StoryView 左侧让出状态栏空间（`padding-left` 随折叠态同步变化）。
- [ ] 通过 `npm run build --workspace play-frontend-dev`。

## Out of Scope

- 角色形象图片上传与持久化（归角色卡子任务）。
- 背包/容器/物品详情 UI（归角色卡子任务）。
- 角色卡全屏视图的完整 UI 设计（归角色卡子任务；MVP 只接通点击入口与视图切换）。
- `runtime-summary-injection` 实现。
- 修改 runtime/schema 约定。

## Dependencies

- 依赖 `07-04-frontend-runtime-render-infra`（已归档，已满足）。
- 依赖 `07-05-runtime-world-time-field`（已归档，已满足：`worldTime` 固定字段）。
