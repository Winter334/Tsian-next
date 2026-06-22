# 编辑器布局修复 + 简化 + UI 增强

## Goal

修复 `WorkspaceEditorView.vue` 的下边栏布局 bug,简化上边栏(移除冗余按钮和 mediaType 下拉框),增强未保存提示(Ctrl+S、星号、关闭确认)。

## Requirements

### R1 布局修复

- `main` 加高度约束(`h-full` 或等效),让 CodeMirror `height:100%` 生效,footer 固定在编辑器窗口底部,不随内容滚动。

### R2 上边栏简化

- 移除 mediaType 下拉框(整块 `<div class="grid gap-2 ...">` 含 Select)。mediaType 仍按现有逻辑从 path 推断(`inferWorkspaceMediaType`),只是不再可编辑。子2 接管存储层移除 mediaType。
- 移除"校验"按钮。保存时本会自动校验(`validateSavedFile`),无需手动按钮。
- 移除"还原"按钮和 `resetDraft` 逻辑。CodeMirror 原生 Ctrl+Z 逐字撤销已够。
- 保留"保存"按钮。

### R3 未保存星号

- 标题文件名旁,当 `hasDraftChanges` 为 true 时显示 `*`:`文件名 *`。
- 与 VS Code / Windows 记事本未保存标记一致。

### R4 Ctrl+S 保存快捷键

- window 级 keydown 监听,编辑器路由(workspace-editor)生效时拦截 Ctrl+S / Cmd+S,触发 `saveDraft`。
- 注意:这次不能用 `isEditableKeyboardTarget` 守卫——Ctrl+S 正是要在编辑器(可编辑元素)内触发。需判断当前路由是编辑器而非其他视图。

### R5 关闭时未保存提示

- 桌面 shell `useDesktopWindows` 的 `closeWindow` 加 beforeClose 钩子机制:关闭前询问窗口"是否可关闭",若返回 false 则取消关闭。
- 编辑器窗口注册 beforeClose 回调:有未保存改动时弹窗"是否保存/不保存/取消"。
  - 保存 → saveDraft 后关闭。
  - 不保存 → 直接关闭。
  - 取消 → 不关闭。
- 需要设计 beforeClose 钩子的具体形态(函数返回 boolean / Promise<boolean>,或事件机制)。设计阶段定。

## Constraints

- 改动主要在 `WorkspaceEditorView.vue` + `useDesktopWindows.ts` + `DesktopShell.vue`(或 DesktopWindow.vue)。
- 不改 `WorkspaceCodeEditor.vue`(CodeMirror 组件)。
- 不改后端、契约、存储。
- 移除 mediaType 下拉框后,相关状态(`mediaType`/`mediaTypeTouched`/`originalMediaType`/`mediaTypeOptions`/`mediaTypeLabel`/`mediaTypeChanged`)保留但不再有 UI 入口——子2 会彻底清理。此阶段 mediaType 仍按现有逻辑从 path 推断并传给保存 API。
- `npm run build:web` 通过。

## Acceptance Criteria

- [ ] 编辑器 footer 固定在窗口底部,长内容时只有编辑区滚动,footer 不动。
- [ ] 编辑器无 mediaType 下拉框、无校验按钮、无还原按钮。
- [ ] 有未保存改动时,标题文件名旁显示 `*`。
- [ ] Ctrl+S 触发保存;在编辑器外(其他视图)不误触。
- [ ] 有未保存改动时关闭编辑器窗口,弹窗提示"保存/不保存/取消";无改动时直接关闭。
- [ ] `npm run build:web` 通过。
