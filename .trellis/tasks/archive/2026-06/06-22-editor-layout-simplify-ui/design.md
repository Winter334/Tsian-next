# Design — 编辑器布局修复 + 简化 + UI 增强

## 范围

- `apps/platform-web/src/views/WorkspaceEditorView.vue`(主改动)
- `apps/platform-web/src/composables/useDesktopWindows.ts`(加 beforeClose 钩子)
- `apps/platform-web/src/components/desktop/DesktopShell.vue`(关闭流程接入 beforeClose)
- 可能涉及 `apps/platform-web/src/components/desktop/DesktopWindow.vue`(关闭按钮事件)

不改 `WorkspaceCodeEditor.vue`、后端、契约、存储。

## 关键设计决策

### D1 布局修复

当前:
```html
<main class="min-h-0 bg-[#101411]">  <!-- 缺高度约束 -->
  <WorkspaceCodeEditor ... />  <!-- CodeMirror height:100% 失效 -->
</main>
```

修复:`main` 加 `overflow-hidden` + 让 CodeMirror 撑满。实际最小改动是给 `main` 加 `class="min-h-0 overflow-hidden"` 并确保 grid 行 `minmax(0,1fr)` 把高度传下来。验证:`desktop-window-content` 有 `min-height:0` + `overflow:hidden`,grid 行 `minmax(0,1fr)` 会给 `main` 一个确定高度,CodeMirror `height:100%` 就能解析。

如果加 `overflow-hidden` 仍不够(某些 flex/grid 嵌套场景 height 传递断链),fallback 是给 `main` 显式 `style="height: 100%"` 或用 `flex` 替代 grid。实现时先试 `overflow-hidden`,build 后手动验证 footer 是否固定。

### D2 上边栏简化

移除三块:
1. mediaType 下拉框整块 `<div class="grid gap-2 border-b ...">...</div>`(L43-64)。
2. "校验"按钮(L13-21)。
3. "还原"按钮(L22-30)。

保留"保存"按钮。

移除下拉框后,grid 行从 `auto_auto_minmax(0,1fr)_auto` 变成 `auto_minmax(0,1fr)_auto`(少一行)。

相关状态保留但无 UI 入口(子2 清理):
- `mediaType`/`mediaTypeTouched`/`originalMediaType` ref 保留,`watch(draftPath)` 仍按 path 推断 mediaType,保存时仍传 mediaType。
- `mediaTypeOptions`/`mediaTypeLabel` computed 保留(footer 仍显示类型标签)。
- `resetDraft` 函数删除(无"还原"按钮)。
- `validateDraft` 函数保留(保存流程内部调用),只是不再有按钮直接触发。

### D3 未保存星号

```html
<h1 class="mt-1 truncate text-sm font-bold text-text-main">
  {{ draftPath || "untitled.txt" }}<span v-if="hasDraftChanges" class="text-neon">*</span>
</h1>
```

`hasDraftChanges` 已存在 computed(create 模式或 content/mediaType 变化)。

### D4 Ctrl+S 保存

window 级 keydown 监听。不能用 `isEditableKeyboardTarget` 守卫(Ctrl+S 正是要在编辑器内触发)。用路由判断:

```ts
function onGlobalKeydown(event: KeyboardEvent) {
  const ctrl = event.ctrlKey || event.metaKey
  if (ctrl && (event.key === "s" || event.key === "S")) {
    if (route.name !== "workspace-editor") return  // 只在编辑器路由拦截
    event.preventDefault()
    void saveDraft()
  }
}

onMounted(() => window.addEventListener("keydown", onGlobalKeydown))
onBeforeUnmount(() => window.removeEventListener("keydown", onGlobalKeydown))
```

CodeMirror 默认不绑定 Ctrl+S,所以不会冲突。`event.preventDefault()` 阻止浏览器"保存网页"对话框。

### D5 关闭时未保存提示(beforeClose 钩子)

