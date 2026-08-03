# Research: Agent tool observation contract

- Query: Map every Agent Runtime tool-result path into model observations and tool memories; identify current sizing, pagination, continuation, artifact, truncation, compatibility, spec, and test behavior; recommend the smallest coherent producer-owned-output MVP.
- Scope: internal
- Date: 2026-08-03

## Files Found

- `apps/platform-web/src/agent-runtime/workspace-tools/tool-execution.ts` — shared dispatcher for every platform, workspace, Skill-script, and custom Tool execution.
- `apps/platform-web/src/agent-runtime/workspace-tools/observations.ts` — current central model projection, generic compaction, read/search projection, final cap, and `agent_call` UI projection.
- `apps/platform-web/src/agent-runtime/index.ts` — native/text tool loops, model-message replay, memory collection, and turn result handoff.
- `apps/platform-web/src/agent-runtime/text-tool-protocol.ts` — text-mode observation envelope and its second generic compaction pass.
- `apps/platform-web/src/agent-runtime/tool-memory.ts` — cross-turn tool-memory summaries, generic large-value compaction, and retention limits.
- `apps/platform-web/src/agent-runtime/workspace-operations.ts` — raw workspace read/search/list/glob/mutation producers and their existing range/limit behavior.
- `apps/platform-web/src/agent-runtime/workspace-tools/action-executors.ts` — Skill script and custom Tool browser-script result adapters.
- `apps/platform-web/src/agent-runtime/workspace-tools/skill-actions.ts` — `run_script` result wrapper and optional output-schema validation.
- `apps/platform-web/src/agent-runtime/workspace-tools-types.ts` — internal observation, script, diagnostics, inspector, and execution-context types.
- `apps/platform-web/src/agent-runtime/tool-schemas.ts` — model-facing schemas and current pagination guidance.
- `apps/platform-web/src/platform-host/diagnostics-query.ts` — already bounded `query_diagnostics` producer.
- `apps/platform-web/src/platform-host/frontend-inspector.ts` and `frontend-inspector-dom.ts` — `inspect_frontend` aggregate producer and field-level bounds.
- `apps/platform-web/src/platform-host/browser-skill-script-executor.ts` — Worker output normalization and reusable workspace read/write capability for script-owned artifacts.
- `packages/contracts/src/runtime.ts` — shared workspace, Tool registry, tool-memory, and platform-action contracts.
- `apps/platform-web/src/runtime-host/ai/providers/{openai-chat,openai-responses,claude,gemini}.ts` — provider-specific native tool-result serialization.
- `.trellis/spec/platform-web/frontend/type-safety.md` and `quality-guidelines.md` — current runtime-owned truncation contract.
- `.trellis/spec/platform-web/storage/diagnostics.md` — diagnostics paging/bounding contract.

## Findings

### 1. Confirmed result flow

The common successful/failure path is:

`tool-specific executor -> raw RuntimeWorkspaceToolObservation -> projectToolObservationForAgent -> native/text model replay -> collectToolMemoriesForContext -> contextUpdate.toolMemories`.

