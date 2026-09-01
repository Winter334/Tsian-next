# ask_user: AI 向玩家提问+选项+自定义回答

## Goal

AI 在 turn 中途调 `ask_user` 工具向玩家提问，给出一组选项（玩家也可自定义回答）。工具阻塞 turn 等待玩家选择，选择后 observation 喂回 AI 继续生成。无超时。选项由前端决定怎么渲染（SDK 不负责表现层）。

## 数据流

Round 1: AI → tool_call(ask_user) → 工具阻塞 await → 事件推前端 → 玩家选择 → RPC 回填 → observation → Round 2: AI 继续

## Requirements

### R1 contracts 类型
- `AskUserRequest` / `AskUserResult` / `AskUserResponse` 类型
- `AgentPlatformToolName` 加 `ask_user`
- `RemotePlayBridgeEventName` 加 `interaction-request`
- `RemotePlayBridgeMethod` 加 `interaction.respond`

### R2 interaction-events 事件总线
- 新建 `interaction-events.ts`，emit 返回 Promise
- `Map<requestId, {resolve, reject}>` 等待表
- subscribe/emit/resolve/reject 四函数

### R3 agent-runtime
- `ask_user` 工具名 + schema + 执行分支
- `onAskUser` 回调穿透（TurnInput → ModelCallOptions → ToolExecutionContext）
- ask_user 分支 `await context.onAskUser(...)`，abort 时 reject

### R4 platform-host
- sendMessage 绑定 onAskUser → emitInteractionRequest
- abort 时 rejectInteractionRequest 清理

### R5 remote-iframe-bridge
- 订阅 interaction-request 转发 postEvent
- interaction.respond RPC 分发 → resolveInteractionRequest
- dispose 取消订阅

### R6 play-bridge
- onInteractionRequest 快捷 handler
- bridge.respondInteraction(requestId, answer) 方法

### R7 开发前端渲染
- interaction-request 事件 → 渲染问题 + 选项按钮 + 自定义输入框
- 玩家选择/输入 → bridge.respondInteraction

## Acceptance Criteria

- [ ] AI 能调 ask_user 工具（schema 暴露给 LLM）
- [ ] 前端收到 interaction-request 事件并渲染选项 UI
- [ ] 玩家选选项或自定义输入 → AI 拿到答案继续生成
- [ ] 玩家点停止 → ask_user 返回 cancelled observation
- [ ] 三个 build（contracts/play-bridge/web）全绿
- [ ] 默认前端 default-frontend-files.ts 未改动

## Out of Scope

- 不加超时
- 不改默认前端
- 不改 PlayView.vue
- 不改 observation 序列化函数
