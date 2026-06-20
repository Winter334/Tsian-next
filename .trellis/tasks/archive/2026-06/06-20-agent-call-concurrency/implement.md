# Implement — 子代理并发改造（同轮多 agent_call 并行 + 移除 maxCallsPerTurn + 事件 agentId）

> 执行计划。按 R 顺序实施，每个 R 是独立提交单元。design.md 是技术依据，本文件是有序清单 + 验证 + 回滚点。
> 行号锚点基于 2026-06-20 勘察（tool-token-budget R1-R4 已提交后），实现时以实际为准。

## 验证命令

| 用途 | 命令 |
|---|---|
| contracts 构建 | `npm run build:contracts` |
| platform-web 构建（含 vue-tsc 类型检查） | `npm run build:web` |
| 全量构建（本任务验收） | `npm run build:contracts && npm run build:web` |

> 仓库无 test 脚本。类型安全靠 `vue-tsc -b`（事件签名变更靠它兜底捕获遗漏消费者）；行为正确性靠真实 API 实测（§收尾 C3-C6）。

## 风险文件

| 文件 | 风险 | 回滚锚 |
|---|---|---|
| `agent-runtime/index.ts` | maxCallsPerTurn 移除点多（policy/default/normalize/metadata/trace/拦截/canExpose）+ 事件签名加 agentId 首参（影响两处工具循环 onTool 绑定 + createAgentCallRunner 透传） | R1/R2/R3 分段提交，类型系统兜底 |
| `agent-runtime/workspace-tools.ts` | agent_call 分组改造（三组分立），分组逻辑 bug 导致 observation 错位 | R2 单独提交，现有 Map-by-index 回填不变 |
| `streaming-events.ts` | pub/sub 签名加 agentId，emit/subscribe 全改 | R3 单独提交，纯签名 |
| `bridge/remote-iframe-bridge.ts` | 转发事件负载加 agentId | R3，类型兜底 |
| `platform-host/index.ts` | master 路径 onDelta 闭包绑 agentId + 桌面助手路径适配 | R3，两处注入点 |
| `views/AssistantView.vue` | onTool/onDelta 回调加 agentId 首参（忽略） | R4，最小改动 |

## 关键实现路径（勘察已确认）

- **maxCallsPerTurn 不在 contracts**：grep `packages/contracts` 无命中，移除只改 index.ts。
- **callCount 保留**：`state.callCount += 1`（index.ts:1113）保留作 trace 计数，只删拦截分支（:1094）和 canExpose 条件（:592）。
- **maxDepth 保留**：字段/默认/normalize/`depth >= maxDepth` 拦截（:1068）全保留。
- **事件链两套路径**：游戏内 master（host:1488 闭包 → emitTurn* → streaming-events → bridge）vs 桌面助手（host:1790 直接传 input.onDelta → AssistantView）。agentId 注入点不同。
- **onTool round 绑定模式**：工具循环里 `options.onTool!(round, callId, ...)`（index.ts:1421），加 agentId 后 `options.onTool!(agentId, round, callId, ...)`，agentId 从 `agentContext.agent.id` 取（delegated 时是目标 id）。
- **executeRuntimeWorkspaceToolCalls 已有 Map-by-index 回填**（workspace-tools.ts:1991 `calls.map((_, index) => observations.get(index)!)`），agent_call 移组后复用，不变。

## 执行清单

### R1 — 移除 maxCallsPerTurn 硬限制（保留 callCount + maxDepth）

> 先做 R1：纯字段/拦截移除，不碰事件签名，为 R2 并行扫清 budget 障碍。

- [ ] **R1.1** `index.ts` `AgentRuntimeCollaborationPolicy`（:193）：删 `maxCallsPerTurn: number`。
- [ ] **R1.2** `index.ts` `DEFAULT_AGENT_RUNTIME_COLLABORATION_POLICY`（:221）：删 `maxCallsPerTurn: 4,`。
- [ ] **R1.3** `index.ts` `normalizeAgentRuntimeCollaborationPolicy`（:300）：删 `maxCallsPerTurn: normalizePolicyInteger(...)` 行。
- [ ] **R1.4** `index.ts` `AgentCallRuntimeMetadata`（:248）：删 `maxCallsPerTurn: number` 字段。
- [ ] **R1.5** `index.ts` `createAgentCallRuntimeMetadata`（:918）：删 `maxCallsPerTurn: collaborationPolicy.maxCallsPerTurn` 赋值。
- [ ] **R1.6** `index.ts` `agentCallTraceFacts`（:938）：删 `maxCallsPerTurn: metadata.maxCallsPerTurn`。
- [ ] **R1.7** `index.ts` `createAgentCallRunner`（:1094）：删整个 `if (state.callCount >= collaborationPolicy.maxCallsPerTurn)` 拦截分支（`AGENT_CALL_LIMIT_EXCEEDED`）。`state.callCount += 1`（:1113）保留。
- [ ] **R1.8** `index.ts` `canExposeAgentCallInPrompt`（:586）：删 `state.callCount < policy.maxCallsPerTurn` 条件（:592），只保留 `depth < policy.maxDepth`。
- [ ] **R1.9** grep `maxCallsPerTurn` / `AGENT_CALL_LIMIT_EXCEEDED` 在 `apps/platform-web/src`——应无代码引用残留（spec 文档 Phase 3.3 单独更新）。
- [ ] **R1.10** 验证：`npm run build:web` 通过（类型系统兜底：若漏删 maxCallsPerTurn 引用，编译报错）。

