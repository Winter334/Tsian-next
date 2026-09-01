# Design

## Architecture Boundary

The runtime boundary should remain:

```text
Agent output
  -> action_call runtime tool
  -> loaded Skill/action lookup
  -> input validation
  -> action executor dispatcher
  -> injected platform-controlled capability when side effects are needed
  -> structured observation back to the same Agent
  -> summarized trace event
```

`agent-runtime` must continue to own Skill gating, action declaration parsing, input validation, executor dispatch decisions, and trace event emission. It must not import storage helpers, bridge objects, Dexie, or platform-host modules.

`platform-host` must continue to own side effects and host-specific execution such as workspace mutation, browser-limited execution, future remote calls, persistence synchronization, and platform allow-lists.

## Current Shape

Current executor reference:

```json
{
  "type": "platform_action",
  "name": "workspace-write"
}
```

Missing executor declaration defaults to:

```json
{
  "type": "builtin",
  "name": "validation"
}
```

This is a good base and should not be replaced by a larger always-visible tool list.

## Proposed Foundation

Keep executor declarations model-facing and Skill-owned, but normalize them internally into a richer runtime execution request.

The shared handling should cover:

- `type` and executor identity validation.
- optional executor options such as timeout.
- structured success and failure envelopes.
- timeout and abort propagation.
- trace-safe summaries.
- allow-list checks before platform side effects.

The platform-controlled execution hook can evolve from the current `runPlatformAction(request)` into either:

- a broader controlled executor runner, or
- a small set of explicit platform actions that back executor types.

The choice should be made during implementation based on minimal code churn, but the public Skill author model should stay stable: a Skill declares one action executor, then calls it through `action_call`.

## Selected First Real Executor

### High-Power Browser Skill Script

Add a high-power browser-side Skill script executor as the first non-trivial path after the shared foundation.

This executor is intentionally more permissive than a toy sandbox. The product premise is that Tsian official default content should not rely on high-risk third-party scripts, but players who install or enable third-party executable Skills can accept that risk to get capabilities closer to native Skill scripts.

Baseline constraints that still apply:

- Script source should be a Runtime Workspace file under the declaring Skill directory, normally `scripts/*.js`.
- Input and output should be JSON-compatible values at the executor boundary.
- Execution has a default timeout and a strict maximum timeout.
- Script result is summarized in trace; full output returns only through the action observation.
- Failures return normalized runtime tool errors rather than crashing the whole browser app.
- The executor type must be identifiable, traceable, and disable-able.
- Browser hard limits still apply. A normal web app cannot grant arbitrary host filesystem, terminal, OS process, or native browser-extension powers.

Recommended initial capability profile:

- Provide a script SDK object with current action input.
- Provide workspace `read`, `list`, `search`, `write`, and `delete` APIs scoped to the active Runtime Workspace.
- Provide network `fetch` capability when the browser allows it.
- Provide structured `log` / `trace` helpers with trace-safe summarization.
- Provide abort/timeout signaling.
- Keep direct access to raw platform-host internals out of the first slice, even in trusted mode, so platform invariants and checkpoint/writeback behavior stay centralized.

User decision: this strong SDK profile is the selected first implementation profile. Do not expose raw DOM, `window`, internal bridge objects, Vue app state, or platform-host internals as supported script APIs in this slice.

Why this fits first:

- It turns local third-party Skills into executable units without needing remote infrastructure.
- It exercises workspace file resolution, executor dispatch, async execution, timeout, result normalization, and trace.
- It gives Skill authors meaningful power while keeping gameplay semantics outside the platform.

Main risk:

- High-power browser-side execution can read/write active save workspace data and call network APIs if exposed. This should be documented as a third-party trust decision, not presented as safe official content behavior.
- Direct raw DOM/window/bridge access would maximize power but can destabilize the app and bypass platform-level checkpoint, trace, and mutation bookkeeping. This needs an explicit decision before implementation.

### Deferred Alternative: Remote HTTP

Remote HTTP is useful later for hosted services and external tools, but it introduces endpoint policy, CORS, auth, secrets, offline behavior, retry semantics, and user trust questions. It is less suitable as the first completion slice unless the user explicitly wants networked execution first.

### Deferred Alternative: Richer Platform Actions

Richer platform actions such as workspace batch write/delete are safer and immediately useful, but they do not exercise script/remote executor concerns. This is a good fallback if browser-script isolation is judged too risky for the first task.

## Data Flow

1. Agent loads a Skill through `skill_load`.
2. Runtime parses `tsian-actions` declarations and stores normalized action metadata in the tool session state.
3. Agent calls `action_call` with `{ skill, action, input }`.
4. Runtime verifies the Skill was loaded and the action was declared by that Skill.
5. Runtime validates input against the action schema.
6. Runtime dispatches the action executor.
7. Built-ins run inside `agent-runtime`.
8. Side-effecting or host-specific executors call an injected platform capability.
9. Platform-host performs allow-list and host validation, executes the controlled action or trusted script, updates in-memory workspace file state if needed, emits mutation trace where appropriate, and returns a structured result.
10. Runtime returns a structured observation and emits summarized action trace.

## Compatibility

- Existing `builtin/validation`, `builtin/echo`, `platform_action/workspace-write`, and `platform_action/workspace-delete` declarations must continue to work.
- Existing Skill declarations that omit `executor` must continue to default to `builtin/validation`.
- Existing trace files remain readable; new trace fields should be additive.
- Existing Runtime Workspace files and checkpoints should not need migration.

## Rollback Shape

- If the new executor path is unstable, keep the shared foundation changes and disable the new executor through the platform allow-list.
- If shared foundation changes regress existing action calls, revert the executor normalization/dispatch edits while preserving task docs and spec notes for retry.

## Resolved Decision

The first trusted browser script slice uses strong Tsian SDK access:

- workspace APIs,
- network `fetch` where browser policy permits,
- structured log/trace,
- timeout/abort,
- JSON-compatible input/output.

Raw browser globals, DOM, internal bridge access, Vue app state, and platform-host internals are not supported script APIs in this first slice.
