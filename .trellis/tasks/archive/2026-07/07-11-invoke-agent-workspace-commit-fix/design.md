# 修复 invokeAgent 覆盖前端写入 — Design

## Problem Statement

`interaction.invokeAgent` is a side-channel Agent call. It starts with a staged `RuntimeWorkspaceTransaction` built from an effective workspace snapshot. While that side-channel call is running, `inspect_frontend` can operate the visible `/play` iframe. The iframe uses the real bridge path and persists `workspace.write` requests directly to Dexie.

The current side-channel commit then passes `workspaceTransaction.finalWorkspaceFiles()` into full-replacement helpers. Those helpers delete every current `workspaceFiles` row for the save and insert only the staged snapshot. Files written by the frontend after the side-channel snapshot but before the side-channel commit are not present in that snapshot and are deleted.

A separate diagnostic problem compounds the confusion: `inspect_frontend({ wait: "runtime-settled" })` only treats `interaction.sendMessage` as a trigger, so pure bridge-backed frontend work such as setup import (`workspace.write`) can complete but still return `ok:false / INSPECT_RUNTIME_NOT_TRIGGERED`.

## Design Goals

1. Preserve real frontend bridge writes made during a side-channel `invokeAgent` call.
2. Keep side-channel Agent writes durable, including traces and persisted context updates.
3. Preserve `workspace-with-checkpoint` post-turn-maintenance semantics.
4. Make `inspect_frontend` wait semantics match both formal player turns and pure bridge-backed frontend work.
5. Avoid changing Dexie schema or broad formal turn commit semantics.

## Non-Goals

- Do not change formal `interaction.sendMessage` main turn full-snapshot commit behavior in this task.
- Do not add hidden iframe/private inspection targets.
- Do not add OS file selection automation.
- Do not introduce a global event bus or a new storage table.
- Do not redesign checkpoint pruning or history turn storage.

## Current Data Flow

```text
Desktop Assistant invokeAgent starts
  -> platform-host creates RuntimeWorkspaceTransaction from effective workspace snapshot
  -> Assistant calls inspect_frontend
    -> visible /play iframe dispatches real DOM action
    -> frontend SDK sends workspace.write over bridge
    -> platform-host direct mutation path persists file to Dexie workspaceFiles
  -> Assistant model turn finishes
  -> invokeAgent stages trace/context into old transaction
  -> commitWorkspaceFilesForSave(finalWorkspaceFiles)
    -> deletes all current workspace rows
    -> writes old transaction snapshot
    -> deletes frontend-written files absent from old snapshot
```

## Target Data Flow

```text
Desktop Assistant invokeAgent starts
  -> RuntimeWorkspaceTransaction tracks explicit writes/deletes as a changeset
  -> inspect_frontend action persists frontend workspace.write directly to Dexie
  -> Assistant model turn finishes
  -> invokeAgent stages trace/context into transaction
  -> commitWorkspaceChangesForSave(finalWorkspaceChanges)
    -> deletes only paths explicitly deleted by the side-channel transaction
    -> upserts only files explicitly written by the side-channel transaction
    -> preserves all current DB rows not touched by the side-channel transaction
```

For `workspace-with-checkpoint`:

```text
Read current DB workspace
  -> merge side-channel changes into current DB state in memory
  -> build checkpoint from merged state outside Dexie transaction
  -> in Dexie transaction:
       apply side-channel deletes/upserts
       delete same-turn after-turn checkpoints except protected frontend debug checkpoint
       put post-turn-maintenance checkpoint
       touch save updatedAt
  -> prune checkpoints
```

## RuntimeWorkspaceTransaction Changeset

Extend `RuntimeWorkspaceTransaction` with a new non-breaking method, for example:

