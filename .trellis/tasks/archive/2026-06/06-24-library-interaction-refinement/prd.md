# 我的应用交互收敛：导入/属性/快捷操作

## Goal

收敛"我的应用"相关交互链路：导入不再强制跳详情页、属性统一手动保存并给反馈、卡片 hover 露出快捷复制/加载按钮。消除当前"导入突兀弹框、保存行为不一致、复制/加载入口深"三个体验问题。

## User Value

- 导入卡包后留在"我的应用"看到新卡片出现，配 Toast 提示，不突兀跳转。
- 改属性有明确的"保存"提交动作 + Toast 反馈，玩家始终知道改动是否生效；封面误改可放弃。
- 卡片上直接复制 / 加载，不用右键菜单或进详情页。

## Confirmed Facts (from code inspection)

### 导入跳转现状

- `AppMarketView.vue:117` — 导入后 `router.push({ name: "game-card-detail", params: { cardId: imported.id } })`，强制跳详情。
- `GameCardLibraryView.vue:414` — 导入后 `openCard(imported.id)`，同样跳详情。
- `GameCardLibraryView` 已监听 `GAME_CARDS_CHANGED_EVENT`（`onGameCardsChanged` → `refreshCards`），所以导入后卡片会自动出现在列表。改 Toast 只需删跳转那两行。

### 属性保存不一致

- **封面即时保存**：`GameCardDetailView` 的 `handleCoverSelected` / `saveCoverUrl` / `clearCover` 直接调 `setPlatformGameCardCover` 写库，无 draft、无确认、不可撤销。
- **name/summary 手动保存**：`metadataName` / `metadataIntro` 是 draft ref，点"保存属性"按钮调 `saveMetadata` → `updatePlatformGameCardMetadata` 才写库。
- "保存属性"按钮只管 name/summary 两个字段，封面改了静默生效无反馈——半吊子状态。

### 复制/加载入口现状

- 加载：仅右键菜单"加载"（`loadCardFromMenu` → `setPlatformActiveGameCard`）。
- 复制：详情页"另存为本地副本"按钮（`copyAsLocalCard` → `copyPlatformGameCardAsLocal`）。builtin 卡已从列表过滤，该按钮实际用武之地小。
- `copyPlatformGameCardAsLocal(cardId, { name, summary })`：复制全部内容+前端文件，生成新 local 卡 id，emit `GAME_CARDS_CHANGED_EVENT`。快捷复制需传入名字（可用 `${原名} 副本`）。

### 卡片 DOM 结构

- `GameCardLibraryView` 卡片是 `<button>`（line 70-115），嵌套快捷按钮会 HTML 非法。需改为 `<div role="button">` 或让快捷按钮 `@click.stop` 阻止冒泡 + 卡片保持 button 但快捷操作用非 button 元素。spec `component-guidelines.md` 有 `retro-focus` 约定，需保持键盘可达。

### beforeClose 机制

- `useDesktopWindows.ts` 导出 `setBeforeClose(id, handler)` / `clearBeforeClose(id)`，handler 返回 `Promise<boolean>`，false 则阻止关闭。`WorkspaceEditorView` 已用此机制做未保存确认。
- 详情页窗口 id 形如 `game-launcher:${cardId}`（`desktopWindowForRoute` 生成）。详情页要注册 beforeClose，有 dirty 时弹确认。

## Decisions (resolved)

- **导入不跳转**：`AppMarketView` 和 `GameCardLibraryView` 导入成功后只 Toast 提示 + 列表自动刷新，不 `router.push`/`openCard`。
- **属性全量手动保存**：封面改为 draft（暂存上传 file / URL / 移除意图，本地预览），name/summary 保持 draft。统一一个"保存属性"按钮，`disabled = !hasUnsavedChanges`，点击后写库 + `toast.success`。封面/名称/简介一次性提交。
- **移除"另存为本地副本"按钮**：由卡片快捷复制取代。详情页不再有复制入口。
- **卡片快捷操作**：hover（或 focus）时在卡片上露出"复制""加载"两个快捷按钮。复制调 `copyPlatformGameCardAsLocal` 用 `${原名} 副本` 作名；加载调 `setPlatformActiveGameCard`。复制后 Toast 提示，卡片自动出现（事件刷新）。
- **未保存确认**：详情页有 dirty 时关闭窗口弹确认（复用 `confirm` + `setBeforeClose`）。

## Requirements

- R1: 导入卡包成功后 Toast 提示，不跳详情页，卡片自动出现在"我的应用"列表。
- R2: 封面改为 draft：上传/URL/移除操作先暂存意图 + 本地预览，不立即写库。
- R3: name/summary/封面统一一个"保存属性"按钮，有未保存改动时可点，无改动时 disabled。
- R4: 保存成功后 Toast 提示（"已保存属性"）。
- R5: 详情页有未保存改动时关闭窗口弹确认（放弃/取消）。
- R6: 移除详情页"另存为本地副本"按钮。
- R7: "我的应用"卡片 hover/focus 时露出"复制""加载"快捷按钮。
- R8: 快捷复制用 `${原名} 副本` 名，调 `copyPlatformGameCardAsLocal`，Toast 提示，新卡出现在列表。
- R9: 快捷加载调 `setPlatformActiveGameCard`，loaded 标记更新，已是当前卡时禁用。

## Acceptance Criteria

- [ ] 导入卡包后留在当前页，Toast 提示，卡片出现在列表，不跳详情。
- [ ] 封面上传/URL/移除先本地预览，不立即生效；点"保存属性"才写库。
- [ ] 无未保存改动时"保存属性"按钮 disabled；有改动时可点。
- [ ] 保存成功 Toast 提示。
- [ ] 有未保存改动时关闭详情窗口弹确认。
- [ ] 详情页无"另存为本地副本"按钮。
- [ ] 卡片 hover/focus 露出复制/加载快捷按钮，操作可达。
- [ ] 快捷复制后新卡以 `${原名} 副本` 出现在列表，Toast 提示。
- [ ] 快捷加载后该卡 loaded 标记更新；已是当前卡时加载按钮禁用。
- [ ] `npm run build:web` 通过。

## Out of Scope

- 应用市场实质化（仍为占位）。
- 卡片重命名（属性编辑仍在详情页）。
- 导入时的卡包校验增强（沿用现有）。
- 卡片拖拽排序。
