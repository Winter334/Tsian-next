# Transitional State Cleanup Implementation Plan

## Pre-Development

- Load `trellis-before-dev` before code changes.
- Read current platform-web and contracts specs referenced by this task.
- Do not start until planning is approved and `task.py start 06-14-transitional-state-cleanup` has run.

## Ordered Checklist

1. Contracts cleanup
   - Remove `StateRecord`, `StateWriteOperationType`, `StateWriteOperation`, and `StateWriteOutput` from `packages/contracts/src/runtime.ts`.
   - Remove `CheckpointSummary.stateRecordCount` from `packages/contracts/src/debug.ts`; replace with `workspaceFileCount`.
   - Remove direct `StateWriteOperation` dependency and old normalized state-write helper types from `packages/contracts/src/memory.ts`.
   - Build contracts early to reveal stale imports.

2. Storage cleanup
   - Delete `apps/platform-web/src/storage/state-records.ts`.
   - Remove its export from `apps/platform-web/src/storage/index.ts`.
   - Remove `LocalStateRecord`, `LocalCheckpointRecord.stateRecords`, and `TsianLocalDb.stateRecords` from `apps/platform-web/src/storage/db.ts`.
   - Rename Dexie database to a new prototype name, for example `tsian-agent-runtime-v3`.
   - Update `apps/platform-web/src/storage/checkpoints.ts` so checkpoints store and restore snapshot, history, and workspace files only.
   - Update checkpoint summaries to return `workspaceFileCount`.
   - Update `apps/platform-web/src/storage/saves.ts` to stop reading/deleting/passing state records.

3. Runtime and host cleanup
   - Remove state-record imports and query handling from `apps/platform-web/src/platform-host/index.ts`.
   - Stop listing state records before `runAgentRuntimeTurn`.
   - Stop passing state records into `commitSuccessfulRuntimeTurnForSave`.
   - Remove `AgentRuntimeTurnInput.stateRecords` from `apps/platform-web/src/agent-runtime/index.ts`.
   - Remove `formatStateRecords` and all "可用状态记录" prompt sections.
   - Update platform guard text to mention workspace context rather than state records.

4. Frontend/debug cleanup
   - Update `apps/platform-web/src/views/DebugView.vue` to remove state-record count, query, and details block.
   - Update `builtin/play-frontends/official-default/src/index.ts` to remove `StateRecord` import, `state` inspector tab, `state-records` query, and state renderer.
   - Update checkpoint display copy to use `workspaceFileCount` or omit file count if the UI should stay simpler.

5. Default workspace state convention
   - Add default files:
     - `state/README.md`;
     - `state/schemas/README.md`;
     - `state/data/README.md`.
   - Increment `DEFAULT_WORKSPACE_VERSION`.
   - Add the three state doc paths to `DEFAULT_WORKSPACE_UPGRADE_FILE_PATHS`.
   - Update root default workspace README for new saves to mention generic `state/`.
   - Add `state/README.md` to new default master Agent `contextPaths`; do not add bulk `state/data/*`.

6. Active docs/specs
   - Update active direction and handoff docs listed in `design.md`.
   - Update module handoff docs and Trellis specs so `stateRecords` is not documented as active state.
   - Keep archived task docs unchanged.

7. Cleanup search
   - Run an active-surface search for:

     ```bash
     rg -n "stateRecords|state-records|StateRecord|StateWriteOperation|StateWriteOutput|stateRecordCount" apps packages builtin docs/active .trellis/spec
     ```

   - Resolve all active hits unless the text explicitly explains retired history.

## Validation Commands

Run:

```bash
python3 ./.trellis/scripts/task.py validate 06-14-transitional-state-cleanup
git diff --check
npm run build:contracts
npm run build:web
```

Optional focused smoke after successful build:

```bash
rg -n "stateRecords|state-records|StateRecord|StateWriteOperation|StateWriteOutput|stateRecordCount" apps packages builtin docs/active .trellis/spec
```

Expected remaining hits: none in active app/contracts/frontend/spec surfaces.

## Risky Files

- `apps/platform-web/src/storage/db.ts`
- `apps/platform-web/src/storage/checkpoints.ts`
- `apps/platform-web/src/storage/saves.ts`
- `apps/platform-web/src/platform-host/index.ts`
- `apps/platform-web/src/agent-runtime/index.ts`
- `packages/contracts/src/runtime.ts`
- `packages/contracts/src/debug.ts`
- `packages/contracts/src/memory.ts`
- `builtin/play-frontends/official-default/src/index.ts`

## Rollback Points

- If contract removal exposes more stale generated surfaces than expected, keep the deletion scope but fix consumers rather than reintroducing compatibility types.
- If removing `CheckpointSummary.stateRecordCount` is too broad, use `workspaceFileCount` consistently instead of a deprecated nullable field.
- If default workspace upgrade risks overwriting user data, only add the three new `state/` docs through the manifest-gated, non-overwriting upgrade path.

## Definition Of Done

- No active runtime path reads, writes, prompts, queries, checkpoints, or displays `stateRecords`.
- New saves include the default workspace state convention docs.
- Active docs/specs tell future work to use workspace-native state.
- Builds and Trellis validation pass.
