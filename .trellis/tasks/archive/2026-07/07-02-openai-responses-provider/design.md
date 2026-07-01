# OpenAI Responses API provider support — Design

## Overview

Add an `OpenAI Responses` provider adapter beside the existing OpenAI Chat Completions, Gemini, Claude, and DeepSeek adapters. The adapter must translate Tsian's existing internal AI call contracts (`AiChatMessage[]`, `RuntimeChatMessage[]`, `ToolSchema[]`, `ModelCallResult`) to OpenAI Responses request/response shapes while leaving Agent Runtime orchestration unchanged.

The implementation should be an adapter-level protocol addition, not an Agent Runtime rewrite.

## Current Boundaries

```text
Settings/config
  BrowserAiProviderKind + provider preset/model config
        ↓
runtime-host/ai.ts
  selectAdapter(kind) → ProviderAdapter
        ↓
Agent Runtime / platform-host
  generateAssistantReply / generateAssistantReplyNative / streamAssistantReplyNative / streamAssistantReplyText
        ↓
Provider API
```

Relevant existing seams:

- `ProviderAdapter` already owns URL, headers, request body, response text/result extraction, streaming delta/tool/finish extraction (`apps/platform-web/src/runtime-host/ai.ts:515-588`).
- `selectAdapter` isolates kind→adapter routing (`apps/platform-web/src/runtime-host/ai.ts:1265-1274`).
- Settings and debug provider-kind unions are centralized (`apps/platform-web/src/config/ai.ts:2`, `packages/contracts/src/debug.ts:14`).

## Conversation State Decision

Use **local stateless replay** for the OpenAI Responses provider:

- Do not use `previous_response_id`.
- Send `store: false` by default.
- Rebuild `input` from Tsian-local runtime messages, assistant function-call history, and function-call outputs.

Rationale:

- Tsian's checkpoint/rollback/debug model assumes the model-visible context is reconstructable from local save/runtime state.
- Server-side stored response chains introduce external state that can diverge from local rollback and multi-agent context slots.
- Stateless replay matches existing providers and keeps this task focused on protocol compatibility.

## Provider Kind

Add a provider kind for the `/responses` protocol, recommended internal key:

```ts
"openai-responses"
```

User-facing name:

```text
OpenAI Responses
```

The existing `openai-compatible` kind remains Chat Completions-compatible and continues to target `/chat/completions`. `deepseek` continues to reuse the Chat Completions adapter.

## Request Construction

### URL And Headers

- URL: `${trimTrailingSlash(config.baseUrl)}/responses`
- Headers: same bearer JSON headers as OpenAI-compatible Chat Completions:
  - `Content-Type: application/json`
  - `Authorization: Bearer ${config.apiKey}`

### Parameters

Responses body parameter mapping:

| Tsian field | Responses field |
|---|---|
| `model` | `model` |
| `parameters.maxOutputTokens` | `max_output_tokens` |
| `parameters.temperature` | `temperature` |
| `parameters.topP` | `top_p` |
| `parameters.reasoningEffort` | `reasoning.effort` |
| local stateless replay | `store: false` |
| streaming native/text | `stream: true` assigned after custom param merge |

Do not forward Chat Completions-only penalties (`frequency_penalty`, `presence_penalty`) until verified against Responses compatibility. If users need provider-specific extras, they can use custom request params.

Custom params should be merged, then runtime-owned fields reasserted (`model`, `input`, `tools`, `store`, and forced `stream`) so user JSON cannot corrupt the protocol body.

## Message Mapping

### Content Parts

Add a Responses content builder:

```ts
string -> string or [{ type: "input_text", text }]
ContentPart[] -> Array<
  | { type: "input_text", text }
  | { type: "input_image", image_url: dataUrl, detail: "auto" }
>
```

Use structured content arrays when there are image parts. For plain string text, either string or a single `input_text` part is acceptable; using a consistent array form makes multimodal handling simpler.

### Text Protocol Messages (`AiChatMessage[]`)

Map each message to a Responses message input item:

```ts
{ type: "message", role: message.role, content: buildResponsesContent(message.content) }
```

Then parse response text from:

1. top-level `output_text` when present;
2. otherwise `output[]` message items with `content[].type === "output_text"`;
3. otherwise fail loudly with `AI response format is not supported.`

### Native Runtime Messages (`RuntimeChatMessage[]`)

Map each item in order:

