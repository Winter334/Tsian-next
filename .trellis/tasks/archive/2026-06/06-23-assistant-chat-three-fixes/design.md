# Design: 桌面助手三个 Bug 修复

## 架构边界

三个修复都在 `apps/platform-web` 前端层，不触碰 agent-runtime / runtime-host /
contracts / 游戏前端。涉及文件：

- `apps/platform-web/src/views/AssistantView.vue` — R1 滚动保存/恢复、R3 上下文环持久化
- `apps/platform-web/src/composables/useAssistantTimeline.ts` — R2 过渡文本保留
- `apps/platform-web/src/storage/assistant-conversations.ts` — R3 contextUsed 持久化字段
- `apps/platform-web/src/style.css` — R1 窄屏 display:none 不再重置（配合 JS 恢复）

## R1: 焦点切换保持滚动位置

### 根因（实测确认）

浏览器对非活动/不可见滚动容器异步重置 `scrollTop` 为 0。两条路径：
- 宽屏：助手失焦被遮挡 → 空闲时异步重置（延迟 > 640ms，被持续测量推迟）
- 窄屏：`display:none` → 切回 `display:grid` 重置

复位是延迟异步的，且任何持续读 scrollTop 的定时器都会推迟它——**不能依赖在
复位前捕获**。必须在获焦时恢复。

### 方案：会话级 scrollTop 持久化 + 多帧防御性恢复

AssistantView 已有 `handleScroll` 监听 `messageListRef` 的 scroll 事件（用于
`userPinnedToBottom`/`showJumpToBottom`）。扩展它：scroll 时用 rAF 节流把
`scrollTop` 写入会话存储（`assistant-scroll-top:{id}`，与 R3 contextUsed 同模式
的独立 meta key）。

恢复时机：路由变化反映焦点切换（`focusWindow → navigateTo(routePath)`）。
AssistantView `watch(route.path)`：进入 `/assistant` 路由（从非助手路由切来）时，
从存储读取该会话的 scrollTop 目标值，用**多帧防御性恢复**写回。

多帧防御性恢复（对抗浏览器异步重置的不确定时机）：连续最多 10 帧 rAF 检查——
若 `scrollTop` 被重置为 0 且内容可滚动且目标 > 0，则补回目标值，下一帧再验（可能
再被重置则再补）；若已稳定在目标值则停止；帧数耗尽也停止（兜底）。

用户主动滚到顶部时，handleScroll 已把 0 写入存储，`loadScrollTop` 返回 0，
`target === 0` 时不进入恢复循环，不会误恢复。

获焦信号用路由 watch（`focusWindow → navigateTo(focused.routePath)`，路由是 active
窗口的权威信号），无需改 useDesktopWindows 的 module 级状态。`handleSelectSession`
切会话不改路由（路由仍是 /assistant），不触发路由 watch，其 `scrollToBottom` 行为
不变（切会话看最新回复）；焦点切换恢复只走路由 watch，分工清晰。

### 边界

- `loadActiveSession` 末尾的 `scrollToBottom()` 保持不变（首次加载滚到底）。
- 流式 `maybeScrollToBottom` 期间用户在底部时正常滚到底，不影响。
- scrollTop 持久化随会话（独立 meta key），刷新后 loadActiveSession 走 scrollToBottom
  滚到底（首次加载看最新），焦点切走再切回走路由 watch 恢复。
- rAF 节流写存储：每帧最多一次，高频 scroll 不写库；遗漏最后一次写入无害（下次
  scroll 再同步）。
- `onBeforeUnmount` 取消恢复 rAF 链，防泄漏。
- `deleteAssistantSession` 连带清理 scrollTop key（防孤儿，同 contextUsed/附件）。

## R2: 工具调用轮过渡文本保留显示

### 根因

`useAssistantTimeline.ts:62-69` `onRoundEnd` 在 `finishReason === "tool_calls"`
时丢弃 `streamingText`（注释称"噪声"）。该文本是模型工具调用前的有意义过渡说明，
流式期用户已见，轮结束被清空即消失。

### 方案：新增 `interim` 时间线节点

`AssistantTimelineNode` 新增第三类：
```ts
| { type: "interim"; id: string; round: number; text: string; collapsed: boolean }
```
`collapsed` 固定 `false`（始终展开可见，符合"当正常回复"）。

