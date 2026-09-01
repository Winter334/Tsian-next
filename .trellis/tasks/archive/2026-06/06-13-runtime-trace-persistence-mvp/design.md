# Design

## Architecture

Runtime trace is produced in the Agent Runtime loop and persisted by `platform-host` into Runtime Workspace files under `.tsian/traces/`.

```text
interaction.sendMessage
  -> initialize workspace
  -> create trace collector
  -> runAgentRuntimeTurn(..., trace?)
     -> agent_step_started
     -> model_call_completed
     -> tool/action observations
     -> agent_step_completed / failed
  -> write trace file into .tsian/traces/turns/
  -> save runtime snapshot/history
  -> create checkpoint
```

The Agent Runtime should not import storage or platform-host. It should receive a small optional trace sink/callback through runtime capabilities or turn input and emit structured events as they occur.

## Event Model

Use JSON-compatible records:

```ts
type RuntimeTraceEvent = {
  type: string
  timestamp: number
  turn: number
  agentId?: string
  debugLabel?: "master-agent" | "narrative-agent"
  ok?: boolean
  data?: Record<string, JsonValue>
}
```

If adding this to `@tsian/contracts` is useful for shared UI/query consumers, define the shape there. If implementation stays fully internal for this MVP, keep it inside `platform-web/src/agent-runtime` and update the platform-web spec.

## Event Types

MVP event types:

- `turn_started`
- `turn_completed`
- `turn_failed`
- `agent_step_started`
- `agent_step_completed`
- `agent_step_failed`
- `model_call_completed`
- `skill_loaded`
- `workspace_tool_called`
- `action_called`
- `workspace_mutation`

## Summarization Rules

Do not default to large raw content.

- Model call summary: message count, output length, whether tool calls were present, parsed tool call count.
- `skill_loaded`: skill name, path, scope, action count, declaration error count. Do not duplicate full `SKILL.md`.
- Workspace read: path, media type, size, updatedAt. Do not duplicate file content.
- Workspace list: path and result count.
- Workspace search: query length or query string, limit, result count. Query string is acceptable for MVP because it is user/model-provided small text, but do not include result file contents.
- Action call: skill, action, executor, input summary, output summary, ok/error.
- Workspace mutation: write path/mediaType/size/updatedAt, delete deletedPaths.

Input/output summaries should be stable and small:

```ts
{
  keys?: string[]
  jsonLength: number
  preview?: string
}
```

Keep previews short and omit them for large objects if needed.

## Trace File Path

Recommended successful turn path:

```text
.tsian/traces/turns/turn-000001.jsonl
```

Use the post-turn number (`snapshotBefore.state.turn + 1`) for successful turns.

For failed turns:

```text
.tsian/traces/turns/turn-000001-failed-<timestamp>.jsonl
```

This avoids overwriting a later successful retry for the same turn number.

## Persistence Timing

Confirmed MVP policy:

- Successful turns write the trace before creating the after-turn checkpoint, so the checkpoint includes the trace for that turn.
- Failed turns attempt to write a failure trace in the `catch` path after restoring the in-memory snapshot.
- Trace files are normal Runtime Workspace files under `.tsian/traces/`, so checkpoint restore rolls them back together with the rest of the workspace.
- This matches AIRP branch semantics: when a player rolls back an unsatisfactory branch, trace for that discarded branch is also discarded.

If trace persistence fails:

- For successful turns, prefer failing loudly before the checkpoint is created, because trace persistence is part of this MVP's acceptance boundary.
- For failed turns, do not mask the original runtime error. Failure trace persistence should be best-effort and must not replace the gameplay error.

## Workspace Visibility

`.tsian/traces/` is platform-managed workspace content.

Default hiding rules:

- `agent-context` should not inject trace files unless explicitly referenced in an Agent definition. MVP does not need extra code here because default agents do not reference traces.
- Runtime `workspace_list` and `workspace_search` should exclude `.tsian/traces/` by default.
- Bridge `workspace-list` and `workspace-search` should exclude `.tsian/traces/` by default.
- Exact `workspace_read` can remain unchanged for MVP; no trace path is exposed by default through list/search.

Future work can add explicit trace query resources or `trace_read` / `trace_search` tools.

## Data Flow Changes

### Agent Runtime

Add a trace sink:

```ts
interface RuntimeTraceSink {
  emit(event: RuntimeTraceEvent): void
}
```

or:

```ts
emitTrace?(event: RuntimeTraceEvent): void
```

`runAgentRuntimeTurn` and `callAgentModelWithWorkspaceTools` should emit events without knowing persistence.

`executeRuntimeWorkspaceToolCalls` can return observations plus lightweight trace events, or accept a trace sink in its execution context. Prefer a trace sink in context to avoid duplicating observation parsing in `index.ts`.

### Platform Host

Create a trace collector per `sendMessage`.

Responsibilities:

- seed `turn_started`;
- pass collector to Agent Runtime;
- append `turn_completed` / `turn_failed`;
- serialize events to JSONL;
- write the trace file using `writeWorkspaceFileForSave`;
- sync the local `workspaceFiles` array so same-turn checkpoint includes the trace file.

### Workspace Storage

Add an option to list/search helpers:

```ts
includePlatformTraces?: boolean
```

Default false for list/search. Exact read remains unchanged.

The filtering helper should exclude paths with prefix `.tsian/traces/`.

## Compatibility

Prototype stage: no migration required.

Existing saves already include `.tsian/traces/README.md` if initialized with current defaults. Older non-empty workspaces may not have that README; trace writing can still create `.tsian/traces/turns/...` directly.

## Trade-Offs

- Storing trace as `.tsian/traces` workspace files keeps trace tied to save export/checkpoint flows.
- Hiding trace from default list/search keeps Agent context clean.
- Summary-only events are less complete than raw trajectory logs but much lighter and safer for AIRP content.
- Checkpointed trace is simpler than append-only audit logging, but restore may roll back newer trace files.
