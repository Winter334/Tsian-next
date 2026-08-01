# 游戏前端工具调用体验优化

## Goal

把默认游戏前端的推演过程从生硬的嵌套技术日志改为轻量、稳定、可扩展的活动展示：玩家能看见工具调用数量与每个工具的实时状态，但不会看到错误拼接的工具语义、内部 Agent 标识或多余的嵌套折叠。

## Background

- 当前外层 `RoundProcess` 默认折叠，并汇总“轮 / 思考 / 过渡 / 工具”四类数量；用户只需要工具调用数量。现有实现见 `apps/play-frontend-dev/src/components/story/RoundProcess.vue`。
- 当前 `ProcessNode` 把过渡、思考、单工具和工具组都包装成内层折叠。虽然过渡默认展开，仍会显示 `storyteller · 过渡` 一类内部标签和小折叠外观。现有实现见 `apps/play-frontend-dev/src/components/story/ProcessNode.vue`。
- 工具组摘要依赖前端硬编码 `TOOL_LABEL`；未知专用工具回退到 `${name}了操作`，会生成 `read_entity了操作` 一类错误文案。
- 自定义 Tool 注册项已有面向用户的 `title`，但现有 `turn-tool` / `ToolEvent` / `TurnTimelineItem` 只把 `name` 送到游戏前端。工具行若要自动适配后续新 Tool，需要把可选显示标题沿事件和历史链路传递；旧历史缺失标题时回退到原始 `name`。
- 实时工具事件按 `callId` 原位更新 `loading/running/success/failed`，适合用视觉状态动画表达生命周期，而不是尝试把任意工具标题拼成自然语言句子。
- 本任务只修改开发前端 `apps/play-frontend-dev`。卡内源码与 packaged frontend 由用户后续通过既有打包脚本上传，不属于本次交付。

## Requirements

### R1. 外层推演摘要

- 保留“推演过程”外层折叠及其默认折叠行为。
- 摘要只显示 `N 次工具调用`；不再显示轮数、思考数或过渡数。
- 工具数实时变化时，数字使用短促、稳定且不引发布局跳动的切换动画。
- 没有工具调用时不显示工具数量，不伪造 `0 次工具调用`。

### R2. 单层内容层级

- 外层折叠展开后，过渡文本直接显示为时间线正文，不再使用内层 `CollapsibleRoot`、卡片标题或二次点击。
- 过渡文本不显示 `agentId`，也不显示“过渡”标签；仅用排版、颜色、间距或外层时间线表达其从属关系。
- 工具调用直接显示为轻量列表，不再使用工具组小折叠，也不再生成工具组自然语言摘要。
- “思考”节点继续保留内层折叠，避免长内容抢占叙事空间。
- 保持原有 timeline 顺序；过渡、思考与工具不得因扁平化而重排。

### R3. 工具名称与通用状态

- 每条工具行把“工具身份”和“运行状态”分离显示，禁止将工具标题或工具名与“正在 / 已 / 了操作 / 失败”等词拼接成句子。
- 自定义 Tool 优先显示注册项的 `title`；显示标题缺失或旧历史没有该字段时，稳定回退到原始 `name`。
- 状态语义固定为：`loading` 和 `running` → “运行中”，`success` → “成功”，`failed` → “失败”。
- 状态由文字、图形和颜色共同表达，不能只靠颜色。
- 玩家界面不显示原始参数、原始 output、内部 Agent id 或工具协议术语。

### R4. 动画与可访问性

- 新工具行出现时使用轻微淡入/位移动画；同一 `callId` 的状态更新必须原位过渡，不能重复插入或闪烁。
- 运行中使用持续但克制的状态动画；成功和失败只播放一次短促的终态过渡，随后保持静态。
- 工具数量变化使用数字切换动画；动画期间宽度稳定。
- 遵守 `prefers-reduced-motion`：减少动画时立即或近乎立即切换状态，但保留完整文字和图形反馈。
- 动画不得阻塞展开/收起、滚动或键盘操作。

### R5. 实时、历史与开发前端交付一致性

- 实时事件与刷新后历史重建必须使用同一工具显示标题、状态映射和扁平布局。
- 工具显示标题作为可选兼容字段沿 runtime timeline、远程 bridge、play-bridge SDK 和默认前端传递；旧数据与旧发送方继续可用。
- 只修改并验证 `apps/play-frontend-dev`；不得修改卡内 frontend source、dist、`game-card.json` 或上传产物。
- 必须通过开发前端构建；后续打包与上传沿用用户现有工作流，不在本任务内执行。

## Out of Scope

- 根据工具名称、参数或 output 猜测“读取了文件 / 编辑了资料”等行为分类。
- 为任意 Tool 设计可配置的句式模板或结果摘要协议。
- 在玩家界面展示完整工具参数、output 或 Agent 调试信息。
- 改变 Tool 的执行逻辑、调用顺序、权限或失败语义。
- 复刻 Codex Desktop 的私有组件或视觉资产。
- 修改 `cards/沉浸阅读器.tsian-card/frontend/**`、`game-card.json` 或任何 packaged frontend 产物。
- 执行后续开发前端打包、上传或游戏卡替换流程。

## Acceptance Criteria

- [x] AC1：外层标题只呈现“推演过程”和实时 `N 次工具调用`；轮、思考、过渡计数均不可见，数字变化有稳定动画且 reduced-motion 下无依赖动画的信息缺失。
- [x] AC2：展开外层后，过渡文本直接显示且没有内层折叠、边框卡标题、`agentId` 或“过渡”标签；思考仍可单独折叠。
- [x] AC3：连续工具直接形成列表，不出现工具组小折叠，也不出现 `${name}了操作` 或任何基于未知工具名的造句。
- [x] AC4：工具行优先显示自定义 Tool 的 `title`，缺失时显示 `name`；状态仅显示“运行中 / 成功 / 失败”，并由图形、文字和动画共同表达。
- [x] AC5：同一 `callId` 从 loading/running 到 success/failed 原位更新；新行、运行态和终态动画不造成重复项、布局跳动或持续终态动画。
- [x] AC6：实时事件与历史重载后的名称、状态、顺序和层级一致；缺少新增显示标题字段的旧历史仍能用原始工具名正常渲染。
- [x] AC7：玩家界面不暴露原始参数、output、Agent id 或 bridge/runtime 术语。
- [x] AC8：只修改开发前端及其必要的 contracts/platform/bridge 支撑链；`npm run build:contracts`、`npm run build --workspace @tsian/play-bridge`、`npm run build:web`、`npm run build --workspace play-frontend-dev` 按实际改动范围通过，卡内源码和 packaged frontend 保持未改。

## Technical Notes

- 预计需要扩展 `TurnTimelineItem`、runtime `onTool` 回调、`turn-tool` 事件、remote iframe bridge、play-bridge `ToolEvent` 与默认前端 `StreamItem` 的可选显示标题字段。
- `ProcessNode.vue` 应按节点类型分流渲染：interim/plain、thought/collapsible、tool/list-row，而不是继续让所有类型共享一个折叠壳。
- 动画应优先使用现有 Vue/CSS 能力；除非现有依赖能显著减少复杂度，否则不为本任务新增动画库。
