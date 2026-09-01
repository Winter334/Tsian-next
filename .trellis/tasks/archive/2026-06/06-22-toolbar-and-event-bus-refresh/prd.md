# 游戏卡库顶部工具栏 + 平台事件总线自动刷新

## Goal

解决两个交互问题：(1) 游戏卡库的「创建」「导入」操作藏在空白处右键，发现成本高——提到顶部工具栏显式暴露；(2) 各视图数据只在 `onMounted` 拉一次，别处改动后当前视图不自动更新，必须关闭重开才生效——通过扩展平台事件总线，让相关视图在实体变更时自动刷新。

## Background

### Part 1 · 创建/导入藏右键
`GameCardLibraryView.vue` 的创建/导入入口仅在空白处右键菜单（`createCardFromMenu` / `importFromMenu`，L165-183）。讽刺的是空库时反而有内联按钮（L36-54），有卡后就只剩右键。视图顶部没有工具栏，只有底部 statusbar。这是发现成本问题，不是功能缺失——右键菜单本身工作正常。

### Part 2 · 跨视图不刷新
- 每个 View 各写一个手动 `refresh()`，只在 `onMounted` 跑一次。
- 桌面窗口无 keep-alive：关窗=组件卸载，重开=新窗口=重 mount=重跑 `onMounted` refresh。这就是「关闭再打开就刷新了」的机制——反过来也证明只要窗口不关，它不会自己更新。
- 全局只有 `WorkspaceExplorerView` 订阅了 `WORKSPACE_CONTENT_CHANGED_EVENT`（`WorkspaceEditorView` 保存时 emit，Explorer 收到刷新目录）。`GameCardLibraryView` / `GameCardDetailView` / `StudioView` / `AssistantView` 都不订阅任何事件。
- 事件类型也只有「workspace 内容变更」一种，没有「卡列表变了」「存档变了」「激活卡变了」这种实体级事件。
- spec 明确没有 Pinia/全局 store，约定是「mutation 后从 platform/storage API 重新拉取」——即事件驱动刷新。现有 `lib/workspace-events.ts` 的 `window.dispatchEvent` + `CustomEvent` 就是认可的模式，只是覆盖不全。

根因不是延迟，是根本没有跨视图同步（只有 workspace 内容一处接了线）。

## Requirements

### R1 共享顶部工具栏组件 `ViewActionBar`

- 新建 `apps/platform-web/src/components/common/ViewActionBar.vue`。
- retro 风格，与现有 footer statusbar 视觉对齐（`retro-statusbar` 风格族、`font-mono`、neon 色系）。
- 接收 `actions` prop：数组项含 `label`、`icon`（lucide 组件）、`onClick`、`disabled?`、`loading?`、`variant?`（default/danger）。
- 左对齐渲染按钮；右侧留可选 slot 给自定义内容（如标题或状态文本）。
- 无 actions 时不渲染（不留空栏）。

### R2 游戏卡库接入工具栏

- `GameCardLibraryView.vue` 顶部加 `ViewActionBar`，放「创建游戏」+「导入卡包」两项。
- 复用现有 `createDefaultCard` / `openPackagePicker` 回调，不重写业务逻辑。
- 「创建游戏」按钮 `:disabled="creating"`，「导入卡包」按钮 `:disabled="importing"`（复用现有 loading flag）。
- 空状态内联按钮（L36-54）保留作首启引导。
- 右键菜单全部保留（打开/加载/删除/创建/导入）作快捷方式。

### R3 平台实体级事件总线

- 新建 `apps/platform-web/src/lib/platform-events.ts`，沿用 `lib/workspace-events.ts` 模式（`window.dispatchEvent` + `CustomEvent` + 类型守卫）。
- 三类事件：
  - `tsian:game-cards-changed` — 游戏卡列表变更（创建/删除/导入/复制）。
  - `tsian:active-card-changed` — 激活卡变更（加载/切换/新建后激活）。
  - `tsian:saves-changed` — 存档列表变更（创建/删除/选择）。
- 每个事件配 `emitXxx()` 函数 + `isXxxEvent()` 类型守卫 + 常量事件名。
- 不引入新依赖、不改全局 store 约定。

### R4 platform-host 变更点 emit 事件

- 在 `platform-host` 的实体变更函数内 emit 对应事件（在成功 mutation 完成后）：
  - `createDefaultPlatformGameCard` / `deletePlatformGameCard` / `importPlatformGameCardPackage` / `copyPlatformGameCardAsLocal` → `emitGameCardsChanged()`。
  - `setPlatformActiveGameCard` → `emitActiveCardChanged()`（同时该函数被创建/导入流程末尾调用，会连带触发卡列表刷新，无需重复 emit）。
  - 存档 create/delete/select → `emitSavesChanged()`。
- emit 只在成功路径触发，失败路径不 emit（避免订阅者做无意义刷新）。

