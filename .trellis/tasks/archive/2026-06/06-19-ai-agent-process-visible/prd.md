# PRD — 工具过程可见 + 并行执行

> 父任务：`06-19-ai-streaming-response`。**依赖子任务 `06-19-ai-streaming-sse`（子2a，流式输出 + 思考流可见）先完成**——本任务在子2a 的流式通道（`turn-delta` 事件 + `streamAssistantReplyNative` + `onDelta` 透传）上叠加工具过程事件与并行执行。

## 目标与用户价值
- **工具过程可见**：让玩家看到 agent 的工具调用过程（调用什么工具、执行状态、输出结果），默认折叠、想看再展开。配合子2a 的思考流可见，让玩家在等待时实时感知 agent 在干什么，发现问题时可展开复查、据此选择回滚检查点 / 叫助手优化 / 手动编辑，而非对着黑箱干等。这是 Tsian 区别于普通聊天客户端的差异化价值。
- **单轮内工具并行执行**：当模型一轮返回多个 tool_calls 时，对无状态/无依赖的工具并行执行，减少同一轮工具执行总耗时（串行 N 个 → 并行 1 个的延迟），间接减少 token 消耗（更快拿到结果、整体更顺滑）。

## 依赖（来自子2a 流式输出）
- 子2a 完成后：`streamAssistantReplyNative` 提供 text/tool_call delta 分离；`turn-delta` 事件（带 turn/round）已从 bridge 推出；`onDelta` 已透传到 runtime；`streaming-events.ts` 已建。
- 本任务在此基础上加：`turn-round-end` 事件（本轮结束 + 类型）、`turn-tool` 事件（工具调用状态/输出）；`executeRuntimeWorkspaceToolCalls` 并行化（无状态工具）。

## 确认事实（来自勘察）
- `callAgentModelWithWorkspaceToolsNative`（`agent-runtime/index.ts:991`）：每轮调 `callModelNative` → `streamAssistantReplyNative`；`finishReason==="tool_calls"` 时调 `executeRuntimeWorkspaceToolCalls({...}, toolCalls)`（`:1074`）执行工具，observations 累积进 runtimeMessages 进下一轮。
- `executeRuntimeWorkspaceToolCalls`（`workspace-tools.ts:1983`）是 `for` 循环顺序 `await`（`:1988` `for (const [index, call] of calls.entries()) observations.push(await executeRuntimeWorkspaceToolCall(...))`），即使一轮多个 tool_calls 也串行。
- `NativeToolCall.id`（`runtime-host/ai.ts:20`）已有 provider 分配的 id，可用于并行调用区分（对应 Codex call_id 思路）。
- `streaming-events.ts`（子2a 新建）是 Set pub/sub，可扩展 `emitTurnTool`/`subscribeTurnTool`/`emitTurnRoundEnd`。
- `contracts/src/bridge.ts` `RemotePlayBridgeEventName` 子2a 已加 `"turn-delta"`；本任务加 `"turn-round-end"` + `"turn-tool"`。
- 工具执行有共享状态边界：`agent_call` 有共享 `agentCallState`（callCount/depth budget，`agent-runtime/index.ts`）；`workspace_write` 类有 workspace 文件状态依赖（写 A 再写 B 顺序可能重要）。

## 需求

### R1 turn-round-end 事件（本轮结束 + 类型标记）
- 流式每轮（每次 `callModelNative` 调用对应一轮 SSE）结束时，平台推 `turn-round-end` 事件，携带 `{turn, round, kind: "thought" | "final"}`。
  - `kind: "thought"`：本轮是思考轮（`finishReason==="tool_calls"` 或有 tool_calls），text delta 属思考流。
  - `kind: "final"`：本轮是最终轮（`finishReason==="stop"`），text delta 属最终回复。
- 游戏前端据此把 `turn-delta` 的 text 归类到"思考"或"最终"区块（子2a 推 turn-delta 时只有 turn/round，前端无法区分；本事件补上归类）。
- `streaming-events.ts` 加 `emitTurnRoundEnd(turn, round, kind)` / `subscribeTurnRoundEnd`。
- `contracts` `RemotePlayBridgeEventName` 加 `"turn-round-end"`；payload 加 `{turn, round, kind}`。
- `remote-iframe-bridge.ts` 订阅转发。
- runtime 在 `callAgentModelWithWorkspaceToolsNative` 轮结束处发（runtime 层已知 round + finishReason）。

### R2 turn-tool 事件（工具调用状态 + 输出）
- 工具执行时，平台推 `turn-tool` 事件，携带 `{turn, round, callId, name, status: "loading" | "running" | "success" | "failed", output?: string}`。
  - `loading`：工具即将执行（参数已解析）。
  - `running`：执行中（长耗时工具可选，如 browser_script；workspace 操作内存级快，可能直接 loading→success）。
  - `success`：执行完成，`output` 携带结果（折叠展示，过长截断 + "显示更多"）。
  - `failed`：执行失败，`output` 携带错误信息。
