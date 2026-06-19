# Implement — 工具过程可见 + 并行执行

> Design：`design.md`。PRD：`prd.md`。依赖子2a `06-19-ai-streaming-sse`（代码已提交 `bace0b2`，待真实 key 实测归档）。
>
> **本清单基于 design §2 推荐方案 A（按顶层工具名并行分组）**。若评审门改选方案 B（穿透 action_call executor），在 Phase E 步骤 2 替换 `isParallelizableToolName` 为 executor 预解析逻辑，并加 skill load 预解析步骤。

## 执行顺序（每步可独立验证）

### Phase A：contracts 事件类型（R1 + R2）

1. `packages/contracts/src/bridge.ts`：
   - `RemotePlayBridgeEventName` 追加 `"turn-round-end"` | `"turn-tool"`。
   - `RemotePlayBridgeEventPayload` 追加：
     - `{ turn: number; round: number; kind: "thought" | "final" }`（R1）。
     - `{ turn: number; round: number; callId: string; name: string; status: "loading" | "running" | "success" | "failed"; output?: string }`（R2）。
2. 验证：`npm run build:contracts` 通过。

### Phase B：streaming-events 扩展

3. `apps/platform-web/src/streaming-events.ts`：镜像现有 `subscribeTurnDelta`/`emitTurnDelta`，新增：
   - `TurnRoundEndListener = (turn, round, kind: "thought"|"final") => void` + `subscribeTurnRoundEnd` + `emitTurnRoundEnd`。
   - `TurnToolListener = (turn, round, callId, name, status, output?) => void` + `subscribeTurnTool` + `emitTurnTool`。
   - 复用 Set pub/sub + 浅克隆迭代 + 异常吞掉 console.error 模式（照抄 turn-delta 块，改 listener 类型与签名）。
4. 验证：`vue-tsc -b` 通过。

### Phase C：remote-iframe-bridge 订阅转发

5. `apps/platform-web/src/bridge/remote-iframe-bridge.ts`（`:429` turn-delta 转发块旁）：
   - `subscribeTurnRoundEnd((turn, round, kind) => postEvent("turn-round-end", { turn, round, kind }))`。
   - `subscribeTurnTool((turn, round, callId, name, status, output) => postEvent("turn-tool", { turn, round, callId, name, status, ...(output !== undefined ? { output } : {}) }))`。
   - dispose 处（`:437` 区）加 `unsubscribeTurnRoundEnd?.()` + `unsubscribeTurnTool?.()`。
6. 验证：`vue-tsc -b` 通过。

### Phase D：runtime 类型 + 透传（agent-runtime/index.ts）

7. `AgentRuntimeTurnInput`（`:49`）：加 `onRoundEnd?: (round, finishReason: "stop"|"tool_calls") => void` + `onTool?: (round, callId, name, status, output?) => void`。
8. `AgentRuntimeModelCallOptions`（`:73`）：加同名 `onRoundEnd` + `onTool`（签名同上，含 round）。
9. entry agent options 注入（`:1338`）：`onRoundEnd: input.onRoundEnd`、`onTool: input.onTool`（与现有 `onDelta: input.onDelta` 并列）。
10. delegated agent options（`:899`）：**不注入** onRoundEnd/onTool（与 onDelta 同理，委托 agent 静默）。
11. native 循环（`:1040`）每轮 `callModelNative` 返回后（`:1047` 之后、stop 分支 `:1051` 与 tool 分支 `:1095` 之前）调：
    ```ts
    options.onRoundEnd?.(round, result.finishReason)
    ```
    > `callOptions`（`:1043`）经 `...options` 展开已带 `onRoundEnd`/`onTool`，无需额外赋值。
12. `executeRuntimeWorkspaceToolCalls` 调用处（`:1095`）：context 加 `onTool`（绑 round 的闭包）：
    ```ts
    const observations = await executeRuntimeWorkspaceToolCalls({
      // ...现有字段...
      onTool: options.onTool
        ? (callId, name, status, output) => options.onTool!(round, callId, name, status, output)
        : undefined,
    }, toolCalls)
    ```
    并在调用前把 native callId 写入 calls（见 Phase E 步骤 4）。
13. 验证：`vue-tsc -b` 通过。

### Phase E：workspace-tools 并行化 + turn-tool 发射（workspace-tools.ts）