### R5 订阅点自动刷新

- `GameCardLibraryView`：订阅 `game-cards-changed` + `active-card-changed` → 调 `refreshCards()`（更新卡列表 + loaded 徽标）。
- `GameCardDetailView`：订阅 `saves-changed` + `active-card-changed` → 调 `refreshData()`（更新存档列表 + 激活存档/卡态）。
- `StudioView`：订阅 `active-card-changed` → 调 `refresh()`（重新加载工作室快照）。
- `AssistantView`：订阅 `active-card-changed` → 调 `refresh()`（更新当前卡名）。
- 订阅在 `onMounted` 注册、`onBeforeUnmount` 注销，照搬 `WorkspaceExplorerView` 现有 `window.addEventListener`/`removeEventListener` 写法。
- 订阅回调做基本防护：事件无 detail 或 detail 与当前上下文无关时跳过（参考 Explorer 的 `isWorkspaceContentChangedEvent` 守卫）。

### R6 现有功能保持

- `WorkspaceExplorerView` 保持现状不动（符合 Windows 资源管理器操作习惯，用户明确要求保留）。
- 右键菜单在所有视图保留作快捷方式。
- `WorkspaceEditorView` ↔ `WorkspaceExplorerView` 的 `WORKSPACE_CONTENT_CHANGED_EVENT` 机制不动。
- 手动 `refresh()` 函数在所有视图保留（事件总线的兜底，也为未来可能的刷新按钮预留）。

## Constraints

- 改动集中在 `apps/platform-web/src`：新建 `components/common/ViewActionBar.vue`、`lib/platform-events.ts`；改 `views/GameCardLibraryView.vue`、`views/GameCardDetailView.vue`、`views/StudioView.vue`、`views/AssistantView.vue`、`platform-host/index.ts`（及相关 game-cards.ts / saves.ts 变更点）。
- 不引入 Pinia/Vuex/全局 store，契合 spec `state-management.md`。
- 不改 `@tsian/contracts`、不改 Dexie 表、不改路由、不改 `WorkspaceExplorerView.vue`。
- 遵循 spec `state-management.md`：「Route views should refresh from platform/storage APIs after mutations」——事件总线是触发这条约定的机制，不是替代。
- 遵循 spec `component-guidelines.md`：ViewActionBar 是展示型组件，不含业务逻辑，回调由父 View 提供。
- 遵循 spec `quality-guidelines.md`：`npm run build:web` 必须通过。
- 不引入新依赖。

## Acceptance Criteria

### Part 1 · 工具栏
- [ ] 新建 `components/common/ViewActionBar.vue`，retro 风格与 statusbar 对齐，接收 `actions` prop（label/icon/onClick/disabled?/loading?/variant?）+ 可选右侧 slot。
- [ ] `GameCardLibraryView` 顶部渲染 `ViewActionBar`，含「创建游戏」+「导入卡包」两项，点击行为与原右键菜单一致（创建走 `createDefaultCard`，导入走 `openPackagePicker`）。
- [ ] 创建中按钮 disabled，导入中按钮 disabled（复用 `creating`/`importing` flag）。
- [ ] 空状态内联按钮保留。
- [ ] 右键菜单全部保留且功能不变。

### Part 2 · 事件总线
- [ ] 新建 `lib/platform-events.ts`，导出三类事件的 emit + 类型守卫 + 事件名常量。
- [ ] `platform-host` 的 `createDefaultPlatformGameCard`/`deletePlatformGameCard`/`importPlatformGameCardPackage`/`copyPlatformGameCardAsLocal` 在成功后 emit `game-cards-changed`。
- [ ] `setPlatformActiveGameCard` 成功后 emit `active-card-changed`。
- [ ] 存档 create/delete/select 成功后 emit `saves-changed`。
- [ ] 失败路径不 emit。
- [ ] `GameCardLibraryView` 订阅 `game-cards-changed` + `active-card-changed` → `refreshCards()`。
- [ ] `GameCardDetailView` 订阅 `saves-changed` + `active-card-changed` → `refreshData()`。
- [ ] `StudioView` 订阅 `active-card-changed` → `refresh()`。
- [ ] `AssistantView` 订阅 `active-card-changed` → `refresh()`。
- [ ] 所有订阅 onMounted 注册 / onBeforeUnmount 注销，无内存泄漏。

### 端到端验证
- [ ] 开 Library 窗口 + Detail 窗口，在 Detail 中加载/删除卡 → Library 卡列表与 loaded 徽标自动更新，无需关重开。
- [ ] 在 Library 创建/导入卡 → Detail 窗口（若开着并指向同卡）自动刷新。
- [ ] Studio/Assistant 窗口开着时，别处切换激活卡 → 自动刷新。
- [ ] `WorkspaceExplorerView` 行为不变。
- [ ] `npm run build:web` 通过。
