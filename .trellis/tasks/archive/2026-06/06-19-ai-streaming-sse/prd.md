# PRD — 流式输出 + 思考流可见（SSE 逐字渲染）

> 父任务：`06-19-ai-streaming-response`。**依赖子任务 `06-19-native-tool-calling`（已归档，commit `636a167`）先完成**——流式依赖原生工具调用提供的结构化 text/tool_call 事件边界。
> 姊妹任务：`06-19-ai-agent-process-visible`（子2b，工具过程可展开 + 并行执行），依赖本任务。本任务只做流式 + 思考流可见基础 + `turn-delta` 事件；工具过程的折叠呈现/`turn-round-end`/`turn-tool` 事件 + 并行执行归子2b。

## 目标与用户价值
- 让 AI 回复逐字流式出现，而非整段一次性出现，改善对话/剧情等待体验。
- **思考流可见**：native 模式下，agent 的思考过程（工具轮 text）与最终回复都逐字流式显示，让玩家实时感知 agent 在动脑/在干活，减少等待焦虑；结束后思考过程默认折叠、最终回复展开，玩家可随时展开复查以决定是否干预（回滚检查点/叫助手优化/手动编辑）。这是 Tsian 区别于普通聊天客户端的差异化价值。
- 仅在 `toolCallMode=native` 模式下支持流式：流式响应中 text delta 与 tool_call delta 是不同事件类型，可干净分离——文本实时推 UI、工具调用后台累积，全程真流式。
- `toolCallMode=text` 模式下不流式（一次性返回，同现状），因为文本协议无法干净分离 text/tool 边界。

## 方向决策（2026-06-19，替代原 PRD 措辞）
- **原"玩家只看最终正文"反转**：现为"过程可见 + 默认折叠 + 可干预"。理由见父 PRD"关于过程可见的方向调整"。
- **无 onReset 回滚**：原设计"边显示 + 工具轮清空"被否决。思考流照常推、不清空——它就是给玩家看的过程。流式逻辑因此简化（无 onReset 机制）。
- **桌面 AssistantView 只做基础逐字流式验证**，不追求小说式/折叠呈现（那归 play 前端 game-card packaged frontend）；但需支持"停止生成"和"智能滚动"基础体验。
- **思考/最终的 UI 区分**：本任务在桌面 AssistantView 做最小区分（最终回复为主体、思考过程流式时也显示）。小说式折叠呈现、round-end 归类、工具卡片归子2b + play 前端。

## 依赖（来自子1 原生工具调用）
- 子1 完成后，adapter 层有 `extractNativeResult(payload)` 解析原生工具调用、`buildNativeRequestBody` 传 tools，`generateAssistantReplyNative` 返回 `ModelCallResult{text,toolCalls,finishReason}`。
- 本任务在此基础上加流式：`extractStreamDelta`（text delta）+ `extractStreamToolCalls`（tool_call delta 累积）+ `streamAssistantReplyNative`。

## 确认事实（来自勘察，行号基于子1 提交后状态）
- `generateAssistantReply`（`runtime-host/ai.ts:850`）返回 `Promise<string>`，`fetchJsonWithTimeout`（`:167`）一次性 `response.json()`，无 ReadableStream/SSE。
- `generateAssistantReplyNative`（`runtime-host/ai.ts:943`）结构对称，返回 `ModelCallResult`，非流式。
- `callAgentModelWithWorkspaceToolsNative`（`agent-runtime/index.ts:991`）：每轮调一次 `callModelNative`；`finishReason==="stop"` 返回 `result.text.trim()`；`finishReason==="tool_calls"` 执行工具、进下一轮，**本轮 `result.text` 当前被丢弃**（本任务改为流式推 UI，不再丢弃）。
- `config/ai.ts:130` `"stream"` 在 `PROTECTED_CUSTOM_REQUEST_KEYS`，用户无法手动开启。
- `createTimedAbortSignal`（`runtime-host/ai.ts:128`）+ signal 一路透传到 `callModelNative` → `fetch`；`runAssistantChat`（`platform-host/index.ts:1703`）内部 `new AbortController()`（`:1746`），工具循环 `assertNotAborted`。**停止生成基础设施已有，只差 AssistantView 暴露按钮**。
- AssistantView（`views/AssistantView.vue:535` `send()`）只显示 `result.replyText`；`scrollToBottom()`（`:593`）直接 `scrollTop=scrollHeight`，**不检查用户是否上滚**，流式时会与用户抢视线；typing dots（`:200`）是占位符非内容。
- bridge 层 `RemotePlayBridgeEventName`（`contracts/src/bridge.ts:112`）只有 `turn-completed`/`turn-debug-ready`；`debug-events.ts` 是干净的 Set pub/sub（`subscribeTurnDebugReady`/`emitTurnDebugReady`），可镜像建 `streaming-events.ts`。
- `executeRuntimeWorkspaceToolCalls`（`workspace-tools.ts:1983`）是 `for` 循环顺序 await——**并行执行归子2b**，本任务不动。

