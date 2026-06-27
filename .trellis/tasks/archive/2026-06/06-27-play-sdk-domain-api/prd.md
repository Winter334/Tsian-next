# Play SDK 领域 API 重设计 + injection 能力 + API 文档

## Goal

把 `@tsian/play-bridge` 从"协议层机械移植的裸 RPC"重设计为"面向游戏前端开发者的领域 API"，并给 `sendMessage`/`invokeAgent` 新增 `injection` 能力（前端可注入独立于玩家输入、有边界的上下文消息）。同时产出一份 API 文档，供助手 agent 和前端开发者查阅。

## Background

现有 `@tsian/play-bridge` 是从默认前端内联协议层机械移植来的（`bridge.ts:5` 注释），对外暴露裸 `bridge.call("interaction.sendMessage", {content})`——这是 RPC 术语，不是前端开发者心智里的东西。玩家/助手写游戏前端时要理解 method 字符串、params 结构、事件名，门槛高。

同时，平台只有一个 `contextPaths` 机制给 agent 注入常驻上下文（文件全文、路径写死、平台组装时机固定），前端无法加工状态后注入、无法控制注入位置、无法注入非 user-role 信息。`MessageInteractionRequest` 只有 `{content: string}`，前端加工的任何信息只能拼进玩家输入字符串，混在玩家语义里。

经长讨论确认：
- SDK 应是一层领域 API `tsian.*`，对外不暴露裸 call，协议层留包内。
- 维持前端 import 包（不做平台注入——注入路径对 packaged/remote 前端复杂度不值得）。
- injection 能力：契约加可选字段，平台透传不解释语义、不落盘进 turn 历史。
- 这是第一版，根据实际前端开发发现的问题再调整，不追求一次性完美。

## Requirements

### R1 — SDK 重设计为领域 API

- `@tsian/play-bridge` 对外只导出 `createTsian()` + 领域类型。`createBridge`/`Bridge`/裸 `call` 降为包内不公开导出（或标记 internal）。
- 领域 API 对象（暂称 `tsian`）按前端行为组织，不丢平台能力：
  - 语义化方法覆盖高频用法
  - `tsian.query(resource, params)` / `tsian.runAction(action, params)` 通用入口覆盖冷门/未来新增能力
- 现有 `createSessionHistory`/`listCheckpoints`/`restoreCheckpoint`/`parseStoryOptions` 并入领域 API，不再单独顶层导出。

### R2 — API 形态（第一版，允许后续调整）

```
tsian.ready() / tsian.sessionId                              // 生命周期
tsian.send(text, { injection?, attachments? })               // 走 master 推进剧情
tsian.invokeAgent(agentId, input, { injection? })            // 旁路调 agent
tsian.onMessage(cb)      // 流式增量 {kind:"reasoning"|"content", delta, agentId, round}
tsian.onRoundEnd(cb)     // 每轮边界 {kind:"thought"|"final", round, agentId}
tsian.onTurnEnd(cb)      // 回合定稿 {options?, stats?}
tsian.onTool(cb)         // 工具过程 {status, name, output, ...}
tsian.onAsk(cb)          // AI 提问 {requestId, question, options?, allowCustom?}
tsian.answer(requestId, text)
tsian.history.get()                                          // SessionHistoryEntry[]
tsian.checkpoints.list() / tsian.checkpoints.restore(id)
tsian.workspace.read(path) / tsian.workspace.write(path, content)
tsian.query(resource, params) / tsian.runAction(action, params)
```

- 事件订阅三粒度（增量/轮/回合）来自现有前端渲染模型反推（`play-frontend-dev/main.ts` 的 `finalizeRound`/`finalizeTurn`）：`onMessage` 给流式增量带 kind，`onRoundEnd` 区分中间轮（interim）vs 最终轮（final），`onTurnEnd` 管回合定稿（选项/stats）。
- `send` 永远走 master，不塞 agentId（指定 agent 是 `invokeAgent` 的事）。
- `invokeAgent` 暴露给游戏前端，不做"慎用"标注（master 对话同样消耗 token，不该单独给 invokeAgent 贴警告）。

### R3 — injection 能力

- `MessageInteractionRequest` 和 `InvokeAgentRequest`（`packages/contracts/src/runtime.ts`）加可选 `injection` 字段：
  ```ts
  injection?: {
    role: "system" | "user" | "assistant"
    content: string
    position?: "before-input" | "after-input"   // 默认 "before-input"
  }[]
  ```
- 单条级别 position：每条 injection 自己带 position，前端能一次注入混合位置的信息。
- 平台侧（`agent-runtime/index.ts` 上下文序列构建 L833-869）按 position 分两组插入：
  - `before-input`：框架信息 user 消息之后、玩家输入之前
  - `after-input`：玩家输入之后
- injection 不落盘进 turn 历史、不进 context.json 快照、平台不解释语义。
- 桥 normalize 层（`remote-iframe-bridge.ts`）透传 injection，校验数组结构 + 合法 role + string content，不校验语义。

### R4 — API 文档

- 产出一份 API 文档，面向助手 agent 和前端开发者。
- 覆盖：包导入、`createTsian()`、每个方法的签名/参数/回调形状/示例、injection 用法、workspace 读写、通用入口。
- 文档位置：仓库内 `docs/`（具体路径实现期定），可作为助手 agent 写前端时查阅的参考。

### R5 — 方向文档更新

- `docs/active/play-frontend-sdk-direction.md` 从"薄 SDK 封装"更新为"领域 API"，反映本次重设计的定位变化。

## Acceptance Criteria

- [ ] `@tsian/play-bridge` 对外导出 `createTsian()` + 领域类型，裸 `call`/`createBridge` 不在公开导出
- [ ] `tsian.send/invokeAgent/onMessage/onRoundEnd/onTurnEnd/onTool/onAsk/answer/history/checkpoints/workspace/query/runAction` 全部实现
- [ ] `MessageInteractionRequest`/`InvokeAgentRequest` 含可选 `injection` 字段，单条带 position
- [ ] injection 按 position 分组插入上下文序列（before-input / after-input），不落盘、不进 context.json
- [ ] 桥 normalize 层透传 injection 并校验结构
- [ ] API 文档产出，覆盖全部公开方法 + injection 用法 + 示例
- [ ] `play-frontend-sdk-direction.md` 更新为领域 API 定位
- [ ] 现有 `play-frontend-dev` 迁移到新 API（验证 API 可用性）
- [ ] type-check 通过

## Notes

- API 形态是第一版，根据实际前端开发发现的问题再调整。
- 两个实现期待核实的事实（不挡定方向）：
  1. `tsian.workspace.write` 底层走哪个 RPC（`platform.runAction` 还是 query 支持写）。
  2. injection 插入不破坏 master 上下文消息序列的缓存断点结构（`index.ts:851-853` 注释提到轮次号放后面让缓存断点后移）。
