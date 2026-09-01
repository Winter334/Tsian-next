# Implement — 流式输出 + 思考流可见（SSE 逐字渲染）

> Design：`design.md`。PRD：`prd.md`。依赖子1（已归档）。

## 执行顺序（每步可独立验证）

### Phase A：模型层流式 adapter（runtime-host/ai.ts）

1. `ProviderAdapter` 接口（`:317`）加 5 个流式方法：`buildStreamUrl(config)`、`buildStreamRequestBody(config, messages, tools)`、`extractStreamDelta(dataLine): string | undefined`、`extractStreamToolCalls(dataLine): NativeToolCall[] | undefined`、`extractStreamFinish(dataLine): "stop" | "tool_calls" | undefined`。
2. `openaiAdapter`（`:341`）实现：
   - `buildStreamUrl` = `buildUrl`。
   - `buildStreamRequestBody` = `buildNativeRequestBody(...)` 后 `body.stream = true`（custom merge 后赋值）。
   - `extractStreamDelta`：`choices[0].delta.content`（string 或 array of `{text}`）。
   - `extractStreamToolCalls`：`choices[0].delta.tool_calls[].{index, function:{name, arguments}}`，返回带 index 增量片段。
   - `extractStreamFinish`：`choices[0].finish_reason` → `tool_calls`/`stop`。
3. `geminiAdapter`（`:571`）实现：
   - `buildStreamUrl` = `buildUrl` 替换 `generateContent` → `streamGenerateContent?alt=sse`。
   - `buildStreamRequestBody` = `buildNativeRequestBody(...)`（不加 stream）。
   - `extractStreamDelta`：`candidates[0].content.parts[].text` 拼接。
   - `extractStreamToolCalls`：`candidates[0].content.parts[].functionCall` → `NativeToolCall`（一次性完整）。
   - `extractStreamFinish`：`candidates[0].finishReason` → `/tool/i.test ? "tool_calls" : "stop"`。
4. `claudeAdapter`（`:713`）实现：
   - `buildStreamUrl` = `buildUrl`。
   - `buildStreamRequestBody` = `buildNativeRequestBody(...)` + `body.stream = true`。
   - event-based：`streamAssistantReplyNative` 维护 `currentEvent`，按 event 分派：
     - `content_block_delta` → `extractStreamDelta(data)` 解析 `data.delta.text`。
     - `content_block_start`(tool_use) + `input_json_delta` → `extractStreamToolCalls` 累积 id/name/arguments。
     - `message_delta` → `extractStreamFinish` 解析 `stop_reason`。
     - `message_stop` → 终止信号。
5. 验证：`vue-tsc -b` 通过。

### Phase B：streamAssistantReplyNative（runtime-host/ai.ts）

6. 新增 `StreamAssistantReplyNativeOptions`（extends `GenerateAssistantReplyNativeOptions` + `onDelta?: (delta: string, round: number) => void`）。
7. 新增 `streamAssistantReplyNative(messages, options)`：
   - config/adapter/url/requestBody/debug 记录（镜像 `generateAssistantReplyNative:955-991`，label `chat-stream`）。
   - `createTimedAbortSignal`（`DEFAULT_CHAT_TIMEOUT_MS`）。
   - `fetch` → 检查 `response.ok`（错误同 native 版）。
   - **非 SSE 回退**：`!response.headers.get("content-type")?.includes("text/event-stream")` → `payload = await response.json()` → `adapter.extractNativeResult(payload)` 返回（不调 onDelta）。
   - **SSE 路径**：`reader = response.body!.getReader()`；`decoder = new TextDecoder()`；`lineBuffer=""`；`textBuffer=""`；`isToolRound=false`；`toolCallAccumulator = new Map<number,{id,name,args:string}>`；`finishReason`；`currentEvent=""`。
   - 读循环：`{done, value} = await reader.read()`；`done` → 处理 lineBuffer 残留 + 终止。`lineBuffer += decoder.decode(value, {stream:true})`；按 `\n` 切分；每行：
     - `event: X` → `currentEvent = X`（Claude）。
     - `data: <json>` → 按协议（OpenAI `[DONE]` 终止 / Gemini reader done / Claude message_stop）解析 delta/tc/finish。
     - `if (delta) { textBuffer += delta; onDelta?.(delta, round) }`（**全推含思考流**）
     - `if (tc) { isToolRound = true; 累积 toolCallAccumulator }`（不推 UI）
     - `if (fr) finishReason = fr`
   - 流结束：
     - `isToolRound || finishReason === "tool_calls"` → 返回 `{text:"", toolCalls: accumulated→JSON.parse→NativeToolCall[], raw:"", finishReason:"tool_calls"}`。**不调 onReset**。
     - 否则 → 返回 `{text: textBuffer, toolCalls: [], raw: textBuffer, finishReason:"stop"}`。
   - 错误 + `updateAiDebugRecord({error})`（同 native 版）。
