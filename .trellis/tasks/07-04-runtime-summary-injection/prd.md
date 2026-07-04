# runtime 摘要注入 master

## Goal

让前端在玩家发送行动前，基于 `runtime.json` 和前端可显示状态编译一段易读的当前局面摘要，通过 `send(..., { injection })` 提供给 master，减少 master 自行读取 runtime 引用实体的成本。

## Requirements

- R1: 使用与状态栏/详情 UI 同源的 runtime 渲染数据，而不是另起一套 schema 解释逻辑。
- R2: 将当前可显示的 runtime 内容、必要引用摘要、关键状态编译为人类可读 Markdown/文本。
- R3: injection 只帮助 master 理解玩家本轮行动，不让前端承担状态维护或剧情推理。
- R4: 不要求第一版做复杂防御性限制；读取失败或无法格式化时跳过对应项或降级为简单文本。
- R5: injection 内容应明确其来源是当前 runtime/前端编译摘要；若后续 workspace 工具读取冲突，以 workspace 权威文件为准。
- R6: 可配置或可关闭，避免在不需要时额外污染 master 上下文。

## Acceptance Criteria

- [ ] 发送玩家行动时可附带 runtime 当前局面摘要 injection。
- [ ] 摘要至少包含 runtime 中的若干可显示字段。
- [ ] 摘要格式对 master 友好，不是原始冗余 JSON。
- [ ] 不改变 runtime/entity 数据，不承担维护职责。
- [ ] injection 失败不阻断玩家发送。
- [ ] 通过 `npm run build --workspace play-frontend-dev`。

## Dependencies

- 依赖 `.trellis/tasks/07-04-frontend-runtime-render-infra`。
- 可在左侧状态栏 MVP 后实施。
