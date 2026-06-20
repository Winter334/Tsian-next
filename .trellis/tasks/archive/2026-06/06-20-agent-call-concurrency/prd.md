# PRD — 子代理并发改造（同轮多 agent_call 并行 + 移除 maxCallsPerTurn + 事件 agentId）

> 父任务：`06-19-tool-runtime-performance`。
> **依赖子2（tool-token-budget，已落地 R1-R4，C3-C6 实测待 PV-002）**——本任务在 tool-token-budget 已去硬轮次限制 + turn 内 token 预算兜底的基础上，进一步移除 agent_call 的次数硬限制并让同轮多个 agent_call 并行执行。
>
> 方向已与用户对齐（2026-06-20 多轮讨论）。本任务只做**执行层并发**，不碰上下文压缩（压缩改造是后续独立任务，见 prd.md 末尾"关联后续任务"）。

---

## 背景与现状（勘察确认）

- **agent_call 当前串行执行**：`executeRuntimeWorkspaceToolCalls`（workspace-tools.ts:1947）把 tool calls 分两组——并行组（`PARALLEL_TOOL_NAMES`：只读无状态工具 `use_skill`/`workspace.read/list/search/diff/validate`，`Promise.all`）和串行组（写操作、`agent_call`、`run_script`、不可解析 call，按原顺序逐个 `await`）。`agent_call` 在串行组，注释明确"因共享 mutable budget (callCount/depth) 而保持串行"。
- **同轮多个 agent_call 串行跑**：模型一轮可发多个 agent_call tool call，但逐个执行，受 `maxCallsPerTurn=4` 限制。
- **delegated agent 不流式**：`createAgentCallRunner`（index.ts:1046）给 delegated 传的 callOptions 不含 `onDelta`/`onRoundEnd`/`onTool`（spec 记载"delegated agents stream silent"）。用户看不到子代理在干什么。
- **事件层无 agentId**：bridge 转发的 `turn-delta`/`turn-round-end`/`turn-tool` 事件（remote-iframe-bridge.ts:430-450）负载只有 `turn`/`round`/`callId`/`name`/`status`/`output`，**不带 agentId**。当前只有 entry agent 流式，无需区分；并行多子代理后游戏前端无法区分事件来源。
- **`maxCallsPerTurn` 是与 `maxToolRoundsPerAgent` 同类的遗留硬限制**：tool-token-budget 已移除后者（轮次限制→token 预算兜底），前者逻辑上该一并审视——agent_call 是工具循环里的一个 tool call，不该有独立次数硬限制，应受统一 token 预算约束。
- **`callCount` 有诊断价值**：移除 `maxCallsPerTurn` 硬限制后，`AgentCallTurnState.callCount` 作为"已发起几次 agent_call"的计数仍用于 trace metadata（index.ts:932/944），只是不再作拦截。**保留 callCount 计数，去掉硬限制拦截。**
- **`maxDepth=2` 是递归安全网，保留**：防 agent_call 无限嵌套递归（A→B→A→B...）。token 预算能管"调多少次"但管不了递归深度。depth 是值传递（每次 agent_call 传 `callerDepth+1` 快照），并行 agent_call 各自拿到独立 depth 值，**天然并发安全**。

## 讨论结论沉淀（2026-06-20，供 design 依据）

### 用户价值

主 agent（master）一轮里需要同时调多个独立子代理时（如记忆 agent + 状态 agent 并行总结），当前串行执行导致等待时间累加。并行执行可缩短一轮时长，增强玩家体验。串行/并行由模型自己控制：一轮发一个 agent_call = 串行（等 observation 回来再进下一轮），一轮发多个 = 并行——无需额外机制，只要让并行成为可能。

### 核心决策（已对齐）

1. **同轮多 agent_call 并行执行**：`agent_call` 移出串行组，多个 agent_call `Promise.all` 并行跑，observation 按原索引回填（复用现有 Map-by-index 机制）。
2. **移除 `maxCallsPerTurn` 硬限制**：与 `maxToolRoundsPerAgent` 同理，token 预算覆盖。`callCount` 保留作计数/trace，去掉拦截。`maxDepth=2` 保留（递归安全网）。
3. **agent_call observation 走 tool 通道**：不包装成剧情 user message（维护剧情/tool 分层，不破坏 tool-token-budget 的剧情压缩）。这是现有做法，不改。
4. **事件层加 agentId**：runtime 的 `onDelta`/`onRoundEnd`/`onTool` 事件负载加 agentId（标明来源 agent），delegated 也发这些事件。bridge 转发时带上。游戏前端可选消费（区分多子代理）。AssistantView 暂不改（事件层预留 agentId 即可，桌面助手默认不 agent_call 多子代理）。
5. **observation 按原顺序回填**：并行执行完成顺序不确定，但 observation 数组按模型发出的原 index 回填（native 靠 `result.toolCalls[index].id` 配对，text 靠 Map-by-index 追加）。确定性优先，上下文顺序稳定模型更好预测。