8. 验证：`vue-tsc -b` 通过。

### Phase C：agent-runtime 透传 + round 绑定（agent-runtime/index.ts）

9. `AgentRuntimeModelCallOptions`（`:63`）加 `onDelta?: (delta: string) => void`（已绑 round，不含 round 参数）。
10. `AgentRuntimeTurnInput`（`:49`）加 `onDelta?: (delta: string, round: number) => void`（含 round）。
11. `runAgentRuntimeTurn`（`:1286`）：
    - entry agent options（`:1316`）：把 `input.onDelta` 包装成绑 round 的 `(d)=>input.onDelta?.(d, round)` 注入。需在 `callAgentModelWithWorkspaceTools` 调用处绑定（round 在 native 循环内变化）。
    - **实现**：`callAgentModelWithWorkspaceToolsNative`（`:1026`）循环内，调 `callModelNative` 前 `const roundOnDelta = options.onDelta ? (d:string) => options.onDelta!(d, round) : undefined`，传给 streamAssistantReplyNative。但 `options.onDelta` 是 `(d)=>void`（已绑入口 round？）——需理清：
      - **方案**：`AgentRuntimeTurnInput.onDelta(delta, round)` 是入口回调；`runAgentRuntimeTurn` 传 `input.onDelta` 给 `callAgentModelWithWorkspaceTools` 的 options.onDelta（签名 `(delta, round)=>void`）；`callAgentModelWithWorkspaceToolsNative` 循环内调 `options.onDelta?.(delta, round)` 直接传 round。`callModelNative` 闭包收到的 options.onDelta 是 `(delta, round)=>void`，转给 streamAssistantReplyNative 的 `onDelta(delta, round)`。
      - 即 `AgentRuntimeModelCallOptions.onDelta` 签名也用 `(delta: string, round: number) => void`，round 在 native 循环内传。
    - delegated agent options（`:895`）：**不注入** onDelta（undefined → 非流式）。
12. `callAgentModelWithWorkspaceToolsNative`（`:991`）循环（`:1026`）：`capabilities.callModelNative!(runtimeMessages, options, tools)` —— options.onDelta 已含 round 签名，streamAssistantReplyNative 调 `onDelta(delta, round)`。**不丢弃工具轮 text**（已通过 onDelta 推 UI）。
13. 验证：`vue-tsc -b` 通过。

### Phase D：platform-host 集成

14. `AssistantChatInput` 加 `onDelta?: (delta: string, round: number) => void` + `signal?: AbortSignal`（停止按钮用）；`runAssistantChat`（`:1703`）：
    - 外部 signal 合并进内部 controller：`if (input.signal) input.signal.addEventListener("abort", ()=>controller.abort())`。
    - `runAgentRuntimeTurn` input 加 `onDelta: input.onDelta`。
15. `runAssistantChat` 的 `callModelNative` 闭包（`:1776`）：
    ```ts
    async callModelNative(messages, options, tools) {
      const agentConfig = resolveAgentModelConfig(options.agentId, providerPresetMap)
      if (!options.onDelta) {
        return generateAssistantReplyNative(messages as RuntimeChatMessage[], {
          debugLabel: options.debugLabel, signal: options.signal, tools,
          ...(agentConfig ? { config: agentConfig } : {}),
        })
      }
      return streamAssistantReplyNative(messages as RuntimeChatMessage[], {
        debugLabel: options.debugLabel, signal: options.signal, tools,
        onDelta: options.onDelta,
        ...(agentConfig ? { config: agentConfig } : {}),
      })
    }
    ```
16. AIRP play turn 的 `callModelNative` 闭包（`:1543`）同样改造（onDelta 来源 AIRP input，见 Phase E）。
17. AIRP `interaction.sendMessage` 的 `runAgentRuntimeTurn` input 注入 `onDelta`（emit turn-delta，见 Phase E）。
18. 验证：`vue-tsc -b` 通过。

### Phase E：bridge 通道（R5）

19. `packages/contracts/src/bridge.ts`：
    - `RemotePlayBridgeEventName` 加 `"turn-delta"`。
    - `RemotePlayBridgeEventPayload` 加 `{ delta: string; turn: number; round: number }`。
