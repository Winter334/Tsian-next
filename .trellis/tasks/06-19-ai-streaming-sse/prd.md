# PRD — 流式输出（SSE 逐字渲染）

> 父任务：`06-19-ai-streaming-response`。**依赖子任务 `06-19-native-tool-calling` 先完成**——流式依赖原生工具调用提供的结构化 text/tool_call 事件边界。

## 目标与用户价值
- 让 AI 回复逐字流式出现，而非整段一次性出现，改善对话/剧情等待体验。
- 仅在 `toolCallMode=native` 模式下支持流式：流式响应中 text delta 与 tool_call delta 是不同事件类型，可干净分离——文本实时推 UI、工具调用后台累积，全程真流式无回滚。
- `toolCallMode=text` 模式下不流式（一次性返回，同现状），因为文本协议无法干净分离 text/tool 边界。

## 依赖（来自子1 原生工具调用）
- 子1 完成后，adapter 层有 `extractToolCalls(payload)` 解析原生工具调用、`buildToolRequestBody` 传 tools。
- 本任务在此基础上加流式：`extractStreamDelta`（text delta）+ `extractStreamToolCalls`（tool_call delta 累积）。

## 确认事实（来自勘察）
- `generateAssistantReply`（`runtime-host/ai.ts:451`）返回 `Promise<string>`，`fetchJsonWithTimeout`（`:491`）一次性 `response.json()`，无 ReadableStream/SSE。
- `config/ai.ts:110` `"stream"` 在 `PROTECTED_CUSTOM_REQUEST_KEYS`，用户无法手动开启。
- AssistantView（`views/AssistantView.vue:528-562`）只显示 `result.replyText`（最终回复），`messages.push({role:"assistant", content: result.replyText})` 一次性追加；typing dots 是占位符非内容。
- `runAssistantChat`（`platform-host/index.ts:1684`）总构建 workspaceFiles → entry agent 总走 tool-loop path（`agent-runtime/index.ts:958+`）。
- bridge 层（`remote-iframe-bridge.ts`）只有 `turn-completed`/`turn-debug-ready` 事件，`sendMessage` 是 request/response 一次性。
- AssistantView 是进程内调用 `runAssistantChat`（不走 bridge）；play 前端走 iframe bridge。

## 需求

### R1 模型层流式（runtime-host/ai.ts）
- 每个 adapter 加 `buildStreamUrl`（Gemini 切 `:streamGenerateContent?alt=sse`，其余 URL 不变）、`buildStreamRequestBody`（OpenAI/Claude/DeepSeek 注入 `stream:true`，Gemini 靠 URL）、`extractStreamDelta(dataLine)`（解析各家 SSE text delta）。
- 三家 SSE 格式：
  - OpenAI/DeepSeek：`data:{choices[].delta.content}` + `data:[DONE]`。
  - Gemini：`candidates[0].content.parts[].text`，无 `[DONE]`（流关闭即终止）。
  - Claude：`event:content_block_delta` + `data:{delta.text}`，`message_stop` 终止。
- 新增 `streamAssistantReply(messages, {onDelta, ...options}): Promise<string>`：`fetch` + `getReader()` + `TextDecoder` 逐块读，按 SSE 边界切分，每 delta 调 `onDelta` + 累积完整字符串。复用 `createTimedAbortSignal`（10 分钟超时）。
- **非 SSE 回退**：`content-type` 非 `text/event-stream` 时降级走 `response.json()` + `extractText`（不调 onDelta）。

### R2 流式工具调用 delta（依赖子1）
- 流式响应中 tool_call delta 与 text delta 分离：text delta → `onDelta` 推 UI；tool_call delta → 后台累积成 `ParsedRuntimeWorkspaceToolCall[]`（不推 UI）。
- `extractStreamToolCalls(delta)`：OpenAI `choices[0].delta.tool_calls[].function.{name,arguments增量}`、Gemini `functionCall` part、Claude `input_json_delta` 累积。
- `finish_reason`（OpenAI `tool_calls`/`stop`、Gemini `finishReason`、Claude `message_delta.stop_reason`）决定是继续工具循环还是最终回复。

### R3 agent runtime 集成
- `AgentRuntimeModelCallOptions` 加 `onDelta?: (delta: string) => void`。
- `callAgentModelWithWorkspaceTools`：`toolCallMode=native` 时，`callModel` 流式返回，text delta 经 `onDelta` 推 UI，tool_calls 后台累积；`finish_reason:stop` 时文本已是最终回复（已实时显示）；`finish_reason:tool_calls` 时执行工具、进下一轮（本轮文本不显示——原生工具模式下 text 和 tool_call 分离，工具轮可能无 text delta 或 text 是思考过程，见开放问题）。
- `toolCallMode=text` 模式：不流式，`callModel` 仍返回 `Promise<ModelCallResult>` 一次性，无 onDelta。

### R4 platform-host + UI
- `runAssistantChat` 加 `onDelta?` 转发进 `callModel` 闭包（用 `streamAssistantReply`）。
- AssistantView `send()`：await 前 push 空 assistant 消息 `messages.push({role:"assistant", content:""})`，`onDelta` 追加 `content += delta`；await 后用 `result.replyText` 校正（消除 trim 差异）。markdown 渲染节流（~50ms）。`persistCurrentSession` 仍在 await 后调（不保存半截文本）。
- typing dots 保留到第一个 delta 到达后隐藏。

### R5 bridge 通道（play 前端）
- `contracts/src/bridge.ts`：`RemotePlayBridgeEventName` 加 `"turn-delta"` + payload 类型 `{delta:string, turn:number}`。
- 新建 `streaming-events.ts`：`emitTurnDelta`/`subscribeTurnDelta`（Set<Listener>，独立于 debug-events）。
- `remote-iframe-bridge.ts`：订阅 `streaming-events`，转发为 `postEvent("turn-delta", {delta, turn})`。play 前端可消费（平台只提供通道）。

### R6 stream 解禁
- `config/ai.ts` `PROTECTED_CUSTOM_REQUEST_KEYS` 移除 `"stream"`（由 adapter 内部设 `stream:true`，不暴露用户自定义）。

## 验收标准
- [ ] 桌面助手对话逐字流式渲染（`toolCallMode=native` + 真实 key 实测）。
- [ ] `toolCallMode=text` 模式不流式，行为同现状。
- [ ] 三家 SSE 格式正确解析（需真实 key 实测）。
- [ ] 非流式回退：端点不支持 SSE 时降级一次性 JSON 不报错。
- [ ] 中途 AbortSignal 取消干净停止。
- [ ] `turn-delta` 事件从 bridge 推出。
- [ ] `npm run build`（含 contracts）通过。

## 明确不做
- 不改 UI 展示模型为"显示 agent 思考多轮过程"（留演进）。
- 不做原生工具调用（子1 已做）。
- 不做 auto 模式（子1 已定两选一 native/text）。

## 开放问题
- 工具轮的 text delta（模型思考过程）是否推给 UI？倾向不推（玩家只看最终正文），工具轮静默，仅最终轮流式。但这需确认原生工具模式下工具轮是否会产生 text delta。
