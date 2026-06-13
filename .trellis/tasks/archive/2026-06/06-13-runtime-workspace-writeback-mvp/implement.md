# Native AIRP History Writeback Implementation Plan

## Checklist

- [x] Load platform-web frontend specs with `trellis-before-dev` before editing code.
- [x] Add raw AIRP history helpers in the platform host or a nearby storage helper:
  - format `history/turns/turn-000001.json` paths.
  - serialize the turn JSON contract.
  - write the file with `application/json`.
  - sync the in-memory `workspaceFiles` array.
  - best-effort restore/delete the file if a later success-path storage step fails.
- [x] Wire the writeback into `interaction.sendMessage` only after `runAgentRuntimeTurn` returns and the abort check passes.
- [x] Keep the raw history file free of prompts, master briefs, tool observations, trace events, and delegated Agent outputs.
- [x] Update default Runtime Workspace docs:
  - mention `history/turns/` in `history/README.md`.
  - optionally add `history/turns/README.md` so the directory is visible before the first turn.
- [x] Verify that checkpoints include the written history turn file by relying on the existing `workspaceFiles` checkpoint path.
- [x] Keep current `saveHistory` / snapshot behavior unchanged.

## Validation

- [x] `npm run build:web`
- [x] `git diff --check`
- [x] Focused one-off runtime/storage probe or manual verification:
  - successful turn writes `history/turns/turn-*.json`;
  - file content includes player input and final assistant output;
  - file content does not include master brief or trace/tool details;
  - workspace search can match the individual turn file;
  - failed/aborted turn does not leave a raw history file when practical to probe.

## Risk Notes

- `interaction.sendMessage` currently performs multiple storage writes after model success. Raw history writeback should be placed before checkpoint creation and tracked for rollback if later storage work fails.
- Existing saves will not be backfilled, so validation should use a new or current save after the feature is applied.
- Do not use this task to introduce a semantic memory layer, summary step, or dedicated history retrieval primitive.
