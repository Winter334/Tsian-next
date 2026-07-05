# 左侧状态栏角色字段钉选机制

## Goal

让玩家可以从角色卡中选择少量字段（状态、基础维度、特殊量表等）"钉选"到左侧状态栏，使状态栏在 MVP 最小主角入口 + runtime 世界变量之上，按个人偏好展示关心的角色信息。避免 Agent 自动决定状态栏内容导致 schema 演进后状态栏越来越臃肿。

## Background

`07-04-left-status-bar-mvp` 已实现左侧状态栏的固定分区：Scene / Character / Status / Metrics / Refs。其中 Status 区现在直接读主角实体的 `entity.status`，Metrics/Refs 区读 `runtime.extensions` 的 displayItems。

`07-04-present-characters-character-cards` 已实现角色卡全屏视图，角色卡是实体信息的主展示面。schema 演进后的新字段优先进入角色卡，而不是自动进入状态栏。本任务补齐"用户钉选"这条链路，让状态栏在 MVP 之上具备个性化扩展能力。

## Confirmed Direction（来自 07-04 PRD D8 + 父任务 07-03 P-series）

- 角色卡是实体信息的主展示面。schema 演进后的新字段优先进入角色卡对应标签页/区域，而不是自动进入左侧状态栏。
- 同一份渲染控制字段在不同 UI 表面可有不同解释：角色卡使用完整/详细渲染，状态栏使用紧凑/钉选渲染，injection 使用文本去结构化渲染。`render` / `slot` / `polarity` 是语义提示，不是绑定某个组件外观的硬 UI 指令。
- 左侧状态栏不由 Agent 自动决定展示哪些角色字段，避免状态栏随 schema 演进越来越臃肿。
- 左侧状态栏采用用户钉选机制：用户从角色卡中的字段/状态/基础维度/特殊量表中选择少量项目显示到左侧状态栏。
- 默认显示主角/当前视角角色的钉选字段；未配置时只显示最小主角入口与 runtime 世界变量（即当前 MVP 行为）。
- 钉选配置属于前端显示偏好，默认存 localStorage，不写入 workspace，不成为剧情权威数据。
- 钉选配置只保存字段引用/路径，不保存字段快照；状态栏渲染时重新从 entity 读取当前值，避免双源。

## Requirements

- R1: 钉选配置数据结构设计：保存字段引用/路径（如 `entity.status[*].id`、`entity.attributes.体魄`、`entity.gauges[*].id`、`entity.appearance` 等），不保存字段值快照。
- R2: 钉选配置存储：localStorage（键名约定 `tsian.statusBarPins.<characterRef>` 或全局 `tsian.statusBarPins`），不写入 workspace。
- R3: 钉选 UI 入口：在角色卡字段上提供"钉选到状态栏"操作（icon 按钮 / 右键菜单 / 拖拽，选其一）；钉选后状态栏对应区域即时更新。
- R4: 状态栏新增"钉选"分区或在现有 Status/Metrics 分区内展示钉选项；钉选项紧凑渲染（chip / 小数值 / 微缩 bar），与角色卡的详细渲染形成对比。
- R5: 钉选项渲染时按 `protagonistRef` 重新读取 entity 当前值，不读快照；entity 读取失败时降级展示字段名 + "—"。
- R6: 取消钉选：在状态栏钉选项上提供移除操作；或在角色卡已钉选字段上提供取消操作。
- R7: 默认行为：未配置钉选时，状态栏保持 MVP 行为（最小主角入口 + runtime 世界变量 + 主角 entity.status）。
- R8: 多角色钉选策略：钉选配置是否按 characterRef 分组（切换主角时切换钉选集），还是全局一份。建议按 characterRef 分组，但 MVP 可先做全局一份。

## Acceptance Criteria

- [ ] 玩家可以在角色卡上把至少 3 类字段（status / attribute / gauge）钉选到状态栏。
- [ ] 钉选配置存 localStorage，不写入 workspace。
- [ ] 钉选配置只保存字段引用/路径，不保存字段值快照。
- [ ] 状态栏钉选区在 entity 字段变化时（回合后刷新）自动更新展示当前值。
- [ ] 玩家可以取消钉选。
- [ ] 未配置钉选时，状态栏保持 MVP 行为（不破坏现有 07-04-left-status-bar-mvp 行为）。
- [ ] 通过 `npm run build --workspace play-frontend-dev`。

## Out of Scope

- 钉选配置的导入/导出/分享。
- 跨存档的钉选配置同步。
- 钉选字段的历史趋势/图表展示。
- 状态栏布局自定义（拖拽顺序、分区大小调整）。

## Dependencies

- 依赖 `07-04-left-status-bar-mvp`（已归档，提供状态栏 MVP 壳）。
- 依赖 `07-04-present-characters-character-cards`（已归档，提供角色卡字段展示，钉选 UI 入口在角色卡内）。
- 依赖 `07-05-runtime-scene-character-schema-ui-align`（已归档，character schema 已稳定）。

## Notes

- 本任务在父任务 `07-03-play-frontend-status-bar` Child Task Map 中的位置：状态栏体系的最后一块补全，可在 injection 任务之前或并行。
- 实施前需要先和用户讨论钉选 UI 交互形式（按钮 vs 右键 vs 拖拽）与多角色策略（按 characterRef 分组 vs 全局一份）。
