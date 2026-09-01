# Design — 游戏卡库工具栏 + 平台事件总线自动刷新

## 范围

新建 2 个文件，改 5 个文件：

| 类型 | 文件 | 改动 |
|------|------|------|
| 新建 | `apps/platform-web/src/components/common/ViewActionBar.vue` | 共享顶部工具栏组件 |
| 新建 | `apps/platform-web/src/lib/platform-events.ts` | 实体级事件总线 |
| 改 | `apps/platform-web/src/views/GameCardLibraryView.vue` | 接入工具栏 + 订阅事件 |
| 改 | `apps/platform-web/src/views/GameCardDetailView.vue` | 订阅事件 |
| 改 | `apps/platform-web/src/views/StudioView.vue` | 订阅事件 |
| 改 | `apps/platform-web/src/views/AssistantView.vue` | 订阅事件 |
| 改 | `apps/platform-web/src/platform-host/game-cards.ts` | 变更点 emit 事件 |

不改 `@tsian/contracts`、Dexie、路由、`WorkspaceExplorerView.vue`、`lib/workspace-events.ts`。

## 后端能力盘点（已具备，无需改动）

所有实体操作函数已在 `platform-host/game-cards.ts` 导出，UI 直接调用。本任务只在这些函数的成功路径末尾追加 `emitXxx()`，不改其内部逻辑。

## 关键设计决策

### D1 ViewActionBar：展示型组件，无业务逻辑

```
Props:
  actions: Array<{
    label: string
    icon: Component        // lucide-vue-next 图标组件
    onClick: () => void
    disabled?: boolean
    loading?: boolean
    variant?: "default" | "danger"
  }>
Slots:
  #default (右侧可选内容，如标题/状态文本)
```

- 渲染：左对齐按钮行 + 右侧 slot。无 actions 且无 slot 时不渲染（不留空栏）。
- 样式：复用 `retro-statusbar` 风格族（参考 `GameCardLibraryView` footer L117-122 与 `retro-button` class），`font-mono`、neon 色系、与现有 footer 视觉对齐但置于顶部。
- 按钮复用 `retro-button` / `retro-focus` class，`variant: "danger"` 用 `text-danger` + `hover:bg-danger/10`（参考右键菜单删除项 L159）。
- `loading` 时按钮显示禁用态（与 `disabled` 合并判断），不强制内置 spinner——复用现有 `creating`/`importing` flag 语义，按钮文案不变，靠 disabled 防重复点击。

### D2 platform-events.ts：沿用 workspace-events 模式

三个事件，无 payload（订阅者全量重读，不需要 diff）：

```typescript
export const GAME_CARDS_CHANGED_EVENT = "tsian:game-cards-changed"
export const ACTIVE_CARD_CHANGED_EVENT = "tsian:active-card-changed"
export const SAVES_CHANGED_EVENT = "tsian:saves-changed"

export function emitGameCardsChanged(): void
export function emitActiveCardChanged(): void
export function emitSavesChanged(): void

export function isGameCardsChangedEvent(event: Event): event is CustomEvent<void>
export function isActiveCardChangedEvent(event: Event): event is CustomEvent<void>
export function isSavesChangedEvent(event: Event): event is CustomEvent<void>
```

- 与 `workspace-events.ts` 同构：`window.dispatchEvent(new CustomEvent(NAME))` + 类型守卫。
- 无 payload → 守卫只检查 `event.type === NAME && event instanceof CustomEvent`。
- 不引入通用 EventBus 类，保持模块级函数风格（契合 spec `state-management.md` 无全局 store 约定）。

为什么无 payload：订阅者的响应都是「调自己的 refresh() 全量重读」，不需要知道改了哪个卡/存档。payload-less 最简，且避免「emit 时带的 id 与订阅者当前上下文不匹配导致漏刷新」的边界问题。

### D3 emit 插入点（platform-host/game-cards.ts）

在每个公开 mutation 函数的成功返回前 emit。失败路径（throw 前）不 emit。

| 函数 | 行号 | emit 事件 | 说明 |
|------|------|-----------|------|
| `copyPlatformGameCardAsLocal` | L312 | `game-cards-changed` | 复制卡（DetailView 直接调用） |
| `createDefaultPlatformGameCard` | L353 | `game-cards-changed` + `active-card-changed` | 末尾 emit；内部 `copyPlatform...` 会先 emit 一次 game-cards-changed（premature 但无害），末尾再 emit 一次确保最终态 |
| `deletePlatformGameCard` | L391 | `game-cards-changed` + `saves-changed` + 条件 `active-card-changed` | 删卡连带删存档；若删除的是激活卡且触发了 fallback（L410-422），emit active-card-changed |
| `importPlatformGameCardPackage` | L482 | `game-cards-changed` | 导入卡包，不自动激活（UI 后续 openCard 导航，不 load） |
| `setPlatformActiveGameCard` | L568 | `active-card-changed` | 加载/切换激活卡 |
| `createPlatformSave` | L270 | `saves-changed` + `active-card-changed` | 新建存档会设 active card |
| `createPlatformSaveFromGameCard` | L512 | `saves-changed` + `active-card-changed` | |
| `selectPlatformSave` | L528 | `saves-changed` + `active-card-changed` | 选择存档会 sync active card |
| `deletePlatformSave` | L538 | `saves-changed` + 条件 `active-card-changed` | 若删除的是激活存档且 fallback（L552-556），emit active-card-changed |

