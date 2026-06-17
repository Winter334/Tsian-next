# Runtime Diagnostics And Settings UI

## Goal

Turn runtime diagnostics, settings, traces, checkpoints, and debug data into usable RetroOS desktop observability surfaces.

## Parent

- `.trellis/tasks/06-15-platform-ui-development-phase`

## Current Alignment

Keep this task. The shell pivot changes presentation, not the underlying goal. Treat Settings as a Control Panel style window and Diagnostics as a System Monitor / Event Viewer style window in the current RetroOS desktop shell, while keeping raw AI/debug material platform-only and bridge-safe.

## User Value

- Ordinary players can tell whether the local AI model configuration is ready without reading environment-variable documentation.
- Authors and testers can understand the current Game Card / Save / frontend context and recent runtime behavior from one monitor window.
- Checkpoints, history, snapshots, and AI debug remain available for development, but the first screen emphasizes readable summaries instead of raw JSON.
- The System Monitor feels like a newly designed RetroOS utility instead of a repainted legacy debug page.
- The platform keeps debug-only material inside the platform shell and does not expose it to remote or packaged game frontends.

## Confirmed Facts

- `SettingsView.vue` already stores local browser AI overrides through `config/ai.ts`.
- `DebugView.vue` already reads `history`, `checkpoints`, runtime snapshot, and platform-only AI debug records.
- `platform-host` already exposes `runtime-diagnostics` through platform-local `playFrontendBridge.query`.
- `remote-iframe-bridge` blocks `ai-debug`, so remote/packaged frontends cannot query raw AI debug records.
- The current desktop shell already names Settings as `控制面板` and Debug as `系统监视器`.
- Existing contract types provide `RuntimeDiagnosticSummary`, `RuntimeDiagnosticFact`, `RuntimeDiagnosticHealth`, `CheckpointSummary`, and `AiDebugRecord`.

## Requirements

- Improve model settings UI beyond the current minimal chat config form.
- Show current effective AI config and whether each field comes from a local override or the environment.
- Keep API keys masked in summaries and never render the raw key outside the password input.
- Replace the legacy Debug panel layout with a new System Monitor information architecture.
- Present active save/card/frontend context as the monitor's top-level runtime identity.
- Show `runtime-diagnostics` summaries in a bounded, facts-only way, including turn, status, severity, health counts, and selected facts.
- Keep raw AI debug and trace data platform-only.
- Preserve current checkpoint restore capability with an explicit user confirmation.
- Present history, snapshot, checkpoints, and AI debug as separate purpose-built inspection areas, with raw JSON/details still available behind disclosure controls.
- Keep remote/packaged game frontend bridge from exposing `ai-debug`.

## Acceptance Criteria

- [ ] Settings view clearly shows current effective AI config and local override state.
- [ ] Settings save/reset feedback remains visible and the view refreshes the effective config after changes.
- [ ] System Monitor uses a new layout, not the old Debug page structure with minor copy/style changes.
- [ ] Diagnostics view shows active platform context, including save and frontend context when available.
- [ ] Diagnostics view can show runtime diagnostic summaries.
- [ ] History/checkpoint/snapshot/debug sections remain available but easier to scan.
- [ ] Checkpoint restore remains explicit, confirmed, and validated.
- [ ] No debug namespace is exposed to remote/packaged game frontends.
- [ ] `npm run build:web` passes.
- [ ] Browser smoke covers settings save/reset and diagnostics refresh.

## Dependencies

- Existing AI config helpers.
- Existing runtime-diagnostics query and debug records.

## Out Of Scope

- New executor classes.
- Trace pruning or retention policy.
- Account/cloud model-provider settings.
- Management Agent auto-repair workflows.
- New contract schemas unless existing runtime diagnostic and debug contracts prove insufficient.
- Exposing raw AI debug data to game frontends.
