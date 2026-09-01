# Implementation Plan: 重设计通用 Checkpoint API

## Pre-Implementation Context

Before editing code, read:

- `.trellis/spec/platform-web/storage/index.md`
- `.trellis/spec/platform-web/frontend/index.md`
- `.trellis/spec/platform-web/frontend/type-safety.md`
- `.trellis/spec/platform-web/frontend/state-management.md`
- `.trellis/spec/contracts/backend/index.md`
- `.trellis/spec/contracts/backend/directory-structure.md`
- `.trellis/spec/contracts/frontend/index.md`
- `.trellis/spec/contracts/frontend/type-safety.md`
- `.trellis/spec/guides/cross-layer-thinking-guide.md`
- `.trellis/spec/guides/data-fileification-principle.md`
- `.trellis/spec/guides/airp-data-capability-design-principles.md`

Completed reply-projection context to preserve during implementation:

- `.trellis/tasks/07-15-agent-reply-regex-projection/prd.md`
- `.trellis/tasks/07-15-agent-reply-regex-projection/design.md`
- `.trellis/tasks/07-15-agent-reply-regex-projection/implement.md`

## Likely Code Entry Points

- `packages/contracts/src/debug.ts` — `CheckpointSummary` currently lives here.
- `packages/contracts/src/runtime.ts` — `InvokeAgentRequest` / commit mode types currently live here.
- `packages/contracts/src/bridge.ts` — shared bridge action/result types if new operations need contract exposure.
- `packages/play-bridge/src/tsian-api.ts` — SDK `tsian.checkpoints` and `InvokeAgentOptions`.
- `packages/play-bridge/src/checkpoints.ts` — standalone helper comments/functions currently lag behind SDK surface.
- `apps/platform-web/src/storage/db.ts` — `LocalCheckpointRecord` schema/interface.
- `apps/platform-web/src/storage/checkpoints.ts` — create/list/restore/prune helpers.
- `apps/platform-web/src/storage/saves.ts` — turn commit and invokeAgent checkpoint commit helpers.
- `apps/platform-web/src/platform-host/platform-actions.ts` — platform actions for checkpoint operations.
- `apps/platform-web/src/platform-host/ai-invocation.ts` — `invokeAgent` checkpoint option handling.
- `apps/platform-web/src/platform-host/resource-queries.ts` — checkpoint list query.
- `apps/platform-web/src/views/DebugView.vue` — checkpoint display/labels/actions.
- `apps/play-frontend-dev/src/App.vue` — opening completion checkpoint call.
- `apps/play-frontend-dev/src/composables/useSyncAfterTurn.ts` — post-turn maintenance invokeAgent options.

## Ordered Steps

### 0. Preserve completed reply-projection API work

- Treat current branch reply-projection changes as the base; do not undo `AssistantTurnTimelineItem`, `MessageInteractionResult.assistant`, `turn-completed.assistant`, or `reply-project` action behavior.
- Re-run `git diff -- packages/contracts/src/runtime.ts packages/contracts/src/bridge.ts packages/play-bridge/src/tsian-api.ts apps/platform-web/src/platform-host/platform-actions.ts` before editing if unsure about overlapping changes.
- Avoid undoing reply projection API changes.

### 1. Update contract types

Files:

- `packages/contracts/src/debug.ts`
- `packages/contracts/src/runtime.ts`
- optionally `packages/contracts/src/bridge.ts`

Changes:

- Add `CheckpointRetention`, `CheckpointSource`, checkpoint option/patch types if contracts own them.
- Extend `CheckpointSummary` with retention/source/tags/visible/metadata/updatedAt and make `reason` compatibility-only or widen it to `string`.
- Add `InvokeAgentCheckpointOption` or equivalent to `InvokeAgentRequest`.
- Deprecate, but do not necessarily remove, `AgentInvocationCommitMode` and `checkpointReason` for compatibility.

### 2. Update storage record model and summary mapping

Files:

- `apps/platform-web/src/storage/db.ts`
- `apps/platform-web/src/storage/checkpoints.ts`

Changes:

- Add explicit metadata fields to `LocalCheckpointRecord`, or implement defaulted optional fields if avoiding a DB name bump is safe.
- Update `toCheckpointSummary` to fill new summary fields with default mappings for old records.
- Decide whether Dexie DB name must be bumped. If yes, update the mirrored service worker DB name per storage spec.

### 3. Add generic checkpoint storage helpers

Files:

- `apps/platform-web/src/storage/checkpoints.ts`
- possibly `apps/platform-web/src/storage/saves.ts`

Implement helpers:

- `createCheckpointForSave(saveId, options)` as generic current-state create with retention/source/tags metadata.
- `updateCheckpointForSave(saveId, checkpointId, patch)` metadata only.
- `overwriteCheckpointForSave(saveId, checkpointId, options)` preserve id, rebuild manifest from current state.
- `deleteCheckpointForSave(saveId, checkpointId)` delete record and run/check blob GC.
- Shared internal normalization for labels/tags/retention/source/metadata.

Guardrails:

- Hash/put blobs outside Dexie transactions.
- Keep actual checkpoint record mutation in a small transaction.
- Do not modify append-only log behavior.

### 4. Refactor automatic checkpoint creation and pruning

Files:

