# Runtime Side-Effect Transactions

## Goal

Define and implement a reliable transaction boundary for runtime turn side effects, starting with Runtime Workspace writes/deletes performed by Agent Runtime tools, Skill actions, and browser script SDK calls.

The desired user-facing behavior is: if a turn succeeds, ordinary workspace mutations from that turn are committed together with the accepted snapshot/history/checkpoint; if the turn fails or is aborted, ordinary workspace mutations from that turn do not remain as if the turn succeeded.

## Parent Direction

Parent task: `.trellis/tasks/06-13-runtime-foundation-completion`

This is the first foundation-completion implementation slice. It comes before remote executors, WASM/hosted execution, automatic Agent notes/timeline maintenance, and UI/Agent/Skill design because those later layers will all depend on predictable runtime write semantics.

## User Value

- Failed or aborted turns do not leave ordinary world/history/memory/frontend workspace files in a half-updated state.
- Future executable Skills can write workspace files without each executor inventing its own rollback behavior.
- Same-turn Agents and scripts can still read the writes they just made, so tool loops remain useful.
- Checkpoint/restore behavior remains coherent: successful-turn workspace changes are captured; failed-turn ordinary changes are not.
- Trace can still preserve diagnostic information without being confused with accepted story/world state.

## Confirmed Facts

- Current `platform_action` and browser script SDK workspace writes/deletes persist immediately to IndexedDB and then synchronize the in-memory `workspaceFiles` list.
- Current `interaction.sendMessage` rolls back the runtime snapshot on failure.
- Current failed-turn cleanup best-effort rolls back raw AIRP history writeback only when that specific writeback has happened.
- Current failed-turn trace is best-effort persisted under `.tsian/traces/turns/turn-*-failed-*.jsonl`.
- Current workspace list/search hides `.tsian/traces/` by default, but exact reads can still access platform trace paths.
- Current successful-turn order is runtime execution, raw history writeback, trace file write, runtime snapshot/history save, then checkpoint creation.
- Runtime Workspace has ordinary user/runtime data paths such as `world/`, `memory/`, `history/`, `frontend/`, and platform metadata paths under `.tsian/`.
- Future remote/WASM/hosted executors may have non-workspace external side effects that cannot always be rolled back; this task should establish the local workspace contract first and document how future non-rollbackable effects must be classified.

## Requirements

- Establish a runtime-turn transaction boundary for ordinary Runtime Workspace mutations.
- Use a true staging model for the first implementation: ordinary runtime writes/deletes update an in-memory staged workspace view during the turn and persist to storage only after the turn succeeds.
- Preserve read-after-write consistency within the active turn: later tools in the same turn should observe staged writes/deletes.
- On successful turns, commit staged ordinary workspace mutations atomically with accepted snapshot/history and after-turn checkpoint creation.
- On failed or aborted turns, discard or rollback staged ordinary workspace mutations so accepted workspace state remains equivalent to the pre-turn state, except for explicitly allowed platform diagnostic artifacts.
- Keep failed-turn trace persistence as platform diagnostic behavior, not ordinary gameplay/world state.
- Treat `.tsian/*` as platform-owned metadata space. Ordinary Agent/Skill workspace write/delete actions must not mutate `.tsian/*`; platform internals may write trace/checkpoint/index/cache files through explicit host-owned paths.
- Scope staging to Agent Runtime turn execution inside `interaction.sendMessage`. Frontend bridge `platform.runAction` workspace writes/deletes remain immediate operations outside this runtime-turn transaction.
- Keep `agent-runtime` platform-pure: transaction storage mechanics belong in platform-host/storage capabilities, while Agent Runtime should receive controlled write/delete capabilities through injection.
- Preserve existing `workspace-write`, `workspace-delete`, and browser script SDK behavior from the Agent/Skill perspective unless a planned contract change is explicitly documented.
- Surface structured errors for transaction commit/rollback failures.
- Ensure checkpoint captures successful committed workspace state and does not capture discarded failed-turn ordinary mutations.
- Update active docs/specs if this task makes the transaction contract authoritative.

## Acceptance Criteria

- [x] A Skill action using `platform_action/workspace-write` can write a workspace file and a later same-turn tool/script can read the staged content.
- [x] A successful turn commits ordinary staged workspace writes/deletes and includes them in the post-turn checkpoint.
- [x] A successful-turn commit does not leave partial workspace/snapshot/history/checkpoint state if the commit fails.
- [x] A failed model call after a workspace write does not leave that ordinary workspace write in persisted workspace state.
- [x] An aborted turn after a workspace write does not leave that ordinary workspace write in persisted workspace state.
- [x] Browser script SDK workspace write/delete follows the same ordinary mutation transaction boundary.
- [x] Agent/Skill attempts to write or delete `.tsian/*` through ordinary workspace actions fail with structured errors.
- [x] Failed-turn trace can still be written under `.tsian/traces/` without causing ordinary workspace files to appear committed.
- [x] Raw AIRP history writeback continues to be success-only ordinary history data.
- [x] Existing successful runtime behavior and workspace synchronization still pass focused probes.
- [x] Frontend bridge `platform.runAction` workspace write/delete behavior remains immediate and compatible.
- [x] The transaction boundary is documented in active docs/specs.

## Out Of Scope

- Remote HTTP, remote script, WASM, or hosted executor implementation.
- Solving external non-workspace side effects that cannot be rolled back; this task should only classify the requirement for future executor designs.
- UI for viewing staged mutations or trace.
- Concrete memory/timeline/Agent notes maintenance behavior.
- Migrating `stateRecords` into workspace files.
- Changing checkpoint UX or adding user-facing rollback controls.

## Decisions

- First implementation uses true staging instead of rollback log. Staging keeps failure semantics clean: ordinary runtime writes are visible to the current turn through the staged workspace view, but are not persisted to IndexedDB until commit. Failed or aborted turns can discard staged ordinary mutations without restoring storage after the fact.
- Rollback log is a fallback only if staging proves incompatible with existing storage/checkpoint flow during implementation.
- `.tsian/*` is platform-owned metadata space for this phase. Ordinary Agent/Skill workspace mutations must reject `.tsian/*` targets, while platform internals can write diagnostics such as failed-turn trace through explicit host-owned operations outside the ordinary mutation surface.
- Staging applies only to Agent Runtime turn side effects inside `interaction.sendMessage`. Frontend bridge `platform.runAction` remains an immediate platform action surface; future workspace editor draft/undo semantics should be designed separately.
- Successful-turn commit should be atomic across accepted workspace final state, snapshot/history, and after-turn checkpoint. Existing split helpers can be refactored or bypassed by a dedicated storage helper for this path.