- `system` / `user` → Responses message input item.
- `assistant` with visible `content` → assistant message input item.
- `assistant.toolCalls[]` → one Responses `function_call` input item per call:

```ts
{
  type: "function_call",
  call_id: call.id,
  name: call.name,
  arguments: JSON.stringify(call.arguments),
  status: "completed"
}
```

- `tool` → Responses function-call output item:

```ts
{
  type: "function_call_output",
  call_id: message.toolCallId,
  output: message.content,
  status: "completed"
}
```

Important: for Responses, Tsian `NativeToolCall.id` must equal Responses `call_id`, not the output item `id`, because Tsian later stores `toolCallId` and must send it back as `function_call_output.call_id`.

## Tool Schema Mapping

Map `ToolSchema[]` to flat Responses tools:

```ts
{
  type: "function",
  name: tool.name,
  description: tool.description,
  parameters: tool.parameters
}
```

Do not set `strict: true` by default. Existing tool schemas may not all satisfy strict-mode requirements such as complete `required` arrays and `additionalProperties: false`. A strict-mode switch can be considered in the later model configuration UI task.

## Non-Streaming Result Parsing

For `extractNativeResult(payload)`:

1. Validate `payload` is an object.
2. If top-level `error` is present or `status` is `failed` / `incomplete`, throw a descriptive error.
3. Collect text from `output_text` or `output` message `output_text` blocks.
4. Collect function calls from `output` items where `type === "function_call"`:
   - `id`: `call_id`
   - `name`: `name`
   - `arguments`: parse JSON string; fall back to `{}` on parse failure, matching current adapter behavior.
5. Return `finishReason: "tool_calls"` if any function calls are present, otherwise `"stop"`.

For `extractText(payload)`, reuse the same text extraction and error handling without returning tool calls.

## Streaming Parsing

The current shared streaming loop already tracks `event`, parses JSON `data:`, and lets adapters extract deltas/tool calls/finish. Responses can fit this shape with one small extension for stream errors.

### Required new optional adapter hook

Add an optional hook such as:

```ts
extractStreamError?(data: unknown): string | undefined
```

The shared stream loops should call it after JSON parse and before extracting deltas. If it returns a message, update the debug record and throw.

This covers Responses `type: "error"`, `response.failed`, and `response.incomplete` without overloading the delta/tool methods.

### Text deltas

`extractStreamDelta` returns `data.delta` when `data.type === "response.output_text.delta"`.

### Tool-call accumulation

Use `output_index` as the accumulator key.

- On `response.output_item.added` / `response.output_item.done` where `item.type === "function_call"`, seed or update accumulator:
  - `id = item.call_id`
  - `name = item.name`
  - `args = item.arguments ?? ""`
- On `response.function_call_arguments.delta`, append `data.delta` to the accumulator entry for `output_index`.
- On `response.function_call_arguments.done`, set final `name` and `arguments` for `output_index` if present.

### Finish detection

- On `response.completed`, inspect `response.output`; if any `function_call` items exist, return `"tool_calls"`, otherwise `"stop"`.
- If no completed event is parsed but tool accumulator has entries, the shared stream loop already resolves to `"tool_calls"`.

### Usage extraction

Responses usage may arrive on `response.completed.response.usage`; `extractUsageFromPayload` should understand both top-level Responses payloads and completed-event wrappers.

## Error Handling

Non-stream and streaming paths must fail loud for:

- HTTP non-OK with OpenAI-style `{ error: { message } }` payloads (already handled by caller).
- Responses top-level `error`.
- `status: "failed"` with error message.
- `status: "incomplete"` with `incomplete_details.reason`.
- SSE `type: "error"`.
- SSE `response.failed` / `response.incomplete`.

Do not silently return empty text for these cases.

## Usage And Debug Records

Add `"openai-responses"` to debug provider kind. Update usage extraction so Responses contributes:

- `usage.input_tokens` → `input`
- `usage.output_tokens` → `output`
- `usage.total_tokens` → `total`
- `usage.input_tokens_details.cached_tokens` → `cached`

Existing debug record creation can remain unchanged once `config.kind` accepts the new value.

## Compatibility / Migration

- No Dexie schema changes.
- Stored provider config normalization must recognize the new kind; built-in provider type seeding will make it appear for new and existing configs.
- No migration of existing OpenAI-compatible presets. Users intentionally create/select an OpenAI Responses preset for `/responses` APIs.
- Existing providers keep their current adapter and endpoint behavior.