- The dispatcher constructs raw observations for `use_skill`, `run_script`, `agent_call`, `inspect_frontend`, `query_diagnostics`, `ask_user`, `test_skill_script`, workspace operations, and visible custom Tools at `apps/platform-web/src/agent-runtime/workspace-tools/tool-execution.ts:476`, `:483`, `:490`, `:509`, `:524`, `:539`, `:555`, `:576`, and `:618`.
- Thrown producer errors are normalized to a failed raw observation at `tool-execution.ts:638-653`.
- The dispatcher then projects once and returns only the projected observation at `tool-execution.ts:656-678`; raw output remains local only long enough for audit and the closed UI projection (`:661-676`).
- Exception: parsed-call errors and a missing parsed call return early at `tool-execution.ts:444-463`. They bypass `projectToolObservationForAgent`, audit emission, UI terminal events, and memory collection (text mode filters missing calls before memory collection). A replacement validator should cover these paths too.
- Native mode appends one assistant tool-call message and one independent `role: "tool"` message per call id at `apps/platform-web/src/agent-runtime/index.ts:1431-1444`; the tool message content comes from `formatNativeToolObservationContent` (`observations.ts:289-297`).
- Text mode wraps observations in `<tsian-tool-observations>` at `text-tool-protocol.ts:328-343` and appends that as a user message at `index.ts:1883-1907`.
- Native and text modes both build tool memories from the returned (already projected) observations at `index.ts:1446-1452` and `:1915-1931`. The turn result exposes them at `index.ts:2169-2178`; `AgentContextSnapshot.toolMemories` is the persisted shared shape (`packages/contracts/src/runtime.ts:124-153`, `:181-193`).
- Cross-turn memories are rendered into the next assistant entry context at `index.ts:550-555` and `tool-memory.ts:370-385`.
- Native provider mapping preserves ids without changing content: OpenAI Chat `tool_call_id` (`openai-chat.ts:101-107`), OpenAI Responses `function_call_output.call_id` (`openai-responses.ts:20-29`), Claude `tool_result.tool_use_id` (`claude.ts:44-64`), and Gemini `functionResponse.id/name` (`gemini.ts:43-73`).
- Image reads are a separate channel: base64/binary is removed from the text result and placed in `imageParts` at `tool-execution.ts:589-610`; native/text loops append those parts separately at `index.ts:1454-1463` and `:1896-1905`. The text observation limit does not bound image bytes (`workspace-tools-types.ts:98-106`).

### 2. Current generic truncation and preview envelopes

- The runtime hard cap is 32 KiB and read content cap is 24 KiB (`observations.ts:10-17`). Requested observation budgets are clamped back to at most 32 KiB (`:58-63`).
- `jsonSafeValue` silently normalizes unsupported, circular, and unserializable values (`observations.ts:19-47`).
- `previewEnvelope` replaces an oversized value with `{ preview, charCount, truncatedForModel, anchors?, continuation }` (`observations.ts:65-81`).
- `boundedValue` first recursively compacts and then falls back to that preview envelope (`observations.ts:83-89`).
- The final whole-observation fallback can replace even a tool-specific result/error with a generic preview envelope (`observations.ts:201-245`).
- Text mode compacts the already projected result/error a second time via `compactLargeValueForModel` (`text-tool-protocol.ts:293-325`). This is a second mutation point and must disappear if producers own the exact model result.
- `compactLargeValueForModel` independently truncates strings above 20,000 chars, arrays above 50 items, and values deeper than four levels (`tool-memory.ts:9-21`, `:52-113`). It is used by text replay and by memory summaries.
- Cross-turn memory has a separate, legitimate retention layer: per-tool summary bounding and total/recent-turn replacement with placeholders (`tool-memory.ts:202-238`, `:322-367`). This is context-retention summarization, not immediate tool-output enforcement, and can remain if it consumes only validated observations.
- The `agent_call` UI projection has its own independent 8-KiB response cap (`observations.ts:248-280`). It should remain independent of the model contract.
- AI diagnostic previews in `runtime-host/ai/debug-records.ts:66-69` and `runtime-host/ai/calls.ts` are debug-record projections, not model-result mutation.

### 3. Tool-by-tool producer behavior

