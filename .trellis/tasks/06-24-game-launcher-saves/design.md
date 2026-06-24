# Design: 游戏启动器化

## Architecture & Boundaries

四处改动，职责清晰分离：

1. **存储层 rename**（`apps/platform-web/src/storage/saves.ts` + `platform-host/game-cards.ts`）—— 纯新增
2. **启动器面板组件**（`apps/platform-web/src/components/play/GameLauncherPanel.vue`）—— 新建，承载选档/新建/重命名/删除 UI
3. **PlayView 改造为 phase 路由器**（`apps/platform-web/src/views/PlayView.vue`）—— 保持 thin loader 性质（spec `type-safety.md:110` / `component-guidelines.md:12`），根据 phase 决定渲染 `<GameLauncherPanel>` 还是前端挂载点
4. **应用属性瘦身**（`apps/platform-web/src/views/GameCardDetailView.vue`）

路由 `/play`、桌面 singleton 窗口、`desktop-apps.ts` 的 `play` 定义均不变。PlayView 仍是 thin loader：它只决定"渲染启动器面板还是挂载前端"，启动器业务 UI 在独立子组件里，不违反 thin-loader 约束。

## PlayView 状态机（phase 路由器）

PlayView 从单一"挂载前端"变为三态路由：

```
进入 /play
  │
  ├─ active card 无可玩前端 ──→ [unplayable-guide] 提示 + 跳转按钮
  │                              （去我的应用 / 去应用属性）
  │
  └─ active card 可玩
       │
       ├─ [launcher] 列存档 + 新建 + 重命名 + 继续
       │     │
       │     ├─ 选定/新建存档 ──→ selectPlatformSave ──→ [playing] 挂载前端
       │     │                                          │
       │     │                                          └─ 返回启动器 ──→ [launcher]
       │     │
       │     └─ active card 变更/存档变更事件 ──→ 刷新存档列表
       │
       └─ 无存档时 [launcher] 仍显示"新建存档"入口
```

### 状态定义

```ts
type LauncherPhase =
  | "resolving"          // 初始化中
  | "unplayable-guide"   // active card 无可玩前端
  | "launcher"           // 选档界面
  | "playing"            // 已挂载前端，游玩中
```

`playing` 态复用现有 `mountActiveFrontend()` 全部逻辑（remote/packaged 挂载、loading/error 覆盖层）。`launcher` 态渲染 `<GameLauncherPanel>`（新建子组件），`unplayable-guide` 态渲染引导提示。`resolving` 沿用现有 loading 覆盖层。PlayView 本身只持有 phase + active card 缓存，不直接渲染存档列表 UI——那属于 `GameLauncherPanel`。

### GameLauncherPanel 组件契约

`components/play/GameLauncherPanel.vue`，props：

```ts
defineProps<{
  card: LocalGameCardRecord          // active card（由 PlayView 传入，避免重复查询）
  saves: LocalSaveRecord[]           // 该卡的存档（由 PlayView 过滤后传入）
  activeSaveId: string               // 当前激活存档（用于高亮一键继续）
}>()

defineEmits<{
  continue: [saveId: string]         // 继续存档 → PlayView 切 playing
  create: [name: string]             // 新建存档 → PlayView 切 playing
  // 重命名/删除在面板内部完成（调 platform API），完成后 PlayView 通过事件刷新列表
  changed: []                        // 存档列表变更 → PlayView 重新拉取
}>()
```

面板内部职责：渲染存档列表、行内新建/重命名/删除、调 `createPlatformSaveFromGameCard` / `renamePlatformSave` / `deletePlatformSave` / `selectPlatformSave`（继续时由 PlayView 接管挂载）。变更后 emit `changed` 让 PlayView 重新拉取存档列表。

### 进入流程

`onMounted`：
1. `waitForPlatformHostReady()`
2. `getPlatformActiveGameCard()`
3. 无卡 → 不应发生（platform-host 保证有 active card），按 error 处理。
4. `hasPlayableFrontend(card)` 为 false → `unplayable-guide`。
5. 为 true → 加载该卡存档列表 → `launcher`。

### 选档/建档 → 游玩

- 继续：`selectPlatformSave(saveId)` → 切 `playing` → `mountActiveFrontend()`。
- 新建：`createPlatformSaveFromGameCard(activeCardId, { name })` → 切 `playing` → `mountActiveFrontend()`。
- 重命名：`renamePlatformSave(saveId, name)` → 刷新存档列表（不切态）。
- 删除：`deletePlatformSave(saveId)` → 刷新存档列表。

### 游玩 → 启动器

`playing` 态渲染一个"返回启动器"控件（角落按钮 + ESC 快捷键）。点击：`unmountFrontend()` → 切 `launcher`。不卸载存档数据，只卸载前端 iframe。

### 事件监听