`onRoundEnd` 的 `tool_calls` 分支：若 `streamingText` 非空，push 一个 `interim`
节点（保留文本），再处理 reasoning→thought。不再丢弃 streamingText。

`AssistantView` 模板在 `v-for="node in msg.timeline"` 增加 `interim` 分支：
用与最终回复一致的 `prose-chat` 正文样式渲染（`v-html="renderMarkdown(node.text)"`），
无折叠触发器、无竖线/淡背景（区别于 thought/tool 的过程元信息样式），平铺在该轮
工具节点之前（timeline 按发生顺序，interim 在 tool 之前 push）。

### 边界

- `interim` 节点不持久化（同 thought/tool，刷新后消失，只留 content 最终回复）。
- `finalize()` 把 interim 的 collapsed 置 true 会让它折叠——但 interim 应始终可见，
  故 `finalize` 只折叠 thought/tool，不动 interim。
- `flushStreaming`（中止/切会话落盘）已有 streamingText→content 逻辑；tool_calls
  轮中止时也应把 streamingText 落为 interim 节点（保持一致），避免中止时过渡文本
  丢失。
- 不改 runtime `ai.ts:1589` tool_calls 轮 `result.text=""`（流式已推送，reconcile
  用 stop 轮 text，不影响）。
- 游戏前端侧不动（`turn-round-end` kind 已能区分，渲染由游戏前端决定）。

## R3: 上下文窗口用量跨会话保持

### 根因

`contextUsed`（`AssistantView.vue:620`）注释明说不持久化。`loadActiveSession`
只恢复 `contextTotal`，从不恢复 `contextUsed`，故重载归零。

### 方案：按会话持久化 contextUsed

`assistant-conversations.ts` 的会话存储目前是 `messagesKey(id)` 存消息 JSON。
contextUsed 是单值，随会话走。两个子方案：
- **方案 A（推荐）：复用 meta 表独立 key**。新增 `assistant-context-used:{id}`
  存单个数字。`saveContextUsed(id, value)` / `loadContextUsed(id)`。改动小、
  不破坏现有消息存储结构、不混入 messages JSON。
- 方案 B：扩展 `AssistantSessionSummary` 加 `contextUsed` 字段。会污染 summary
  列表语义（summary 是列表元数据），且每次更新 contextUsed 要重写整个列表。不采用。

采用方案 A。AssistantView：
- `send()` 成功后更新 `contextUsed.value` 时，同时 `saveContextUsed(sessionId, value)`
  （已有 sessionId）。
- `loadActiveSession()` 末尾 `loadContextUsed(session.id)` 恢复 `contextUsed.value`。
- `handleSelectSession` 切会话后也 `loadContextUsed(id)` 恢复。
- `handleCreateSession` 新会话 contextUsed 归 0。
- `handleDeleteSessionById` 连带清理该 key（防孤儿，同附件清理）。

### 边界

- 仅持久化最后一次值（轻量，不需逐轮历史）。
- text 模式无 usage（undefined）时不写（环保持上次值或 0，与现状一致）。
- contextTotal 不持久化（来自当前模型 contextWindow，切模型时更新，刷新后由
  loadProviderPreset 恢复，行为不变）。

## 兼容性与迁移

- R2 `interim` 节点是新增类型，旧持久化消息无 timeline（刷新后只有 content），
  无需迁移。
- R3 新增独立 meta key，旧会话无该 key 时 `loadContextUsed` 返回 0（与现状一致），
  无需迁移。
- R1 纯运行时行为，无存储变更。

## 风险与回滚

- R1 恢复启发式（scrollTop===0 且可滚动且 last>0）可能在极端情况误恢复：用户
  真的滚到顶部后切走再切回。但用户主动滚到顶时 scroll 事件会把 lastScrollTop
  更新为 0，切回时不满足 last>0 条件，不会误恢复。风险低。
- R2 interim 节点始终展开可能让长过渡文本占据视觉空间。但这是用户明确要求的
  "当正常回复"语义。可接受。
- R3 每轮多一次 meta 写（轻量单值），性能可忽略。
- 三处改动独立，可分别回滚。