14. `ParsedRuntimeWorkspaceToolCall`（`:44`）或 `RuntimeWorkspaceToolCall`（`:21`）加可选 `id?: string`（向后兼容）。
15. `RuntimeWorkspaceToolExecutionContext` 加 `onTool?: (callId, name, status: "loading"|"running"|"success"|"failed", output?) => void`（不含 turn/round，已由调用方绑 round，见步骤 12）。
16. 新增并行分组常量 + 判断（方案 A）：
    ```ts
    const PARALLEL_TOOL_NAMES = new Set<string>([
      RUNTIME_WORKSPACE_TOOL_NAMES.skillLoad,
      RUNTIME_WORKSPACE_TOOL_NAMES.workspaceRead,
      RUNTIME_WORKSPACE_TOOL_NAMES.workspaceList,
      RUNTIME_WORKSPACE_TOOL_NAMES.workspaceSearch,
      RUNTIME_WORKSPACE_TOOL_NAMES.workspaceDiff,
      RUNTIME_WORKSPACE_TOOL_NAMES.workspaceValidate,
    ])
    function isParallelizableToolName(name: string): boolean {
      return PARALLEL_TOOL_NAMES.has(name)
    }
    ```
17. 改造 `executeRuntimeWorkspaceToolCalls`（`:1983`）：
    - 分组：遍历 calls，`call.error || !call.call` 或 `!isParallelizableToolName(call.call.name)` → serialIndices；否则 parallelIndices。
    - 并行组 `Promise.all(parallelIndices.map(i => executeRuntimeWorkspaceToolCall(context, calls[i], i)))`，结果按 index 回填 `Map<number, observation>`。
    - 串行组 `for (const index of serialIndices) { assertNotAborted(context.signal); observations.set(index, await executeRuntimeWorkspaceToolCall(...)) }`。
    - 返回 `calls.map((_, i) => observations.get(i)!)`（index 升序还原，保不变量）。
18. `executeRuntimeWorkspaceToolCall`（`:1860` 区）内注入 turn-tool 发射：
    - `parsed.error` / `!call` 的提前 return（`:1880`/`:1888`）：**不发** turn-tool（无有意义 name/callId）。
    - call 确认后、try 块前：`context.onTool?.(callId, call.name, "loading")`。
    - try 块成功结束（observation 构造完，return 前）：`context.onTool?.(callId, call.name, "success", truncateToolOutput(observation))`。
    - catch 块（`:1961`）：`context.onTool?.(callId, call.name, "failed", errorMessage(error))` 后再构造 failed observation。
    - `callId = call.id ?? \`tool-${index}\``（native 有 id，text 兜底）。
19. 新增 `truncateToolOutput(observation)`：`JSON.stringify(observation.result)` 超 500 字符截断 + "…(已截断)"；`errorMessage(error)`：`error instanceof Error ? error.message : String(error)`。
20. 验证：`vue-tsc -b` 通过。

### Phase F：platform-host 绑 turn + 注入（platform-host/index.ts）

21. 新增 `finishReasonToKind(fr: "stop"|"tool_calls"): "thought"|"final"`（`fr === "tool_calls" ? "thought" : "final"`），放文件顶部 helper 区。
22. AIRP `interaction.sendMessage` 的 `runAgentRuntimeTurn` input（`:1525` 区，子2a onDelta 注入旁）加：
    ```ts
    onRoundEnd: (round, finishReason) => emitTurnRoundEnd(nextTurn, round, finishReasonToKind(finishReason)),
    onTool: (round, callId, name, status, output) => emitTurnTool(nextTurn, round, callId, name, status, output),
    ```
23. import `emitTurnRoundEnd`/`emitTurnTool` from `../streaming-events`（现有 `emitTurnDelta` import 旁）。
24. 桌面 `runAssistantChat` 的 input（`:1801` 区）：加 `onTool: input.onTool`（桌面不绑 turn、不发 bridge，直接透传给 AssistantView）；`onRoundEnd` 桌面不传（桌面不区分 thought/final）。
25. `AssistantChatInput`（`:1703` 区）加 `onTool?: (callId, name, status, output?) => void`（不含 round/turn，桌面 view 直接消费）。
26. native 循环调用 `executeRuntimeWorkspaceToolCalls` 前写 callId（配合 Phase E 步骤 14 的 id 字段）：在 `index.ts:1095` 调用前，`toolCalls.forEach((tc, i) => { if (calls[i]?.call) calls[i].call!.id = tc.id })`。
27. 验证：`vue-tsc -b` 通过。

### Phase G：桌面 AssistantView 工具过程行（R5，最小）