**复合调用产生的多次 emit 是无害的**：`createDefaultPlatformGameCard` 内部 `copyPlatformGameCardAsLocal` emit 一次 game-cards-changed（卡尚无 frontend），末尾再 emit 一次（完整态）。订阅者 `refreshCards()` 被触发两次，第二次读到最终态。这是可接受的——IndexedDB 本地读很快，且 idempotent refresh 不会产生错误状态。与现有 `WorkspaceExplorerView` 每次 workspace-content-changed 都 refresh 的模式一致。

**为什么不在 storage 层（saves.ts/game-cards.ts storage）emit**：storage 层是纯 DB 操作，不知道「激活态」语义；platform-host 层才是业务变更边界。emit 放 platform-host 保持分层干净。

### D4 订阅点（4 个 View）

照搬 `WorkspaceExplorerView.vue` L1317-1352 范式：handler 函数 + onMounted addEventListener + onBeforeUnmount removeEventListener。

| View | 订阅事件 | 响应 | 现有 onBeforeUnmount |
|------|---------|------|---------------------|
| `GameCardLibraryView` | `game-cards-changed` + `active-card-changed` | `refreshCards()`（更新卡列表 + loaded 徽标） | 无，需新增 |
| `GameCardDetailView` | `saves-changed` + `active-card-changed` | `refreshData()`（更新存档列表 + 激活态） | 无，需新增 |
| `StudioView` | `active-card-changed` | `refresh()`（重载工作室快照） | 无，需新增 |
| `AssistantView` | `active-card-changed` | `refresh()`（更新当前卡名） | 无，需新增 |

handler 写法（以 LibraryView 为例）：

```typescript
function onGameCardsChanged(event: Event) {
  if (!isGameCardsChangedEvent(event)) return
  void refreshCards()
}

function onActiveCardChanged(event: Event) {
  if (!isActiveCardChangedEvent(event)) return
  void refreshCards()  // 更新 loaded 徽标
}

onMounted(() => {
  window.addEventListener(GAME_CARDS_CHANGED_EVENT, onGameCardsChanged)
  window.addEventListener(ACTIVE_CARD_CHANGED_EVENT, onActiveCardChanged)
  void refreshCards()
})

onBeforeUnmount(() => {
  window.removeEventListener(GAME_CARDS_CHANGED_EVENT, onGameCardsChanged)
  window.removeEventListener(ACTIVE_CARD_CHANGED_EVENT, onActiveCardChanged)
})
```

**不做 cardId 过滤**：订阅者的响应是全量重读自己的数据，任何卡/存档变更都应触发刷新。过滤会引入「事件 detail 与当前上下文不匹配导致漏刷新」的边界问题。这与 Explorer 的 workspace-content-changed 过滤不同——Explorer 过滤是因为 Explorer 是单卡上下文，只关心自己卡的文件变更；而 Library/Detail 关心全局卡列表/存档列表。

### D5 防抖考量（暂不做）

短时间内多次 emit（如 `createDefaultPlatformGameCard` 的 premature + final）会触发多次 refresh。当前不引入防抖，原因：
- IndexedDB 本地读 < 5ms，两次 refresh 无感知。
- 防抖会引入 50-100ms 延迟，反而让「自动刷新」显得迟钝。
- 若后续出现高频 emit 场景，再在订阅者侧加 `requestAnimationFrame` 合并（参考 AssistantView 流式输出的 rAF 节流模式）。

## 数据流

```
[用户在 DetailView 删除卡]
  → deletePlatformGameCard()
    → storage 删除 + fallback
    → emit game-cards-changed + saves-changed + active-card-changed
  → 事件冒泡到 window
  → LibraryView handler: refreshCards() → 卡列表更新 + loaded 徽标更新
  → StudioView handler: refresh() → 工作室快照重载
  → AssistantView handler: refresh() → 当前卡名更新
  → DetailView 自身: refreshData()（存档列表 + 激活态）
```

无需关重开，所有打开的视图自动同步。

## 兼容性与回滚

- 纯新增 + 追加，不改现有函数签名/返回值/内部逻辑。
- 事件总线是可选增强：即使 emit 漏加某处，订阅者只是不刷新（退化为现状），不会出错。
- 回滚：删除新文件 + revert 5 个文件的 import/emit/addEventListener 行。无数据迁移、无 DB schema 变更。
