# Implement Plan: 我的应用交互收敛

## Validation Commands

```bash
npm run build:web   # = vue-tsc -b && vite build，含 type-check
```

## Ordered Checklist

### 1. desktop-apps.ts: detailWindowIdFor（纯新增）

- [ ] 新增 `export function detailWindowIdFor(cardId: string): string`。
- [ ] `desktopWindowForRoute` 的 game-card-detail 分支 id 改用此函数。
- [ ] build:web 通过。

### 2. 导入不跳转（AppMarketView + GameCardLibraryView）

- [ ] `AppMarketView.handlePackageSelected`：删 `router.push`，补 `toast.success`，补 toast import；清理无用 `useRouter`（若不再用）。
- [ ] `GameCardLibraryView.handlePackageSelected`：删 `openCard(imported.id)`。
- [ ] build:web 通过。

### 3. 卡片快捷复制/加载（GameCardLibraryView.vue）

- [ ] 卡片 `<button>` 改 `<div role="button" tabindex="0">`，补 `@keyup.enter` / `@keydown.space.prevent`。
- [ ] 封面预览右上角加快捷按钮区（复制/加载），`@click.stop`，hover/focus 可见。
- [ ] `quickCopy(card)`：`copyPlatformGameCardAsLocal` + `${原标题} 副本` + toast，`copyingId` 防重入。
- [ ] `quickLoad(card)`：复用 `loadSelectedCard` + toast。
- [ ] import `copyPlatformGameCardAsLocal` + `Copy` icon。
- [ ] build:web 通过。

### 4. 属性统一手动保存（GameCardDetailView.vue）

- [ ] 封面 draft 化：`CoverDraft` 类型 + `coverDraft` ref，上传/URL/移除只设 draft。
- [ ] `coverUrl` computed 优先读 draft，fallback 已保存 cover。
- [ ] 切换 draft revoke 旧 upload previewUrl；unmount revoke。
- [ ] `hasUnsavedChanges` computed。
- [ ] `saveMetadata` → `saveProperties`：合并 name/summary + cover 提交，成功 toast，清 draft。
- [ ] 保存按钮 `:disabled="!hasUnsavedChanges || saving || builtin"`。
- [ ] 删 `copyAsLocalCard` + 按钮 + 清理 import（Copy icon / copyPlatformGameCardAsLocal）。
- [ ] beforeClose：`detailWindowIdFor` + `setBeforeClose` + `onBeforeClose`（dirty 弹确认）。
- [ ] build:web 通过。

### 5. 全量验证

- [ ] `npm run build:web` 全绿。
- [ ] 手动验证（dev server）：
  - 导入卡包 → Toast，不跳详情，卡片出现在列表。
  - 改封面/名称/简介 → 未点保存不生效，点保存 Toast + 生效。
  - 无改动时保存按钮 disabled。
  - 有未保存改动关闭详情窗口 → 弹确认。
  - 卡片 hover → 复制/加载按钮可见；复制后新卡出现；加载后 loaded 标记更新。
  - 详情页无"另存为本地副本"按钮。

## Risky Files / Rollback Points

- `GameCardDetailView.vue` — 改动最大（封面 draft + beforeClose + 移除另存为）。回滚 = revert 此文件。
- `GameCardLibraryView.vue` — DOM 结构改动 + 快捷操作。回滚 = revert。
- `AppMarketView.vue` — 单行删除，低风险。
- `desktop-apps.ts` — 纯新增 helper + 一处复用，低风险。

## Review Gates

- 步骤 1 完成后 build:web（helper 独立可验）。
- 步骤 2 完成后 build:web（导入跳转独立可验）。
- 步骤 3 完成后 build:web（卡片快捷操作）。
- 步骤 4 完成后 build:web（属性保存核心）。
- 步骤 5 全量 + 手动验证后才能报告完成。
