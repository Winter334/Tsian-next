# Design

## Boundary

This task adds a runtime-turn transaction boundary for ordinary Runtime Workspace mutations created during `interaction.sendMessage`.

The boundary is intentionally narrower than all platform writes:

- In scope: Agent Runtime `platform_action/workspace-write`, `platform_action/workspace-delete`, and browser script SDK `workspace.write` / `workspace.delete` calls made during a turn.
- In scope: host-owned successful raw AIRP history writeback, as success-only ordinary workspace data.
- Out of scope: frontend bridge `platform.runAction` workspace writes/deletes, which remain immediate platform operations.
- Out of scope: external side effects from future remote/WASM/hosted executors, except documenting that they need explicit rollback/compensation policy.
- Special case: `.tsian/*` is platform-owned metadata. Ordinary Agent/Skill mutations reject `.tsian/*`; host-owned trace writes continue through explicit platform paths.

`agent-runtime` stays platform-pure. It continues to call injected capabilities. Platform-host/storage own staging, commit, persistence, and platform metadata writes.

## Proposed Architecture

Add a platform-host runtime workspace transaction object created inside `interaction.sendMessage` after `initializeWorkspaceForSave` and initial workspace file load.

Conceptual shape:

```ts
interface RuntimeWorkspaceTransaction {
  readonly workspaceFiles: WorkspaceFile[]
  write(input: WorkspaceWriteInput): PlatformActionResult<WorkspaceFile>
  delete(path: unknown): PlatformActionResult<{ deletedPaths: string[] }>
  finalWorkspaceFiles(): WorkspaceFile[]
  discard(): void
}
```

The transaction owns:

- a mutable staged `workspaceFiles` view used by Agent Runtime tools;
- a mutation log or final staged file map sufficient to commit the final accepted workspace state;
- validation helpers matching storage path/content/media type behavior;
- `.tsian/*` ordinary mutation rejection.

The simplest robust commit model is final-state commit:

1. Load baseline workspace files from storage.
2. Clone them into `transaction.workspaceFiles`.
3. Apply ordinary runtime write/delete operations to the clone only.
4. Agent Runtime and browser scripts read/list/search against the clone during the turn.
5. On success, persist the transaction's final workspace state together with runtime snapshot/history and checkpoint creation in one storage operation.
6. On failure/abort, discard the clone; storage remains unchanged except for explicit host-owned diagnostics.

Add a storage helper for successful turn commit rather than composing existing helpers in platform-host:

```ts
commitSuccessfulRuntimeTurnForSave(saveId, {
  snapshot,
  history,
  stateRecords,
  workspaceFiles,
  checkpointReason: "after-turn",
})
```

This helper should run a single IndexedDB transaction over the save, snapshot, history, stateRecords, workspaceFiles, and checkpoints tables. It replaces the accepted workspace final state, writes snapshot/history, creates the after-turn checkpoint from the same accepted workspace files, and updates the save timestamp together. That removes the current failure window between workspace persistence, runtime save, and checkpoint creation.

## Data Flow

Successful turn:

```text
ensure active save
initialize workspace
load baseline workspace files
create transaction with staged workspace view
run Agent Runtime with transaction.workspaceFiles
  platform_action workspace writes/deletes stage into transaction
  browser script SDK workspace writes/deletes stage into transaction
  workspace read/list/search sees staged view
build snapshot/history
stage success-only raw AIRP history turn file into transaction
emit turn_completed trace
write/stage successful trace file under .tsian/traces
commit successful runtime turn atomically:
  - accepted workspace final state
  - snapshot/history
  - stateRecords checkpoint payload
  - after-turn checkpoint
```

Failed or aborted turn:

```text
load snapshotBefore
discard transaction staged ordinary mutations
emit turn_failed trace
best-effort write host-owned failed trace under .tsian/traces
throw original error
```

Failed trace writes are not ordinary runtime mutations in this task. They remain platform diagnostic writes and are allowed under `.tsian/traces/*`.

## Staged Workspace Semantics

### Write

Runtime ordinary write:

- normalizes path like storage does;
- rejects `.tsian/*`;
- requires string content;
- infers media type the same way storage does;
- preserves existing `createdAt` if replacing a staged or baseline file;
- sets `updatedAt` to the write time;
- inserts/replaces the file in the staged `workspaceFiles` view;
- emits a `workspace_mutation` trace summary.

The returned `WorkspaceFile` matches what would be returned by storage write, except it is not persisted until commit.

### Delete

Runtime ordinary delete:

- normalizes target path like storage does;
- rejects `.tsian/*`;
- deletes an exact file path and all files under the target directory prefix from the staged view;
- returns sorted `deletedPaths`;
- returns an empty list if no staged file matches;
- emits a `workspace_mutation` trace summary.

### Read/List/Search

Existing Runtime Workspace tools already use the in-memory `workspaceFiles` list. Passing `transaction.workspaceFiles` preserves same-turn read-after-write semantics without changing `agent-runtime`.

Browser script SDK currently reads/list/searches storage directly. This task should route SDK read/list/search through the same staged transaction view so scripts see staged writes and do not bypass the transaction.

## Platform Metadata Policy

`.tsian/*` is host-owned for this phase:

- ordinary Agent/Skill workspace-write/delete reject `.tsian/*`;
- runtime workspace read/list/search still hide `.tsian/traces/` by default and exact reads may remain as current debug behavior unless implementation evidence shows the policy must tighten;
- host-owned failed trace writes use explicit platform functions outside ordinary mutation staging;
- host-owned successful trace can be included in the accepted final workspace state before atomic commit;
- future `.tsian/indexes/` and `.tsian/cache/` writes need explicit host-owned APIs and their own commit/retention policy.

## Compatibility

- Existing Skill declarations and `action_call` input shape do not change.
- Existing frontend `platform.runAction` behavior remains immediate.
- Existing successful turns still produce raw history and trace files.
- Existing failed-turn trace behavior remains best-effort.
- Checkpoints should continue to include workspace files, now after committed successful-turn staged mutations.

## Atomic Commit

The successful-turn commit helper should build the checkpoint record from the same final workspace file list it persists. It should not call `createCheckpointForSave` if that helper reads workspace files back from storage outside the transaction.

If implementation can safely refactor `createCheckpointForSave` to accept an optional workspace file payload and participate in the outer transaction, that is fine. Otherwise the successful-turn helper can create the checkpoint record directly with shared conversion helpers.

Prefer including successful trace in the final accepted workspace state when practical. Failed trace remains outside the ordinary transaction because it is diagnostic output for a failed turn.

## Error Handling

- Ordinary mutation validation failures return structured platform/action errors and do not modify staged state.
- Successful-turn commit failures should fail the turn without partially saving workspace, snapshot/history, or checkpoint state.
- If host-owned failed trace persistence fails, preserve existing behavior: do not mask the original turn error.

## Alternatives

### Rollback Log

Write immediately to storage and restore/delete on failure.

Rejected for first implementation because a crash, reload, or abort before rollback can leave ordinary workspace files half-committed. It also spreads rollback logic across every executor.

### Full Cross-Table Transaction

Wrap workspace commit, snapshot/history save, and checkpoint creation in one IndexedDB transaction.

Selected for successful-turn commit. Current storage helpers are split by concern, but the accepted behavior requires eliminating the post-workspace-commit failure window.