| Tool/result family | Current producer sizing and continuation | Current artifact/recovery behavior | Gap after removing generic truncation |
|---|---|---|---|
| `read` | Raw read supports line `offset/limit` (default 2,000, max 5,000) and character `charOffset/charLimit` (default/max 24 KiB), but when all ranges are omitted it returns the entire file (`workspace-operations.ts:49-81`, `:668-783`). The central projector then slices content to 24 KiB and synthesizes `nextCharOffset` (`observations.ts:145-165`). | Workspace path is authoritative; character continuation is exact. Image bytes use `imageParts`, not text. | Agent-facing read producer must default to a bounded character page (or otherwise produce its bounded result) before runtime validation. Changing generic `executeWorkspaceOperation(read)` globally would risk SDK/UI compatibility because its documented no-range behavior is full-file (`packages/contracts/src/runtime.ts:240-265`). |
| `search` | Raw search returns up to 50 files by default/200 max, each with up to 50 matches; line and requested context strings are not length-bounded (`workspace-operations.ts:313-399`, `:786-910`). The central projector cuts to 10 files, 5 matches/file, 400 chars/string and adds counts/hints (`observations.ts:98-142`). | Returned paths are authoritative and can be passed to `read`. There is no search cursor/offset. Raw `.slice(0, limit)` does not report total omitted files, so projected `totalFiles` is only the raw returned length, not corpus cardinality. | Move the 10/5/snippet/count/continuation shape into the Agent search producer. Keep “narrow query/path then read” continuation; do not describe it as true pagination. |
| `query_diagnostics` | Producer-owned already: max 20 records, 3 snippets/record, 320 chars/snippet, 16-KiB read page, 30-KiB aggregate, 320-char summary fields (`diagnostics-query.ts:15-21`, `:41-93`, `:109-184`). Read returns exact `offset/nextOffset`; list/search continuation asks the caller to narrow filters/query. | Record id is the durable authoritative handle. Request/response sections are page-readable. | Mostly reusable unchanged; runtime should validate it. Collection continuation is filter refinement, not cursor pagination. |
| `agent_call` | Delegated response is returned in full as `{status,targetAgent,response}` with no model-output cap (`agent-runtime/index.ts:911-985`). Only the later generic projector and separate UI projector bound it. | No persisted response artifact or read-by-id continuation exists. The target response is execution-local and does not enter player history directly. | Producer must return an explicitly bounded response with `responseChars/responseTruncated`, or fail its own output contract. A universal delegated-response artifact store is not needed for MVP. |
| `inspect_frontend` | Producer caps DOM summary to 8,000 chars, interactables to 80, diagnostics collections to 50/100/50, error stacks to 2,000, console args to 500, activity to 200, and snapshots to 50 (`frontend-inspector-dom.ts:11-17`, `:70-103`; `frontend-inspector-diagnostics.ts:6-10`, `:59-83`; `frontend-inspector.ts:59-60`, `:230-254`). Aggregate serialized size is not capped and the central projector may collapse the whole structure. | No page token or persisted result artifact. Repeating `inspect` obtains a fresh bounded snapshot; `finish` restores the debug baseline. | Producer should budget the aggregate and expose omitted counts/sections while preserving selectors, diagnostics summary, and `truncated`. Runtime should not turn it into an opaque preview.
| `run_script` | Browser script output is JSON-normalized, wrapped as `{status,skill,action,output}`, and optional `outputSchema` validation checks root/property type and required fields, not bytes/items/depth (`browser-skill-script-executor.ts:418-450`, `action-executors.ts:734-823`, `skill-actions.ts:456-481`). | Scripts can reuse `tsian.workspace.*`; SDK operations route through the same workspace executor (`browser-skill-script-executor.ts:850-888`). A script can therefore write a large artifact and return its path when its Agent exposes the needed write operation. No universal artifact envelope exists. | The Skill action producer must return a bounded inline output or a summary/path/page contract. Oversized legacy outputs should become a structured violation, not a preview. |
| `test_skill_script` | Returns the `PlatformActionResult` envelope directly as the successful tool result (`tool-execution.ts:555-575`); large `item` is currently globally compacted. | Same script workspace capability as `run_script`. | Validate/fold the nested action result into a bounded producer result; preserve script errors without treating `{ok:false}` as an outer runtime failure unless deliberately redesigned. |
| custom Tool | `tool.json` declares name/description/parameters/browser-script executor only; there is no output schema, limit, cursor, or artifact field (`packages/contracts/src/runtime.ts:677-713`, `registry.ts:1114-1274`). `executeUserTool` returns arbitrary JSON-like Worker output and explicitly defers output-schema validation (`action-executors.ts:826-942`). | Tool scripts can use permitted workspace operations and return paths. Tool config is always empty; output is JSON-normalized before dispatch. | Existing <= cap results can remain byte/shape compatible. Existing oversized results will fail loudly and authors must add Tool-specific summary/pagination/path behavior. Do not require a new manifest field in the MVP. |

