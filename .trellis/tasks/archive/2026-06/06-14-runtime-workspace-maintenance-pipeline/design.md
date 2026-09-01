# Design

## Boundary

This task adds successful-turn Agent session transcript persistence and Skill-triggered maintenance primitives on top of the staged Runtime Workspace transaction.

In scope:

- Agent-facing session transcript persistence under `agents/<agent>/session.jsonl`.
- A maintenance plan contract and first vertical-slice implementation for Skill-triggered controlled writes to `agents/<agent>/notes.md`, `history/timeline.md`, `memory/summaries/current.md`, and `memory/summaries/long-term.md`.
- A safe default workspace upgrade path that makes the official maintenance Skill available to existing saves.
- Platform validation and staged application of maintenance writes.
- Trace summaries for maintenance start/completion/failure.

Out of scope:

- Platform operational logging. Logs remain a separate future subsystem with bounded normal windows and error-window persistence.
- Gameplay-specific memory schemas for characters, relationships, locations, rules, events, or world state.
- Replacing `history/turns/turn-*.json` as the authoritative player-facing turn record.
- UI review/diff/approval surfaces.
- Remote/WASM/hosted executor work.

## Concepts

### Raw AIRP Turn

`history/turns/turn-*.json` remains the source record for successful player-facing exchanges. It contains player input and final narrative output only.

### Agent Session Transcript

`agents/<agent>/session.jsonl` is an append-only, checkpoint-scoped transcript for what a specific Agent saw and did. It is not an operational log.

The transcript records Agent-facing material:

- the model messages actually sent to the Agent, including injected Agent context, context file snapshots, recent history, state records, and tool observation messages;
- the model output returned by that Agent;
- parsed tool calls made by that Agent;
- tool observations returned to that Agent;
- delegated Agent interactions visible to the caller and target;
- execution metadata needed to understand the turn, such as turn number, agent id, step kind, model-call index, timestamps, and status.

The transcript excludes platform-only internals that the Agent did not see, such as IndexedDB record ids, Dexie transaction mechanics, hidden storage snapshots, and full trace payloads that were not returned as Agent observations.

The first implementation does not segment, trim, compress, or archive session transcript files. Each record should include schema/version/turn metadata so later compaction or archival can be designed without losing format boundaries.

### Maintenance Plan

Maintenance writes to notes/timeline/summaries are not hardcoded platform memory logic and do not run on a fixed per-turn schedule. A workspace-defined Skill explicitly exposes a maintenance action; an Agent must load that Skill and call the action to submit a structured plan. Platform code validates and stages that plan.

Allowed targets for this slice:

- `agents/<agent>/notes.md`
- `history/timeline.md`
- `memory/summaries/current.md`
- `memory/summaries/long-term.md`

`notes.md` writes are allowed only when the loaded maintenance Skill declares the maintenance responsibility and the proposed write passes the platform contract. `AGENT.md` may tell an Agent when to load the Skill, but it should not bypass the Skill action in this slice.

Timeline and summary writes are replaceable enhanced memory behavior. The default memory Agent may maintain them, but future Skills can replace the strategy.

No maintenance trigger means no enhanced memory maintenance work for that turn. This is not an error and should not be inflated into a synthetic "maintained/no update" state. If an Agent explicitly considered maintenance and decided no files should change, it can call the Skill action with a valid empty plan.

## Proposed Architecture

Add a storage-free transcript collector to Agent Runtime. The collector records Agent-facing model calls and tool-loop interactions while `runAgentRuntimeTurn` runs.

Conceptual shape:

```ts
interface RuntimeAgentSessionTranscriptRecord {
  schema: "tsian.agent.session.transcript.v1"
  turn: number
  createdAt: string
  agentId: string
  role: "master" | "narrative" | "delegated" | "maintenance"
  stepId: string
  modelCallIndex: number
  messages: AiChatMessage[]
  modelOutput: string
  toolCalls: RuntimeWorkspaceToolCall[]
  toolObservations: AiChatMessage[]
  status: "completed" | "tool-continued" | "failed"
}
```