```ts
interface RuntimeWorkspaceChanges {
  writtenFiles: WorkspaceFile[]
  deletedPaths: string[]
}

interface RuntimeWorkspaceTransaction {
  readonly workspaceFiles: WorkspaceFile[]
  write(input: WorkspaceWriteInput): WorkspaceFile
  writePlatformFile(input: WorkspaceWriteInput): WorkspaceFile
  delete(path: unknown): { deletedPaths: string[] }
  finalWorkspaceFiles(): WorkspaceFile[]
  finalWorkspaceChanges(): RuntimeWorkspaceChanges
  discard(): void
}
```

Implementation details:

- `write(...)` and `writePlatformFile(...)` call existing staged write helpers, then record the normalized resulting `file.path` in a `writtenPathSet`.
- `delete(...)` calls the existing staged delete helper, then records returned `deletedPaths` in a `deletedPathSet`.
- If a path is written after deletion, the write remains in `writtenFiles`; the deleted path should not remove the final upsert. The commit helper can apply deletes first and then upserts.
- If a path is deleted after write, the staged delete removes it from staged files; `finalWorkspaceChanges()` should not include it in `writtenFiles` if it is no longer present in `stagedFiles`.
- `finalWorkspaceChanges()` returns cloned/sorted files for `writtenPathSet` paths still present in `stagedFiles`, plus sorted `deletedPaths`.
- `finalWorkspaceFiles()` remains unchanged for existing formal turn callers.

## Side-Channel Partial Commit

Add storage-level helpers near existing side-channel commit helpers in `apps/platform-web/src/storage/saves.ts`.

Suggested API:

```ts
export async function commitWorkspaceChangesForSave(
  saveId: string,
  changes: RuntimeWorkspaceChanges,
): Promise<void>

export async function commitWorkspaceChangesWithCheckpointForSave(
  saveId: string,
  changes: RuntimeWorkspaceChanges,
  input: {
    turn: number
    checkpointReason: "post-turn-maintenance"
  },
): Promise<void>
```

### `commitWorkspaceChangesForSave`

- Convert `changes.writtenFiles` through `saveRuntimeFilesFromEffectiveWorkspace` and `createLocalWorkspaceFileRecord`.
- Normalize/dedupe `changes.deletedPaths`.
- In a Dexie transaction over `saves` and `workspaceFiles`:
  - delete rows whose path is exactly a deleted path or under a deleted directory prefix;
  - put written records;
  - touch save `updatedAt` if there was at least one delete or upsert.
- Do not delete unrelated current DB rows.

### `commitWorkspaceChangesWithCheckpointForSave`

- Read current save workspace rows.
- Apply changes in memory to produce merged post-maintenance workspace:
  - remove explicit deleted paths/prefixes;
  - upsert written records;
  - keep unrelated current rows.
- Build checkpoint files from merged rows after filtering append-only logs.
- Build the checkpoint outside Dexie transaction, matching existing async hash constraints.
- In the transaction:
  - apply the same deletes/upserts;
  - delete same-turn `after-turn` checkpoints except protected frontend debug checkpoint;
  - write the maintenance checkpoint;
  - touch save `updatedAt`.
- Run `pruneCheckpointsForSave(saveId)` after the transaction.

### Conflict Policy

For this task, the minimal safety guarantee is preserving unrelated external writes. Same-path concurrent writes remain last-commit-wins for the side-channel's explicitly touched path, matching existing write semantics.

A stricter baseline conflict detector is valuable but not required for this bugfix unless the implementation finds an existing, low-cost baseline comparison utility. If implemented, it should fail loud only for side-channel-touched paths whose DB state changed since baseline.

## Platform Host Integration

In `apps/platform-web/src/platform-host/index.ts`, update only the `interaction.invokeAgent` commit dispatch:

Current shape:

```ts
await (commitMode === "workspace-with-checkpoint"
  ? commitWorkspaceFilesWithCheckpointForSave(saveId, workspaceTransaction.finalWorkspaceFiles(), input)
  : commitWorkspaceFilesForSave(saveId, workspaceTransaction.finalWorkspaceFiles()))
```

