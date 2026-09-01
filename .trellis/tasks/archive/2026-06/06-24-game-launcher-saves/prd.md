# 游戏启动器化：存档管理迁入开始游戏

## Goal

把"开始游戏"从单纯的游玩窗口改造为**游戏启动器**：玩家点击后在这里选择存档继续或创建新存档，创建存档时可命名、已有存档可重命名。同时把存档管理从"应用属性"中迁出，消除当前"存档管理"与"开始游戏"分属两个窗口的交互割裂。适当美化启动器 UI。

## User Value

- 玩家点"开始游戏"即可完成"选档 → 进入游戏"或"建档 → 进入游戏"，无需先去"应用属性"。
- 存档可命名、可重命名，玩家能区分多个存档槽。
- 修复当前"无存档也能点开开始游戏"导致的不可预测行为。

## Confirmed Facts (from code inspection)

- `apps/platform-web/src/views/PlayView.vue` 是"哑终端"：点开后直接调 `getPlatformActiveGameCard()` 拿当前激活卡并挂载前端，**全程不检查、不选择存档**。无前端时报"游戏前端未配置"。这就是"无存档也能点开"的根因。
- 存档的建/选/删当前在 `apps/platform-web/src/views/GameCardDetailView.vue` 的 `saves` tab（"应用属性"窗口）。`continueSave()` = `selectPlatformSave(saveId)` + `router.push("/play")`。
- `GameCardDetailView.createSave()` 读取 `newSaveName.value`，但模板里**没有绑定该 ref 的输入框**——它是 dead ref，创建存档只能用默认名 `${卡名} 存档 ${n}`。**当前无法命名存档，重命名功能完全缺失。**
- 存储层 `apps/platform-web/src/storage/saves.ts` 只有 `listLocalSaves / createLocalSave / createLocalSaveFromGameCard / deleteLocalSave`，**没有 rename**。`platform-host/game-cards.ts` 同样只有 `createPlatformSave / createPlatformSaveFromGameCard / selectPlatformSave / deletePlatformSave / listPlatformSaves / getPlatformActiveSaveId / ensureActiveSave`，无 rename。重命名需在 storage + platform-host 两层新增。
- `LocalSaveRecord`（`storage/db.ts:14`）字段：`id, name, gameCardId?, gameCardVersion?, createdAt, updatedAt`。重命名只需更新 `name` + `updatedAt`。
- 存档按 `gameCardId` 限定（`cardSaves` 用 `save.gameCardId === card.manifest.id` 过滤）。`listPlatformSaves()` 返回全部存档，跨卡在数据上可行。
- 平台启动时**总会保证有一张 active card**（`initializePlatformHost` → `ensureActiveGameCardId`，无本地卡时自动建可编辑默认卡）。所以"无 active card"不是真空，而是"只有 builtin blank / 自动建的空白默认卡，且大概率 `hasPlayableFrontend === false`"。
- `apps/platform-web/src/desktop-apps.ts` 中 `play` 是桌面图标"开始游戏"，singleton 窗口，路由 `/play`，组件 `PlayView`。`game-launcher`（应用属性）路由 `/cards/:cardId`，组件 `GameCardDetailView`，含 overview/saves/frontend 三 tab。

## Decisions (resolved)

- **A — 应用属性 `saves` tab：彻底移除。** 应用属性只留 overview + frontend 两个 tab，存档管理完全归启动器，无认知重复。
- **B — 启动器作用域：单卡（基于 active card）。** 启动器只列当前 active card 的存档。无可玩前端时显示引导态，提供跳转："去我的应用换卡" / "去应用属性配前端"，不在启动器内做选卡。
- **C — 试玩入口：移除应用属性 frontend tab 的"打开游玩窗口"按钮。** 进游玩统一走桌面"开始游戏"图标 → 启动器。应用属性不再持有任何选档/进游玩逻辑。
- **D — 美化：适当美化。** 复用现有 retro 设计语言（retro-inset / retro-button / neon 配色），启动器三态（选档 / 游玩中 / 无可玩卡引导）各自明确的视觉层级。具体视觉在实现时迭代，不做独立设计稿。

## Requirements

- R1: 点"开始游戏"进入启动器界面，不再在无存档时直接挂载前端。
- R2: 启动器列出当前 active card 的存档槽（按 updatedAt 倒序），每项可"继续 / 重命名 / 删除"。
- R3: 新建存档时可输入存档名；留空时使用兜底默认名（`${卡名} 存档 ${n}`）。
- R4: 已有存档可重命名，名称持久化（刷新后保留）。
- R5: 选定/新建存档后挂载该卡前端进入游玩态（复用现有前端挂载逻辑）。
- R6: 无可玩前端时进入引导态，提示并跳转"我的应用"换卡 / "应用属性"配前端。
- R7: 应用属性移除 saves tab 与"打开游玩窗口"按钮，不再持有选档/进游玩逻辑。
- R8: 启动器 UI 适当美化，符合 retro 设计语言。

## Acceptance Criteria

- [ ] 点"开始游戏"进入启动器，不直接挂载前端。
- [ ] 启动器列出 active card 的存档槽，按更新时间倒序。
- [ ] 新建存档可自定义命名；留空用兜底默认名。
- [ ] 已有存档可在启动器重命名，名称持久化（刷新后保留）。
- [ ] 选定/新建存档后正常挂载该卡前端进入游玩。
- [ ] 游玩态可返回启动器重新选档。
- [ ] active card 无可玩前端时进入引导态，可跳转"我的应用"/"应用属性"。
- [ ] 应用属性只剩 overview + frontend 两个 tab，无"打开游玩窗口"按钮。
- [ ] lint / type-check / build 通过。

## Out of Scope

- 游戏卡的导入/创建/导出流程（已在应用市场 / 我的应用 / 应用属性覆盖）。
- 存档 checkpoint / 回滚 / 时间线 UI（已有独立入口）。
- 游戏卡前端绑定的配置（仍在应用属性 frontend tab）。
