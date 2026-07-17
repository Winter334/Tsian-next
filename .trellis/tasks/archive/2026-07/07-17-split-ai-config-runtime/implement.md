# Implementation Plan: 拆分 AI config 与 runtime

- [x] Read frontend quality/type-safety/directory specs.
- [x] Record baseline commit and create/confirm `backup/split-ai-config-runtime-pre-split`.
- [x] Inventory exports/import consumers for `config/ai.ts` and `runtime-host/ai.ts`.
- [x] Extract shared types/defaults first.
- [x] Extract config normalization/provider metadata.
- [x] Extract runtime debug records and fetch helpers.
- [x] Extract content conversion helpers.
- [x] Extract provider request/response modules one provider at a time.
- [x] Extract probes/tool-call helpers last.
- [x] Preserve original file import paths through facades or update consumers in one controlled pass.
- [x] Run `git diff --check`.
- [x] Run `npm run build:web` after the runtime split reached a buildable seam.
- [x] Record compatibility notes for request body/debug/tool-call behavior.

## Module Map

### Config

- `apps/platform-web/src/config/ai.ts` — public facade preserving the existing import path.
- `apps/platform-web/src/config/ai/index.ts` — folder barrel for direct folder imports.
- `apps/platform-web/src/config/ai/types.ts` — provider/model/config/embedding type contracts.
- `apps/platform-web/src/config/ai/defaults.ts` — default tool-call/streaming values and default parameter factories.
- `apps/platform-web/src/config/ai/normalize.ts` — stored config normalization, branch helpers, URL cleanup, custom request param parsing, and validation.
- `apps/platform-web/src/config/ai/providers.ts` — provider type/preset metadata, storage read/save/reset, provider resolution, and embedding config helpers.
- `apps/platform-web/src/config/ai/model-fetch.ts` — provider model-list fetch URL/header/payload handling, including Gemini pagination and `generateContent` filtering.

### Runtime

- `apps/platform-web/src/runtime-host/ai.ts` — public facade preserving the existing import path.
- `apps/platform-web/src/runtime-host/ai/index.ts` — folder barrel for direct folder imports.
- `apps/platform-web/src/runtime-host/ai/types.ts` — runtime public types and provider adapter contract.
- `apps/platform-web/src/runtime-host/ai/content.ts` — content preview, image counting, provider content conversion, Responses content conversion, and system-message splitting.
- `apps/platform-web/src/runtime-host/ai/debug-records.ts` — debug record buffering/persistence, message segments, request-id sequencing, masking, preview, and debug logging.
- `apps/platform-web/src/runtime-host/ai/fetch.ts` — timed abort handling, JSON response reading, fetch-with-timeout, and SSE line parsing.
- `apps/platform-web/src/runtime-host/ai/tool-calls.ts` — streamed tool-call finalization and text-protocol display stripping.
- `apps/platform-web/src/runtime-host/ai/calls.ts` — non-streaming, native streaming, and text-protocol streaming model-call orchestration.
- `apps/platform-web/src/runtime-host/ai/probes.ts` — native tool-call probe tool and probe error classification.
- `apps/platform-web/src/runtime-host/ai/providers/shared.ts` — provider shared helpers: record guards, optional field writers, custom-param merge, usage extraction, and error extraction.
- `apps/platform-web/src/runtime-host/ai/providers/openai-chat.ts` — OpenAI-compatible and DeepSeek chat-completions request/response/stream adapter.
- `apps/platform-web/src/runtime-host/ai/providers/openai-responses.ts` — OpenAI Responses request/response/stream adapter.
- `apps/platform-web/src/runtime-host/ai/providers/gemini.ts` — Gemini request/response/stream adapter.
- `apps/platform-web/src/runtime-host/ai/providers/claude.ts` — Claude request/response/stream adapter.
- `apps/platform-web/src/runtime-host/ai/providers/deepseek.ts` — explicit DeepSeek adapter alias to the OpenAI-compatible adapter.
- `apps/platform-web/src/runtime-host/ai/providers/index.ts` — provider adapter selection.

## Compatibility Notes

- Public imports remain compatible through `apps/platform-web/src/config/ai.ts` and `apps/platform-web/src/runtime-host/ai.ts` facades.
- Split submodules import sibling/internal modules directly and do not import the public facade/barrel, avoiding `index ↔ submodule` cycles.
- Request builders were moved by baseline marker extraction; provider-owned request keys and custom-param merge order remain preserved:
  - OpenAI-compatible/DeepSeek keep `model` and `messages` overwritten after custom params.
  - OpenAI Responses keeps `model`, `input`, and `store: false` overwritten after custom params and still deletes `previous_response_id` / `conversation`.
  - Gemini still merges custom params before body-owned keys win via the shared `mergeProviderCustomParams` behavior.
  - Claude still applies model parameters/thinking before custom params are merged with body-owned keys winning.
- Protected custom request key validation remains in config normalization; no persisted config schema changes were introduced.
- Provider URL builders retain the original `baseUrl.replace(/\/+$/, "")` endpoint composition.
- Stream parsers retain the same SSE line parsing, provider delta extraction, tool-call accumulation, usage extraction, and non-SSE fallbacks.
- Debug record shape and `AiDebugRecord.messageSegments` population remain unchanged; debug record persistence still uses the existing Dexie meta helper.
- Native tool-call probe remains manual/non-persisting and still forces native/non-streaming only for the probe call.
- Text Tool Protocol display stripping remains display-only; authoritative parsing stays in Agent Runtime.

## Validation Results

- `git diff --check`: passed.
- AI internal boundary scan: no split submodule imports/mentions the public AI facade/barrel paths.
- `npm run build:web`: passed.
- Rollback artifacts created:
  - `.trellis/tasks/07-17-split-ai-config-runtime/rollback/final-ai-split-forward.patch`
  - `.trellis/tasks/07-17-split-ai-config-runtime/rollback/final-ai-split-revert.patch`
- `git apply --check .trellis/tasks/07-17-split-ai-config-runtime/rollback/final-ai-split-revert.patch`: passed.

## Main-Agent Review

- Rechecked actual changed files: AI split touched `apps/platform-web/src/config/ai.ts`, `apps/platform-web/src/runtime-host/ai.ts`, new `apps/platform-web/src/config/ai/**`, and new `apps/platform-web/src/runtime-host/ai/**`; no workspace-template files were edited by this child after handoff.
- Compared public export names against `HEAD` for both facades: config exports `60/60`, runtime exports `18/18`; no missing or added public export names.
- Rechecked split module boundaries: no submodule imports the public AI facade/barrel or `./index`/`../index`.
- Rechecked rollback: `final-ai-split-revert.patch` applies cleanly with `git apply --check`.
- Rechecked whitespace: `git diff --check` and extra scan of untracked AI/task files passed.
- Re-ran `npm run build:web`: PASS. Vite/Rollup emitted the same pure-comment and chunk-size warnings; command exited successfully.
- Reviewed the apparent behavior-change wording in `extractUsageFromPayload`; confirmed it was pre-existing text/logic from `HEAD`, moved unchanged into `providers/shared.ts`.
