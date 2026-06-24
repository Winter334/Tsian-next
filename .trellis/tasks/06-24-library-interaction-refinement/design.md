# Design: 我的应用交互收敛

## Architecture & Boundaries

四个文件改动：

1. **`desktop-apps.ts`** — 新增 `detailWindowIdFor(cardId)` helper（与 `editorWindowIdFor` 对称）
2. **`AppMarketView.vue`** — 导入不跳转（删 1 行 + 补 toast）
3. **`GameCardLibraryView.vue`** — 导入不跳转 + 卡片快捷复制/加载按钮
4. **`GameCardDetailView.vue`** — 封面 draft 化 + 统一保存 + beforeClose + 移除另存为

## 1. 导入不跳转

### AppMarketView.vue

`handlePackageSelected` 成功后删 `router.push(...)`，改为 toast `已导入：{卡名}`。保留页内 `feedback`。补 `import { toast }`。`useRouter` 若不再用则清理。

### GameCardLibraryView.vue

`handlePackageSelected` 成功后删 `openCard(imported.id)`（已有 toast + 事件刷新列表）。

## 2. desktop-apps.ts: detailWindowIdFor

详情窗口 id 当前在 `desktopWindowForRoute` 内硬编码为 `${gameLauncherDefinition.appId}:${cardId}`（即 `game-launcher:${cardId}`）。抽成导出函数，与 `editorWindowIdFor` 对称，供详情页注册 beforeClose 复用：

```ts
export function detailWindowIdFor(cardId: string): string {
  return `${gameLauncherDefinition.appId}:${cardId}`
}
```

`desktopWindowForRoute` 的 game-card-detail 分支改用此函数，保证单一构造点。

## 3. 卡片快捷复制/加载（GameCardLibraryView.vue）

### DOM 改造

卡片当前是 `<button>`（line 70-115），嵌套 button 非法。改为 `<div role="button" tabindex="0">`，保留 `@click` / `@focus` / `@mouseenter` / `@contextmenu`。键盘可达：`tabindex=0` + `@keyup.enter="openCard(card.id)"` + `@keydown.space.prevent="openCard(card.id)"`。`retro-focus` 保留。

快捷按钮区放封面预览右上角，hover/focus 时可见，`@click.stop` 阻止冒泡。`loaded` 标记在左上角，不冲突。

### 快捷复制

`copyPlatformGameCardAsLocal(card.id, { name: \`${原标题} 副本\`, summary })` → toast + 事件刷新。新增 `copyingId` ref 防重入。import `copyPlatformGameCardAsLocal` + `Copy` icon。

### 快捷加载

复用 `loadSelectedCard`（已有 `setPlatformActiveGameCard` + `feedback`），快捷路径额外 `toast.success`。`canLoadCard` 已判断"非当前卡 + 非加载中"。

## 4. 属性统一手动保存（GameCardDetailView.vue）

### 封面 draft 化

```ts
type CoverDraft =
  | { kind: "none" }
  | { kind: "upload"; file: File; previewUrl: string }
  | { kind: "url"; url: string }
  | { kind: "clear" }
const coverDraft = ref<CoverDraft>({ kind: "none" })
```

- 上传/URL/移除操作只设 draft + 本地预览，不立即写库。
- `coverUrl` computed 优先读 draft，fallback 已保存 cover。
- 切换 draft 前若旧 draft 是 upload，`URL.revokeObjectURL` 旧 previewUrl。
- 提交时按 draft.kind 调 `setPlatformGameCardCover` 对应分支。

### dirty + 保存按钮

`hasUnsavedChanges` computed：name/summary/coverDraft 任一有改动为 true。按钮 `:disabled="!hasUnsavedChanges || saving || builtin"`，文案"保存属性"。`saveMetadata` 扩展为 `saveProperties`：先 metadata 后 cover，成功 `toast.success("已保存属性")`，清 draft（revoke）。

### 移除另存为本地副本

删 `copyAsLocalCard` + 按钮。清理 `Copy` icon / `copyPlatformGameCardAsLocal` import（若不再用）。

### beforeClose

```ts
import { clearBeforeClose, setBeforeClose } from "@/composables/useDesktopWindows"
import { detailWindowIdFor } from "../desktop-apps"

let registeredWindowId = ""
onMounted(() => {
  registeredWindowId = detailWindowIdFor(props.cardId)
  setBeforeClose(registeredWindowId, onBeforeClose)
})
onBeforeUnmount(() => {
  clearBeforeClose(registeredWindowId)
  if (coverDraft.value.kind === "upload") URL.revokeObjectURL(coverDraft.value.previewUrl)
})

async function onBeforeClose(): Promise<boolean> {
  if (!hasUnsavedChanges.value) return true
  return confirm({ message: "有未保存的改动，放弃并关闭？", severity: "danger", confirmText: "放弃" })
}
```

## 5. 兼容性 & 回滚

- 无数据迁移：封面 draft 纯前端暂存，提交走原 API。
- 事件机制不变。
- 回滚点：四文件相互独立。导入跳转删除单行最低风险；`detailWindowIdFor` 纯新增。
- 风险点：封面 draft objectURL 泄漏（切换/unmount/提交后 revoke）；卡片 DOM 改 div 需保键盘可达；`detailWindowIdFor` 必须与 `desktopWindowForRoute` 实际 id 一致否则 beforeClose 不生效。
