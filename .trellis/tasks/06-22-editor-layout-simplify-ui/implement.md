# Implement — 编辑器布局修复 + 简化 + UI 增强

## 前置:阅读上下文

- `prd.md` / `design.md`。
- 现有代码:`WorkspaceEditorView.vue`、`useDesktopWindows.ts`、`DesktopShell.vue`、`DesktopWindow.vue`、`desktop-apps.ts`。

## 执行清单

### 1. 布局修复

- [ ] 1.1 `WorkspaceEditorView.vue` 模板:`<main class="min-h-0 bg-[#101411]">` 加 `overflow-hidden`。
- [ ] 1.2 若 grid 行数变化(移除 mediaType 行后),更新 `<section class="grid min-h-full grid-rows-[...]">` 的行定义。
- [ ] 1.3 build 后手动验证:长内容时 footer 固定,只有编辑区滚动。若仍不固定,fallback 加 `main style="height:100%"` 或排查 grid 高度传递链。

### 2. 上边栏简化

- [ ] 2.1 移除 mediaType 下拉框整块 `<div class="grid gap-2 border-b ...">...</div>`(含 Select/SelectTrigger/SelectContent/SelectItem)。
- [ ] 2.2 移除"校验"按钮。
- [ ] 2.3 移除"还原"按钮。
- [ ] 2.4 移除 `CheckCircle2`/`RotateCcw` 图标导入(若不再用);`Save` 保留。
- [ ] 2.5 移除 `Select`/`SelectContent`/`SelectItem`/`SelectTrigger`/`SelectValue` 导入(若不再用)。
- [ ] 2.6 删除 `resetDraft` 函数。
- [ ] 2.7 `validateDraft` 保留(保存流程内部用),但不再有按钮直接触发;确认 `validateDraft` 仍被 `saveDraft` 调用。
- [ ] 2.8 `mediaType`/`mediaTypeTouched`/`originalMediaType`/`mediaTypeOptions`/`mediaTypeLabel`/`mediaTypeChanged` 保留(子2 清理),确认无 lint 报"已声明未使用"——它们仍被 footer 显示和保存逻辑用。

### 3. 未保存星号

- [ ] 3.1 标题 `<h1>` 内文件名后加 `<span v-if="hasDraftChanges" class="text-neon">*</span>`。

### 4. Ctrl+S 保存

- [ ] 4.1 新增 `onGlobalKeydown` 函数:判断 `route.name === "workspace-editor"` + Ctrl/Cmd+S → `preventDefault` + `void saveDraft()`。
- [ ] 4.2 `onMounted` 加 `window.addEventListener("keydown", onGlobalKeydown)`,`onBeforeUnmount` 移除。
- [ ] 4.3 确认 CodeMirror 默认不绑定 Ctrl+S(不冲突)。

### 5. 关闭时未保存提示(beforeClose 钩子)

- [ ] 5.1 `useDesktopWindows.ts`:新增 `beforeCloseHandlers: Map<string, () => Promise<boolean>>`。
- [ ] 5.2 新增 `setBeforeClose(id, handler)` / `clearBeforeClose(id)` 方法,导出。
- [ ] 5.3 `closeWindow` 改为 `async function`:先查 `beforeCloseHandlers.get(id)`,若存在则 `await handler()`,返回 false 则 return(取消关闭)。
- [ ] 5.4 `DesktopShell.vue`:`@close="closeWindow"` 改为 `@close="(id) => void closeWindow(id)"`(async 适配)。
- [ ] 5.5 `WorkspaceEditorView.vue`:`onMounted` 时找到自己的 windowId,`setBeforeClose(windowId, handler)`;`onBeforeUnmount` 时 `clearBeforeClose(windowId)`。
  - windowId 获取:确认 `desktop-apps.ts` / `useDesktopWindows` 的窗口 id 生成规则(可能含 routeName 或 appId)。若编辑器窗口 id 可从 `useRoute` 推断,直接用;否则需要 `useDesktopWindows` 提供按 routeName 查 windowId 的方法。
- [ ] 5.6 handler 逻辑:
  ```
  async function beforeCloseHandler(): Promise<boolean> {
    if (!hasDraftChanges.value) return true
    const choice = await confirmSave({ message: "有未保存的更改,是否保存?", ... })
    // confirmSave 需要三选一:保存/不保存/取消
    if (choice === "save") { await saveDraft(); return true }
    if (choice === "discard") return true
    return false  // cancel
  }
  ```
- [ ] 5.7 确认 `useConfirm` 的 `confirm` 是否支持三选一(保存/不保存/取消)。若不支持,扩展 `useConfirm` 加一个三选一模式,或用两个连续 confirm(先问"是否保存",取消则不关闭)。

## 验证

- [ ] `npm run build:web` 通过。
- [ ] 手动验证:
  - 长内容时 footer 固定在窗口底部,只有编辑区滚动。
  - 无 mediaType 下拉框、无校验按钮、无还原按钮。
  - 编辑内容后标题出现 `*`,保存后消失。
  - Ctrl+S 保存;在非编辑器视图按 Ctrl+S 不误触(浏览器默认保存对话框正常)。
  - 有未保存改动时关闭窗口弹"保存/不保存/取消";无改动时直接关闭。

## Review Gates

- 布局修复后先 build 验证一次,确认 footer 固定。
- beforeClose 钩子是最复杂部分,单独 build + 手动验证关闭流程。

## Rollback Points

- 单文件 `WorkspaceEditorView.vue` 改动可单独回滚。
- `useDesktopWindows.ts` 的 beforeClose 是可选机制,不影响现有窗口关闭(无 handler 时直接关闭)。
