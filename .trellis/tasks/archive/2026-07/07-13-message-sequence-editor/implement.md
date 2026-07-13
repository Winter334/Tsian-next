# Implement：消息序列编辑 UI

## 执行顺序

### Phase 1：依赖 + 后端 handler

- [ ] 1.1 安装 `vue-draggable-plus` 依赖
- [ ] 1.2 `studio-agents.ts`：新增 `updatePlatformStudioAgentContextPaths` handler（接收完整 contextPaths 数组 + 可选 enabledModules，替换写入 agent.json）
- [ ] 1.3 `studio-agents.ts`：确认 `getPlatformStudioAgentContext` 返回的 `contextInjectionsByPosition` 可用于预览
- [ ] 1.4 验证 handler 正确写入 agent.json（手动测试或类型检查）

### Phase 2：StudioView tab 集成

- [ ] 2.1 `StudioView.vue`：sections 数组添加第 5 tab `{ id: "sequence", label: "消息序列", icon: ListIcon }`
- [ ] 2.2 `StudioView.vue`：tab 内容区渲染 `MessageSequenceEditor`，传入 agentId / contextPaths / enabledModules
- [ ] 2.3 验证 tab 切换正常，空 agent 状态处理

### Phase 3：编辑器核心组件

- [ ] 3.1 新建 `MessageSequenceEditor.vue`：从 contextPaths 数组派生 4 个 position group，渲染 4 个 PositionBucket
- [ ] 3.2 新建 `PositionBucket.vue`：标题 + 位置说明 + VueDraggable 列表 + "添加条目"按钮
- [ ] 3.3 新建 `ContextPathRow.vue`：role badge + 内容摘要 + 铅笔编辑按钮 + 删除按钮
- [ ] 3.4 拖拽逻辑：4 个 bucket 共享 `group: { name: 'contextPaths' }`，dragEnd 时 flatten 为完整数组并保存
- [ ] 3.5 即时保存：dragEnd / add / delete / edit 后调用 `updatePlatformStudioAgentContextPaths`
- [ ] 3.6 纯字符串条目处理：显示为 path 模式，编辑时转为对象形式

### Phase 4：条目编辑浮窗

- [ ] 4.1 新建 `EntryEditDialog.vue`（FloatingWindow slot 模式）：类型切换 + path/template 输入 + role/position Select
- [ ] 4.2 path 模式：路径输入 + 文件正文编辑区（WorkspaceCodeEditor 或 textarea）
- [ ] 4.3 template 模式：多行文本输入
- [ ] 4.4 保存逻辑：配置变更走 updatePlatformStudioAgentContextPaths；文件正文变更走 workspace_write
- [ ] 4.5 新建 `ModuleSwitchList.vue`：当 template 含 `{{file:modules/*.md?enabled}}` 时显示模块开关列表

### Phase 5：预览面板

- [ ] 5.1 新建 `SequencePreview.vue`：可折叠面板，按骨架顺序展示消息序列
- [ ] 5.2 固定层占位条（system prompt / history / turn-runtime / player input / 前端注入）
- [ ] 5.3 contextPaths 注入：role badge + source + 宏展开内容（调用 expandMacros）
- [ ] 5.4 预览数据来源：getPlatformStudioAgentContext → contextInjectionsByPosition

### Phase 6：验证

- [ ] 6.1 `npm run build:web` 通过
- [ ] 6.2 StudioView tab 切换正常
- [ ] 6.3 拖拽排序 + 跨 bucket 移动正常
- [ ] 6.4 条目添加/编辑/删除正常
- [ ] 6.5 模块开关切换正常
- [ ] 6.6 预览面板展示骨架顺序 + 宏展开内容
- [ ] 6.7 即时保存后 agent.json 正确更新
- [ ] 6.8 纯字符串条目正确显示和编辑

## 验证命令

```bash
cd F:/workspace/Tsian && npm run build:web
```

## 风险文件

| 文件 | 风险 | 回滚点 |
|---|---|---|
| StudioView.vue | tab 集成可能影响现有 4 tab | 新增 tab 是纯增量，不影响现有 tab |
| studio-agents.ts | 新 handler 写入逻辑可能出错 | 遵循现有 update handler 模式 |
| vue-draggable-plus | 新依赖可能与现有 Vue 版本不兼容 | 检查 peer dependency，必要时回退到 up/down 按钮 |