## 需求

### R1 模型层流式（runtime-host/ai.ts）
- 每个 adapter 加 `buildStreamUrl`（Gemini 切 `:streamGenerateContent?alt=sse`，其余 URL 不变）、`buildStreamRequestBody`（OpenAI/Claude/DeepSeek 注入 `stream:true`，Gemini 靠 URL）、`extractStreamDelta(dataLine)`（解析各家 SSE text delta）、`extractStreamToolCalls(deltaLine)`（tool_call delta 累积）、`extractStreamFinish(dataLine)`（finishReason）。
- 三家 SSE 格式：
  - OpenAI/DeepSeek：`data:{choices[].delta.content}` + `data:[DONE]`；tool_calls delta 按 index 累积 arguments。
  - Gemini：`candidates[0].content.parts[].text`，无 `[DONE]`（流关闭即终止）；functionCall part 一次性完整。
  - Claude：`event:content_block_delta` + `data:{delta.text}`，`message_stop` 终止；event/data 配对需维护 currentEvent 上下文。
- 新增 `streamAssistantReplyNative(messages, {onDelta, ...options}): Promise<ModelCallResult>`：`fetch` + `getReader()` + `TextDecoder` 逐块读，按 SSE 边界切分，每 text delta 调 `onDelta` + 累积完整字符串；tool_call delta 后台累积（不推 UI）。复用 `createTimedAbortSignal`（10 分钟超时）。
- **非 SSE 回退**：`content-type` 非 `text/event-stream` 时降级走 `response.json()` + `extractNativeResult`（不调 onDelta）。
- **无 onReset**：text delta 全推，工具轮 text 也推（即思考流），不清空。

### R2 流式工具调用 delta（依赖子1）
- 流式响应中 tool_call delta 与 text delta 分离：text delta → `onDelta` 推 UI（含思考流）；tool_call delta → 后台累积成 `NativeToolCall[]`（不推 UI；工具过程呈现归子2b）。
- `finishReason`（OpenAI `tool_calls`/`stop`、Gemini `finishReason`、Claude `message_delta.stop_reason`）决定继续工具循环还是最终回复。本轮结束若是工具轮，`onDelta` 已推的思考流保留显示（不清空）；runtime 执行工具进下一轮，下一轮 text delta 继续追加显示。

### R3 agent runtime 集成
- `AgentRuntimeModelCallOptions` 加 `onDelta?: (delta: string, round: number) => void`（带轮号，供前端区分思考/最终轮）。
- `AgentRuntimeTurnInput` 加 `onDelta?`。
- `callAgentModelWithWorkspaceToolsNative`：`toolCallMode=native` 时，`callModelNative` 流式返回，text delta 经 `onDelta` 推 UI（含工具轮思考流）；`finish_reason:stop` 时文本已是最终回复（已实时显示）；`finish_reason:tool_calls` 时执行工具、进下一轮（本轮思考流保留显示）。
- `toolCallMode=text` 模式：不流式，`callModel` 仍返回 `Promise<string>` 一次性，无 onDelta。
- **委托 agent_call 不流式**：构建 delegated agent options 时不注入 onDelta，委托 agent 的 `callModelNative` 收到 `onDelta===undefined` → 走非流式回退。玩家只看 entry agent 的流式。

