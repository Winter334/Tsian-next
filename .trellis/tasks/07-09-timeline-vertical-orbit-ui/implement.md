# 实施计划：剧情时间线纵向命轨美化

> 最终实现已完成。本文保留最终执行结果与验证记录；原始中间方案（SVG overlay 曲线、Header/Legend 弱化）在实现过程中因实际视觉问题调整为 DOM/CSS 命轨树。

## Final Implementation Summary

- [x] `TimelineView.vue`
  - 不再渲染 `TimelineHeader` / `TimelineLegend`，减少上下空白与说明噪音。
  - 每次挂载主动调用 `refreshFrontier()`，避免显示旧 frontier 缓存。
  - 作为滚动 root 传给 `TimelineGraph`。
  - 最终全屏微调：滚动容器参与满高布局，避免短时间线在大屏中垂直挤成一团。

- [x] `TimelineGraph.vue`
  - 改为正常文档流 + CSS grid 的命轨树。
  - source 节点构成中轴主干，卡片在右侧显示 label / chapter title / time。
  - player 节点按 branch role（start/mid/end）在侧枝上显示。
  - 分支方向按段交替：分支结束（rejoined）后下一段换边。
  - 当前 source 用节点呼吸和卡片光效表示，不写额外“当前”文本。
  - alignment 的 row class 与 dot class 分离，避免背景样式污染整行产生光带。
  - 支持 source-only 紧凑布局，避免没有 player 时预留大块分支空白。
  - 最终全屏微调：tree/body 填满可用高度，短列表用 `space-evenly` 纵向分布，让命轨向上下两端延展。

- [x] `parse-frontier.ts`
  - 修复 `isFrontierLike` 类型守卫，让 `timeline` 正确收窄为 `unknown[]`。

- [x] `TimelineHeader.vue` / `TimelineLegend.vue`
  - 已删除，避免保留未使用组件和旧 UI 语义。

## Validation

- [x] `npm run build --workspace play-frontend-dev` 通过。
- [x] 未修改 frontier/runtime schema。
- [x] 未引入第三方图表库。
- [x] 用户用包含 source + player 的 frontier 数据手工确认 player 节点可见，最终确认“没问题了”。

## Notes

- 最终实现没有采用全区域 SVG overlay。此前尝试的 SVG 分支路径在实际 UI 中出现大面积光带与坐标不稳定，已撤回。
- 后续若继续提升曲线质感，应优先在当前 DOM/CSS branch role 模型上微调，而不是直接恢复 SVG overlay。
