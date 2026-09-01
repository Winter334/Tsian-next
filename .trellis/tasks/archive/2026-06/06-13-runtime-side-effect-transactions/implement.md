# Implementation Plan

## Pre-Implementation Checks

- Load `trellis-before-dev` before editing product code.
- Read the platform-web specs listed by `.trellis/spec/platform-web/frontend/index.md`.
- Re-scan `platform-host/index.ts`, `platform-host/browser-skill-script-executor.ts`, `agent-runtime/workspace-tools.ts`, and `storage/workspace.ts` before edits.
- Search before changing path constants or action names such as `.tsian`, `workspace-write`, `workspace-delete`, and `.tsian/traces/`.

## Implementation Checklist

1. Add staged workspace helpers.
   - Provide an in-memory staged workspace view initialized from `listWorkspaceFilesForSave`.
   - Implement staged write/delete with storage-compatible path/content/media type normalization.
   - Reject ordinary mutation targets under `.tsian/*`.
   - Preserve created/updated timestamps consistently.

2. Add atomic successful-turn commit storage helper.
   - Persist final accepted workspace files, snapshot/history, save timestamp, and after-turn checkpoint in one Dexie transaction.
   - Ensure the checkpoint record uses the same final workspace file list, not a separate out-of-transaction read.
   - Keep existing checkpoint restore/list behavior compatible.

3. Route Agent Runtime platform actions through staging.
   - Replace `createAgentRuntimePlatformActionRunner` behavior inside `interaction.sendMessage` so `workspace-write` / `workspace-delete` stage mutations rather than immediate storage writes.
   - Keep frontend bridge `platform.runAction` immediate.
   - Preserve existing structured platform action errors for unsupported actions and validation failures.

4. Route browser script SDK workspace operations through staging.
   - Read/list/search against the staged view.
   - Write/delete into the staged view.
   - Keep script logs and action trace summaries.

5. Update sendMessage success/failure flow.
   - Use the staged workspace view during `runAgentRuntimeTurn`.
   - Stage raw AIRP history turn file after narrative success.
   - Include successful trace in final accepted workspace state when practical.
   - Commit final workspace + snapshot/history + checkpoint atomically.
   - On failure/abort, discard ordinary staged mutations and best-effort persist failed trace only.

6. Update docs/specs.
   - Update active direction/current-state docs if the transaction contract becomes authoritative.
   - Update `.trellis/spec/platform-web/frontend/type-safety.md` if new runtime/storage boundary rules should guide future tasks.

## Validation Plan

- Build: `npm run build:web`
- Contract build only if shared contract source changes: `npm run build:contracts`
- Diff hygiene: `git diff --check`
- Focused runtime/browser probes:
  - successful `platform_action/workspace-write` stages, same-turn reads, commits, and appears in checkpoint;
  - failed model call after staged write leaves no ordinary persisted workspace write;
  - abort after staged write leaves no ordinary persisted workspace write;
  - browser script SDK write/delete follows the same transaction behavior;
  - ordinary `.tsian/*` write/delete attempts through Agent/Skill action fail structurally;
  - failed-turn trace persists under `.tsian/traces/` when possible;
  - frontend bridge `platform.runAction` workspace write/delete remains immediate.

## Risky Files

- `apps/platform-web/src/platform-host/index.ts`
- `apps/platform-web/src/platform-host/browser-skill-script-executor.ts`
- `apps/platform-web/src/storage/workspace.ts`
- `apps/platform-web/src/storage/checkpoints.ts`
- `apps/platform-web/src/storage/saves.ts`
- `apps/platform-web/src/storage/db.ts`
- `apps/platform-web/src/agent-runtime/workspace-tools.ts`
- `apps/platform-web/src/agent-runtime/trace.ts`
- `docs/active/current-state-handoff.md`
- `docs/active/agent-framework-runtime-workspace-direction.md`
- `.trellis/spec/platform-web/frontend/type-safety.md`

## Rollback Points

- After staged helper creation, verify storage immediate frontend actions still work before wiring Agent Runtime.
- After platform action staging, verify existing `workspace-write` and `workspace-delete` observations still match the old caller-facing shape.
- After browser script SDK staging, verify scripts can read their own writes without hitting IndexedDB.
- After atomic commit helper, verify checkpoint restore returns the committed workspace state.
- If atomic cross-table commit becomes too invasive, stop and revise design rather than falling back silently to rollback log.

## Review Gate

- Confirm PRD/design/implement are reviewed before `task.py start`.
- Implementation should not begin until the user approves this child task plan.

## Verification Results

- `npm run build:web` passed.
- `git diff --check` passed.
- Browser IndexedDB probe passed for staged write visibility, pre-commit non-persistence, `.tsian/*` ordinary mutation rejection, atomic successful-turn commit, checkpoint restore, failed discard, host-owned failed trace write, and immediate direct storage write behavior.
- Browser Worker probe passed for `browser_script` SDK read/write against staged workspace view and mutation/script trace emission.
- Shared contract source was not changed, so `npm run build:contracts` was not required.
