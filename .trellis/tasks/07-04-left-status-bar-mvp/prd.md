# 左侧状态栏 MVP

## Goal

在主游玩态左侧实现第一版状态栏，展示 `runtime.json` 中的当前局面与可渲染扩展字段，让玩家在阅读剧情时能快速扫读角色、地点、时间、状态、背包摘要等信息。

## Requirements

- R1: 状态栏位于主游玩态左侧，与顶部 `AppHeader`、右侧 `AppNav`、中间 `StoryView` 共存。
- R2: 不遮挡正文流、剧情选项、Composer、检查点恢复 UI。
- R3: 读取前端 runtime 渲染基础设施提供的数据，而不是自己重复解析 workspace 数据。
- R4: 固定区域可显示当前角色/视角、地点/场景、时间/世界变量、关键状态、背包/容器摘要。
- R5: 扩展字段按渲染类型进入预留槽位，而不是堆到“其它”区域。
- R6: 支持折叠/展开或轻重两态，让常驻信息不挤占剧情正文。
- R7: 延续当前“烛火书卷·重铸”暗色仪式系，但更偏可扫读的信息仪表盘。

## Acceptance Criteria

- [ ] 主游玩态左侧可见状态栏入口/常驻摘要。
- [ ] 状态栏能展示 runtime 中至少一种固定字段和一种 extensions 字段。
- [ ] 状态栏不会破坏发送、停止、剧情选项、历史滚动和检查点恢复。
- [ ] 状态栏折叠/展开状态不会写入 workspace；如需持久化偏好，使用 localStorage。
- [ ] 未知/缺失 runtime 数据有空态或降级展示。
- [ ] 通过 `npm run build --workspace play-frontend-dev`。

## Dependencies

- 依赖 `.trellis/tasks/07-04-frontend-runtime-render-infra`。
