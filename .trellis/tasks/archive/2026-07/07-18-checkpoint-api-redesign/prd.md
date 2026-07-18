# 重设计通用 Checkpoint API

## Goal

Make checkpoint handling a clear, general platform capability for play frontends and side-channel agent calls. A frontend developer should be able to understand checkpoint operations as ordinary save-point operations:

- create a checkpoint from the current save state;
- update a checkpoint's metadata without changing its restore target;
- overwrite an existing checkpoint with the current save state;
- delete or restore a checkpoint explicitly;
- request a checkpoint write as an optional part of a successful `invokeAgent` call.

The API should no longer expose internal commit modes or hard-coded `reason` values as the primary way to ask for checkpoint behavior.

## Background / Confirmed Facts

- The SDK already exposes `tsian.checkpoints.list()`, `restore()`, and `create()` in `packages/play-bridge/src/tsian-api.ts:145`, but `create()` is not a general current-state checkpoint.
- SDK `checkpoints.create(label?)` currently calls `platform.runAction("create-checkpoint")` in `packages/play-bridge/src/tsian-api.ts:413`.
- Platform action `create-checkpoint` is opening-specific today: it defaults the label to `"开局设定"`, calls `replaceInitialCheckpointForSave(activeSaveId, { turn: 0, label })`, and emits turn `0` debug refresh in `apps/platform-web/src/platform-host/platform-actions.ts:128`.
- Storage already has generic snapshot helpers and a separate opening-specific helper:
  - `createCheckpointForSave` builds a checkpoint from current checkpoint workspace files in `apps/platform-web/src/storage/checkpoints.ts:79`.
  - `replaceInitialCheckpointForSave` creates a turn-0 manual checkpoint and deletes initial checkpoints in `apps/platform-web/src/storage/checkpoints.ts:205`.
  - `restoreCheckpointForSave` restores a checkpoint and prunes future turn logs/checkpoints in `apps/platform-web/src/storage/checkpoints.ts:103`.
- Checkpoint records are thin manifests backed by content-addressed blobs; append-only turn logs/traces are excluded from checkpoint manifests and are pruned to the restored turn. This storage model is documented in `.trellis/spec/platform-web/storage/index.md:44`.
- Current automatic pruning preserves `initial` / `manual`, recent `after-turn`, sparse turns, and current turn in `apps/platform-web/src/storage/checkpoints.ts:258`. The storage spec documents the existing recent+sparse policy in `.trellis/spec/platform-web/storage/index.md:51`.
- Current `invokeAgent` checkpoint creation is tied to `commitMode: "workspace-with-checkpoint"` and `checkpointReason: "post-turn-maintenance"` in `packages/contracts/src/runtime.ts:883` and `apps/platform-web/src/platform-host/ai-invocation.ts:113`.
- Current side-channel maintenance checkpoint commit creates a `post-turn-maintenance` checkpoint and deletes same-turn `after-turn` checkpoints in `apps/platform-web/src/storage/saves.ts:342`.
- Contract and storage reason enums are already inconsistent: public `CheckpointSummary.reason` allows only `"initial" | "after-turn" | "manual"` in `packages/contracts/src/debug.ts:57`, while storage also allows `"post-turn-maintenance"` in `apps/platform-web/src/storage/db.ts:77`.
- The reply-projection task `.trellis/tasks/07-15-agent-reply-regex-projection/` has completed and landed on the current working branch. It changed shared API files (`packages/contracts/src/runtime.ts`, `packages/contracts/src/bridge.ts`, `packages/play-bridge/src/tsian-api.ts`, `apps/platform-web/src/bridge/remote-iframe-bridge.ts`, and platform-host files). This checkpoint task should preserve those reply-projection API changes while editing the same surfaces.

## Product Decisions

- `checkpoints.create()` must mean one thing: create a new checkpoint from the active save's current state. It must not hide deletion, replacement, or opening-specific behavior.
- Replacement-style use cases are better described as overwriting an existing checkpoint's snapshot with current state. Public API should prefer `overwrite` over a vague `replace` term.
- `update` should mean metadata-only update: label, tags, retention mode, or other non-snapshot fields. It must not change what state the checkpoint restores to.
- `overwrite` should preserve checkpoint identity while changing the snapshot/restore target to the current state. It may also apply metadata changes in the same operation.
- `delete` should be explicit because removing a checkpoint is destructive.
- `reason` should not be the behavior switch for validation, pruning, or replacement. Behavior should be expressed through explicit fields such as retention and explicit operations.
- Checkpoint retention should be explicit:
  - `auto`: managed by the platform's automatic recent+sparse pruning policy.
  - `pinned`: protected from ordinary automatic prune.