### 明确不做（本任务边界）

- **不碰上下文压缩**：子代理/助手的任务压缩、多次压缩、时长兜底是后续独立任务（见末尾"关联后续任务"）。本任务里 delegated 路径仍沿用 tool-token-budget R2 的"跳过压缩、只走预算兜底"。
- **不改 master 兜底**：master 的 turn 内"一次压缩 + ContextBudgetExhaustedError"兜底不动（tool-token-budget 已落地，其机制证明一次压缩够：第一次压剧情腾工具空间，期间不产新剧情，第二次压不动即异常）。
- **不做跨 turn 后台子代理**：受 turn 原子性约束，当前玩家阻塞式 turn 模型下是过度设计。Claude Code 式后台需先打破"玩家发一句→等 master 完整回复"的阻塞模型，是更大的产品级改动。
- **不包装子代理结果为剧情 user message**：Claude Code 那套在 Tsian 明确不做（污染正文 + 破坏压缩）。
- **不改 AssistantView 渲染**：事件层加 agentId 预留，AssistantView 保持单 agent 平铺（桌面助手默认不 agent_call 多子代理）。
- **不做助手 agent 跨 turn 持久化**：后续独立任务。
- **不改子代理/助手 messages 为消息序列**：那是任务压缩改造的前提，属后续任务。本任务在现有单条 user message 结构上做并发。

## 需求

### R1 移除 maxCallsPerTurn 硬限制（保留 callCount 计数 + maxDepth）

- `AgentRuntimeCollaborationPolicy`（index.ts:193）移除 `maxCallsPerTurn: number` 字段。`DEFAULT_AGENT_RUNTIME_COLLABORATION_POLICY` 移除 `maxCallsPerTurn: 4`。`normalizeAgentRuntimeCollaborationPolicy` 移除 `maxCallsPerTurn` normalize。`AgentRuntimeCollaborationPolicyInput` 自动收窄。
- `createAgentCallRuntimeMetadata`（index.ts:918）移除 `maxCallsPerTurn` 字段；`agentCallTraceFacts`（index.ts:938）移除 `maxCallsPerTurn` trace 字段。
- `createAgentCallRunner`（index.ts:1046）删除 `state.callCount >= collaborationPolicy.maxCallsPerTurn` 拦截分支（index.ts:1094，`AGENT_CALL_LIMIT_EXCEEDED`）。`state.callCount += 1`（index.ts:1113）保留（计数/trace 用）。
- `canExposeAgentCallInPrompt`（index.ts:586）移除 `state.callCount < policy.maxCallsPerTurn` 条件（index.ts:592），只保留 `depth < policy.maxDepth`。
- `maxDepth` 字段、默认值、normalize、`depth >= maxDepth` 拦截（index.ts:1068）全部保留。
- grep `maxCallsPerTurn` / `AGENT_CALL_LIMIT_EXCEEDED` 在 `apps/platform-web/src` 应无代码引用残留（spec 文档 Phase 3.3 单独更新）。

### R2 同轮多 agent_call 并行执行

- `executeRuntimeWorkspaceToolCalls`（workspace-tools.ts:1947）：把 `agent_call` 从串行组移出。多个 agent_call 进并行组 `Promise.all`。
- **预算/depth 并发安全**：移除 maxCallsPerTurn 后无 budget 竞争；`callCount += 1` 在 JS 单线程下原子（即使并行闭包交错，单线程无真并发）；depth 是值传递快照，天然并发安全。**无需加锁。**
- **observation 回填**：复用现有 Map-by-index 机制（observations.set(index, result)），并行结果按原 index 回填，返回数组顺序与 calls 对齐。native 循环靠 `result.toolCalls[index].id` 配对，text 循环追加 user observation message——两者都依赖 observation 顺序与原 toolCalls 顺序对齐，现有机制已保证。
- **run_script 仍串行**：`run_script` 有副作用 + bounded timeout，保持串行（不改 `PARALLEL_TOOL_NAMES`，run_script 不加入）。
- **混合轮处理**：一轮里可能既有 agent_call（并行）又有 workspace.write（串行）。并行组先跑完，再跑串行组——但 agent_call 产生的 workspace 写入经由 delegated 的工具循环，与本轮 master 的 workspace 写入都进同一个 staged transaction，turn 成功才提交。并行 agent_call 之间的 workspace 写入冲突由 staged transaction 的最终状态覆盖语义决定（后写覆盖，与串行一致）。

### R3 事件层加 agentId（delegated 过程可见）

