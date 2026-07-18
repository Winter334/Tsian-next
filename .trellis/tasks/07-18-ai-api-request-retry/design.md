# AI API Request Retry Design

## Boundary

Implement retry in `apps/platform-web/src/runtime-host/ai/*`, below Agent Runtime orchestration and above provider adapters. The retry layer is transport/request behavior, not tool-loop behavior.

Shared callers that benefit automatically:

- Formal player turns (`platform-host/runtime-turn.ts`) call `generateAssistantReply`, `generateAssistantReplyNative`, `streamAssistantReplyText`, or `streamAssistantReplyNative`.
- Desktop Assistant (`platform-host/assistant-chat.ts`) calls the same entry points.
- `interaction.invokeAgent` (`platform-host/ai-invocation.ts`) calls the same entry points.
- `agent_call` delegated Agents reuse the caller's injected `capabilities.callModel` / `callModelNative`, so they also reach the same entry points.

## Retry policy

Code-level defaults:

- `AI_REQUEST_MAX_RETRIES = 3` (initial request + 3 retries = 4 attempts total).
- Base retry delay around 800ms.
- Delay doubles for each retry: approximately 800ms, 1600ms, 3200ms.
- Add small jitter to avoid synchronized retry bursts.

Retryable failures:

- Network/fetch transport failure such as `TypeError: Failed to fetch`.
- Request timeout raised by `fetchJsonWithTimeout` / timed abort.
- HTTP status: `408`, `429`, `500`, `502`, `503`, `504`.

Non-retryable failures:

- User/parent abort (`AbortSignal` aborted for reasons other than the request-layer timeout).
- HTTP `400`, `401`, `403`, and other deterministic client/provider request errors.
- Provider SSE payload errors after the stream has started emitting content.

## Non-streaming flow

For `generateAssistantReply` and `generateAssistantReplyNative`:

1. Build adapter, URL, headers, body, debug record exactly once.
2. Run request attempts through a shared retry helper.
3. Each attempt calls `fetchJsonWithTimeout` with the same request parameters.
4. If `response.ok`, parse/extract result as today.
5. If status is retryable, wait and retry.
6. If all attempts fail, update the original debug record with the final error and throw.

Debug logging should include attempt metadata in console output. The debug record can remain one logical model call; it should not create a separate request record per retry unless future debug UX asks for per-attempt records.

## Streaming flow

For `streamAssistantReplyNative` and `streamAssistantReplyText`:

1. Wrap the whole single-stream request/read operation in a retry helper.
2. Retry only if no text/reasoning/content delta has been emitted to `onDelta` yet.
3. Once any delta has been emitted, treat later fetch/read/SSE errors as final failures and do not retry.
4. HTTP retryability still applies before body streaming starts.
5. Cleanup each attempt's timed abort signal and reader lock before retrying.

Rationale: retrying after UI-visible deltas would duplicate partial output and desynchronize the model round.

## Abort and timeout

- The retry delay must be abortable by the caller's `AbortSignal`.
- If caller signal aborts while waiting for retry, throw the abort reason/error immediately.
- Request-layer timeout is retryable; delegated Agent inactivity timeout and user stop are parent aborts and must not be retried.
- For `agent_call`, retry elapsed time counts against the delegated Agent timeout because the same composite signal is passed down.

## Diagnostics

- `console.warn` should record attempt number and whether another retry will occur.
- Final failure should keep the same error surface the caller receives today, but with no swallowed cause.
- Debug record should update with the final error message on total failure and normal response/usage on success.

## Compatibility

- No settings UI or config migration.
- No changes to provider adapters.
- No changes to Agent Runtime tool execution or workspace transaction semantics.
- No retry for workspace tools or browser_script actions.