- `apps/platform-web/src/storage/saves.ts`
- `apps/platform-web/src/storage/checkpoints.ts`

Changes:

- Formal turn automatic checkpoints should be created with `retention: "auto"`, `source: "platform"`, turn tags.
- Update `pruneCheckpointsForSave` to use retention semantics instead of `reason === "after-turn"` for recent/sparse auto checkpoints.
- Preserve current retention policy shape: recent N auto, sparse auto, current turn, pinned.
- Preserve protected frontend debug checkpoint handling.

### 5. Generalize workspace+checkpoint transaction helper

Files:

- `apps/platform-web/src/storage/saves.ts`
- `apps/platform-web/src/platform-host/ai-invocation.ts`

Changes:

- Replace narrow `commitWorkspaceChangesWithCheckpointForSave` semantics with a generalized helper that accepts create/overwrite/current-turn-auto instructions.
- Ensure post-commit snapshot is built from merged workspace records, not pre-commit workspace.
- Preserve atomicity: workspace changes and checkpoint write/overwrite/delete of stale same-turn auto checkpoints happen in the same Dexie transaction.
- Keep completion event ordering after durable commit.

### 6. Add platform actions

File:

- `apps/platform-web/src/platform-host/platform-actions.ts`

Actions:

- `create-checkpoint`
- `update-checkpoint`
- `overwrite-checkpoint`
- `delete-checkpoint`
- existing `restore-checkpoint`

Changes:

- `create-checkpoint` becomes general current-state create.
- Remove opening-specific behavior from create.
- Add validation/error codes for checkpoint id and protected/baseline restrictions.
- Emit debug refresh for the relevant turn after create/update/overwrite/delete.

### 7. Update SDK surface

Files:

- `packages/play-bridge/src/tsian-api.ts`
- `packages/play-bridge/src/checkpoints.ts`
- `packages/play-bridge/src/index.ts`
- docs if present and in scope, likely `docs/sdk/play-frontend-api.md`

Changes:

- Update `TsianApi.checkpoints` with list/create/update/overwrite/delete/restore.
- Support `create(label)` shorthand if keeping compatibility.
- Add `InvokeAgentOptions.checkpoint` and pass normalized params to `interaction.invokeAgent`.
- Mark `commitMode` / `checkpointReason` as deprecated compatibility if retained.
- Update standalone helper comments in `checkpoints.ts` so they no longer claim list/restore only.

### 8. Update platform bridge validation for invokeAgent

Files:

- `apps/platform-web/src/bridge/remote-iframe-bridge.ts`
- `apps/platform-web/src/platform-host/ai-invocation.ts`

Changes:

- Normalize/validate checkpoint option from remote payload.
- Keep old commitMode validation if compatibility path remains.
- Map old `workspace-with-checkpoint` to the new current-turn-auto path.
- Reject ambiguous inputs if caller provides incompatible old and new options at once.

### 9. Update frontend call sites

Files:

- `apps/play-frontend-dev/src/App.vue`
- `apps/play-frontend-dev/src/composables/useSyncAfterTurn.ts`
- possibly `apps/platform-web/src/views/DebugView.vue`

Changes:

- Opening completion should use `overwrite(initial.id, ...)` or another explicit general API flow.
- Post-turn maintenance should use `checkpoint: { mode: "current-turn-auto" }` or agreed shorthand rather than `commitMode`.
- DebugView labels should prefer retention/source/tags but keep fallback for old reason.
- Restore/delete destructive operations should retain confirmation UX where applicable.

### 10. Validation

Run at minimum:

```bash
npm run build:contracts
npm run build:web
```

Search checks:

```bash
rg -n "workspace-with-checkpoint|checkpointReason|post-turn-maintenance|replaceInitialCheckpointForSave|create-checkpoint|CheckpointSummary" packages apps
rg -n "reason === \"after-turn\"|reason === \"manual\"|reason === \"initial\"" apps/platform-web/src/storage apps/platform-web/src/views
```

Manual/behavior checks:

- Create a current-state checkpoint from SDK and verify list shows it at current turn.
- Update a checkpoint label/retention and verify restore target did not change.
- Overwrite an existing checkpoint and verify restore returns to the overwritten state with same checkpoint id.
- Delete a checkpoint and verify list/restore no longer find it.
- Complete opening flow and verify no hidden create-side replacement remains.
- Run a post-turn maintenance invokeAgent and verify the current turn automatic checkpoint represents post-maintenance state and participates in prune.
- Restore still prunes future branch checkpoints and respects frontend-debug baseline floor.

## Risk / Rollback Points

- Dexie schema/name change may reset local prototype data. Get explicit approval before adding a required migration instead of rename-and-reset.
- Completed reply-projection changes touch shared contract files; preserve them while editing overlapping surfaces.
- `overwrite` is destructive to the checkpoint's restore target. Keep naming and docs explicit.
- Blob GC after delete/overwrite must not delete blobs still referenced by other checkpoints.
- If `reason` remains as compatibility data, avoid writing new behavior that depends on it.
- Keep platform trace/debug refresh events accurate after checkpoint mutations.

## Planning Gate Before `task.py start`

- User has reviewed PRD/design/API vocabulary.
- `implement.jsonl` and `check.jsonl` contain real context entries.
- Active reply-projection API task status is known and conflict plan is clear.
