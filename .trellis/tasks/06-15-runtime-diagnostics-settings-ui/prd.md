# Runtime Diagnostics And Settings UI

## Goal

Turn runtime diagnostics, settings, traces, checkpoints, and debug data into a usable platform observability UI.

## Parent

- `.trellis/tasks/06-15-platform-ui-development-phase`

## Requirements

- Improve model settings UI beyond the current minimal chat config form.
- Present active save/card/frontend context in diagnostics.
- Show `runtime-diagnostics` summaries in a bounded, facts-only way.
- Keep raw AI debug and trace data platform-only.
- Preserve current checkpoint restore capability.
- Present history, snapshot, checkpoints, and AI debug without raw JSON being the only affordance.
- Keep remote/packaged game frontend bridge from exposing `ai-debug`.

## Acceptance Criteria

- [ ] Settings view clearly shows current effective AI config and local override state.
- [ ] Diagnostics view can show runtime diagnostic summaries.
- [ ] History/checkpoint/snapshot/debug sections remain available but easier to scan.
- [ ] Checkpoint restore remains explicit and validated.
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
