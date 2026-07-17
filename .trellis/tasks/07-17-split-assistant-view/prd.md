# 拆分 AssistantView 巨型组件

## Goal

将 `apps/platform-web/src/views/AssistantView.vue` 拆分为 route shell、子组件与 composables，保持现有 Assistant UI 行为不变。

## Background / Evidence

- 当前文件约 2148 行 / 89.3 KiB。
- Route view 同时承载 session sidebar、message list、composer、attachment、ask dialog、scroll/focus、provider config 等交互状态。
- Vue UI 拆分风险主要来自响应式状态归属、watch 生命周期、DOM focus/scroll 行为和事件传递。

## Requirements

- R1. 拆分 route shell、session sidebar、message list/tool group、composer/attachment、ask dialog/config panel integration 等 UI 边界。
- R2. 将可复用状态逻辑移动到 composables，例如 sessions、composer、scroll、ask state，但不引入全局 store。
- R3. 保持路由、会话创建/重命名/删除、消息发送/编辑/复制、附件上传、ask 回答、滚动到底等行为不变。
- R4. 遵守现有组件目录规范；route-level shell 留在 `views`，局部子组件可放在 feature 子目录或 `components/assistant`。
- R5. 备份：实现前记录 baseline commit 并创建 `backup/split-assistant-view-pre-split` 本地备份 ref；每拆一个组件或 composable 后验证 build。

## Acceptance Criteria

- [ ] `AssistantView.vue` 降为 route shell，不再承载所有 UI 和状态细节。
- [ ] 子组件 props/emits 明确，未引入隐式全局状态。
- [ ] 主要 Assistant 交互路径保持不变。
- [ ] `npm run build:web` 通过。
- [ ] 回滚点按 UI seam 记录。

## Out of Scope

- 不 redesign Assistant UI。
- 不改变模型配置功能。
- 不改变会话/消息持久化格式。