The exact TypeScript shape can be adjusted during implementation, but the persisted JSONL schema should remain explicit and versioned.

Agent Runtime remains platform-pure:

- it can produce transcript records as plain JSON-compatible data;
- it must not import Dexie, storage helpers, platform-host, or bridge objects;
- platform-host owns staging transcript writes into Runtime Workspace.

Platform-host stages transcript records after the main turn succeeds and before successful-turn commit. It appends JSONL content to each participating Agent's `session.jsonl` file through the runtime workspace transaction.

For maintenance plans, the default workspace includes an official Skill, conceptually `skills/memory-maintenance/SKILL.md`. A loaded Skill declares an `apply_maintenance_plan` action. The first implementation should prefer existing executor surfaces instead of adding a maintenance-specific platform action.

Recommended executor shape:

```json
{
  "type": "browser_script",
  "path": "scripts/apply-maintenance-plan.js"
}
```

The script runs through the existing strong Tsian SDK, validates the maintenance plan, and writes approved workspace files with SDK workspace writes. This keeps maintenance policy in workspace content while reusing the already-controlled browser script executor and staged workspace transaction.

If implementation evidence shows that browser-script validation is insufficient for this contract, the task should stop and re-plan before adding a new maintenance-specific platform action.

Agents trigger maintenance through the normal `skill_load` -> `action_call` flow.

This keeps maintenance policy in workspace content:

- `SKILL.md` explains when the action should be used and what each target file means;
- the action input schema constrains the plan shape before platform execution;
- the Skill-local script performs maintenance-specific target/content validation;
- platform-host and storage still enforce normal workspace path rules, `.tsian/*` rejection for ordinary mutations, timeout/abort behavior, and staged transaction semantics.

The platform does not independently invoke memory maintenance on every successful turn, and the maintenance Skill action is not exposed as an always-visible runtime primitive.

Conceptual maintenance plan:

```ts
interface RuntimeWorkspaceMaintenancePlan {
  schema: "tsian.runtime.maintenance.plan.v1"
  writes: Array<{
    path: string
    content: string
    reason: string
    mode: "replace"
  }>
}
```

The first write mode should be `replace`; append/patch modes can be added later after UI/diff needs are clearer.

### Default Skill Availability For Existing Saves

New saves should receive the official maintenance Skill as part of the default workspace files. Existing non-empty saves also need the Skill to be discoverable without requiring users to recreate a save.

Because current workspace initialization returns early once any workspace file exists, add a safe default workspace upgrade path for official files introduced after the original workspace version. The upgrade should:

- use the host-owned workspace manifest version or equivalent platform-owned marker to run the default-file addition once per relevant version;
- create missing official maintenance Skill files only when the target path is absent;
- preserve any user-authored file already present at the same path;
- avoid auto-loading the Skill, adding it to `defaultSkills`, or invoking maintenance actions;
- avoid re-creating the Skill merely because a user deletes it after the upgrade marker has been applied.

This is default content availability, not enhanced memory execution. The normal `skill_load` -> `action_call` flow remains the only way to run the maintenance plan.

## Successful Turn Flow

```text
ensure active save
initialize workspace
create runtime workspace transaction
run Agent Runtime turn with transcript collection
build accepted snapshot/history
stage raw AIRP turn file
stage Agent session transcript records
if a loaded Skill action submitted maintenance plans
  parse/validate each maintenance plan
  stage allowed notes/timeline/summary writes
emit successful trace
commit successful runtime turn atomically:
  - accepted workspace final state
  - snapshot/history
  - stateRecords checkpoint payload
  - after-turn checkpoint
```

If a submitted maintenance plan fails validation before staging valid writes, preserve the successful player-facing turn, raw history, session transcripts, and trace. Record a maintenance failure summary in trace. Do not fail the turn unless the final atomic commit fails.

## Failed Or Aborted Turn Flow

