# Implement — 游戏卡库工具栏 + 平台事件总线自动刷新

## 执行顺序

按依赖关系分 3 阶段：底层（事件总线）→ 中层（emit 点）→ 上层（工具栏 + 订阅）。每阶段结束可独立 build 验证。

### 阶段 A · 事件总线基础设施

- [ ] A1 新建 `apps/platform-web/src/lib/platform-events.ts`
  - 导出 3 个事件名常量：`GAME_CARDS_CHANGED_EVENT = "tsian:game-cards-changed"`、`ACTIVE_CARD_CHANGED_EVENT = "tsian:active-card-changed"`、`SAVES_CHANGED_EVENT = "tsian:saves-changed"`。
  - 导出 3 个 emit 函数：`emitGameCardsChanged()` / `emitActiveCardChanged()` / `emitSavesChanged()`，各 `window.dispatchEvent(new CustomEvent(NAME))`。
  - 导出 3 个类型守卫：`isGameCardsChangedEvent` / `isActiveCardChangedEvent` / `isSavesChangedEvent`，各检查 `event.type === NAME && event instanceof CustomEvent`。
  - 模式照搬 `lib/workspace-events.ts`（payload-less，守卫不带 detail 检查）。
- [ ] A2 验证：`npm run build:web` 通过（新文件未被引用不会报错，但确认无语法问题）。

### 阶段 B · platform-host emit 点

- [ ] B1 `apps/platform-web/src/platform-host/game-cards.ts` 顶部 import 三个 emit 函数。
- [ ] B2 `copyPlatformGameCardAsLocal`（L325 `return putLocalGameCard(...)` 前）：先 `const result = await putLocalGameCard(...)`，再 `emitGameCardsChanged()`，再 `return result`。
- [ ] B3 `createDefaultPlatformGameCard`（L387 `const active = await setPlatformActiveGameCard(record.id)` 后、`return active` 前）：`emitGameCardsChanged()`（`setPlatformActiveGameCard` 内部已 emit active-card-changed，无需重复）。
- [ ] B4 `deletePlatformGameCard`（L439 `return {...}` 前）：
  - `emitGameCardsChanged()` + `emitSavesChanged()`。
  - 条件 active-card-changed：在 L410-422 fallback 分支内，若删除的是激活卡（`await getActiveGameCardId() === card.id` 成立过），emit `emitActiveCardChanged()`。最简做法：在 L410 前记录 `const wasActive = await getActiveGameCardId() === card.id`，函数末尾 `if (wasActive) emitActiveCardChanged()`。
- [ ] B5 `importPlatformGameCardPackage`（L484 `return importGameCardPackage(input)` 改为）：`const result = await importGameCardPackage(input); emitGameCardsChanged(); return result`。
- [ ] B6 `setPlatformActiveGameCard`（L575 `return card` 前）：`emitActiveCardChanged()`。
- [ ] B7 `createPlatformSave`（L277 `return created` 前）：`emitSavesChanged(); emitActiveCardChanged()`（新建存档设了 active card）。
- [ ] B8 `createPlatformSaveFromGameCard`（L525 `return created` 前）：`emitSavesChanged(); emitActiveCardChanged()`。
- [ ] B9 `selectPlatformSave`（L535 `restoreActiveSnapshotFromStorage` 后）：`emitSavesChanged(); emitActiveCardChanged()`。
- [ ] B10 `deletePlatformSave`（L558 函数末）：
  - `emitSavesChanged()`。
  - 条件 active-card-changed：记录 `const wasActive = activeSaveId === saveId`，末尾 `if (wasActive && remaining.length > 0) emitActiveCardChanged()`（fallback 切换了 active card）。
- [ ] B11 验证：`npm run build:web` 通过。此时 emit 已生效但无订阅者，行为与现状一致（事件冒泡无人听）。

### 阶段 C · 工具栏 + 订阅

- [ ] C1 新建 `apps/platform-web/src/components/common/ViewActionBar.vue`
  - template：`<div class="view-action-bar ...">` + 左侧 `v-for actions` 按钮 + `<slot />`（右侧）。
  - script：`defineProps<{ actions: ViewActionBarAction[] }>()`，`ViewActionBarAction` 类型导出（label/icon/onClick/disabled?/loading?/variant?）。
  - 按钮 class：`retro-button retro-focus`（default）/ `text-danger hover:bg-danger/10`（danger variant）；`:disabled="action.disabled || action.loading"`。
  - 无 actions 且无 slot 时不渲染（`v-if="actions.length || $slots.default"`）。
