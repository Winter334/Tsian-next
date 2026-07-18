# Design: 重设计通用 Checkpoint API

## Scope

This task redesigns checkpoint operations across shared contracts, the play bridge SDK, platform actions, platform storage helpers, and the `invokeAgent` side-channel checkpoint path.

The goal is not to change the underlying thin-manifest checkpoint storage model. The goal is to expose the model through clearer operations and to stop encoding behavior in hidden `create` side effects, `commitMode` strings, or hard-coded `reason` values.

## Target Mental Model

A checkpoint is a save-point record with two layers:

1. Metadata: label, tags/source/visibility/retention, timestamps, turn.
2. Snapshot: manifest of state files that defines what restoring the checkpoint returns to.

API verbs map to those layers:

- `create`: create a new record and snapshot from the current state.
- `update`: update metadata only.
- `overwrite`: replace the existing record's snapshot with the current state, preserving its identity; may also update metadata.
- `delete`: delete the record.
- `restore`: restore active save state to the record's snapshot.
- `list`: list records.

## Proposed Public Types

Exact names can be tuned during implementation, but the model should follow this shape.

```ts
export type CheckpointRetention = "auto" | "pinned"
export type CheckpointSource = "platform" | "user" | "card" | "agent"

export interface CheckpointSummary {
  id: string
  turn: number
  label: string
  createdAt: number
  updatedAt?: number
  retention: CheckpointRetention
  source?: CheckpointSource
  tags?: string[]
  visible?: boolean
  metadata?: Record<string, JsonValue>
  messageCount: number
  workspaceFileCount: number

  /** Compatibility only while old records/UI still depend on it. */
  reason?: string
}

export interface CreateCheckpointOptions {
  label?: string
  retention?: CheckpointRetention
  source?: CheckpointSource
  tags?: string[]
  visible?: boolean
  metadata?: Record<string, JsonValue>
}

export interface UpdateCheckpointOptions {
  label?: string
  retention?: CheckpointRetention
  source?: CheckpointSource
  tags?: string[]
  visible?: boolean
  metadata?: Record<string, JsonValue>
}

export interface OverwriteCheckpointOptions extends UpdateCheckpointOptions {}
```

Default choices:

- `checkpoints.create()` defaults to `retention: "pinned"` because explicit SDK calls usually mean a user/card-visible save point.
- Platform-created formal turn checkpoints default to `retention: "auto"`, `source: "platform"`, tags such as `["turn"]`.
- Post-turn maintenance overwrites the current turn's automatic checkpoint and remains `retention: "auto"`.

## SDK Shape

```ts
interface TsianApi {
  readonly checkpoints: {
    list(options?: ListCheckpointOptions): Promise<CheckpointSummary[]>
    create(options?: string | CreateCheckpointOptions): Promise<CheckpointSummary>
    update(checkpointId: string, patch: UpdateCheckpointOptions): Promise<CheckpointSummary>
    overwrite(checkpointId: string, options?: OverwriteCheckpointOptions): Promise<CheckpointSummary>
    delete(checkpointId: string): Promise<void>
    restore(checkpointId: string): Promise<{ turn: number }>
  }

  invokeAgent(agentId: string, input: string, options?: InvokeAgentOptions): Promise<InvokeAgentResult>
}
```

`create(string)` may be accepted as a backward-compatible shorthand for `{ label: string }`.

## `invokeAgent` Checkpoint Option

Replace the preferred caller-facing model with an optional `checkpoint` field:

```ts
export type InvokeAgentCheckpointOption =
  | boolean
  | ({ mode?: "create" } & CreateCheckpointOptions)
  | ({ mode: "overwrite"; checkpointId: string } & OverwriteCheckpointOptions)
  | { mode: "current-turn-auto"; label?: string; tags?: string[]; metadata?: Record<string, JsonValue> }

export interface InvokeAgentOptions {
  // existing fields...
  checkpoint?: InvokeAgentCheckpointOption

  /** Compatibility path; deprecated after checkpoint option exists. */
  commitMode?: AgentInvocationCommitMode
  checkpointReason?: string
}
```

Semantics:

- `checkpoint` omitted/false: commit workspace changes only.
- `checkpoint: true` or `{ mode: "create" }`: after successful workspace commit, create a checkpoint from the post-commit workspace. Default retention should be `pinned` unless explicitly set.
- `{ mode: "overwrite", checkpointId }`: after successful workspace commit, overwrite the given checkpoint with the post-commit workspace.
- `{ mode: "current-turn-auto" }`: after successful maintenance commit, find the current turn's canonical automatic checkpoint and overwrite it. If absent, create one. This replaces the current `workspace-with-checkpoint` + `post-turn-maintenance` special case and keeps retention `auto`.

Transactional requirement: the workspace mutation and checkpoint mutation must commit together or fail together. The current `commitWorkspaceChangesWithCheckpointForSave` transaction shape should be generalized rather than replaced with a post-commit non-atomic create.

Compatibility:

- Existing `commitMode: "workspace-with-checkpoint"` should map to `checkpoint: { mode: "current-turn-auto" }` during migration, unless user approves removing the old path outright.
- `checkpointReason` should become compatibility-only and should not be the primary behavior switch.

## Storage Model Changes

Current `LocalCheckpointRecord` only has `reason` as behavior/category. New storage should add explicit metadata fields, likely in `apps/platform-web/src/storage/db.ts`:

```ts
export interface LocalCheckpointRecord {
  id: string
  saveId: string
  turn: number
  label: string
  reason?: string // compatibility
  retention: "auto" | "pinned"
  source?: "platform" | "user" | "card" | "agent"
  tags?: string[]
  visible?: boolean
  metadata?: Record<string, JsonValue>
  createdAt: number
  updatedAt?: number
  manifest: Array<{ path: string; hash: string; createdAt: number; updatedAt: number }>
}
```

Because this changes Dexie schema shape, follow `.trellis/spec/platform-web/storage/index.md`: no old data migration unless explicitly approved; if schema version/name changes are required, bump the DB name and matching service worker DB name.

If the implementation can safely represent missing fields with defaults without a Dexie name bump, it may do so, but this must be verified against Dexie schema/index needs. No new index is required unless filtering by retention/source becomes a DB query requirement; current list-by-save can compute defaults in memory.

Default mapping for old records:

- `reason === "initial"` -> `retention: "pinned"`, `source: "platform"`, `tags: ["initial"]`, `visible` likely false or current UI-compatible behavior depending on call site.
- `reason === "manual"` -> `retention: "pinned"`, `source: "user" | "card"` depending on creation path when known, `tags: ["manual"]`.
- `reason === "after-turn"` -> `retention: "auto"`, `source: "platform"`, `tags: ["turn"]`.
- `reason === "post-turn-maintenance"` -> `retention: "auto"`, `source: "agent"`, `tags: ["turn", "post-maintenance"]`.

## Storage Helpers

Add or refactor helpers around one snapshot builder:

- `createCheckpointForSave(saveId, options)` — generic current-state create.
- `updateCheckpointForSave(saveId, checkpointId, patch)` — metadata only; does not rebuild manifest.
- `overwriteCheckpointForSave(saveId, checkpointId, options)` — rebuild manifest from current state and write it into the same checkpoint record/id.
- `deleteCheckpointForSave(saveId, checkpointId)` — delete checkpoint; run blob GC if needed.
- `commitWorkspaceChangesWithCheckpointForSave` should be generalized to accept create/overwrite/current-turn-auto options and use merged post-change workspace for the snapshot manifest.

Hashing remains outside Dexie transactions; record writes/deletes remain in small Dexie transactions.

## Pruning

Replace reason-based prune keep logic with retention-based logic:

- Keep all `retention: "pinned"` checkpoints during ordinary automatic prune.
- For `retention: "auto"`, keep:
  - recent N automatic checkpoints;
  - sparse automatic checkpoints every configured interval;
  - current turn checkpoint(s) needed to avoid immediately deleting the newest state.
- Continue GC after prune.

This preserves the existing platform policy while making post-maintenance automatic checkpoints first-class participants in the policy.

Open implementation detail: if multiple auto checkpoints exist for the same turn during migration, canonicalization should prefer post-maintenance/current-turn-auto and remove stale same-turn pre-maintenance points as today.

## Platform Actions

Proposed actions:

- `create-checkpoint`
- `update-checkpoint`
- `overwrite-checkpoint`
- `delete-checkpoint`
- existing `restore-checkpoint`

Each action validates active save and checkpoint ownership. Restore keeps existing frontend-debug baseline floor protection. Delete/overwrite may also need to honor protected frontend-debug checkpoints or reject operations against them if deleting/overwriting would break the debug session baseline.

Action results should return `PlatformActionResult<CheckpointSummary>` for create/update/overwrite, `PlatformActionResult<{ checkpointId: string }>` or empty item for delete, and existing restore result for restore.

## Opening Flow

Opening completion should no longer call a create operation that secretly deletes initial. Recommended flow:

1. Find the initial/baseline checkpoint from `checkpoints.list()` (or have platform expose a selector later if needed).
2. Call `checkpoints.overwrite(initial.id, { label: "开局设定", retention: "pinned", source: "card", tags: ["opening-complete"] })`.

This keeps the checkpoint identity stable and expresses that the opening baseline now points at the completed opening state.

If retaining the initial checkpoint as a hidden system baseline is later desired, that should be a separate product decision; this task's requirement is to avoid hidden create-side replacement.

## Interaction with Completed Reply Projection Task

The `07-15-agent-reply-regex-projection` task has completed and landed on the current branch. This checkpoint task should preserve those reply-projection API changes while editing overlapping files. Expected overlap files:

- `packages/contracts/src/runtime.ts`
- `packages/contracts/src/bridge.ts`
- `packages/play-bridge/src/tsian-api.ts`
- `apps/platform-web/src/platform-host/platform-actions.ts`

Checkpoint work should not alter reply projection semantics.

## Error Handling

Use stable platform action error codes, for example:

- `ACTIVE_SAVE_REQUIRED`
- `CHECKPOINT_ID_REQUIRED`
- `CHECKPOINT_NOT_FOUND`
- `CHECKPOINT_PROTECTED`
- `CHECKPOINT_CREATE_FAILED`
- `CHECKPOINT_UPDATE_FAILED`
- `CHECKPOINT_OVERWRITE_FAILED`
- `CHECKPOINT_DELETE_FAILED`
- `INVOKE_AGENT_CHECKPOINT_INVALID`

Do not fail softly for invalid checkpoint management actions; these are explicit platform operations.

## Rollback / Compatibility

- Preserve old `commitMode` behavior by mapping it to the new current-turn-auto checkpoint operation initially.
- Keep `reason` on summaries as optional compatibility if existing DebugView labels still consume it, but new behavior should use retention/tags/source.
- If Dexie DB name must be bumped, note that local prototype data resets; no migration unless separately approved.