### R2 — agent_call 移入并行组（单独成组，design §2.2 方案 B）

> R2 改 workspace-tools.ts 的分组逻辑。agent_call 从串行组移出，单独成 agentCallGroup，与 parallelGroup（只读）、serialGroup（write/run_script）三组分立。

- [ ] **R2.1** `workspace-tools.ts` `executeRuntimeWorkspaceToolCalls`（:1947）分组逻辑：
  - 新增 `agentCallIndices: number[]`。
  - 遍历 calls：`isParallelizableToolCall` → parallelIndices；`call.call?.name === RUNTIME_WORKSPACE_TOOL_NAMES.agentCall` → agentCallIndices；其余 → serialIndices。
  - 执行顺序：parallelGroup `Promise.all` → agentCallGroup `Promise.all` → serialGroup 逐个 await（abort 检查保留）。
  - 三组结果都 observations.set(index, result)，最终 `calls.map((_, index) => observations.get(index)!)` 不变。
- [ ] **R2.2** `workspace-tools.ts` `PARALLEL_TOOL_NAMES` 注释（:1924）更新：说明 agent_call 单独成组（不混入只读组），因其跑 delegated 工具循环有状态/写入。
- [ ] **R2.3** 验证：`npm run build:web` 通过。手动 reasoning：单 agent_call 落 agentCallGroup（Promise.all 单元素 = 等同串行，不回归）；多 agent_call 并行；write/run_script 仍 serialGroup 串行。

### R3 — 事件层加 agentId（签名变更，全链路）

> R3 是破坏性签名变更：runtime 回调 + streaming-events + bridge + host 注入点 + createAgentCallRunner 透传。一条链路全改，类型系统兜底捕获遗漏。

- [ ] **R3.1** `index.ts` `AgentRuntimeTurnInput` 的 onDelta/onRoundEnd/onTool 签名（:79-99）加 agentId 首参：
  - `onDelta?: (agentId: string, delta: string, round: number) => void`
  - `onRoundEnd?: (agentId: string, round: number, finishReason: "stop" | "tool_calls") => void`
  - `onTool?: (agentId: string, round: number, callId: string, name: string, status, output?) => void`
  - `AgentRuntimeModelCallOptions` 的 onDelta/onRoundEnd/onTool（:140-146）同步加 agentId 首参。
- [ ] **R3.2** `index.ts` 两处工具循环的 onTool 绑定（native :1420、text 对称处）：`options.onTool!(round, callId, ...)` → `options.onTool!(agentContext.agent.id, round, callId, ...)`。agentId 从当前循环的 `agentContext.agent.id` 取（delegated 时是目标 agent id）。
- [ ] **R3.3** `index.ts` 两处工具循环的 onDelta/onRoundEnd 调用点（native callModelNative 后 onRoundEnd、text 对称处）：加 agentId 首参（`agentContext.agent.id`）。onDelta 在 streamAssistantReplyNative 内部触发——确认其 onDelta 回调签名链路（AgentRuntimeModelCallOptions.onDelta → streamAssistantReplyNative onDelta）加 agentId。
- [ ] **R3.4** `index.ts` `createAgentCallRunner`（:1133）给 delegated 透传 onDelta/onRoundEnd/onTool：
  - callOptions（:1147）加 `onDelta: input.onDelta`、`onRoundEnd: input.onRoundEnd`、`onTool: input.onTool`。
  - delegated 工具循环内部 emit 时 agentId = `targetContext.agent.id`（由 R3.2 的 `agentContext.agent.id` 自动取到——delegated 循环的 agentContext 是 targetContext）。
  - delegated 流式 onDelta：确认 `callModelNative` 闭包的 onDelta 链路（delegated 用 non-SSE fallback，不流式——但签名要兼容）。delegated 的 onRoundEnd/onTool 仍发（工具过程可见），onDelta 可能不发（non-SSE）。
