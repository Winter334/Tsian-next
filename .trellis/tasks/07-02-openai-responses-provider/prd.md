# OpenAI Responses API provider support

## Goal

Add a first-class **OpenAI Responses** chat provider type for Tsian so players can use endpoints and relay services that implement OpenAI's `/responses` protocol instead of Chat Completions. The provider must support Tsian's existing text tool protocol and native tool-calling runtime paths, including streaming, without sending Chat Completions-shaped `tools[].function.name` payloads to Responses-only APIs.

## Background And Confirmed Facts

- The current provider kind union is `"openai-compatible" | "gemini" | "claude" | "deepseek"` in `apps/platform-web/src/config/ai.ts:2`; debug records mirror that union in `packages/contracts/src/debug.ts:14`.
- Provider types are resident UI/config entries via `PROVIDER_TYPE_KINDS` in `apps/platform-web/src/config/ai.ts:424-435`; Settings chooses base URL placeholders per kind in `apps/platform-web/src/views/SettingsView.vue:197-209`.
- Runtime AI calls are routed through `ProviderAdapter` in `apps/platform-web/src/runtime-host/ai.ts:515-588` and selected by `selectAdapter` in `apps/platform-web/src/runtime-host/ai.ts:1265-1274`.
- The current OpenAI-compatible adapter targets `{baseUrl}/chat/completions` and sends Chat Completions `messages` in `apps/platform-web/src/runtime-host/ai.ts:340-380`.
- Native OpenAI-compatible tools are currently nested as `tools[].function.name` in `apps/platform-web/src/runtime-host/ai.ts:608-646`, which is incompatible with Responses-only APIs that expect flat `tools[].name`.
- Tsian's internal native tool loop uses `RuntimeChatMessage` and `NativeToolCall` in `apps/platform-web/src/runtime-host/ai.ts:40-43`, returning `ModelCallResult` with `text`, `toolCalls`, `raw`, `finishReason`, and optional `usage` in `apps/platform-web/src/runtime-host/ai.ts:134-153`.
- Streaming native calls share one loop in `streamAssistantReplyNative` in `apps/platform-web/src/runtime-host/ai.ts:1545-1767`; adapters provide delta/tool/finish extraction hooks.
- Text-protocol streaming is separate and currently sends `stream: true` through `buildRequestBody` in `apps/platform-web/src/runtime-host/ai.ts:1817-2024`.
- `platform-web` requires `npm run build:web` after any platform-web change, and `npm run build:contracts` when contract shapes change (`.trellis/spec/platform-web/frontend/quality-guidelines.md:4-7`).
- Runtime/provider payloads are external boundaries and must normalize unknown data defensively (`.trellis/spec/platform-web/frontend/type-safety.md:2-12`).
- OpenAI Responses docs confirm function tools use flat `{ type: "function", name, description, parameters }`; function calls appear in `response.output` with `{ type: "function_call", call_id, name, arguments }`; tool results are sent as `{ type: "function_call_output", call_id, output }` (`research/openai-responses-api-notes.md`).

## Product Decision

OpenAI Responses must use Tsian's existing **local stateless replay** strategy:

- Do **not** use `previous_response_id` in this task.
- Default to `store: false` for OpenAI Responses requests unless a future explicitly-designed setting changes it.
- Reconstruct every request from Tsian-local Agent Runtime history/context/tool results, matching existing provider behavior.

Rationale: Tsian checkpoints, rollback, debug records, and multi-provider Agent Runtime behavior depend on locally reconstructable model-visible context. Server-side response chains would require a separate persistence and rollback design, so they are out of scope for this provider MVP.

## Requirements

### R1 — Provider Identity And Minimal Configuration Entry

- Add a provider kind whose user-facing name is **OpenAI Responses**.
- Use this provider for `/responses` protocol endpoints; do not overload the existing **OpenAI 兼容** Chat Completions kind.
- Update debug/provider-kind types so AI debug records can report this kind.
- Add only the minimal settings UI affordance needed to create/select this provider type. Broader model-configuration UI redesign belongs to `07-02-model-config-ui-redesign`.

### R2 — Responses Request Construction

- Send Responses requests to `{baseUrl}/responses`.
- Build Responses request bodies with `model` and `input`, not Chat Completions `messages`.
- Map existing model parameters to Responses-compatible names:
  - `maxOutputTokens` → `max_output_tokens`
  - `temperature` → `temperature`
  - `topP` → `top_p`
  - `reasoningEffort` → `reasoning.effort`