- 游戏前端据此渲染工具卡片（Loading 骨架/名称 → Success/Failed 状态徽标，点击展开 output）。
- `executeRuntimeWorkspaceToolCalls`（`workspace-tools.ts:1983`）每个工具执行前后发 `emitTurnTool`。
- `streaming-events.ts` 加 `emitTurnTool` / `subscribeTurnTool`。
- `contracts` 加 `"turn-tool"` + payload。
- `remote-iframe-bridge.ts` 订阅转发。

### R3 单轮内无状态工具并行执行
- `executeRuntimeWorkspaceToolCalls` 改为：对**无状态/无依赖的工具**并行执行（`Promise.all`），对**有状态/有依赖的工具**保持串行。
- **并行白名单**（无状态、可并行）：
  - `skill_load`（只读 skill 注册表，无 workspace 副作用）。
  - `workspace.read` / `workspace.list` / `workspace.search`（只读）。
  - `action_call` 的 `builtin`(validation/echo) / `workspace_operation` 的 read 类（只读）。
- **串行保留**（有状态/有依赖/有预算）：
  - `agent_call`（共享 `agentCallState` callCount/depth budget，并行会绕过预算检查 + 嵌套复杂）。
  - `workspace.write` / `workspace.patch` / `workspace.move` / `workspace.delete`（workspace 文件状态依赖，写顺序可能重要）。
  - `browser_script`（可能有 workspace 写副作用 + Worker 资源）。
  - `workspace_operation` 的 write/patch/delete/move。
- 实现：`executeRuntimeWorkspaceToolCalls` 按 call.name 分两组（并行组 / 串行组），并行组 `Promise.all`，串行组顺序 await，合并 observations 按 index 还原顺序（observations 需与 toolCalls index 对齐回填 runtimeMessages）。

### R4 system prompt 引导并行调用（可选，鼓励模型一轮多发 tool_calls）
- native 模式 `buildWorkspaceToolInstructions` 追加提示："如果需要同时调用多个独立的只读工具（如查询多个文件），可以在一轮中同时发起多个工具调用，它们会并行执行。"
- 目的：鼓励模型主动并行，最大化 R3 的收益（模型行为不可控，但 prompt 引导提高概率）。

### R5 桌面 AssistantView 工具过程基础呈现（最小）
- 桌面 AssistantView 可选展示工具过程（折叠行："🔧 skill_load ✓ → ▸输出"），但**不追求小说式/多态卡片**（归 play 前端）。
- 若实现成本高，桌面 AssistantView 可只显示"正在调用工具…"状态行，详细呈现归 play 前端消费 `turn-tool` 事件。

## 验收标准
- [ ] `turn-round-end` 事件从 bridge 推出（带 turn/round/kind），游戏前端可据此区分思考/最终。
- [ ] `turn-tool` 事件从 bridge 推出（带 callId/name/status/output），游戏前端可渲染工具卡片。
- [ ] 单轮内多个无状态工具并行执行（实测：一轮 2+ 个 workspace.read 并行，总耗时 ≈ 最慢一个而非累加）。
- [ ] 有状态工具（agent_call/workspace.write）保持串行，预算/状态正确。
- [ ] observations 与 toolCalls index 对齐（runtimeMessages 回填正确）。
- [ ] system prompt 引导并行（可选，实测模型是否多发 tool_calls）。
- [ ] 桌面 AssistantView 工具过程基础呈现（可选，状态行）。
- [ ] `npm run build`（含 contracts）通过。

## 明确不做（本任务范围外）
- 不做 play 前端小说式/多态卡片的完整呈现（归游戏前端，平台只推事件）。
- 不做跨轮并行（每轮工具独立执行；并行只在单轮内）。
- 不做 Partial JSON Parser（工具轮静默后台累积，不实时渲染工具参数 UI，无闪烁）。
- 不做 thought 推理流事件（思考流是 text delta，子2a 已推 turn-delta；本任务只加 round-end 归类 + tool 事件）。
- 不做长耗时心跳（workspace 工具内存级快；browser_script 有 timeoutMs 兜底；running 状态可选）。
- 不做 agent_call / workspace.write 并行（安全约束，保持串行）。

## 开放问题
- `turn-tool` 的 `output` 截断阈值：多长算"过长"？倾向 500 字符截断 + "显示更多"，实现时定。
- 桌面 AssistantView 工具过程呈现做到什么程度：只状态行 vs 折叠 + output？倾向只状态行（详细归 play 前端），实现时定。
- R4 system prompt 引导是否有效（模型行为不可控）：实测后定，无效则不强加（避免 prompt 噪音）。