Other built-ins also currently rely on the global fallback and must not be forgotten when it is removed: large directory `list`, full-content `diff`, mutation results containing full `WorkspaceFile.content`, large copied/moved/deleted path arrays, validation errors, `use_skill` action lists, and an unbounded `ask_user` answer. `glob` already has `limit/truncated` (`workspace-operations.ts:971-989`), and semantic search has a schema cap of 8 candidates (`tool-schemas.ts:346-367`).

### 4. Smallest coherent MVP

1. **Keep one final hard size invariant, change its responsibility.** Replace `projectToolObservationForAgent` with a strict boundary validator over the final text observation (excluding separately validated `imageParts`). It must not normalize, compact, slice, or synthesize previews.
2. **Fail loud with one small stable code.** On non-JSON-safe or oversized producer output, return a bounded failed observation such as `TOOL_OBSERVATION_CONTRACT_VIOLATION` with details limited to `{ toolName, reason: "not-json-safe" | "too-large", maxChars, actualChars? }`. Never include the offending output in details. Route early parse-error observations through the same final boundary.
3. **Decompose producer adapters before deleting the fallback.** Move current read/search shaping into their Agent-facing producers; keep bounded diagnostics; add explicit aggregate shaping for `agent_call`, inspector, Skill scripts, test scripts, custom Tools, and every other built-in capable of exceeding the cap. Underlying generic workspace/SDK operations may keep their broader compatibility behavior; the Agent tool producer owns the model result.
4. **Remove the second text-mode mutation.** `formatTextToolObservations` should serialize the validated observation directly. Native provider adapters remain transport-only and unchanged.
5. **Keep tool-memory retention separate.** Generate memory from the validated observation. Memory may still create a bounded summary/placeholder because that is a later cross-turn retention policy, but specs should stop describing the immediate result and memory as one truncating projection.
6. **Reuse current handles, do not build a universal artifact subsystem.** `read` uses workspace path/range, diagnostics uses record id/section/offset, search returns paths, and scripts/custom Tools may return a workspace path they wrote. `agent_call` and inspector use explicit bounded summaries for MVP. Add a generic artifact contract only after a concrete consumer requires one.
7. **Compatibility rule for custom Tools/Skills:** no mandatory `tool.json` or `SKILL.md` migration; unchanged compliant outputs continue to work. Oversized outputs change from silently altered success to structured failure. Document the size contract and examples for “return summary + workspace path” and producer-specific pagination. This is intentionally fail-loud but localized to outputs that were already lossy.
8. **Retain final request-budget enforcement.** Multiple individually valid observations can still overflow a provider request; `requestInputBudgetTokens` remains the aggregate guard (`index.ts:1255-1268`, `:1704-1715`). It must not become another truncation point.

Suggested rollout order: introduce validator/error and tests; implement bounded producers for all platform built-ins; remove text double-compaction; then switch the dispatcher from projector to validator. This avoids a window where normal built-ins unexpectedly fail.

### 5. Contracts and specs that must change

- `apps/platform-web/src/agent-runtime/workspace-tools-types.ts:92-107` — preferably make success/failure observations a discriminated union and define/document the contract-violation error; clarify `imageParts` is outside the text-size invariant.
- `apps/platform-web/src/agent-runtime/turn-types.ts:108-113`, `:265-271` plus host callers `platform-host/assistant-chat.ts:721-722`, `ai-invocation.ts:388-389`, and `runtime-turn.ts:238-239` — remove or rename `observationCharBudget`; a fixed runtime validation maximum should not look like a caller-controlled truncation budget.
- `packages/contracts/src/runtime.ts:124-153` — keep tool memory bounded, but clarify it is derived from a validated producer observation and independently summarized for retention.
- `packages/contracts/src/runtime.ts:240-265`, `:294-317` — correct the comment that `charLimit` is “capped by Agent runtime”; the read producer/operation owns the cap. Preserve generic workspace full-read compatibility if the MVP uses an Agent adapter.
- `.trellis/spec/platform-web/frontend/type-safety.md:473` and `:868-894` — replace “runtime cap/projector truncates” with “producer owns bounded structured output; runtime validates and emits contract violation.” Update the three-projection wording and tests matrix.
- `.trellis/spec/platform-web/frontend/type-safety.md:419`, `:466-480`, `:489-491` — assign large-output behavior to each producer and document custom Tool/Skill compatibility failure.
- `.trellis/spec/platform-web/frontend/quality-guidelines.md:280-283` — remove the runtime generic final-cap/one-projector rule; preserve UI isolation, provider id correlation, and independent memory retention.
- `.trellis/spec/contracts/frontend/type-safety.md:78`, `:405-419` — retain the UI-only `agent_call` presentation contract and align shared Agent Tool guidance with producer ownership if shared types/comments change.
- `.trellis/spec/platform-web/storage/diagnostics.md:66-68` — mostly reusable; clarify that diagnostics is an exemplar producer-owned bounded result and that list/search continuation is narrowing, while read is true offset paging.
- Contract package checks remain `npm run build:contracts` and consuming `npm run build:web` per `.trellis/spec/contracts/backend/index.md` and `quality-guidelines.md`.