### R4 platform-host + 桌面 AssistantView
- `runAssistantChat` 加 `onDelta?` 转发进 `callModelNative` 闭包（用 `streamAssistantReplyNative`）。
- AssistantView `send()`：await 前 push 空 assistant 消息，`onDelta` 追加 `content += delta`；await 后用 `result.replyText` 校正（消除 trim 差异）。markdown 渲染随 Vue 响应式更新。
- typing dots 保留到第一个 delta 到达后隐藏。
- **① 打字机节流（Token Throttling）**：前端建 delta 缓冲队列，用 `requestAnimationFrame` 匀速释放到 `content`，避免来一个 token 就渲染导致抖动。
- **② 智能滚动锚定（Smart Scroll）**：流式 onDelta 自动滚到底仅在用户已在底部附近时；用户手动上滚则冻结自动滚动 + 悬浮"下方有新消息"提示，不强行拉视线。修现有 `scrollToBottom` 不检查用户位置的 bug。
- **③ 停止生成按钮（Abort）**：AssistantView 暴露"停止"按钮，点击 abort `runAssistantChat` 的 controller（基础设施已通，signal 一路到 fetch + `assertNotAborted`）；停止后保留已生成内容或清空（实现定，倾向保留半截 + 标注"已停止"）。

### R5 bridge 通道（play 前端，本任务只推 text delta）
- `contracts/src/bridge.ts`：`RemotePlayBridgeEventName` 加 `"turn-delta"` + payload 类型 `{delta:string, turn:number, round:number}`（带轮号供游戏前端区分思考/最终）。
- 新建 `streaming-events.ts`：`emitTurnDelta`/`subscribeTurnDelta`（Set<Listener>，镜像 debug-events）。
- `remote-iframe-bridge.ts`：订阅 `streaming-events`，转发为 `postEvent("turn-delta", {delta, turn, round})`。
- **平台只提供通道**：play 前端如何消费（小说式/折叠呈现）不在本任务范围。`turn-round-end`/`turn-tool` 事件归子2b。

### R6 stream 解禁
- `config/ai.ts` `PROTECTED_CUSTOM_REQUEST_KEYS` 移除 `"stream"`（由 adapter 内部设 `stream:true`，且在 custom merge 之后赋值确保不被用户覆盖）。

## 验收标准
- [ ] 桌面助手对话逐字流式渲染（`toolCallMode=native` + 真实 key 实测），思考过程与最终回复都逐字出现。
- [ ] `toolCallMode=text` 模式不流式，行为同现状。
- [ ] 三家 SSE 格式正确解析（需真实 key 实测）。
- [ ] 非流式回退：端点不支持 SSE 时降级一次性 JSON 不报错。
- [ ] 中途 AbortSignal 取消干净停止（停止按钮可用）。
- [ ] 打字机节流：流式不抖动，匀速释放。
- [ ] 智能滚动：用户上滚时不强行拉到底，显示"有新消息"提示。
- [ ] `turn-delta` 事件从 bridge 推出（带 turn/round）。
- [ ] `npm run build`（含 contracts）通过。

## 明确不做（本任务范围外）
- 不做工具过程折叠呈现/`turn-round-end`/`turn-tool` 事件（归子2b）。
- 不做单轮内工具并行执行（归子2b）。
- 不做 play 前端小说式/折叠呈现（归游戏前端，平台只推事件）。
- 不做原生工具调用（子1 已做）。
- 不做 auto 模式（子1 已定两选一 native/text）。
- 不改 UI 展示模型为"显示 agent 思考多轮过程"的完整呈现（本任务只做流式 + 思考流可见基础；折叠/小说式归子2b + play 前端）。

## 开放问题
- 停止生成后保留半截内容 vs 清空：倾向保留半截 + 标注"已停止"，实现时定。