- [ ] C2 `GameCardLibraryView.vue` 接入工具栏
  - import `ViewActionBar` + `Plus`/`Download` 图标（已有）。
  - 在 `<section>` 内、`<div class="retro-inset m-3 ...">` 前插入 `<ViewActionBar :actions="toolbarActions" />`。
  - `const toolbarActions = computed(() => [{ label: "创建游戏", icon: Plus, onClick: createDefaultCard, disabled: creating.value, loading: creating.value }, { label: "导入卡包", icon: Download, onClick: openPackagePicker, disabled: importing.value, loading: importing.value }])`。
- [ ] C3 `GameCardLibraryView.vue` 订阅事件
  - import `onBeforeUnmount` + `GAME_CARDS_CHANGED_EVENT`/`ACTIVE_CARD_CHANGED_EVENT` + `isGameCardsChangedEvent`/`isActiveCardChangedEvent`。
  - 加 `onGameCardsChanged` / `onActiveCardChanged` handler（各调 `refreshCards()`）。
  - `onMounted` 追加两个 `addEventListener`；新增 `onBeforeUnmount` 两个 `removeEventListener`。
- [ ] C4 `GameCardDetailView.vue` 订阅事件
  - import `onBeforeUnmount` + saves/active-card 事件 + 守卫。
  - handler 调 `refreshData()`。
  - onMounted 追加 addEventListener；新增 onBeforeUnmount。
- [ ] C5 `StudioView.vue` 订阅事件
  - import `onBeforeUnmount` + `ACTIVE_CARD_CHANGED_EVENT` + `isActiveCardChangedEvent`。
  - handler 调 `refresh()`。
  - onMounted 追加；新增 onBeforeUnmount。
- [ ] C6 `AssistantView.vue` 订阅事件
  - import `onBeforeUnmount` + `ACTIVE_CARD_CHANGED_EVENT` + `isActiveCardChangedEvent`。
  - handler 调 `refresh()`。
  - onMounted 追加；新增 onBeforeUnmount。
- [ ] C7 验证：`npm run build:web` 通过。

## 验证命令

```bash
# 每阶段结束
npm run build:web

# 全部完成后端到端手测（dev server）
npm run dev:web   # 或项目实际 dev 命令
```

## 端到端手测清单

1. **Library ↔ Detail 卡列表同步**：开 Library 窗口 + Detail 窗口（指向某卡）。在 Detail 删除该卡 → Library 卡列表自动更新且 loaded 徽标消失，无需关重开。
2. **Library 创建同步**：开 Library 窗口。点顶部「创建游戏」→ 新卡出现在列表，loaded 徽标更新。
3. **Library 导入同步**：点顶部「导入卡包」选 zip → 新卡出现在列表。
4. **Detail 存档同步**：开 Detail 窗口。在别处（Play/Studio）新建/删除存档 → Detail 存档列表自动更新。
5. **Studio 激活卡同步**：开 Studio 窗口。在 Library 加载另一张卡 → Studio 自动刷新到新卡内容。
6. **Assistant 激活卡同步**：开 Assistant 窗口。在 Library 加载另一张卡 → Assistant 顶栏卡名更新。
7. **Explorer 不变**：WorkspaceExplorerView 行为完全不变（右键、刷新、新建都如旧）。
8. **右键菜单不变**：Library 右键菜单的创建/导入仍可用。

## Review Gates

- 阶段 A 后：检查 `platform-events.ts` 与 `workspace-events.ts` 同构，无多余抽象。
- 阶段 B 后：确认所有 emit 在成功路径、throw 路径无 emit。`grep -n "emit" game-cards.ts` 逐处核对。
- 阶段 C 后：确认每个 View 的 add/removeEventListener 事件名与 handler 配对，无遗漏 remove。

## 回滚点

- 阶段 A/B 出问题：revert game-cards.ts 的 emit 行 + 删除 platform-events.ts，现有功能不受影响。
- 阶段 C 出问题：revert 各 View 的 import/订阅行 + 删除 ViewActionBar.vue，退化为现状（手动关重开刷新）。
- 无数据迁移、无 DB schema 变更，回滚零风险。