### 6. Tests that must change or be added

- Replace truncation assertions in `apps/platform-web/src/agent-runtime/workspace-tools/observations.test.ts:10-89` with validator acceptance, oversized/non-JSON-safe contract violations, no output preview leakage, and preservation of the independent 8-KiB UI projection.
- Move read continuation ownership out of the generic projector in `workspace-operations-retrieval.test.ts:52-64`; test the Agent read producer returns an exact bounded page while generic workspace read compatibility remains intentional.
- Add producer tests for search 10-file/5-match/snippet/count behavior, plus proof that runtime validation returns the value unchanged.
- Retain and extend `platform-host/diagnostics-query.test.ts:44-80` to assert the complete observation remains under the final invariant without runtime mutation.
- Add `agent_call` producer tests for oversized delegated response metadata and unchanged UI projection tests.
- Add inspector aggregate-size tests covering omitted counters and selector/diagnostic preservation rather than a generic preview envelope.
- Extend `platform-host/browser-skill-script-executor.test.ts:157-212` and action/custom Tool executor tests with: compliant legacy output unchanged; oversized Skill/custom output becomes `TOOL_OBSERVATION_CONTRACT_VIOLATION`; script-written workspace artifact path remains usable.
- Add direct text-protocol tests showing validated results are serialized without `compactLargeValueForModel`; retain provider correlation tests at `runtime-host/ai/providers/native-tool-correlation.test.ts:38-73` and additionally assert content is unchanged.
- Update environment/request fixtures carrying `observationCharBudget` (`agent-runtime/environment.test.ts:14-18`, `request-budget.test.ts:45-50`, and assistant isolation fixtures). Retain aggregate request-budget tests.
- Keep UI/storage regression tests such as `storage/assistant-conversations.test.ts:15-47`: ordinary raw output must still never enter timeline persistence.

## External References

- None. The recommendation uses existing repository contracts and capabilities only.

## Related Specs

- `.trellis/spec/platform-web/frontend/type-safety.md`
- `.trellis/spec/platform-web/frontend/quality-guidelines.md`
- `.trellis/spec/platform-web/storage/diagnostics.md`
- `.trellis/spec/contracts/backend/index.md`
- `.trellis/spec/contracts/backend/error-handling.md`
- `.trellis/spec/contracts/backend/quality-guidelines.md`
- `.trellis/spec/contracts/frontend/type-safety.md`
- `.trellis/spec/guides/cross-layer-thinking-guide.md`

## Caveats / Not Found

- No current universal Tool-result artifact contract, output cursor contract, or custom Tool output schema/size field was found.
- Search list/search “continuation” is currently advice to narrow inputs, not stable cursor paging. Only workspace read and diagnostics read expose exact offsets.
- The current 32-KiB check excludes `imageParts`; image byte/dimension limits need a separate media contract if this task intends to cover total provider payload size.
- `test_skill_script` currently embeds a failed `PlatformActionResult` as an outer successful tool observation. Changing that semantic is broader than output ownership and should not be bundled into the MVP without an explicit requirement.
- Memory summarization is intentionally lossy and should not be conflated with immediate tool-output truncation; removing all memory bounds would regress context retention.
