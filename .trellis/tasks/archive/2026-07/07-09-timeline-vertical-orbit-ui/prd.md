# 剧情时间线纵向命轨美化

## Goal

将当前剧情时间线从偏调试感的横向分支图，重塑为更适合长篇叙事的「纵向命轨卷轴」：原著剧情作为自上而下展开的主命轨，玩家事件作为左右交错的圆润支轨，滚动时路径逐段点亮，整体保持暗色金色仙侠氛围与极简说明文本。

## Background / Confirmed Facts

- 当前页面由 `TimelineView` 组合 `TimelineHeader`、`TimelineGraph`、`TimelineLegend` 渲染，入口在 `apps/play-frontend-dev/src/components/timeline/TimelineView.vue:19`。
- 当前 `TimelineGraph` 以 source order 分列，使用水平主干线和 CSS/HTML 节点布局；文件注释明确当前算法是「source 锚点水平排列、列内挂 player 锚点」：`apps/play-frontend-dev/src/components/timeline/TimelineGraph.vue:4`。
- 当前 header 显示 `已读窗口 / 剧情进度 order / 剧情节点 / 玩家事件`，其中 `order` 暴露了工程字段：`apps/play-frontend-dev/src/components/timeline/TimelineHeader.vue:36`。
- 当前 legend 常驻展示四类说明项：原著剧情节点、玩家剧情事件、当前进度、偏离·并回：`apps/play-frontend-dev/src/components/timeline/TimelineLegend.vue:10`。
- timeline 数据已有 source/player、alignment、sourceRef、turn、chapter、label、time 等字段；本任务目标是 UI 美化与布局/动效重构，不改变现有 schema。

## Requirements

### R1. 纵向主命轨

- source 节点沿纵向中轴自上而下排列，表示原著剧情主线。
- 当前进度节点应有更明显但克制的呼吸光环 / 命星高亮。
- 主线应呈现柔和金色星轨质感，而不是普通 stepper 竖线。
- 仍需支持只有一个 source 锚点的开局状态。

### R2. 左右交错分支与并回

- player 分支应从主命轨侧向逸出，并用圆润曲线表达偏离与并回。
- 分支方向按「分支段」交替，而不是每个 player 事件都左右跳动：
  - 一次 `diverged` 开始一个分支段。
  - 同一未并回分支段内保持同侧。
  - 遇到 `rejoined` 后结束该分支段。
  - 下一次新的分支段切换到另一侧。
- 默认第一段从左侧逸出；第二段右侧；之后左右交替。
- aligned player 事件若出现，应以低调方式贴近主线或当前分支段展示，不制造额外说明负担。
- 分支方向属于 UI 排版策略，不新增 schema 字段。

### R3. SVG 圆润曲线

- 使用 SVG path 层渲染主线、偏离线、分支延续线、并回线。
- 线条应使用圆角端点 / 圆润贝塞尔曲线，避免硬折线和后台流程图感。
- 节点和标签可继续使用 HTML/Vue 层，SVG 负责轨道和连接关系。
- 曲线颜色应表达语义但保持克制：主线偏金色，偏离/并回支线可使用赤铜、暗金或低饱和青金过渡。

### R4. 滚动特效

- 时间线变长后应天然支持纵向滚动。
- 首次进入时间线页时，应自动定位到当前剧情节点附近，并保留少量上方上下文；玩家手动滚动后不应被强制拉回当前节点。
- 滚动时以「路径逐段点亮」为主效果：进入视口的主线/分支线和节点变亮或绘制显现。
- 背景星尘 / 光雾可以做轻微视差作为辅助效果，不削弱现有背景和粒子氛围。
- 动效节奏应慢、柔和，像烛火与星尘，不做高频霓虹闪烁。
- 必须尊重 `prefers-reduced-motion: reduce`，降级为静态或低动效状态。

### R5. 极简说明文本

- 顶部说明从工程统计改为叙事状态，不默认显示 `order`。
- 默认只保留必要信息：标题、当前节点/当前状态、节点名、章节/时间等短文本。
- 原著节点标签控制在 `label + 第 N 章` 级别；玩家节点显示一句短标签，可保留回合/时间作为弱化 meta。
- 图例应弱化；当没有玩家事件时，不应让大块图例抢占视觉焦点。

### R6. 保持现有氛围与兼容性

- 不主动降噪背景和粒子；美化重点放在时间线本体、曲线与滚动动效。
- 不改变 frontier/runtime 数据 schema。
- 保持加载、错误、无 frontier、单节点等空态/降级路径可用。
- 保持时间线为纯展示，不新增点击交互作为本任务必需范围。

## Acceptance Criteria

- [ ] 时间线主结构从横向列布局改为纵向命轨布局，source 节点自上而下排列。
- [ ] player 分支以左右交错的分支段展示；并回后下一次分支切换方向，同一未并回分支段不频繁换边。
- [ ] 偏离、分支延续、并回均使用圆润曲线呈现，无明显直角折线/流程图感。
- [ ] 当前节点具有克制但可见的呼吸/光环动效，并在 reduced-motion 下关闭或静态化。
- [ ] 滚动浏览长时间线时，路径/节点有进入视口后的点亮或显现效果；背景星尘/光雾仅作为轻微辅助。
- [ ] 首次进入时间线页时自动定位到当前节点附近，保留少量上方上下文；玩家手动滚动后不被自动拉回。
- [ ] Header 不再默认显示 `order`，说明文本明显少于当前版本且更贴近叙事语气。
- [ ] 玩家事件为 0 时，图例或说明不会以大块组件形式抢占视觉焦点。
- [ ] 不修改 timeline/frontier schema；现有 source/player 字段即可驱动 UI。
- [ ] 加载失败、无数据、单 source 节点、多 source 节点、有 player 分支等状态均能正常显示。
- [ ] `npm run build --workspace play-frontend-dev` 通过。

## Out of Scope

- 修改 frontier/timeline 数据模型或增加分支方向字段。
- 新增节点点击详情面板、跳转到回合正文、缩放/拖拽地图等交互。
- 重做全局背景、侧栏、导航或非 timeline 页面。
- 为时间线引入第三方图表库。
