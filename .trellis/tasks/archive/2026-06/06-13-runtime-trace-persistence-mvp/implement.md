# Implementation Plan

## Checklist

1. [x] Refresh pre-development specs with `trellis-before-dev`.
2. [x] Define runtime trace event helpers.
   - Decide whether shape stays internal to `platform-web` or moves to `@tsian/contracts`.
   - Add JSON-compatible event type and small summary helpers.
3. [x] Instrument `apps/platform-web/src/agent-runtime/index.ts`.
   - Emit agent step start/completion/failure.
   - Emit model call summary events after each model response.
   - Pass trace sink into workspace tool execution.
4. [x] Instrument `apps/platform-web/src/agent-runtime/workspace-tools.ts`.
   - Emit `skill_loaded`.
   - Emit `workspace_tool_called`.
   - Emit `action_called`.
   - Keep trace summaries content-light.
5. [x] Instrument `apps/platform-web/src/platform-host/index.ts`.
   - Create per-turn trace collector.
   - Emit turn started/completed/failed events.
   - Wrap Agent Runtime platform action runner to emit `workspace_mutation`.
   - Serialize JSONL and write `.tsian/traces/turns/turn-*.jsonl`.
   - Sync `workspaceFiles` after trace write so checkpoint contains successful turn trace when using the recommended checkpointed policy.
6. [x] Hide trace from ordinary list/search.
   - Add filtering in storage workspace list/search helpers.
   - Add filtering in runtime workspace tool list/search helpers.
   - Leave exact workspace read unchanged for MVP.
7. [x] Update docs/specs.
   - `docs/active/agent-framework-runtime-workspace-direction.md`
   - `docs/active/current-state-handoff.md`
   - `.trellis/spec/platform-web/frontend/type-safety.md`
8. [x] Validate with probes.
   - Successful turn writes valid JSONL trace.
   - Failed turn produces `turn_failed` when persistence path is available.
   - Tool calls produce expected event types without full file content.
   - Platform workspace-write/delete produce `workspace_mutation`.
   - Workspace list/search exclude `.tsian/traces/` by default.
9. [x] Run quality checks.
   - `npm run build:web`
   - `git diff --check`

## Validation Notes

- `npm run build:web` passed.
- `git diff --check` passed.
- Runtime in-memory probe passed for model call summaries, `skill_loaded`, `workspace_tool_called`, `action_called`, valid JSONL serialization, and runtime `.tsian/traces/` list/search hiding.
- Browser bridge probe passed for successful trace persistence, `workspace_mutation`, checkpoint inclusion, bridge list/search default hiding, and explicit `includePlatformTraces`.
- Browser failure probe passed for failed trace persistence with `turn_failed` and `agent_step_failed`.
- Browser `agent-context` probe passed for default trace exclusion.

## Risky Files

- `apps/platform-web/src/agent-runtime/index.ts`
- `apps/platform-web/src/agent-runtime/workspace-tools.ts`
- `apps/platform-web/src/platform-host/index.ts`
- `apps/platform-web/src/storage/workspace.ts`
- `.trellis/spec/platform-web/frontend/type-safety.md`

## Rollback Points

- If moving trace event shape to `@tsian/contracts` causes too much cross-package churn, keep the type internal for MVP.
- If failed-turn trace persistence complicates error handling, keep successful-turn trace as MVP and document failed-turn trace as follow-up; prefer still emitting in-memory `turn_failed`.
- If hiding `.tsian/traces/` from all list/search paths causes UI surprises, limit hiding first to runtime Agent tools and document bridge query hiding as follow-up.

## Review Gate Before Start

- Trace checkpoint policy is confirmed: trace follows workspace checkpoint/restore for MVP.
- Confirm no UI and no raw prompt archive.
- Confirm exact `workspace_read` remains unchanged in MVP.
