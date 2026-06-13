# Implementation Plan

## Checklist

1. Refresh pre-development specs with `trellis-before-dev`.
2. Update trace type support.
   - Add `agent_called` trace event type.
   - Allow delegated Agent debug labels such as `agent:memory` if the current literal union blocks generic Agent ids.
3. Update default Runtime Workspace files.
   - Add `agents/memory/AGENT.md`.
   - Add `agents/memory/notes.md`.
   - Add `agents/memory/session.jsonl`.
   - Add `memory` to default master contacts and master guidance.
4. Add `agent_call` runtime tool shape.
   - Add tool name to `RUNTIME_WORKSPACE_TOOL_NAMES`.
   - Parse / validate `{ agentId, request, reason?, contextSummary?, expectedOutput?, historyMode? }`.
   - Add structured error codes for invalid target, invalid mode, non-contact target, budget exhaustion, unavailable nested call, and delegated failure.
5. Refactor runtime tool instructions.
   - Generate tool instructions from current Agent context instead of one static constant.
   - Expose `agent_call` only when current Agent has contacts and this step allows it.
   - List only visible contacts.
6. Add turn-scoped agent-call execution state.
   - Track max calls per root turn.
   - Track depth / allow flag.
   - Share budget across master and narrative steps.
7. Add delegated Agent execution path in `agent-runtime/index.ts`.
   - Build delegated Agent messages with target context, request, caller, semantic history mode, current player input, and recent history window.
   - Reuse model call capability and workspace tool loop.
   - Allow workspace tools, `skill_load`, and non-agent_call `action_call`.
   - Disable nested `agent_call`.
8. Connect `agent_call` tool to delegated runner.
   - Pass `runAgentCall` into `executeRuntimeWorkspaceToolCalls`.
   - Return delegated response as observation.
   - Emit `agent_called` trace summary for success and failure.
9. Update specs/docs.
   - Update `.trellis/spec/platform-web/frontend/type-safety.md` with the concrete `agent_call` runtime tool contract.
   - Update `docs/active/agent-framework-runtime-workspace-direction.md` and `docs/active/current-state-handoff.md` if implementation changes current status.
10. Validate with in-memory probes.
   - `agent_call` to memory succeeds and returns observation.
   - non-contact target returns structured error and does not call model.
   - missing target returns structured error.
   - nested `agent_call` returns structured error.
   - `historyMode` defaults to `recent` and rejects invalid modes.
   - delegated Agent can use `workspace_read` / `skill_load` / non-agent_call `action_call`.
   - trace includes `agent_called`.
11. Run quality checks.
   - `npm run build:web`
   - `git diff --check`

## Risky Files

- `apps/platform-web/src/agent-runtime/index.ts`
- `apps/platform-web/src/agent-runtime/workspace-tools.ts`
- `apps/platform-web/src/agent-runtime/trace.ts`
- `apps/platform-web/src/storage/workspace.ts`
- `.trellis/spec/platform-web/frontend/type-safety.md`
- `docs/active/agent-framework-runtime-workspace-direction.md`
- `docs/active/current-state-handoff.md`

## Suggested Constants

- `DEFAULT_AGENT_CALL_HISTORY_MODE = "recent"`
- `MAX_AGENT_CALLS_PER_TURN = 4`
- `MAX_AGENT_CALL_DEPTH = 1`
- `AGENT_CALL_HISTORY_WINDOW_BY_MODE = { minimal: 0, recent: 6, scene: 12 }`

These constants are implementation policy, not user-facing API.

## Rollback Points

- If generic delegated Agent debug labels cause too much type churn, keep trace debug label optional and record target Agent in `data`.
- If reusing the full workspace tool loop for delegated Agents creates recursion complexity, keep the same loop but set `allowAgentCall: false` in delegated contexts.
- If default `memory` Agent prompt causes model behavior drift, keep the Agent file minimal and rely on tests with mocked model responses.

## Review Gate Before Start

- Confirm `agent_call` is a runtime tool, not a Skill action.
- Confirm MVP adds default `memory` Agent.
- Confirm `historyMode` is the only exposed history-control argument.
- Confirm nested `agent_call` is out of scope for MVP.
- Confirm no UI work.

## Implementation Result

- Implemented contacts-gated `agent_call` as a first-class runtime tool.
- Added delegated Agent execution with target Agent context, semantic `historyMode`, root-turn call budget, and nested `agent_call` rejection.
- Added `agent_called` trace coverage and delegated Agent debug labels.
- Added default `memory` Agent files and default master contact guidance.
- Updated platform-web type-safety spec and active docs.

## Validation Result

- `npm run build:web` passed.
- `git diff --check` passed.
- In-memory Vite SSR probe passed for successful `agent_call`, non-contact target, missing target, nested unavailable, default/invalid `historyMode`, delegated workspace read, delegated `skill_load`, delegated non-`agent_call` action, and `agent_called` trace events.
