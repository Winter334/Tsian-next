# Runtime Diagnostics And Settings UI Design

## Architecture And Boundaries

This task keeps the existing two-window desktop model:

- `控制面板` (`SettingsView.vue`) owns local platform configuration display and editing.
- `系统监视器` (`DebugView.vue`) owns runtime observability, checkpoint actions, and platform-only debug inspection.

The task should not introduce a new route shell, a new settings backend, or new contracts unless existing types are demonstrably insufficient. It should consume the current platform-host APIs and contract shapes:

- AI configuration: `apps/platform-web/src/config/ai.ts`
- Runtime/platform data: `playFrontendBridge.runtime`, `playFrontendBridge.platform`, and `playFrontendBridge.query`
- Diagnostics: `RuntimeDiagnosticSummary`
- Checkpoints: existing `checkpoints` query and `restore-checkpoint` platform action
- Raw AI debug: `playFrontendBridge.debug`, platform shell only

Remote and packaged game frontends must remain limited to bridge-safe query resources. The existing remote bridge denial of `ai-debug` is part of the acceptance surface and should not be weakened.

## System Monitor Redesign Direction

The current Debug page is a legacy developer dump. The new System Monitor should be redesigned from first principles as a RetroOS utility for understanding runtime health.

Design tone: compact industrial utility, closer to Task Manager + Event Viewer than a generic dashboard. It should be calm, information-dense enough for repeated testing, and readable for non-engineers.

The memorable interaction should be: "I open System Monitor and immediately know what runtime context is loaded, whether it is healthy, and where to inspect the latest turn."

Recommended layout:

1. Header strip
   - Window-local title: `系统监视器`
   - Refresh action
   - Last refresh time
   - Overall runtime status derived from diagnostics, snapshot, and AI debug errors

2. Runtime identity band
   - Current save
   - Frontend binding
   - Runtime turn
   - Message count
   - Checkpoint count
   - Model-call count

3. Main monitor grid
   - Left rail: monitor sections as a vertical list (`概览`, `诊断`, `历史`, `检查点`, `AI 调试`, `快照`)
   - Main pane: selected section content
   - Right summary pane on wide screens: latest diagnostics and recent issues

4. Section behavior
   - `概览`: health tiles and latest turn summary.
   - `诊断`: runtime diagnostic summaries grouped by turn with severity/status indicators and readable fact rows.
   - `历史`: recent conversation rows with role, turn/order, and content preview.
   - `检查点`: checkpoint timeline with restore confirmation.
   - `AI 调试`: model-call records with label/model/usage/error first; raw request/response behind details.
   - `快照`: concise snapshot summary first; raw JSON behind details.

The old page structure of stacked cards with raw JSON details should be removed rather than incrementally restyled.

## Control Panel Surface

The Settings view should become a compact Control Panel page:

- Show a status row for the effective chat model: configured / missing.
- Show effective base URL and model.
- Show local override state per field: base URL, model, API key.
- Mask API key summaries; do not render the actual key except in the password input value controlled by the browser.
- Keep save and reset actions near the form.
- Preserve existing localStorage-backed behavior.

The page can keep a small platform overview, but the primary user task is AI configuration readiness.

## System Monitor Data Surface

The Debug view should become a System Monitor / Event Viewer page with readable top-level summaries:

- Platform context: active save, frontend id, snapshot turn, history count, checkpoint count, AI debug count.
- Diagnostics summary: query `runtime-diagnostics` with bounded params and display latest summaries by turn, severity, status, event count, malformed count, omitted fact count, health counts, and facts.
- History: show recent message rows first, with raw JSON behind details.
- Checkpoints: show checkpoint label, turn, reason, created time, message count, workspace file count, and an explicit restore button.
- Snapshot: show turn and message count first, with raw JSON behind details.
- AI debug: show model-call rows first, with request/response details behind details.

Checkpoint restore must remain an explicit platform action and should ask for confirmation before running.

## Data Flow

On mount, the System Monitor waits for platform host readiness, then refreshes:

1. Platform context through `playFrontendBridge.platform.getPlatformContext()`.
2. Runtime snapshot through `playFrontendBridge.runtime.getRuntimeSnapshot()`.
3. `history`, `checkpoints`, and `runtime-diagnostics` through `playFrontendBridge.query.query`.
4. Platform-only AI debug through `playFrontendBridge.debug?.getAiDebugRecords()`.

The existing `onTurnDebugReady` subscription should continue to refresh the monitor after runtime turns.

## Compatibility

- No storage migration is required.
- Existing settings localStorage keys stay unchanged.
- Existing route names and desktop app ids stay unchanged.
- Existing raw JSON affordances stay available behind disclosure controls for advanced debugging.

## Trade-Offs

- This slice keeps Settings and Diagnostics as two separate desktop apps instead of combining them into one window. That matches the current app registry and keeps each surface simpler.
- This slice replaces the monitor information architecture without adding new filtering/persistence controls. More advanced event filtering can be a later task after users test the first monitor layout.
- This slice uses existing diagnostics summaries rather than exposing raw trace files, preserving the current platform boundary.

## Rollback

Rollback is limited to the two route views unless a small helper is introduced. If the monitor layout causes regressions, restore `SettingsView.vue` and `DebugView.vue` from the previous commit; no data migration or schema rollback is needed.