```text
discard staged ordinary mutations
do not stage raw history
do not stage session transcripts
do not stage maintenance writes
best-effort persist host-owned failed trace
throw original turn error
```

## Validation

Session transcript records:

- must be JSON-compatible;
- must include schema, turn, createdAt, agentId, role, and status;
- should include full Agent-facing messages/tool observations needed to understand the Agent's work;
- must not include platform-only implementation internals.

Maintenance plan writes:

- schema must match `tsian.runtime.maintenance.plan.v1`;
- `writes` must be an array and may be empty to represent an explicit no-op maintenance decision;
- each `path` must normalize to an allowed maintenance target;
- `.tsian/*` paths are rejected;
- `content` and `reason` must be strings;
- content size should be capped to avoid runaway maintenance output;
- unsupported modes are rejected.

Invalid maintenance output produces a trace summary and no maintenance workspace mutations. Absence of a maintenance trigger produces no maintenance trace event by default; the session transcript already shows whether an Agent loaded and called the maintenance Skill.

## Trace

Trace should record summaries only:

- maintenance started/completed/failed;
- explicit no-op maintenance plans;
- number of transcript records staged;
- maintenance write paths and sizes;
- validation error codes when applicable.

Trace should not duplicate full session transcript content.

## Compatibility

- Existing `history/turns/turn-*.json` behavior remains authoritative and unchanged.
- Existing Agent context assembly can continue to include `session.jsonl` and `notes.md`.
- Existing saves with older workspace manifests receive the official maintenance Skill files through non-overwriting default workspace upgrade.
- Frontend bridge direct workspace writes/deletes remain immediate.
- Checkpoint/restore naturally includes session and maintenance files because they are ordinary workspace files committed in the successful-turn transaction.

## Trade-Offs

### Full Agent-Facing Transcript vs Summary

Selected: full Agent-facing transcript.

This duplicates context and can grow quickly, but it matches the user's desired Codex / Claude Code style session record and makes future replay, audit, compression, and Agent self-reflection possible.

### Append-Only Session Files vs Early Compaction

Selected: append-only for this slice.

Session transcript compaction, segmentation, and archival are real needs, but doing them before the transcript format exists would make replay/debug semantics fuzzy. This task records complete transcript entries first; a later task can introduce size policies using the versioned JSONL schema.

### Platform Maintenance Logic vs Workspace-Defined Memory

Selected: workspace-defined memory with platform validation.

Platform validates generic execution and workspace safety, while the memory Agent/Skill owns semantic decisions. This keeps enhanced memory replaceable.

### Skill-Triggered Maintenance vs Fixed Per-Turn Maintenance

Selected: Skill-triggered maintenance.

The old fixed workflow model ran a predetermined set of steps every turn. This Agent framework should preserve need-driven flexibility: memory maintenance happens when an Agent chooses to load and call a maintenance Skill, while the platform supplies safe validation and transaction semantics.

When a plan is triggered, apply it before successful-turn commit so checkpoint state is coherent. The trade-off is that turns without a trigger have no global "memory considered" marker, but this is acceptable and more faithful to the flexible runtime. Agents that want an explicit no-op can submit an empty plan.

### Skill Policy vs Agent.md Policy

Selected: Skill policy first.

Agents can theoretically maintain files by following `AGENT.md` instructions and calling generic workspace write actions, but a Skill packages the policy, input schema, script validation, and action declaration as replaceable workspace content. If real usage shows the indirection hurts quality, the policy can later move into `AGENT.md` without changing the underlying executor model.

### New Platform Action vs Existing Skill Executors

Selected: reuse existing Skill executors first.

Adding a new platform action is appropriate when the platform must expose a new privileged primitive. Maintenance is primarily workspace-file writing plus policy validation, and existing `browser_script` / workspace SDK surfaces already support controlled staged workspace writes. Therefore this slice should not add a new maintenance-specific platform action unless implementation proves the existing executor surfaces cannot satisfy the contract safely.