- `AgentRuntimeTurnInput` 的 `onDelta`/`onRoundEnd`/`onTool` 签名加 agentId 标识（或事件负载加 agentId）。entry agent 事件带 `agentId: "master"`（或当前 entry agent id），delegated 事件带目标 agent id。
- `createAgentCallRunner`（index.ts:1046）给 delegated 透传 `onDelta`/`onRoundEnd`/`onTool`（带目标 agentId），让子代理过程对上游可见。
- **并发多子代理的事件区分**：并行 agent_call 同时发 delta/tool 事件，靠 agentId 区分。游戏前端按 agentId 分组渲染；AssistantView 暂不分组（单 agent 平铺，桌面助手场景）。
- **bridge 转发**（remote-iframe-bridge.ts:430-450）：`turn-delta`/`turn-round-end`/`turn-tool` 事件负载加 `agentId` 字段。游戏前端可选消费。
- **流式推送订阅**（streaming-events.ts）：pub/sub 事件加 agentId 透传。

### R4 AssistantView 事件接收适配（最小改动）

- AssistantView 的 `onTool`/`onDelta` 回调接收新增的 agentId 参数（桌面助手是单 agent，可忽略 agentId 或仅 log）。不改变渲染逻辑（toolLines 仍平铺）。
- 确保现有桌面助手对话（单 agent、无 agent_call）行为不回归。

## 验收标准

- [ ] `maxCallsPerTurn` 字段从 `AgentRuntimeCollaborationPolicy` 移除，不再作 agent_call 拦截条件；`callCount` 保留作计数/trace；`maxDepth=2` 保留作递归安全网。
- [ ] `AGENT_CALL_LIMIT_EXCEEDED` 错误条件随 R1 移除（不再因次数耗尽拒 agent_call）。
- [ ] 同轮多个 agent_call 并行执行（`Promise.all`），observation 按原索引回填，顺序与模型发出的 toolCalls 对齐。
- [ ] `run_script` 仍串行（不进并行组）。
- [ ] delegated agent_call 的 `onDelta`/`onRoundEnd`/`onTool` 透传到上游，事件负载带 agentId（区分来源 agent）。
- [ ] bridge 转发的 `turn-delta`/`turn-round-end`/`turn-tool` 事件带 `agentId` 字段。
- [ ] master 的 turn 内压缩兜底（一次压缩 + ContextBudgetExhaustedError）行为不回归。
- [ ] `npm run build:contracts && npm run build:web` 通过。
- [ ] 真实 API 实测：模型一轮发多个 agent_call（如同时调记忆 + 状态）并行执行、等待时间缩短；delegated 过程事件在游戏前端/trace 可见且带 agentId；单 agent_call 串行行为不回归；嵌套 agent_call depth 限制仍生效（depth=2 拒绝）。

## 依赖

- 上游：子2（tool-token-budget，R1-R4 已落地）——本任务在其"去硬轮次 + token 预算兜底"基础上移除 agent_call 次数硬限制。delegated 路径仍沿用其"跳过压缩、只走预算兜底"。
- 下游：任务压缩改造（后续独立任务）——子代理/助手消息序列化 + 任务压缩（多次）+ 时长兜底 + 压缩无效早退 + 修正 master 兜底共存。本任务的并行执行 + 事件 agentId 是其执行层基础。

## 关联后续任务（不在本任务范围）

- **任务压缩 + 兜底改造**：子代理/助手 messages 改消息序列（统一构建 helper）+ 任务压缩机制（压整个上下文：工具调用+返回+思考，多次压缩）+ 时长兜底（主 agent 调 agent_call 时传 timeoutMs，有默认，超时=异常）+ 压缩无效早退 + 修正 master 兜底（保持一次压缩，与新机制共存）。根因：两种 agent 压缩对象不同——master 压剧情（一次够，期间不产新剧情）vs 子代理压整个上下文（每次都腾空间，可多次，需时长防死循环）。
- **助手 agent 跨 turn 持久化**：`.tsian/local/assistant/context.json` 任务摘要稳态（类似 master 的 context.json 但存任务摘要）。复用任务压缩机制，加持久化层。

## 开放问题（待 design 决议）

- **并行 agent_call 的 workspace 写入冲突语义**：多个并行子代理同时写同一文件，staged transaction 最终状态如何决定？后写覆盖（与串行一致）是否可接受，还是需要冲突检测/报错？（design 评估）
- **事件 agentId 的签名形态**：`onTool`/`onDelta` 签名是加 agentId 参数，还是包成事件对象？影响下游所有消费者（bridge、AssistantView、streaming-events）。（design 定，倾向最小破坏：加参数）
- **delegated 流式是否影响 onDelta 的 round 语义**：delegated 的 round 是它自己工具循环的 round，与 master 的 round 不同维度。事件里 round 字段的语义在 delegated 场景下如何定义？（design 定）