- Preserve custom request params for provider-specific knobs, but prevent them from overriding runtime-owned fields such as `model`, `input`, `tools`, and forced `stream` values.
- Use local stateless replay for conversation state; no `previous_response_id` in this task.

### R3 — Text Tool Protocol Support

- `toolCallMode: "text"` must work for non-streaming and streaming Responses calls.
- Non-stream text mode must parse visible assistant text from `output_text` or `response.output` message content.
- Streaming text mode must parse `response.output_text.delta` and continue to rely on Tsian's existing post-hoc `<tsian-tool-call>` parser for tool execution.

### R4 — Native Function Calling Support

- `toolCallMode: "native"` must work for non-streaming and streaming Responses calls.
- Native tool schemas must use flat Responses function tools, not Chat Completions `tools[].function` nesting.
- Non-streaming responses must parse `response.output` function calls into Tsian `NativeToolCall[]`.
- Streaming responses must accumulate function-call metadata and argument deltas from Responses SSE events into Tsian `NativeToolCall[]`.
- The internal `NativeToolCall.id` for this provider must be the Responses `call_id`, because follow-up `function_call_output.call_id` must match it.
- Tool observations must be serialized as `function_call_output` input items.

### R5 — Message And Content Compatibility

- Preserve Tsian's existing role semantics as closely as Responses allows: `system`, `user`, and `assistant` messages remain distinct when serialized.
- Text content and image attachments represented by `ContentPart[]` must map to Responses content parts (`input_text`, `input_image`) where practical.
- Historical assistant tool calls plus tool observations must remain replayable in the same stateless history style Tsian currently uses for other providers.

### R6 — Streaming, Errors, And Usage

- Streaming must handle Responses terminal events (`response.completed`, `response.failed`, `response.incomplete`) and error events (`type: "error"`) without silently returning partial success.
- Non-stream and streaming paths must extract usage from Responses `usage.input_tokens`, `usage.output_tokens`, `usage.total_tokens`, and `usage.input_tokens_details.cached_tokens` into Tsian debug usage fields.
- AI debug records must keep current behavior: provider kind, message segments, response text/raw text, tool call summary in console logs, usage, and error messages.

### R7 — Compatibility And Scope Control

- Existing provider kinds (`openai-compatible`, `deepseek`, `gemini`, `claude`) must continue to use their current endpoints and formats.
- No Dexie schema change or migration is expected.
- Do not add support for OpenAI built-in tools (`web_search`, `file_search`, `computer_use`, code interpreter) in this task; Tsian runtime tools remain the only native tools advertised.
- Do not redesign the model-configuration UI in this task beyond the minimal provider entry; that is tracked separately.

## Acceptance Criteria

- [ ] A player can configure/select an **OpenAI Responses** provider type in the existing provider settings flow.
- [ ] For OpenAI Responses non-stream text mode, the request goes to `/responses`, contains `input` rather than `messages`, does not send `previous_response_id`, and the returned text is parsed from Responses output.
- [ ] For OpenAI Responses streaming text mode, streamed `response.output_text.delta` chunks are displayed through the existing text-stream path and the final raw text remains parseable by Tsian's text tool protocol.
- [ ] For OpenAI Responses non-stream native mode, tools are sent as flat `{ type: "function", name, description, parameters }` entries and returned `function_call` output items become `NativeToolCall[]`.
- [ ] For OpenAI Responses streaming native mode, `response.output_item.*` and `response.function_call_arguments.*` events become `NativeToolCall[]`, and a tool-calling round returns `finishReason: "tool_calls"` with no premature final text.
- [ ] Tool results are sent back as `function_call_output` items using the same `call_id` that was parsed into `NativeToolCall.id`.
- [ ] Responses usage is shown in debug records, including cached input tokens when provided.
- [ ] Responses stream errors / failed / incomplete terminal events surface as request errors, not successful empty replies.
- [ ] Existing Chat Completions, DeepSeek, Gemini, and Claude provider behavior remains unchanged.
- [ ] `npm run build:contracts` passes if the debug provider-kind contract changes.
- [ ] `npm run build:web` passes.

## Out Of Scope

- Full model-configuration UI redesign (`07-02-model-config-ui-redesign`).
- OpenAI built-in tools beyond Tsian function tools.
- Server-side Responses conversation state (`previous_response_id`, persisted `response.id` lifecycle, rollback semantics).
- Provider-specific live integration tests requiring a real API key; record any manual verification gap if credentials are unavailable.
- Changing Agent Runtime turn composition, checkpoint behavior, or compression policy.
