# AI API Request Retry Implementation Plan

## Checklist

1. Add retry primitives in `apps/platform-web/src/runtime-host/ai/fetch.ts`:
   - retry constants (`AI_REQUEST_MAX_RETRIES`, base delays/status set),
   - retryability predicates for errors and HTTP statuses,
   - abortable sleep/backoff helper,
   - a generic `withAiRequestRetry` helper that supports `canRetryAfterError` for streaming first-delta gating.
2. Refactor non-streaming request paths in `apps/platform-web/src/runtime-host/ai/calls.ts`:
   - `generateAssistantReply`,
   - `generateAssistantReplyNative`.
3. Refactor streaming request paths in `apps/platform-web/src/runtime-host/ai/calls.ts`:
   - `streamAssistantReplyNative`,
   - `streamAssistantReplyText`.
   - Track whether any delta was emitted; retry only before first delta.
4. Preserve existing debug records:
   - one logical debug record per model call,
   - update final success/error as today,
   - log retry attempts to console with requestId/attempt metadata.
5. Update `.trellis/spec/platform-web/frontend/quality-guidelines.md` with the retry contract.
6. Validate:
   - `npm run build:web`,
   - `git diff --check`.

## Risk / rollback

- Risk: duplicated streaming output if retry happens after first delta. Guard by tracking emitted delta and returning non-retryable after first output.
- Risk: retrying user abort or delegated timeout. Guard by checking parent signal before sleeps and classifying non-timeout aborts as non-retryable.
- Rollback: revert `fetch.ts` retry helper and `calls.ts` retry wrapping; no persisted schema or migration involved.

## Verification Results (2026-08-07)

- Implementation commit: `db5510d`.
- Focused tests: 3 files / 14 tests passed.
- Platform web type-check and production build passed (3,281 modules transformed).
- `git diff --check` passed.
