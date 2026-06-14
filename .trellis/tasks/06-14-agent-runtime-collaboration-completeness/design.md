# Agent Runtime Collaboration Completeness Design

## Boundary

This task matures the existing `agent_call` runtime primitive. It does not add a team graph, gameplay-specific Agent roles, UI, long-running tasks, or parallel execution.

The implementation boundary is:

- `apps/platform-web/src/agent-runtime/index.ts`
  - collaboration policy and runtime limits
  - delegated Agent prompt assembly
  - nested call enablement
  - model/tool loop budget propagation
- `apps/platform-web/src/agent-runtime/workspace-tools.ts`
  - `agent_call` observation/trace metadata
  - structured error details surfaced to caller Agents
- `apps/platform-web/src/agent-runtime/diagnostics.ts`
  - only if existing fact extraction fails to surface the new metadata
- active docs/specs
  - describe the selected collaboration contract

## Policy Shape

Add an explicit Agent Runtime collaboration policy, conceptually:

```ts
interface AgentRuntimeCollaborationPolicy {
  maxCallsPerTurn: number
  maxDepth: number
  historyWindows: Record<RuntimeAgentCallHistoryMode, number>
  maxToolRoundsPerAgent: number
}
```

Defaults:

- `maxCallsPerTurn = 4`
- `maxDepth = 2`
- `historyWindows.minimal = 0`
- `historyWindows.recent = 6`
- `historyWindows.scene = 12`
- `maxToolRoundsPerAgent = 3`

`maxDepth` means maximum `agent_call` edges from a root Agent step. Root master/narrative steps start at depth `0`. A root call produces a delegated Agent at depth `1`. That delegated Agent may make one nested call, producing a delegated Agent at depth `2`. An Agent at depth `2` cannot call another Agent.

Policy should be code-level/default-only in this slice. It may be normalized from an optional runtime capability for tests or future host-owned configuration, but there is no Settings UI, localStorage persistence, per-save config, or runtime prompt.

## Data Flow

Root turn:

```text
runAgentRuntimeTurn
  -> normalize collaboration policy
  -> create shared AgentCallTurnState
  -> master tool loop with allowAgentCall=true depth=0
  -> narrative tool loop with allowAgentCall=true depth=0
```

Delegated call:

```text
agent_call observation request
  -> validate target is in caller contacts
  -> check shared call budget
  -> check current depth < policy.maxDepth
  -> assemble target Agent context
  -> increment root-turn call count
  -> run target Agent tool loop at depth+1
      -> target sees its own visible contacts only if depth+1 < policy.maxDepth
      -> nested agent_call uses target Agent contacts and same shared budget
  -> return target response and budget/depth metadata as observation
  -> emit agent_called trace metadata
```

## Context And History

Keep `historyMode` semantic:

- `minimal`: no recent conversation window.
- `recent`: default small window.
- `scene`: larger current-scene window.

Agents do not get to pick exact message counts in this slice. Exact windows remain platform policy, now represented by the collaboration policy instead of scattered constants.

Delegated prompts continue to include:

- target Agent context;
- caller Agent id/title/summary;
- request, reason, contextSummary, expectedOutput;
- selected recent history window;
- current `stateRecords` compatibility input;
- player input for this root turn.

When nested calls are available, the delegated Agent's system/tool instructions list only that delegated Agent's own contacts. They do not expose the full registry or caller contacts.

## Budget And Error Contract

All `agent_call`s in a root turn share one budget.

Structured errors should include compact facts:

- `callerAgentId`
- `targetAgentId` when known
- `depth`
- `maxDepth`
- `callCount`
- `maxCallsPerTurn`
- `historyMode` when parsed

Important cases:

- target not found -> existing `AGENT_CALL_TARGET_NOT_FOUND`
- target not in caller contacts -> existing `AGENT_CALL_TARGET_NOT_CONTACT`
- call budget exceeded -> existing `AGENT_CALL_LIMIT_EXCEEDED`, with depth/budget facts
- max depth exceeded -> new or existing structured unavailable code with depth facts
- delegated execution failed -> existing `AGENT_CALL_FAILED`, with caller/target/depth facts

The caller receives tool observations rather than raw thrown platform details whenever possible.

## Trace And Diagnostics

`agent_called` trace should include:

- caller Agent id
- target Agent id/title
- depth and maxDepth
- callCount and maxCallsPerTurn
- historyMode
- input summary
- output summary or structured error

Existing `agent_step_started/completed/failed` events for delegated Agents should continue. The `delegated: true` marker remains useful; depth should be added where practical.

Runtime diagnostics should be able to surface these facts through existing event data extraction. Do not add hardcoded causes, repair advice, or `nextChecks`.

## Session Transcript Compatibility

The existing session transcript collector already records delegated Agent model messages, model output, tool calls, tool observations, round, status, and debug label. Keep this compatible.

Nested delegated Agents should produce their own transcript records like first-level delegated Agents. The caller sees nested results only through the observation chain.

## Compatibility

Existing root calls remain compatible:

- master/narrative can call their contacts as before;
- non-contact targets fail as before;
- missing targets fail as before;
- `historyMode` defaults to `recent` and rejects invalid values;
- delegated Agents can still use workspace tools, `skill_load`, and non-`agent_call` `action_call`.

Behavior change:

- Delegated Agents may now call their own contacts when depth and budget allow.
- The delegated platform guard no longer says nested `agent_call` is forbidden.

## Rollback

If limited recursion causes instability, the low-risk rollback is setting default `maxDepth` back to `1` while preserving the explicit policy, structured metadata, and docs.
