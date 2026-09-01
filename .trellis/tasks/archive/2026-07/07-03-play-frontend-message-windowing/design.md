# Design: 游戏前端长历史消息窗口化渲染优化

## Overview

本任务采用“渐进展开”窗口化：完整会话历史仍由 `tsian.history.get()` 一次性加载到前端内存，但 StoryView 初始只渲染最近一段 turn。用户向上滚动到顶部附近时，自动把更早 turn 追加进可见窗口；用户点击“回到最近内容”低调浮标时，窗口重置为最近内容并滚到底部。

这不是严格虚拟列表，也不改 bridge/host 协议。目标是先降低长期游玩默认路径下的 DOM 数量和 `mergedStream` 聚合成本，同时保留完整历史和回看体验。

## Scope And Boundaries

- 修改范围优先限制在 `apps/play-frontend-dev/src/components/story/StoryView.vue`。
- 如需暴露现有 pinned-to-bottom 状态，可复用 `useTurnState()` 已返回的 `userPinnedToBottom`，避免新增全局状态。
- 不修改 `@tsian/contracts`、`@tsian/play-bridge`、`apps/platform-web` host 查询协议。
- 不引入大型虚拟滚动依赖。

## Data Flow

### Existing flow

1. `useTsian.reloadHistory()` 调 `tsian.history.get()`。
2. 完整 `SessionHistoryEntry.timeline[]` 被展平成完整 `stream.value`。
3. `StoryView.mergedStream` 扫描完整 `stream.value`。
4. 模板全量 `v-for` 渲染 `mergedStream`。

### New flow

1. `useTsian` 仍保留完整 `stream.value`，保持现有发送、停止、恢复和选项逻辑稳定。
2. `StoryView` 新增 view-local turn 窗口状态：
   - `INITIAL_VISIBLE_TURNS = 40`
   - `LOAD_OLDER_TURNS = 20`
   - `TOP_LOAD_THRESHOLD = 120`
   - `visibleStartTurn`：当前可见窗口的最早 turn。
3. `visibleStream` 从完整 `stream.value` 切出 `visibleStartTurn` 之后的片段。
4. `mergedStream` 只聚合 `visibleStream`，并以 `visibleStartTurn - 1` 作为 turn 计数初始值，保证 checkpoint 仍能对应正确 turn。
5. `visibleStartTurn <= 1` 时才渲染开局叙事和 turn 0 checkpoint；否则初始最近窗口不会在顶部错误显示开局叙事。

## Turn Window Semantics

- 首次加载历史、checkpoint restore 后，窗口重置为最近 `INITIAL_VISIBLE_TURNS` 个已完成 turn。
- 用户滚动到顶部附近且 `visibleStartTurn > 1` 时：
  - 将 `visibleStartTurn` 向前扩展 `LOAD_OLDER_TURNS`。
  - 在 DOM 更新后用 `scrollHeight` 差值补偿 `scrollTop`，避免视口跳动。
- 用户点击“回到最近内容”：
  - `visibleStartTurn` 重置为最近窗口起点。
  - 平滑滚动到底部。
- 当用户处于底部并产生新 turn 时，可把 `visibleStartTurn` 推进到最新最近窗口，避免连续长时间游玩又累积过多 DOM。
- 当用户上滚阅读历史时，不主动裁剪已展开内容，避免打断回看。

## UI / UX

视觉方向遵循 `tokens.css` 的“烛火书卷·重铸”：暗色底、ember 细线、低饱和文字、mono 小标签、微弱辉光。

### 顶部自动加载状态

- 在可见窗口顶部放一行低调状态。
- 正在扩展历史时显示“翻阅更早记忆…”。
- 样式参考 `CheckpointMark.vue` 的 ember 渐隐线，但更弱，不做强 CTA。

### 回到最近内容浮标

- 仅在 `!userPinnedToBottom` 时显示。
- 位置：正文列右下、Composer 上方，不占据消息流布局。
- 形态：小圆/符印按钮，ember 细线、暗底、微光，包含向下箭头或“最近”短标签。
- 点击后平滑回到底部并重置窗口到最近内容。

## Compatibility Notes

- `lastUserMsgId`、`currentTokens` 可以继续基于完整 `stream.value` 计算，因为它们是轻量反向查找且要表达全局最后一条消息。
- `turnOptions` 仍由 `useTsian` 从最后一轮 options 恢复；窗口化不改变选项数据源。
- `checkpointByTurn` 仍从完整 checkpoint 列表建立 map；渲染时只在可见 turn 位置插入对应 checkpoint。
- 开局叙事只在空历史或最早 turn 已可见时展示，避免最近窗口顶部出现“开局 → 第 N 回”的错误连续感。

## Trade-offs

- 本方案显著减少默认 DOM，但首次 `history.get()` 仍全量加载，内存中仍保留完整 `stream`。
- 如果玩家一直向上翻到开头，DOM 会逐步接近全量；点击回到底部或处于底部产生新 turn 时会回收为最近窗口。
- 真正的数据分页和动态高度虚拟化留给后续任务，避免首版过度复杂。

## Rollback Shape

若窗口化导致滚动或 checkpoint 行为异常，可回退 StoryView 中的 view-local window 逻辑，让模板重新使用完整 `mergedStream`。由于不改数据存储、contracts 或 bridge，回滚风险较低。