- Post-turn maintenance is broadly part of the completed turn. It should update/overwrite that turn's automatic checkpoint and remain under automatic pruning; the frontend should not have to decide whether a particular maintained turn deserves permanent retention.
- The existing restore model that deletes future branch checkpoints after restoring to an earlier turn remains unchanged unless separately redesigned.
- New SDK design should make `invokeAgent` checkpoint behavior an optional parameter (`checkpoint`) rather than a commit mode string. Existing `commitMode` / `checkpointReason` may be kept only as a compatibility path during migration.

## Requirements

- R1: Redefine SDK `tsian.checkpoints.create()` as a general current-state checkpoint operation.
- R2: Add SDK-level checkpoint management operations for metadata update, snapshot overwrite, and delete, in addition to existing list and restore.
- R3: Add platform actions and storage helpers needed to support create/update/overwrite/delete atomically and with clear error reporting.
- R4: Separate checkpoint metadata updates from snapshot overwrites in both API naming and implementation behavior.
- R5: Introduce retention semantics (`auto` vs `pinned`) so prune behavior is not coupled to hard-coded `reason` values.
- R6: Update automatic pruning to operate on retention semantics while preserving the current platform policy shape: recent automatic checkpoints, sparse automatic checkpoints, current turn, and pinned checkpoints.
- R7: Treat post-turn maintenance as an overwrite/update of the current turn's automatic checkpoint, not as a permanently pinned manual checkpoint and not as a frontend-selected retention decision.
- R8: Replace preferred `invokeAgent` checkpoint API with an optional `checkpoint` parameter that can request checkpoint creation or overwrite after a successful workspace commit. The default remains no checkpoint.
- R9: Keep `invokeAgent` checkpoint writes transactional with the workspace changes they checkpoint; successful completion events must fire only after workspace + checkpoint state is durable.
- R10: Update public contracts so checkpoint summaries expose the fields needed by the new model and no longer require consumers to branch on a closed `reason` enum for behavior.
- R11: Preserve current restore safety behavior: restoring a checkpoint requires an explicit action and continues to prune future branch state according to the existing restore model.
- R12: Preserve the completed reply-projection API changes when editing overlapping shared contract and bridge files.

## Acceptance Criteria

- [ ] `tsian.checkpoints.create()` creates a new checkpoint for the current active save state at the current turn; it no longer performs opening-specific initial replacement.
- [ ] `tsian.checkpoints.update(id, patch)` changes checkpoint metadata only and does not change the checkpoint manifest or restore target.
- [ ] `tsian.checkpoints.overwrite(id, options?)` keeps the same checkpoint identity but makes restoring that checkpoint return to the current active save state.
- [ ] `tsian.checkpoints.delete(id)` removes a checkpoint and reports `CHECKPOINT_NOT_FOUND` or equivalent when the id is invalid.
- [ ] Opening completion can be implemented through the general checkpoint API, by overwriting or otherwise explicitly managing the initial checkpoint instead of relying on hidden create-side replacement.
- [ ] `invokeAgent(..., { checkpoint: ... })` can create or overwrite a checkpoint after successful workspace commit without using `commitMode: "workspace-with-checkpoint"` on the new preferred path.
- [ ] Post-turn maintenance uses automatic retention and updates the current turn's canonical automatic checkpoint; it participates in the platform recent+sparse pruning policy.
- [ ] Pinned checkpoints are not removed by ordinary automatic prune, while auto checkpoints are eligible for recent+sparse pruning.
- [ ] Public checkpoint summary types and SDK options are synchronized across `packages/contracts`, `packages/play-bridge`, and `apps/platform-web`.
- [ ] Existing restore confirmation/error behavior remains intact, including the frontend-debug baseline floor protection.
- [ ] Compatibility behavior for existing checkpoint records and the old `invokeAgent` options is either preserved or deliberately removed with explicit approval and documentation.
- [ ] Build/type validation passes for changed contract and platform packages.

## Out of Scope

- Redesigning restore's future-branch deletion model.
- Cloud sync semantics beyond preserving the current thin-manifest/blob storage model.
- A full checkpoint management UI beyond whatever minimal frontend call-site changes are needed to keep existing flows working.
- Old IndexedDB data migration unless explicitly approved; follow the storage spec's rename-and-reset convention if the Dexie schema must change.
- Changing reply-projection or turn-completed API behavior from the completed `07-15-agent-reply-regex-projection` task.
