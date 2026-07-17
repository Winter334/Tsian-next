# Implementation Plan: Text Tool Protocol v2

## Phase 0: Pre-Implementation Context

- Load Trellis before-dev guidance for `platform-web` before editing.
- Re-read the focused specs/context:
  - `.trellis/spec/platform-web/frontend/index.md`
  - `.trellis/spec/platform-web/frontend/quality-guidelines.md`
  - `.trellis/spec/platform-web/frontend/type-safety.md`
  - `.trellis/spec/guides/ai-facing-content-changes.md`
  - `.trellis/spec/guides/cross-layer-thinking-guide.md`
  - `.trellis/spec/guides/module-structure-guide.md`
- Check current git status and avoid touching unrelated existing tmp/storyteller changes.

## Phase 1: Text Protocol Grammar Module

- Add a focused module for Text Tool Protocol v2 grammar, preferably `apps/platform-web/src/agent-runtime/text-tool-protocol.ts`.
- Define constants for:
  - executable calls: `<tsian-tool-calls>`;
  - non-executable call records: `<tsian-tool-call-records>`;
  - observations: `<tsian-tool-observations>`;
  - protocol errors: `<tsian-tool-protocol-error>`.
- Implement parser result types for:
  - `stop` (no executable block);
  - `tool_calls` (valid executable block, parsed calls, surrounding prose/interim text);
  - `protocol_error` (malformed/ambiguous executable protocol).
- Enforce the v2 executable contract:
  - exactly one executable block for tool execution;
  - JSON array only;
  - call item object with non-empty string `name` and optional object `arguments`;
  - no legacy `<tsian-tool-call>` execution support.
- Implement helpers to format call records, observations, and protocol-error messages.
- Implement helpers for task compression: detect v2 interaction messages and extract first tool name.

## Phase 2: Tool Manifest From Shared Schema

- Refactor text/native setup so both modes build `ToolSchema[]` from `buildEnabledToolSchemas(...)` using the same inputs:
  - enabled platform tools;
  - `allowAgentCall` plus visible contacts;
  - filtered `agentContext.toolIndex` user Tools.
- Add a compact text manifest renderer from `ToolSchema[]`.
- Replace legacy text prompt examples/legacy tag teaching in `buildWorkspaceToolInstructions(...)` with Text Protocol v2 instructions and rendered manifest.
- Ensure text instructions include `ask_user` and user Tools when exposed by the shared schema source.
- Remove AI-facing references that describe text mode as legacy/fallback where user-facing or model-facing.

## Phase 3: Text Tool Loop Integration

- Update text branch in `callAgentModelWithWorkspaceTools(...)`:
  - call the v2 parser after each text model response;
  - use parser `finishReason` to emit trace and `onRoundEnd`;
  - collect interim prose around valid calls as timeline interim;
  - assign stable ids `text-r${round}-c${index}` before execution;
  - pass parsed calls into `executeRuntimeWorkspaceToolCalls(...)` unchanged otherwise;
  - append non-executable call records and compact observations to `nextMessages`;
  - keep image part injection behavior for workspace image reads;
  - collect tool calls and tool memories with stable text ids.
- Remove text-loop dependence on `stripRuntimeWorkspaceToolCallBlocks(...)` for executable calls, replacing it with v2 stripping/formatting helpers.
- Preserve `think` block extraction/stripping behavior for visible final text and thought timeline items.

## Phase 4: Protocol Error Retry

- Add a bounded retry counter for text protocol parse/shape errors.
- On malformed protocol output while retries remain:
  - append a protocol-error observation user message;
  - emit model-call trace with protocol error metadata if useful;
  - emit `onRoundEnd(..., "tool_calls")` so UI treats it as a process round;
  - continue to next model call.
- When retry budget is exhausted, throw a clear error.
- Do not route shared executor/tool errors through this retry path; they remain observations.

## Phase 5: Compression Updates

- Update `isTaskInteractionMessage(..., "text")` to recognize v2 call records, v2 observations, and protocol-error messages.
- Update task compression tool-name extraction in `context-lifecycle.ts` to parse v2 call records (and optionally observations) instead of legacy executable blocks.
- Ensure native compression behavior remains unchanged.

## Phase 6: Runtime Host / Settings Text Neutrality

- Update config comments/tooltips/labels that currently describe text as legacy fallback to neutral “text protocol” language.
- Update native probe failure messages to report facts only, removing mode-switch recommendations.
- Confirm no text-protocol probe was added.
- Do not add runtime auto-switching.

## Phase 7: Validation

Required commands:

- `npm run build:web`
- `git diff --check`

Focused code-review checks:

- Search AI-facing surfaces for stale legacy executable protocol guidance:
  - `<tsian-tool-call>` should not appear in prompt-visible text or parser execution paths.
  - It may remain only in historical docs/comments if clearly not runtime AI-facing; prefer removing stale comments when nearby.
- Search user-facing text for recommendation wording around tool mode selection, especially `建议切换` / `fallback` / `legacy` / `兼容` where it implies product recommendation rather than factual capability.
- Verify text manifest uses `ToolSchema[]` and includes user Tools in text mode.
- Verify legacy `<tsian-tool-call>` is not executable.
- Verify native mode still calls `callModelNative` with `ToolSchema[]` and appends native `role: "tool"` observations as before.
- Verify text mode call ids are stable and include round/index.
- Verify malformed v2 protocol output produces bounded retry behavior.
- Verify task compression detects v2 text interaction messages.

Manual/ad-hoc probes if no test framework is added:

- Parse a valid one-call `<tsian-tool-calls>` array.
- Parse a valid multi-call array.
- Parse valid block with surrounding prose and confirm interim text extraction.
- Parse malformed JSON and confirm protocol error classification.
- Parse JSON object instead of array and confirm protocol error classification.
- Confirm legacy `<tsian-tool-call>` produces no executable call.

## Risk / Rollback Points

- Parser/formatter module is the primary rollback boundary.
- Prompt/manifest changes are AI-facing; rollback must restore a coherent single protocol, not a mixed v1/v2 prompt.
- Text loop integration touches process timeline and context compression; validate both assistant/task and formal player-turn paths.
- Avoid changing shared executor semantics unless strictly necessary.
- Avoid storage/schema changes.

## Not Planned

- No dedicated text protocol probe.
- No automatic native→text or text→native switching.
- No old `<tsian-tool-call>` compatibility execution.
- No new IndexedDB/Dexie storage shape.
