# Agent-Facing Runtime Diagnostics Implementation Plan

## Checklist

1. Contracts
   - Add diagnostic query/result types to `packages/contracts/src/runtime.ts`.
   - Keep the shape JSON-compatible and bridge-friendly.
   - Include source/entity normalization fields without repair guidance fields.

2. Pure diagnostics builder
   - Add `apps/platform-web/src/agent-runtime/diagnostics.ts`.
   - Parse `.tsian/traces/turns/*.jsonl` from `WorkspaceFile[]`.
   - Sort and window trace files by turn and updated time.
   - Build one `RuntimeDiagnosticSummary` per trace file / turn attempt.
   - Preserve raw `eventType`, `code`, and `message` facts.
   - Add lightweight `source` and entity fields for Agent/Skill/action/tool/workspace/script areas.
   - Extract directly related workspace paths while dropping `.tsian/*`.
   - Apply bounds for result count, lookback turns, facts, related paths, messages, and details summaries.
   - Treat malformed JSONL lines as compact trace facts or omitted parse counts without crashing the whole query.

3. Query wiring
   - Add `resource === "runtime-diagnostics"` handling in `apps/platform-web/src/platform-host/index.ts`.
   - Require an active save, initialize workspace, list workspace files, and call the pure diagnostics builder.
   - Do not add a runtime tool or inject diagnostics into ordinary master/narrative/memory Agent prompts.
   - Do not write derived diagnostic files.

4. Documentation and specs
   - Update `.trellis/spec/platform-web/frontend/type-safety.md` with the Agent-facing diagnostics contract.
   - Update `docs/active/agent-framework-runtime-workspace-direction.md`.
   - Update `docs/active/current-state-handoff.md`.
   - Update parent task roadmap language if needed.

5. Validation
   - Run `npm run build:contracts`.
   - Run `npm run build:web`.
   - Run `git diff --check`.
   - Run `python3 ./.trellis/scripts/task.py validate 06-14-agent-facing-runtime-diagnostics`.
   - Inspect representative generated summaries in code or a small local probe if a practical runtime fixture is available.

## Risky Files

- `packages/contracts/src/runtime.ts`
  - Contract changes affect all bridge consumers.
- `apps/platform-web/src/agent-runtime/trace.ts`
  - Avoid changing raw trace persistence unless strictly needed.
- `apps/platform-web/src/agent-runtime/diagnostics.ts`
  - New pure summary logic should remain storage-free.
- `apps/platform-web/src/platform-host/index.ts`
  - Keep query wiring small; avoid expanding host responsibilities beyond loading files and delegating.
- `apps/platform-web/src/storage/workspace.ts`
  - Should not need changes for this task; avoid storage lifecycle churn.

## Rollback Points

- If contract churn gets too wide, keep the public bridge query result typed locally and defer exported contract types.
- If related path extraction becomes speculative, restrict it to paths already present in trace data and Agent/Skill/script paths already named by events.
- If health summaries become noisy, default them off and return only failed/anomalous summaries unless `includeHealth` or exact `turn` is provided.
- If malformed trace handling gets complex, count omitted malformed lines and return a single compact trace parse fact.

## Review Gate Before Start

Before `task.py start`, confirm:

- PRD has no open product questions.
- `design.md` keeps diagnostics facts-only and on-demand.
- `implement.md` does not introduce UI, default live-turn tools, repair suggestions, pruning, or derived diagnostic files.