**钩子形态**:`DesktopWindowState` 加可选 `beforeClose?: () => Promise<boolean>`。`closeWindow` 调用它,返回 false 则取消关闭。

```ts
// useDesktopWindows.ts
async function closeWindow(id: string) {
  const target = windows.value.find((w) => w.id === id)
  if (target?.beforeClose) {
    const ok = await target.beforeClose()
    if (!ok) return  // 取消关闭
  }
  // 原关闭逻辑
  const wasActive = activeWindowId.value === id
  windows.value = windows.value.filter((w) => w.id !== id)
  if (wasActive) activeWindowId.value = topVisibleWindow()?.id ?? ""
}
```

`closeWindow` 从同步变 async。`DesktopShell.vue` 的 `@close="closeWindow"` 改为 `@close="(id) => void closeWindow(id)"`。

**编辑器注册 beforeClose**:

编辑器是路由视图,不是直接组件 props。beforeClose 需要由编辑器视图在挂载时注册到当前窗口状态。问题:编辑器视图怎么拿到自己的 windowId?

方案:`useDesktopWindows` 提供 `registerBeforeClose(windowId, callback)` 方法。编辑器 `onMounted` 时通过路由参数或 desktop app 配置找到自己的 windowId,注册回调。

更简洁的方案:编辑器不直接注册,而是 `closeWindow` 检查目标窗口的 routeName,若为 `workspace-editor` 则调用一个全局的"编辑器未保存检查"函数。但这会硬耦合编辑器到 desktop shell。

**推荐方案:通过 props 传入 beforeClose**。

看 `desktop-apps.ts` 怎么注册编辑器窗口:编辑器是 `workspace-editor` 路由,由资源管理器 `openEditorRoute` 通过 `router.push` 打开,不是 `openWindow`。需要确认编辑器窗口是怎么创建的——它可能是路由驱动的窗口,props 由路由 query 填充。

如果编辑器窗口 props 是静态的(路由 query 填充),beforeClose 不能通过 props 传(它是动态回调)。需要一个运行时注册机制。

**最终方案:运行时注册 Map**。

`useDesktopWindows` 维护一个 `beforeCloseHandlers: Map<string, () => Promise<boolean>>`。提供 `setBeforeClose(windowId, handler)` / `clearBeforeClose(windowId)`。编辑器 `onMounted` 时 `setBeforeClose(myWindowId, handler)`,`onBeforeUnmount` 时 `clearBeforeClose`。

编辑器怎么知道自己的 windowId?通过 `useRoute` 的 query 或 desktop window 的 id 规律(若 windowId 含 routeName)。需要看 `openWindow` 怎么生成 id。

实现时确认 id 生成规则,设计阶段已确认方向:运行时 Map + 编辑器 onMounted 注册。这是最小侵入的方案——desktop shell 只加一个可选 Map,编辑器主动注册,不硬耦合。

## 数据流

```
Ctrl+S
  → window keydown
  → route.name === "workspace-editor"?
  → preventDefault + saveDraft()

关闭编辑器窗口(DesktopShell close 按钮)
  → closeWindow(id)
  → beforeCloseHandlers.get(id)?
  → 编辑器 handler: hasDraftChanges?
    → 是 → 弹窗 confirm("保存/不保存/取消")
      → 保存 → saveDraft → return true
      → 不保存 → return true
      → 取消 → return false
    → 否 → return true
  → true → 继续关闭;false → 取消
```

## 边界

- beforeClose handler 在编辑器卸载后不应残留:`onBeforeUnmount` 清理。
- `closeWindow` 变 async 后,`DesktopShell` 调用处改为 fire-and-forget(`void closeWindow(id)`)。
- Ctrl+S 在编辑器加载中/保存中时 `saveDraft` 本身有 `loading || saving` 守卫,不会重复保存。
- 星号在 create 模式(新文件未保存)也显示,符合预期。
