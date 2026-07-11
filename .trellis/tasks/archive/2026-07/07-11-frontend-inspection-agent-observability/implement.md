# 前端自检工具 Agent 可行动观测优化 - Implementation Plan

## Phase 0. Pre-flight

- Confirm no unrelated task files are edited accidentally; current repository already has unrelated active work under `07-10-worker-subbuild-materialization` and frontend-build files.
- Before code edits, load `trellis-before-dev` for `platform-web` and `contracts` guidance.
- Treat existing uncommitted changes as user/other-task work; do not revert them.

## Phase 1. Contracts and tool schema

1. Update `apps/platform-web/src/agent-runtime/workspace-tools-types.ts`:
   - Add wait mode type including `dom-stable`.
   - Add `InspectFrontendWaitSummary`, `InspectFrontendInteractable`, `InspectFrontendActionResult`, `InspectFrontendDiagnosticsSummary`, `InspectFrontendBuildSummary`, `InspectFrontendSourceHint`.
   - Add optional result fields: `wait`, `interactables`, `actions`, `diagnosticsSummary`, `frontendBuild`, `sourceHints`.
2. Update `apps/platform-web/src/agent-runtime/tool-schemas.ts`:
   - Add `dom-stable` enum value.
   - Rewrite wait descriptions to distinguish pure UI changes from runtime/player-turn waits.
3. Update `apps/platform-web/src/agent-runtime/workspace-tools.ts` normalization:
   - Accept `dom-stable`.
   - Keep `timeoutMs` limited to `runtime-settled`, unless a separate DOM timeout is explicitly introduced.
   - Update validation error text.

## Phase 2. Diagnostics filtering

1. Update `frontend-inspector-diagnostics.ts`:
   - Keep real resource element `error` events in `resourceFailures`.
   - Stop adding Resource Timing zero-byte entries to `resourceFailures`.
   - Track timing anomaly count / sample hosts / truncated state internally for `diagnosticsSummary`.
2. Add helper to produce `InspectFrontendDiagnosticsSummary` from collector state.
3. Ensure `emptyInspectDiagnostics` and empty summary stay consistent.

## Phase 3. Interactables and structure filtering

1. Update `frontend-inspector-dom.ts`:
   - Add `collectInteractables(doc)` with filtering rules from `design.md`.
   - Add deterministic ref generation (`i1`, `i2`, ...).
   - Add selector generation helper with uniqueness checks.
   - Remove low-value root CSS variables from default `computedStyles`; keep only key selector styles or reduce further if no consumer depends on root variables.
2. Thread `interactables` through `CapturedFrame` and inspect results.

## Phase 4. Action execution summaries

1. Extend `runInspectDomActions` to always collect `InspectFrontendActionResult[]`.
2. For each action:
   - Count selector matches.
   - Capture target summary.
   - Capture DOM signature before/after.
   - Receive bridge activity sequence getter via options and mark `bridgeTriggered`.
3. Preserve existing `actionSnapshots` when `observeBetween` is true.
4. Change callers in `frontend-inspector.ts` to retain action results even if wait later returns not-triggered.
5. Ensure action failure returns partial action summary and structured error.

## Phase 5. Wait telemetry and result semantics

1. Add wait telemetry helpers in `frontend-inspector.ts`:
   - Runtime trigger wait returns `{ triggered, waitedMs, activityBefore, activityAfter }` instead of boolean only.
   - Runtime settle wait returns status + waitedMs.
   - DOM-stable wait returns status + waitedMs.
2. For `runtime-settled` + actions + no bridge trigger:
   - Return `ok: true` when actions/inspection succeeded.
   - Include `wait.status = "not-triggered"`.
   - Include final captured frame, action summaries, diff, runtime summary.
   - Optionally include a non-fatal finding/message only if it helps the Agent without adding prompt noise.
3. For true failures (selector not found, not actionable, iframe unavailable, finish failure), keep `ok:false`.
4. Preserve `actionResults` in failure result when wait or later capture fails after actions.

## Phase 6. frontendBuild and sourceHints

1. Add compact build summary helper using `getFrontendBuildStatus(cardId)`.
2. Include `frontendBuild` in inspect and finish results when card id is known.
3. Convert existing `fileLineMap` to high-confidence `sourceHints` with kind `runtime-error`.
4. Convert build error file/line to `sourceHints` with kind `build-error`.
5. Do not add visible-text/class source search in this task.

## Phase 7. Docs and assistant-facing instructions

1. Update `docs/active/assistant-frontend-inspection-direction.md`:
   - Filtered Agent-facing result principle.
   - `dom-stable` vs `runtime-settled` usage.
   - `wait` telemetry and action summaries.
   - Diagnostics summary/resource timing anomaly behavior.
   - `frontendBuild` and high-confidence `sourceHints`.
2. Update `apps/platform-web/src/storage/local-assistant-files.ts` embedded assistant guidance:
   - Use `dom-stable`/no wait for pure UI state changes.
   - Use `runtime-settled` only for player turns or bridge-backed work.
   - Always finish debug session.
3. Keep wording concise to avoid replacing one kind of noise with prompt instruction noise.

## Phase 8. Validation

- Run `npm run build:contracts` if contract/shared type files changed.
- Run `npm run build:web` for platform-web.
- If build output warns only on known chunk/pure-comment warnings, record as warnings not failures.
- Review generated inspect result shapes for context size and backwards compatibility.

## Risk / Rollback Points

- Result type changes are additive; if a field causes trouble, remove population while keeping old inspect flow.
- Diagnostics filtering may hide details a developer wanted; retain folded timing anomaly count/sample to preserve signal without raw spam.
- Changing `ok` semantics for `INSPECT_RUNTIME_NOT_TRIGGERED` is behavior-sensitive; keep `wait.status` explicit and update docs/tool description together.