28. `AssistantView.vue`：加 `toolLines: Ref<Array<{ callId: string; name: string; status: string; output?: string }>>`（或挂在当前 assistantMsg 上的字段，随消息一起持久化与否——倾向**不持久化**，工具过程是瞬时呈现，刷新后只留最终回复，同子2a 流式文本校正后只存 result.replyText）。
29. `send()` 的 `runAssistantChat` 调用加 `onTool: (callId, name, status, output) => { 更新 toolLines 对应 callId 行 }`：
    - loading → push 新行 `{ callId, name, status: "loading" }`。
    - success/failed → 找到 callId 行更新 status + output。
30. UI：assistant 消息区下方 `v-for` 渲染 toolLines，"🔧 {name} 执行中…" / "🔧 {name} ✓" / "🔧 {name} ✗ {output截断}"。
31. 流式结束（await 后 / catch）：清空 toolLines（工具过程是瞬时态，结束后消失；最终回复保留）。
32. 验证：`vite build` 通过；Playwright 实测工具调用时状态行出现。

### Phase H：system prompt 引导并行（R4，可选）

33. `buildWorkspaceToolInstructions`（native 工具说明构建处）追加："如果需要同时调用多个独立的只读工具（如查询多个文件、列出多个目录），可以在一轮中同时发起多个工具调用，它们会并行执行以减少等待。"
34. 验证：`vue-tsc -b` 通过。**实测后定去留**——若模型不响应则移除（避免 prompt 噪音）。

## 验证命令

```bash
npm run build:contracts && npm run build:web
# 等价：cd apps/platform-web && npx vue-tsc -b && npx vite build
```

## 风险文件 / 回滚点

- `packages/contracts/src/bridge.ts`：新增 2 个 event union 成员（向后兼容）。回滚：移除成员。
- `apps/platform-web/src/streaming-events.ts`：新增 2 对 pub/sub。回滚：删除。
- `apps/platform-web/src/bridge/remote-iframe-bridge.ts`：新增 2 个 subscribe 转发 + dispose unsubscribe。回滚：删除转发块。
- `apps/platform-web/src/agent-runtime/index.ts`：`AgentRuntimeTurnInput`/`AgentRuntimeModelCallOptions` 加可选 onRoundEnd/onTool；native 循环 onRoundEnd 调用 + callId 写入。回滚：移除注入与调用。
- `apps/platform-web/src/agent-runtime/workspace-tools.ts`：`executeRuntimeWorkspaceToolCalls` 并行化 + `executeRuntimeWorkspaceToolCall` turn-tool 发射 + context 加 onTool + call id 字段。回滚：恢复 `for await` 顺序循环 + 移除 onTool 发射。
- `apps/platform-web/src/platform-host/index.ts`：AIRP/Assistant input 注入 onRoundEnd/onTool + finishReasonToKind + AssistantChatInput 加 onTool。回滚：移除注入。
- `apps/platform-web/src/views/AssistantView.vue`：toolLines + onTool + UI 行。回滚：移除 toolLines 与 UI。

## 实测限制（构建无法覆盖，归浏览器实测）

- `turn-round-end`/`turn-tool` 在真实 native tool-call 流程中正确触发（需真实 key + 触发工具调用的对话）。
- 单轮内多个只读工具实际并行（实测：让模型一轮发 2+ 个 `workspace.read`，总耗时 ≈ 最慢一个而非累加）。
- 有状态工具（`agent_call`/`workspace.write`）保持串行，预算/状态正确。
- abort 中途取消时并行组 `Promise.all` 行为（任一 reject 即整体 reject，已完成 observation 保留）。
- R4 system prompt 引导是否让模型多发 tool_calls（实测后定去留）。

## 评审门（task.py start 前）

- [ ] 并行分组方案 A（推荐，按顶层工具名）vs B（prd R3 倾向，穿透 action_call executor）——定哪个。
- [ ] `turn-tool` output 截断阈值 500 字符（design §6.3）确认。
- [ ] 桌面 AssistantView 呈现度：只状态行（design §8）确认。
- [ ] `running` 状态不实现（design §6.3）确认。
- [ ] text 模式也享受并行（design §1 澄清，与流式正交）确认。
- [ ] callId 透传：native 用 provider id、text 用 `tool-${index}` 兜底（design §6.4）确认。
- [ ] 桌面 toolLines 不持久化（瞬时态，刷新后只留最终回复）确认。
