# OpenAI Responses API provider support — Implementation Plan

## Preconditions

- OpenAI Responses conversation state decision is resolved: use local stateless replay, no `previous_response_id`, default `store: false`.
- Before editing code, load `trellis-before-dev` for platform-web frontend/contract specs.

## Ordered Checklist

### 1. Provider kind plumbing

- Add `"openai-responses"` to `BrowserAiProviderKind` in `apps/platform-web/src/config/ai.ts`.
- Add the provider type entry with display name `OpenAI Responses` to `PROVIDER_TYPE_KINDS`.
- Update provider-kind normalization in `normalizeProviderType`.
- Add a `/v1` placeholder appropriate for Responses in Settings.
- Add `"openai-responses"` to `AiDebugProviderKind` in `packages/contracts/src/debug.ts`.

### 2. Responses request helpers

- Add `buildResponsesUrl(baseUrl)`.
- Add `buildResponsesContent(content)` for string and `ContentPart[]`.
- Add parameter builder for Responses (`max_output_tokens`, `temperature`, `top_p`, `reasoning.effort`, `store: false`).
- Add text extraction helper that reads `output_text` first, then `output` message `output_text` blocks.
- Add response error helper for top-level `error`, failed status, and incomplete status.

### 3. Responses native message and tool mapping

- Add `buildResponsesInput(messages: AiChatMessage[])` for text protocol.
- Add `buildResponsesNativeInput(messages: RuntimeChatMessage[])` for native protocol.
- Map assistant `toolCalls` to `function_call` input items using `call_id = call.id`.
- Map `role: "tool"` observations to `function_call_output` items.
- Map `ToolSchema[]` to flat Responses function tools.

### 4. Responses adapter

- Implement `responsesAdapter: ProviderAdapter`.
- Wire `selectAdapter("openai-responses")` to the new adapter.
- Implement non-stream text and native response parsing.
- Implement `buildStreamRequestBody` by assigning `stream: true` after custom params are merged.

### 5. Streaming errors and Responses SSE parsing

- Extend `ProviderAdapter` with optional `extractStreamError` or equivalent.
- Update native and text streaming loops to throw when the adapter reports a stream error.
- Implement Responses text delta extraction from `response.output_text.delta`.
- Implement Responses function-call accumulation from `response.output_item.added/done` and `response.function_call_arguments.delta/done`.
- Implement finish detection from `response.completed`.

### 6. Usage extraction

- Update `extractUsageFromPayload` for `openai-responses` and `response.completed` wrappers.
- Extract `input_tokens_details.cached_tokens` into debug `usage.cached`.

### 7. Guard compatibility

- Ensure OpenAI-compatible Chat Completions request bodies still use `/chat/completions`, `messages`, and nested `tools[].function`.
- Ensure DeepSeek still reuses the Chat Completions adapter.
- Ensure Gemini and Claude adapter compile unchanged.
- Keep UI changes minimal; defer deeper config layout to `07-02-model-config-ui-redesign`.

## Validation Commands

- `npm run build:contracts`
- `npm run build:web`

## Manual / Mock Verification Checklist

If real Responses credentials are available:

- Configure an OpenAI Responses provider with text mode, streaming off, send a simple message, verify text response.
- Enable text streaming, verify deltas display and debug usage records fill.
- Configure native tool mode, streaming off, run a prompt that triggers a simple workspace/tool call, verify request body uses flat `tools[].name` and follow-up sends `function_call_output.call_id`.
- Enable native streaming, verify `response.function_call_arguments.delta` accumulates into one `NativeToolCall` and the tool loop continues.
- Trigger or mock an error/incomplete stream event and verify it surfaces as an error.

If real credentials are unavailable:

- Use browser devtools / temporary mocked fetch or recorded payloads to exercise helper parsing paths.
- Record the unverified real-provider items in `docs/active/pending-verification.md` or task notes before finishing.

## Risky Files / Rollback Points

- `apps/platform-web/src/runtime-host/ai.ts`: highest risk; contains all provider adapters and streaming loops. Keep helper additions local and avoid changing existing adapter semantics unless required by the new optional stream-error hook.
- `apps/platform-web/src/config/ai.ts`: provider kind normalization affects stored provider config. Avoid destructive changes beyond accepting the new kind.
- `packages/contracts/src/debug.ts`: contract build required after provider-kind union change.
- Settings UI files: keep minimal; broader UX restructuring belongs to the follow-up task.

## Review Gates Before `task.py start`

- PRD convergence pass completed.
- `design.md` and `implement.md` reflect stateless replay.
- `implement.jsonl` and `check.jsonl` contain real spec/research entries.
- User has reviewed/approved the final planning artifacts.
