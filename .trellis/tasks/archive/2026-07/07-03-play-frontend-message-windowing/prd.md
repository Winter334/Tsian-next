# 游戏前端长历史消息窗口化渲染优化

## Goal

降低游戏前端长时间游玩后的消息渲染性能风险：完整玩家历史仍可回看、可恢复，但核心游玩界面默认不再把全部历史消息长期挂在 DOM 中。

## Background / Confirmed Facts

- 当前游戏前端消息流在 `apps/play-frontend-dev/src/composables/useTsian.ts:38` 以扁平 `StreamItem[]` 建模，`stream` 跨轮累积且不清空。
- `reloadHistory()` 在 `apps/play-frontend-dev/src/composables/useTsian.ts:338` 调 `tsian.history.get()`，将完整 `SessionHistoryEntry[]` 展平成完整 `stream.value`。
- `StoryView` 在 `apps/play-frontend-dev/src/components/story/StoryView.vue:137` 通过 `mergedStream` computed 扫描完整 `stream.value`，聚合过程节点、工具组和 checkpoint。
- `StoryView` 模板在 `apps/play-frontend-dev/src/components/story/StoryView.vue:243` 对 `mergedStream` 全量 `v-for` 渲染，当前不是虚拟列表或窗口化渲染。
- `packages/play-bridge/src/session-history.ts:22` 的 `createSessionHistory()` 当前一次 RPC 返回完整会话历史；本任务 MVP 优先不改 SDK/host 协议。
- 项目方向要求玩家视角保留完整历史（正文、过程节点、工具调用、选项），不能为了性能删除或压缩玩家可见历史；见 `docs/active/storage-render-refactor-plan.md:8`。
- 现有 play frontend 视觉语言是 `apps/play-frontend-dev/src/lib/tokens.css:3` 所述“烛火书卷·重铸”：暗色底、ember 细线、低饱和文字、mono 小标签、微弱辉光。

## Product Decisions

- D1. 本任务采用“渐进展开”MVP：初始只渲染最近 N 轮；向上滚动自动追加更早 turn；不在首版实现严格上下双向裁剪/动态高度虚拟化。
- D2. 回看更早历史采用滚到顶部附近自动加载，不使用显式“加载更多”主按钮。
- D3. 提供“回到最近内容”低调浮标：仅在用户离开底部时出现，悬浮在正文列右下、Composer 上方，小圆/符印按钮，ember 细线与微光，点击平滑回到底部。
- D4. 顶部自动加载状态只显示低调“翻阅更早记忆…”提示，避免破坏叙事沉浸感。
- D5. UI/UX 改动必须贴合现有游戏前端风格；后续若出现新的可见控件设计分歧，先与用户讨论再执行。

## Requirements

- R1. 游戏前端应保留完整历史数据来源和回看能力，不删除、压缩或隐藏玩家历史事实。
- R2. 核心游玩界面应按 turn 做渐进窗口渲染：默认只渲染最近一段历史，而不是完整 `stream` 对应的所有 DOM。
- R3. 玩家向上回看时应能自动加载更早 turn，且不破坏当前剧情顺序、过程节点聚合、checkpoint 标记和开局叙事显示。
- R4. 流式输出期间，新用户消息、过程节点、实时叙事、选项和 TurnMeta 应继续出现在底部，并沿用现有自动滚动语义。
- R5. 检查点恢复后，历史窗口应基于恢复后的 turn 文件重建，不能保留被恢复操作抹除的未来轮次或旧选项。
- R6. 本阶段优先控制前端 DOM 和 `StoryView` 聚合渲染成本；不要求首版同时改造 `tsian.history.get()` 为分页/范围 API。
- R7. 实现应贴合现有 Vue/composable 风格，避免引入不必要的大型虚拟滚动依赖。
- R8. 新增可见 UI（顶部加载提示、回到最近内容浮标）必须使用现有 token 与烛火书卷/暗色叙事视觉语言。

## Acceptance Criteria

- [ ] AC1. 长历史会话首次进入 StoryView 时，DOM 只包含最近窗口内的历史消息/过程组/checkpoint，而不是全部历史 turn。
- [ ] AC2. 玩家向上滚动到顶部附近时可以自动加载更早历史；加载后顺序正确，视口不明显跳动。
- [ ] AC3. Checkpoint 标记仍对应正确 turn，点击恢复时仍能显示正确 turn 和待抹除轮数。
- [ ] AC4. 发送新消息、流式接收、停止生成、选项点击、TurnMeta 显示和底部自动滚动行为保持可用。
- [ ] AC5. 执行 checkpoint restore 后，窗口和选项从恢复后的历史重新计算，不展示恢复点之后的旧消息。
- [ ] AC6. 开局叙事仍在正式 turn 历史前显示；当只显示最近窗口时，不把开局叙事错误显示在最近历史顶部；空状态逻辑仍正确。
- [ ] AC7. 本任务不修改 `@tsian/contracts` 或 bridge API；如实施时发现必须改 API，应回到规划更新设计。
- [ ] AC8. “回到最近内容”低调浮标只在用户离开底部时出现，点击后平滑滚回最近内容，并与现有烛火书卷/暗色叙事视觉语言一致。
- [ ] AC9. 相关前端构建/类型检查通过；若现有项目没有专用 play-frontend-dev 检查命令，则至少运行仓库已有的相关 build/typecheck 并记录结果。

## Out of Scope

- 新增 `history.getRange()` / `history.get({ limit, beforeTurn })` 等 bridge/host 分页协议。
- 真正像素级虚拟列表和动态高度缓存。
- 删除、压缩或摘要化玩家可见历史。
- 改造 master agent 上下文压缩策略。
