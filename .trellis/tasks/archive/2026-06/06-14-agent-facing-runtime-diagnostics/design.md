# Agent-Facing Runtime Diagnostics Design

## Architecture

Add an on-demand diagnostic query view over existing runtime trace files.

The query view is a derived read model, not persisted workspace data:

```text
playFrontendBridge.query("runtime-diagnostics")
  -> platform-host loads active save workspace files
  -> pure diagnostics builder filters .tsian/traces/turns/*.jsonl
  -> JSONL trace events are parsed and summarized
  -> bounded RuntimeDiagnosticSummary[] is returned
```

Recommended code boundaries:

- `packages/contracts/src/runtime.ts`
  - Owns stable diagnostic result types for bridge/UI/future Skill consumers.
- `apps/platform-web/src/agent-runtime/diagnostics.ts`
  - Pure parser/summarizer over `WorkspaceFile[]`.
  - Imports trace event types and contract shapes.
  - Does not import Dexie, storage helpers, bridge objects, or `platform-host`.
- `apps/platform-web/src/platform-host/index.ts`
  - Adds a `runtime-diagnostics` query resource.
  - Initializes workspace, lists active save files, and delegates to the pure builder.

## Query Contract

Resource:

```ts
{ resource: "runtime-diagnostics", params?: RuntimeDiagnosticsQueryParams }
```

Suggested params:

- `turn?: number` exact turn filter.
- `limit?: number` result limit, bounded by implementation max.
- `lookbackTurns?: number` recent-turn window, bounded by implementation max.
- `includeHealth?: boolean` include compact successful-turn health summaries; default false.

The query returns `DeepQueryResult<RuntimeDiagnosticSummary>`.

## Summary Shape

Each result should summarize one trace file / turn attempt, not every raw trace event as a top-level item.

Suggested stable fields:

- `schema`: `"tsian.runtime.diagnostic.v1"`.
- `turn`: turn number.
- `status`: `"completed" | "failed" | "anomalous"`.
- `severity`: `"info" | "warning" | "error"`.
- `traceKind`: `"success" | "failed"`.
- `startedAt?`, `endedAt?`, `updatedAt?`.
- `eventCount`.
- `omittedFactCount`.
- `health`: compact successful-turn health facts, when applicable.
- `facts`: bounded list of normalized diagnostic facts.

Each fact should preserve raw event/error facts while adding only lightweight runtime-area normalization:

- `source`: `"turn" | "agent" | "model" | "skill" | "action" | "agent_call" | "workspace" | "script" | "session" | "trace"`.
- `eventType`: raw trace event type when available.
- `timestamp`, `ok`, `agentId`, `debugLabel`.
- `code`, `message`, `detailsSummary`.
- `skill`, `action`, `tool`, `executor`.
- `relatedPaths`.

No fact may contain platform-authored repair suggestions, probable-cause narratives, hardcoded `nextChecks`, full prompts, full model outputs, full tool observations, file contents, script source, provider internals, bridge internals, storage internals, API keys, or raw `.tsian/*` implementation details.

## Fact Selection

Default query behavior should prioritize failed/anomalous material:

- Include failed turns.
- Include successful turns only when `includeHealth` is true or an exact `turn` query asks for that turn.
- Within a summary, include failed events and compact warning/anomaly facts first.
- Successful health summaries should use aggregate names/counts instead of event streams:
  - participating Agent ids;
  - used Skill names;
  - used action names;
  - workspace mutation paths/counts;
  - model/tool/action counts;
  - warning/anomaly counts.

## Related Paths

Related paths are facts, not repair advice.

Allowed sources:

- Direct trace data paths from workspace reads/writes/deletes.
- Skill paths from Skill load/action metadata.
- Script paths from `browser_script` executor/script log metadata.
- Agent definition paths derived from known Agent ids, such as `agents/<agent>/AGENT.md`.

Do not expose raw `.tsian/traces/...` paths in Agent-facing summaries by default. Drop `.tsian/*` paths from `relatedPaths`.

## Bounds

The query must be bounded:

- Default result limit and max result limit.
- Default lookback turn window and max lookback window.
- Per-summary fact limit.
- Per-summary related path limit.
- Per-message/details preview limit.
- Best-effort parsing: malformed trace lines become compact trace parse facts or are counted, but a bad trace line must not crash the whole query.

## Compatibility

- Existing raw trace persistence remains unchanged.
- Trace files remain platform-owned, checkpoint-scoped, and hidden from normal workspace list/search.
- Exact trace read remains as existing MVP debugging escape hatch unless a later task removes it.
- No derived diagnostic workspace files are written.
- No new default live AIRP Agent tool is introduced.
- No management Agent UI or default diagnostic Skill is introduced in this task.

## Trade-Offs

- On-demand generation avoids duplicate derived files, cleanup rules, and checkpoint/migration complexity.
- Adding contract types makes the query shape stable for future UI/Skill work, at the cost of updating `@tsian/contracts`.
- Lightweight `source` normalization saves future Agents from raw trace parsing but deliberately avoids cause inference or repair strategy.