- [ ] **R3.5** `streaming-events.ts`：`TurnDeltaListener`/`TurnRoundEndListener`/`TurnToolListener` 类型 + `emitTurnDelta`/`emitTurnRoundEnd`/`emitTurnTool` 函数签名加 agentId 首参。listener 调用传 agentId。
- [ ] **R3.6** `platform-host/index.ts` master 路径（:1488-1490）：onDelta/onRoundEnd/onTool 闭包加 agentId 首参——runtime emit 时已带 "master"（entry agent id），闭包透传到 emitTurn*：`onDelta: (agentId, delta, round) => emitTurnDelta(agentId, delta, nextTurn, round)` 等。
- [ ] **R3.7** `platform-host/index.ts` 桌面助手路径（:1790-1794）：`runAssistantChat` 的 `AssistantChatInput` 的 onDelta/onTool 类型加 agentId 首参。host 传 `onDelta: input.onDelta` 时透传 agentId（桌面助手 agent 是 LOCAL_ASSISTANT_AGENT_ID，runtime emit 时带它）。
- [ ] **R3.8** `bridge/remote-iframe-bridge.ts`（:430-450）：`turn-delta`/`turn-round-end`/`turn-tool` 的 postEvent 负载加 `agentId`。subscribe 回调签名同步（接收 agentId 首参）。
- [ ] **R3.9** 验证：`npm run build:web` 通过（vue-tsc 兜底：遗漏的消费者编译报错）。

### R4 — AssistantView 事件接收适配（最小改动）

> R4 让桌面助手对话界面接收新签名的回调，不改变渲染。

- [ ] **R4.1** `views/AssistantView.vue` `onDelta` 回调（:610）：加 agentId 首参（忽略，桌面助手单 agent）。`const onDelta = (agentId: string, delta: string) => { ... }`——agentId 不用，但签名要对。
- [ ] **R4.2** `views/AssistantView.vue` `onTool` 回调（:632）：加 agentId 首参。`const onTool = (agentId: string, callId: string, name: string, status, output?) => { ... }`——agentId 不用。
- [ ] **R4.3** `views/AssistantView.vue` `runAssistantChat` 调用处（:655-661）：onDelta/onTool 透传新签名。
- [ ] **R4.4** 验证：`npm run build:web` 通过。确认桌面助手对话（单 agent、无 agent_call）行为不回归。

### 收尾

- [ ] **C1** 全量 grep 残留：`maxCallsPerTurn` / `AGENT_CALL_LIMIT_EXCEEDED` 在 `apps/platform-web/src` 应无代码引用（spec 文档 Phase 3.3 单独更新）。
- [ ] **C2** `npm run build:contracts && npm run build:web` 最终通过。
- [ ] **C3** 真实 API 实测（同轮多 agent_call 并行）：模型一轮发 agent_call(memory)+agent_call(state)，确认并行执行（trace 事件 agentId 交错/时间戳）、等待时间短于串行、observation 按原 index 回填、master 下一轮看到正确 observation 顺序。
- [ ] **C4** 真实 API 实测（delegated 过程可见）：游戏前端收到带 agentId="memory"/"state" 的 turn-delta/turn-tool 事件，能区分是哪个子代理。
- [ ] **C5** 真实 API 实测（不回归）：单 agent_call 串行行为同改造前（除事件带 agentId）；嵌套 agent_call depth=2 仍拒（AGENT_CALL_UNAVAILABLE）；maxCallsPerTurn 移除后发 5+ agent_call 不再被 AGENT_CALL_LIMIT_EXCEEDED 拒。
- [ ] **C6** 真实 API 实测（master 兜底不回归）：master turn 内压缩 + ContextBudgetExhaustedError 行为不变（tool-token-budget R2 逻辑未被破坏）。
- [ ] **C7** Phase 3.3 spec 同步：type-safety.md 的 collaboration policy 记载（移除 maxCallsPerTurn，保留 maxDepth + callCount 计数）+ error matrix 的 AGENT_CALL_LIMIT_EXCEEDED 条目移除 + 新增"同轮多 agent_call 并行 + 事件 agentId"机制契约。

## 回滚点

- R1 独立（字段移除，回滚恢复 maxCallsPerTurn 拦截）。
- R2 独立（分组改造，回滚恢复 agent_call 串行组）。
- R3 是签名破坏点（事件 agentId）——若消费者适配遗漏导致编译错，类型系统兜底；回滚 R3 恢复旧签名（但 R1/R2 的并行 + 移除 maxCallsPerTurn 仍有效，只是事件无 agentId、delegated 仍 silent）。
- R4 独立（AssistantView 回调适配，回滚恢复旧签名——但依赖 R3，R3 回滚则 R4 一起回滚）。

## task.py start 前检查

- [ ] design.md 已完成（开放问题已决议）。
- [ ] implement.md 已完成（有序清单 + 验证命令）。
- [ ] implement.jsonl / check.jsonl 已配 spec 引用（1.3）。
- [ ] 用户审查通过 design.md + implement.md。
