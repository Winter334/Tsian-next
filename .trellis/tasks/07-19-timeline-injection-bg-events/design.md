# Design: 时间线注入轻量 MVP

## Architecture

在开发前端的发送前上下文注入函数中增加一个 timeline block。该 block 与现有 runtime / scene / protagonist block 同属临时派生上下文：读取 runtime 快照和 `save/playthrough/frontier.json`，格式化为一条 `InjectionMessage`，随本轮发送给 storyteller，不写入存档。

实现范围只在：
- `apps/play-frontend-dev/src/lib/context-injection.ts`

不修改平台 contracts、不修改 stage-manager、不修改卡内已打包源码。

## Data Flow

1. `buildContextInjection(input)` 收到 `runtimeData.runtime`。
2. runtime ready 后先生成现有 runtime/world block。
3. 读取 `save/playthrough/frontier.json`：
   - 成功：`JSON.parse` 后用 `parseFrontier` 解析。
   - 失败 / not found / parse failed / 无有效 timeline：跳过 timeline block。
4. 根据 `runtime.plotOrder` 计算窗口：
   - source 锚点：`order <= plotOrder` 的最后 2 个 + `order > plotOrder` 的前 3 个。
   - player 锚点：按 `turn` 或 timeline 顺序取最近 3 个；优先取与当前坐标相关或最新的玩家锚点。
5. 格式化 timeline block。
6. 以 `role: "user"`、`position: "before-input"` 加入 messages，位于 runtime/world block 之后、scene/protagonist block 之前。
7. 继续现有 scene / protagonist 读取逻辑；这些原有读取失败仍按现有规则阻断。

## Message Contract

Timeline block 是资料，不是系统规则：

```ts
{
  role: "user",
  position: "before-input",
  content: formatTimelineBlock(...)
}
```

原因：
- timeline 是本轮运行时资料，不应提升为 system 级硬约束；
- 放在玩家输入前，保持玩家本轮输入是最后的直接请求；
- 连续 user 消息即使被平台合并，顺序仍是资料在前、玩家输入在后。

## Block Semantics

block 必须显式说明：
- source 锚点是 world-architect 从原著中抽出的剧情节点；
- 用途是提供剧情坐标和方向感；
- 不是已发生事实列表，也不是必须复刻的剧本；
- 玩家行动可以贴近、偏离、改写或暂时绕开原著节点；
- 未到达的原著节点不得直接写成已经发生。

## Compatibility

- `frontier.json` 不存在：跳过。
- `frontier.json` 不是合法 JSON：跳过。
- `parseFrontier` 返回 error 或 `frontier=null`：跳过。
- timeline 为空或无有效 source/player 锚点：跳过。
- 不修改任何 schema，因此旧存档天然兼容。

## Trade-offs

选择轻量注入而非背景事件状态机：
- 收益：实现简单、稳定，不引入脆弱的 LLM 事件判定循环。
- 代价：不保证“玩家不在场时原著事件已经作为存档事实发生”。MVP 只提供方向感。

选择 `user before-input` 而非 `system`：
- 收益：避免把原著节点变成硬约束，降低机械复刻风险。
- 代价：约束力比 system 弱；但这正符合“方向感而非剧本”的目标。
