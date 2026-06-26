# Design — 拆分 views/AssistantView.vue

> 评估 + 部分执行。纯函数提取已完成；composable 拆分评估为超出本轮"纯结构重构"边界，留独立任务。

## 1. 已完成：Seam 1 — 纯函数提取

提取 4 个纯类型转换函数到 `assistant-message-mappers.ts`（147 行）：
- `agentCallDisplay` — agent_call 工具卡片可读内容提取
- `mapStoredMessagesToChat` — ConversationMessageRecord[] → ChatMessage[]
- `tryParseAgentCallOutput` — agent_call observation JSON 解析
- `chatToStoredMessages` — ChatMessage[] → ConversationMessageRecord[]（反向）

这些函数无 Vue reactivity 依赖，纯类型转换，提取风险最低。AssistantView 1801 → 1766 行。

## 2. 评估未做：composable 拆分

### composable 候选（已识别）
- `useAssistantSessions` — session CRUD（sessions/activeSessionId/refresh/handleSelect/handleCreate/handleRename/handleDelete）
- `useAssistantAttachments` — 附件管理（pendingAttachments/dragOver/addFile/handlePaste/handleDrop/handleFilePick）
- `useAssistantScroll` — scroll 行为（showJumpToBottom/userPinnedToBottom/handleScroll/scrollToBottom/restoreScrollTop）
- `useAssistantModelConfig` — provider/model 配置（providerPresets/modelId/loadProviderPreset/handlePresetChange/handleModelChange）
- `useAssistantRecovery` — 恢复点（recoverKey/write/read/clear/onBeforeUnload/onVisibilityChange）

### 为什么本轮不做
composable 提取需要把 `ref`/`reactive`/`computed`/`watch` 状态与相关函数一起搬走，涉及 **Vue reactivity 依赖重组**。这不再是"纯抽取内容逐字节不变"——computed/watch 的响应式追踪是**运行时行为**，build（vue-tsc 类型检查）检测不到 reactivity 断裂。

具体风险：
- ref 从 composable 返回后在模板中的响应式追踪是否保持
- watch 的触发源跨 composable 边界后是否仍正确
- onMounted/onBeforeUnmount 的生命周期钩子跨 composable 后执行顺序

这些需要运行时浏览器验证才能确认，不符合本轮"build green + 内容不变 = 行为不变"的轻量验收标准。

### 结论
composable 拆分作为独立任务，在有充分运行时验证条件下推进。本轮 #6 完成纯函数提取（零风险、build green）即收手。