Target shape:

```ts
const workspaceChanges = workspaceTransaction.finalWorkspaceChanges()
await (commitMode === "workspace-with-checkpoint"
  ? commitWorkspaceChangesWithCheckpointForSave(saveId, workspaceChanges, input)
  : commitWorkspaceChangesForSave(saveId, workspaceChanges))
```

Keep the existing ordering:

1. Stage context update if needed.
2. Stage side-channel trace.
3. Commit durable workspace/checkpoint changes.
4. Emit `agent-invocation.completed`.

## `inspect_frontend` Wait Semantics

Current behavior:

- `wait: "runtime-settled"` with actions calls `waitForSendAfter(...)`.
- If no `interaction.sendMessage` starts, it returns `INSPECT_RUNTIME_NOT_TRIGGERED`.

Target behavior:

- `wait: "runtime-settled"` with actions waits for any post-action bridge activity.
- If post-action bridge activity exists, create/continue a runtime wait chain and wait until bridge in-flight count is 0 and quiet for 2 seconds.
- If the activity includes `interaction.sendMessage`, retain formal turn metadata (`sendCount`, send-triggered status).
- If the activity is pure `workspace.write`, return `ok:true` after quieting.
- If no post-action bridge activity occurs, return `INSPECT_RUNTIME_NOT_TRIGGERED` with updated message: actions did not trigger bridge activity.

Implementation outline:

- Extend internal `RuntimeChainState` with optional trigger metadata such as `trigger: "send" | "bridge"`.
- Replace `waitForSendAfter` gating with `waitForBridgeActivityAfter`.
- `recordActivity` should still increment `sendCount` and upgrade a generic bridge chain to send-triggered when `interaction.sendMessage` starts.
- `waitForRuntimeSettled` can mostly remain unchanged because it already checks bridge in-flight and quiet time.

## AI-Facing and Spec Updates

Update the following surfaces so future assistants learn the new behavior:

- `apps/platform-web/src/agent-runtime/tool-schemas.ts`
- `apps/platform-web/src/storage/local-assistant-files.ts` if it contains `inspect_frontend` tool wording
- `.trellis/spec/platform-web/frontend/type-safety.md`
- `.trellis/spec/platform-web/storage/index.md`

Required wording changes:

- `runtime-settled` waits for bridge activity, covering both formal player turns and pure frontend workspace operations.
- `INSPECT_RUNTIME_NOT_TRIGGERED` means no bridge activity was triggered, not merely no `interaction.sendMessage`.
- `invokeAgent` side-channel commits submit a changeset/merge, not full snapshot replacement.

## Compatibility and Risks

- Existing formal turn code can keep using `finalWorkspaceFiles()` and full commit helpers.
- Side-channel commits become less destructive but still persist side-channel writes/traces/context.
- `workspace-with-checkpoint` must not build checkpoint from a stale transaction snapshot; otherwise restore can still lose frontend writes.
- Generic bridge activity waiting may count post-action background bridge reads. This is acceptable for the current semantics: after actions, wait for frontend bridge activity to settle. If noise becomes a problem later, the trigger set can be narrowed to mutating/business methods while keeping `workspace.write` included.

## Validation Strategy

1. Type/build validation: `npm run build:web`.
2. If shared contracts are changed: `npm run build:contracts`.
3. Browser reproduction:
   - prepare `/play` setup import with a selected novel file;
   - ask Desktop Assistant to click “导入” via `inspect_frontend`;
   - verify `workspace.write` activity completed and inspect result is successful;
   - after assistant response completes, inspect IndexedDB / Resource Manager for durable `save/source/**` files;
   - switch chapter preview and verify preview reads real workspace content.
4. Regression sanity:
   - no action / no bridge activity still reports `INSPECT_RUNTIME_NOT_TRIGGERED`;
   - formal `sendMessage` wait still observes `sendCount` and quieting;
   - `operation: "finish"` still restores debug baseline.
