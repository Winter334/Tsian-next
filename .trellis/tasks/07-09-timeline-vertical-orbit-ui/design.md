# 技术设计：剧情时间线纵向命轨美化

> 本文记录 `07-09-timeline-vertical-orbit-ui` 的最终技术设计。实现过程中曾尝试 SVG overlay 曲线，但因实际视觉表现不稳定（大面积光带、坐标缩放难控）被废弃；最终采用正常文档流 + CSS grid + DOM/CSS 侧枝的「命轨树」模型。

## 1. 设计目标

将剧情时间线从横向调试图改为「纵向命轨树」：

- source 节点构成原著剧情主干。
- player 节点按分支段在左右侧枝上展开。
- 并回后下一段分支切换方向。
- 当前 source 只用节点呼吸与卡片高光表达，不写“当前命星”等说明文字。
- 不渲染独立标题、状态 header 或图例；信息内聚到时间树卡片上，减少上下空白。

## 2. 修改范围

- `TimelineView.vue`
  - 作为滚动容器与数据入口。
  - 每次挂载主动 `refreshFrontier()`，避免模块级 frontier 缓存导致玩家编辑后看不到新 player 节点。
  - 不再渲染 `TimelineHeader` / `TimelineLegend`。
- `TimelineGraph.vue`
  - 主体重写为命轨树。
  - 负责 source/player 排序、分支方向、branch role、滚动 reveal、首次定位当前节点。
- `parse-frontier.ts`
  - 修复 `isFrontierLike` 类型守卫，使 `timeline` 在 TypeScript 中正确收窄为 `unknown[]`。
- `TimelineHeader.vue` / `TimelineLegend.vue`
  - 保留文件但当前视图不再使用；后续若需要可删除或重用。

## 3. 数据模型

不修改 schema。继续消费现有字段：

- source：`kind/order/chapter/time/label`
- player：`kind/order/turn/time/label/alignment/sourceRef`

UI 派生额外状态：

```ts
type Side = "left" | "right"
type BranchRole = "none" | "start" | "mid" | "end"

interface TreeItem {
  key: string
  kind: "source" | "player"
  anchor: SourceAnchor | PlayerAnchor
  side: "main" | Side
  isCurrent: boolean
  branchRole: BranchRole
}
```

## 4. 分支方向与角色

扫描 source order 下的 player 节点：

- 第一个未完成分支默认左侧。
- `aligned` / `diverged`：如果没有活跃分支，则开启当前侧分支并标记 `branch-start`；已有活跃分支则标记 `branch-mid`。
- `rejoined`：标记 `branch-end`，结束活跃分支，并切换下一段方向。

这样同一分支段内多个 player 会共享一条侧枝视觉，而不是每个 player 各自短线连接主干。

## 5. 布局

`TimelineGraph` 使用正常文档流与 CSS grid：

```text
左分支区 | 主干轴 | 右分支/source 卡片区
```

- source：位于主干轴上，卡片显示在右侧。
- player-left：卡片显示在左侧。
- player-right：卡片显示在右侧。
- 主干线由 `.tree-body::before` 常驻绘制，确保少节点/无分支时仍有时间轴骨架。
- 无 player 时启用 `source-only` 紧凑布局，避免为未来分支预留大块空白。

## 6. 视觉规则

### Source 卡片

- 半边框“命签”样式：只保留左侧亮金边，不使用全边框。
- 默认显示：label、章节编号、章节标题、time。
- 当前 source：节点呼吸、外圈 pulse、卡片左边和背景微亮。

### Player 卡片

- 小卡片挂在侧枝上。
- 卡片内显示 label、turn、time。
- player dot 颜色表示 alignment：
  - diverged：血珀
  - rejoined：琥珀金
  - aligned：古金

### 侧枝

- `branch-start/mid/end` 通过 CSS pseudo-elements 绘制侧枝竖线、卡片连接线、分出/并回弯折。
- 行语义 class 与点样式 class 分离：行使用 `row-align-*`，点使用 `align-*`，避免 alignment 背景样式污染整行造成光带。

## 7. 滚动与刷新

- TimelineView 每次挂载主动刷新 frontier。
- TimelineGraph 使用 IntersectionObserver 做进入视口 reveal；root 不可用时直接全显示。
- 首次数据就绪后自动定位当前 source 附近，只执行一次，不在用户手动滚动后强制拉回。
- `prefers-reduced-motion: reduce` 下关闭 reveal transition 与当前节点动画。

## 8. 兼容性与回滚

- 不改 frontier/runtime schema，无存档迁移。
- 不引入第三方图表库。
- 若分支线仍需增强，可在当前 DOM/CSS role 模型上微调位置、弯折和颜色；不要重新引入全区域 SVG overlay，除非先解决 viewBox/布局坐标与背景光带风险。