20. 新建 `apps/platform-web/src/streaming-events.ts`（镜像 `debug-events.ts`）：`TurnDeltaListener = (delta, turn, round) => void`、`subscribeTurnDelta`、`emitTurnDelta(delta, turn, round)`。
21. `remote-iframe-bridge.ts`（`:422` 区）：`subscribeTurnDelta((delta, turn, round) => postEvent("turn-delta", {delta, turn, round}))`；dispose unsubscribe。
22. AIRP `interaction.sendMessage` 注入 `onDelta: (delta, round) => emitTurnDelta(delta, currentTurnNumber, round)`。
23. 验证：`build:contracts && vue-tsc -b` 通过。

### Phase F：AssistantView UI（R4，含 ①②③）

24. `send()`（`:535`）改造（见 design §8.1）：
    - push `reactive({role:"assistant", content:""})` 占位。
    - **① 打字机队列**：`deltaQueue: string[]` + `requestAnimationFrame` 匀速释放（每帧释放 `max(1, ceil(len/4))` 批）。
    - `onDelta = (delta) => { deltaQueue.push(delta); if (rafId===null) rafId = requestAnimationFrame(flushQueue) }`。
    - `flushQueue`：释放一批 + `maybeScrollToBottom()`（②）。
    - await 后：`cancelAnimationFrame` + 冲刷剩余 + `assistantMsg.content = result.replyText` 校正。
    - catch：冲刷剩余；若 `!assistantMsg.content` → `messages.value.pop()` 撤空占位；设 errorMessage。
25. **② 智能滚动**：加 `userPinnedToBottom = ref(true)`；`handleScroll`（`:571`）更新 `userPinnedToBottom = distance < 80`；`maybeScrollToBottom` 仅 `userPinnedToBottom` 时滚。流式 onDelta 调 `maybeScrollToBottom` 不强行拉。
26. **③ 停止生成按钮**：
    - `abortController: AbortController | null` ref 提到 send 作用域外（组件级）。
    - `runAssistantChat({message, history, onDelta, signal: abortController.signal})`。
    - UI：`v-if="sending"` 显示"停止"按钮，`@click="abortController?.abort()"`。
    - 停止后保留半截 + 追加"（已停止）"标注。
27. typing dots（`:200`）：加 `firstDeltaReceived` ref，`onDelta` 首次置 true；`v-if="sending && !firstDeltaReceived"`。
28. 验证：`vite build` 通过；Playwright 实测逐字流式、停止按钮、智能滚动。

### Phase G：stream 解禁（R6）

29. `config/ai.ts:130` `PROTECTED_CUSTOM_REQUEST_KEYS` 移除 `"stream"`。
30. 确认 `buildStreamRequestBody` 的 `stream:true` 在 custom merge 后赋值。
31. 验证：`vue-tsc -b && vite build` 通过。

## 验证命令

```bash
npm run build:contracts && npm run build:web
# 等价：cd apps/platform-web && npx vue-tsc -b && npx vite build
```

## 风险文件 / 回滚点

- `runtime-host/ai.ts`：新增 `streamAssistantReplyNative` + adapter 5 方法。回滚：`callModelNative` 闭包 `!onDelta` 分支切回 `generateAssistantReplyNative`。
- `agent-runtime/index.ts`：`AgentRuntimeModelCallOptions`/`AgentRuntimeTurnInput` 加可选 onDelta（向后兼容）；entry 注入点。
- `platform-host/index.ts`：两处 `callModelNative` 闭包 + `runAssistantChat` 签名 + signal 合并。
- `contracts/src/bridge.ts`：新增 `turn-delta` 事件（向后兼容）。
- `streaming-events.ts`：新增文件。
- `AssistantView.vue`：`send()` + 打字机队列 + 智能滚动 + 停止按钮。
- `config/ai.ts`：`PROTECTED_CUSTOM_REQUEST_KEYS` 移除 `"stream"`。

## 实测限制（构建无法覆盖）

- 三家 SSE 格式正确性：需真实 OpenAI/Claude/Gemini key 实测。
- 非 SSE 回退：需端点不支持 SSE 场景。
- AbortSignal 中途取消（停止按钮）：需实测。
- 打字机节流 / 智能滚动：Playwright 实测。

## 评审门（task.py start 前）

- [ ] design.md 核心决策（§2 text delta 全推 + 无 onReset + 思考流可见）经确认。
- [ ] Claude SSE event/data 配对方案（§4.2 + Phase A 步骤4）明确。
- [ ] 委托 agent 不流式（§2 + Phase C 步骤11）明确。
- [ ] 非流式回退（§4.4 + Phase D 步骤15 `!onDelta` 分支）明确。
- [ ] onDelta 签名（入口含 round / 透传含 round）一致（Phase C 步骤11 方案）。
- [ ] ①②③ 打字机/智能滚动/停止按钮纳入。