- `SAVES_CHANGED_EVENT` / `ACTIVE_CARD_CHANGED_EVENT`：在 `launcher` 态刷新存档列表与 active card；在 `playing` 态仅更新缓存，不打断游玩。
- 复用 `GameCardDetailView` 现有的事件监听 + `isSavesChangedEvent` / `isActiveCardChangedEvent` 判别模式。

## 存储层 rename

### `storage/saves.ts`

```ts
export async function renameLocalSave(saveId: string, name: string): Promise<LocalSaveRecord> {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error("存档名不能为空。")
  }
  const existing = await localDb.saves.get(saveId)
  if (!existing) {
    throw new Error(`存档 "${saveId}" 不存在。`)
  }
  const updated: LocalSaveRecord = { ...existing, name: trimmed, updatedAt: Date.now() }
  await localDb.saves.put(updated)
  return updated
}
```

仅写 `saves` 表，无需事务（单表单行更新）。`put` 覆盖整条记录，故先 get 再合并。

### `platform-host/game-cards.ts`

```ts
export async function renamePlatformSave(saveId: string, name: string) {
  const updated = await renameLocalSave(saveId, name)
  emitSavesChanged()
  return updated
}
```

参照 `createPlatformSaveFromGameCard` 的 emit 模式。rename 不改 active save / active card，只广播存档变更。

### 导出

- `storage/index.ts` 导出 `renameLocalSave`。
- `platform-host/index.ts` 导出 `renamePlatformSave`。

## 应用属性瘦身（GameCardDetailView.vue）

移除项：
- `tabs` 数组去掉 `{ id: "saves", ... }`；`TabId` 改为 `"overview" | "frontend"`。
- 模板中 `v-else-if="activeTab === 'saves'"` 整块删除。
- frontend tab 的"打开游玩窗口"按钮 + `openPlayFromCard` 函数删除。
- `ExternalLink`、`Save`(icon)、`Play`、`Plus` 等仅 saves/试玩用到的 import 清理。
- 状态/函数清理：`allSaves`、`cardSaves`、`selectedSaveId`、`activeSaveId`、`newSaveName`、`createSave`、`selectSave`、`continueSave`、`deleteSave`、`openPlayFromCard`。

保留项：
- overview tab（卡片信息、封面、加载、另存为本地副本、删除应用）。
- frontend tab（前端绑定配置，去掉试玩按钮）。

`deleteCurrentCard` 确认文案当前引用 `cardSaves.value.length`。瘦身后改为通用文案：

> 删除应用「{卡名}」？这将同时删除所有关联存档，无法撤销。

不再需要预知存档数；`deletePlatformGameCard` 返回 `{ deletedSaveIds }` 可在成功 toast 里显示实际删除数。

`refreshData` 不再调用 `listPlatformSaves` / `getPlatformActiveSaveId`。仍需 `getPlatformActiveGameCardId` 判断 `isLoadedCard`。

## 启动器 UI 结构（launcher 态）

```
┌─────────────────────────────────────────────┐
│ [封面缩略] 卡名                     loaded    │  ← 卡片头
├─────────────────────────────────────────────┤
│ 存档槽                              [＋新建]  │
│ ┌────────────────────────────────────────┐ │
│ │ 存档A名  更新于 2026-06-24     [继续]   │ │
│ │                          [重命名][删除] │ │
│ └────────────────────────────────────────┘ │
│ ┌────────────────────────────────────────┐ │
│ │ 存档B名  ...                  ...       │ │
│ └────────────────────────────────────────┘ │
│                                              │
│ （无存档时）这张游戏卡还没有存档，新建一个开始 │
└─────────────────────────────────────────────┘
```

- 重命名：行内编辑——点"重命名"→ 名称位变 `<input>` + 确定/取消；回车确认、ESC 取消。
- 新建：点"＋新建"→ 展开行内输入框（占位符 = 兜底默认名）+ 创建/取消；回车创建。
- 继续按钮主操作色（neon），重命名/删除次要色，删除用 danger 色。
- 复用 `retro-inset` / `retro-button` / `retro-focus` / `border-neon-deep` 等现有 class，与桌面其余窗口一致。

## unplayable-guide 态

居中提示卡：

> 当前游戏卡「{卡名}」还没有可游玩的前端。
> [去我的应用换卡]  [去应用属性配前端]

按钮分别 `router.push("/library")` 与 `router.push({ name: "game-card-detail", params: { cardId } })`。

## 兼容性 & 回滚

- 无数据迁移：rename 只改 `name`/`updatedAt` 现有字段。
- 路由不变，桌面窗口行为不变。
- 回滚点：三处改动相互独立，可分别 revert。存储层 rename 是纯新增函数，不影响现有路径。
- 风险点：PlayView 从单态变多态，状态机分支需覆盖 resolving→guide、resolving→launcher、launcher↔playing、事件打断 playing 等边界。
