# Implement Plan: 游戏启动器化

## Validation Commands

```bash
# 根目录
pnpm -w lint
pnpm -w type-check
pnpm -w build

# 受影响包快速验证
pnpm --filter @tsian/platform-web lint
pnpm --filter @tsian/platform-web type-check
pnpm --filter @tsian/platform-web build
```

> 实际命令名以 package.json scripts 为准，开工前先核对。

## Ordered Checklist

### 1. 存储层 rename API（纯新增，零风险）

- [ ] `apps/platform-web/src/storage/saves.ts`：新增 `renameLocalSave(saveId, name)`，参照 design.md 实现。
- [ ] `apps/platform-web/src/storage/index.ts`：导出 `renameLocalSave`。
- [ ] `apps/platform-web/src/platform-host/game-cards.ts`：新增 `renamePlatformSave(saveId, name)`，调 `renameLocalSave` + `emitSavesChanged()`。
- [ ] `apps/platform-web/src/platform-host/index.ts`：导出 `renamePlatformSave`。
- [ ] type-check 通过。

### 2. 应用属性瘦身（GameCardDetailView.vue）

- [ ] `tabs` 去掉 saves 项；`TabId` → `"overview" | "frontend"`。
- [ ] 删除模板 `v-else-if="activeTab === 'saves'"` 整块。
- [ ] 删除 frontend tab"打开游玩窗口"按钮。
- [ ] 删除 `openPlayFromCard` 及 saves 相关状态/函数（`allSaves`/`cardSaves`/`selectedSaveId`/`activeSaveId`/`newSaveName`/`createSave`/`selectSave`/`continueSave`/`deleteSave`）。
- [ ] `deleteCurrentCard` 确认文案改为通用版（不引用 `cardSaves.value.length`）。
- [ ] `refreshData` 移除 `listPlatformSaves` / `getPlatformActiveSaveId` 调用。
- [ ] 清理无用 import（`ExternalLink`、`Play`、`Plus`、`Save` icon 等——逐个确认是否还被 overview/frontend 使用）。
- [ ] lint + type-check 通过。

### 3. PlayView 改造为启动器（核心）

- [ ] 引入 `LauncherPhase` 状态 + active card / saves 列表缓存。
- [ ] `onMounted`：resolve active card → `hasPlayableFrontend` 分流到 `unplayable-guide` 或 `launcher`。
- [ ] `launcher` 态模板：卡片头 + 存档列表 + 新建入口 + 行内重命名。
- [ ] `unplayable-guide` 态模板：提示 + 两个跳转按钮。
- [ ] 新建存档：行内输入 + `createPlatformSaveFromGameCard` → 切 `playing` + `mountActiveFrontend`。
- [ ] 继续存档：`selectPlatformSave` → 切 `playing` + `mountActiveFrontend`。
- [ ] 重命名：行内编辑 + `renamePlatformSave` → 刷新列表。
- [ ] 删除：`confirm` + `deletePlatformSave` → 刷新列表。
- [ ] `playing` 态：保留现有前端挂载 + loading/error 覆盖层；新增"返回启动器"控件（按钮 + ESC）。
- [ ] 事件监听：`SAVES_CHANGED_EVENT` / `ACTIVE_CARD_CHANGED_EVENT`，launcher 态刷新，playing 态仅更新缓存。
- [ ] `onBeforeUnmount`：保留现有卸载逻辑。
- [ ] lint + type-check 通过。

### 4. 美化与打磨

- [ ] 启动器三态视觉对齐 retro 设计语言（retro-inset / retro-button / neon / danger 色）。
- [ ] 存档列表项布局、间距、hover/selected 反馈。
- [ ] 行内重命名/新建输入框样式与现有 input 一致。
- [ ] unplayable-guide 居中提示卡样式。
- [ ] 游玩态"返回启动器"控件位置与可见性（不遮挡游戏前端主区）。

### 5. 全量验证

- [ ] `pnpm -w lint` / `type-check` / `build` 全绿。
- [ ] 手动验证（dev server）：
  - 无存档点"开始游戏" → 进启动器，不挂前端。
  - 新建存档命名 → 进入游玩。
  - 重命名存档 → 刷新后名称保留。
  - 删除存档 → 列表更新。
  - active card 无前端 → 引导态，跳转可用。
  - 游玩中返回启动器 → 重新选档。
  - 应用属性只剩 overview + frontend，无试玩按钮。

## Risky Files / Rollback Points

- `apps/platform-web/src/views/PlayView.vue` —— 改动最大，状态机从单态变多态。回滚 = git revert 此文件。
- `apps/platform-web/src/views/GameCardDetailView.vue` —— 大量删除，注意勿删到 overview/frontend 仍用的 import。
- `apps/platform-web/src/platform-host/game-cards.ts` —— 纯新增 rename，低风险。
- 存储层 `saves.ts` —— 纯新增，低风险。

## Review Gates

- 步骤 1 完成后 type-check（存储层独立可验）。
- 步骤 2 完成后 lint + type-check（应用属性瘦身独立可验）。
- 步骤 3 完成后 lint + type-check（启动器核心）。
- 步骤 5 全量验证 + 手动验证后才能报告完成。
