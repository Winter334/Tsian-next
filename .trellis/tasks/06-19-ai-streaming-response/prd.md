# PRD — AI 回复流式输出（SSE 逐字渲染）

## 目标与用户价值
- 让 AI 回复逐字/逐块出现，而非整段一次性出现，改善对话等待体验（尤其长回复）。
- 覆盖桌面助手对话（AssistantView）与工作室 agent 输出两个消费场景。

## 确认事实（来自代码勘察 — 06-19-control-panel-rework 收尾）
- `runtime-host/ai.ts:450` `generateAssistantReply` 返回 `Promise<string>`，内部 `fetchJsonWithTimeout`（`:491`）`await` 整个响应后 `adapter.extractText(payload)` 一次性解析完整 JSON。
- `config/ai.ts:110` 把 `"stream"` 列入 `PROTECTED_CUSTOM_REQUEST_KEYS`，用户即使自定义请求参数写 `{ "stream": true }` 也被过滤，连手动开口子都堵死。
- 调用方 `platform-host/index.ts:1530`/`:1747` 直接 `return generateAssistantReply(...)`，agent runtime 拿完整字符串才继续。
- adapter 层（`openaiAdapter`/`geminiAdapter`/`claudeAdapter`）现只有 `buildUrl`/`buildHeaders`/`buildRequestBody`/`extractText`，无流式增量解析。

## 需求

### R1 adapter 层流式扩展
- 每个 adapter 增 `streamRequestBody`（在 buildRequestBody 基础上注入 `stream: true`，DeepSeek/OpenAI 兼容直接加；Gemini 用 `streamGenerateContent` 端点 + `alt=sse`；Claude body 加 `stream: true`）。
- 每个 adapter 增 `extractStreamDelta(chunk: string): string`，解析各家 SSE 增量格式：
  - OpenAI 兼容 / DeepSeek：`data: {choices[].delta.content}` 行，`data: [DONE]` 终止。
  - Gemini：`streamGenerateContent` SSE，`candidates[0].content.parts[].text` 增量。
  - Claude：`event: content_block_delta` + `data: {delta.text}`，`message_stop` 终止。

### R2 fetch 层改流式
- `generateAssistantReply` 改签名为 `AsyncGenerator<string, void, void>` 或回调式 `({ onDelta, signal }) => Promise<string>`（二选一，倾向 AsyncGenerator，调用方 `for await`）。
- 从 `fetchJsonWithTimeout` 换成 `fetch` + `response.body.getReader()` + `TextDecoder` 逐块读，按 SSE 边界（`data: ` 行分割）切分，逐块调 adapter.extractStreamDelta。
- 超时/AbortSignal 支持中途取消（读循环里检查 signal）。
- 错误响应（非 2xx）仍走一次性 JSON error 解析（流式错误体通常是一次性 JSON）。

### R3 `stream` 保护键解禁
- `PROTECTED_CUSTOM_REQUEST_KEYS` 移除 `"stream"`（由 adapter 内部统一设 `stream:true`，不暴露给用户自定义，避免用户关掉流式）。

### R4 调用方与 UI 增量消费
- `platform-host/index.ts` 两处调用改 `for await (const chunk of generateAssistantReply(...))`，通过 trace/emit 把增量推给前端。
- AssistantView 消息渲染支持逐字追加（当前是整条消息一次性出现）。
- agent runtime（工作室）若要流式看到工具调用中间输出，需进一步改 runtime 的消息消费；可先只做桌面助手对话流式，工作室留 follow-up。

### R5 兼容性
- 非 stream 模式保留 fallback：若服务端不支持 SSE（返回非 stream content-type），降级为一次性 JSON 解析（复用现有 extractText）。
- `getBrowserAiConfig`/`resolveProviderConfig` 行为不变。

## 验收标准
- [ ] 桌面助手对话逐字渲染（OpenAI 兼容 + DeepSeek 至少实测一家）。
- [ ] Gemini/Claude 流式格式正确解析（需真实 key 实测）。
- [ ] 中途 AbortSignal 取消能干净停止，不残留半条消息。
- [ ] 非流式 fallback：服务端不支持时降级一次性响应，不报错。
- [ ] `npm run build` 通过。

## 明确不做
- 不改 contracts `AiChatMessage`（仍是 OpenAI 内部表示）。
- 工作室 agent 工具调用中间输出的流式可列为 follow-up，本期不强求。

## 开放问题
- 调用方签名选 AsyncGenerator 还是回调式？（倾向 AsyncGenerator，更易组合）
- 工作室 agent 流式是否本期纳入？（倾向先只做桌面助手对话）
