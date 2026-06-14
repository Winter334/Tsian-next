# Agent Runtime Collaboration Completeness Implementation Plan

## Checklist

1. Read applicable specs before editing:
   - `.trellis/spec/guides/index.md`
   - `.trellis/spec/platform-web/frontend/index.md`
   - relevant platform-web frontend/type-safety guidance.
2. Add an explicit collaboration policy in `apps/platform-web/src/agent-runtime/index.ts`.
   - Default `maxCallsPerTurn = 4`.
   - Default `maxDepth = 2`.
   - Default history windows: `minimal=0`, `recent=6`, `scene=12`.
   - Default `maxToolRoundsPerAgent = 3`.
   - Normalize optional capability overrides if added.
3. Replace direct uses of hardcoded collaboration constants with the normalized policy.
   - `selectHistoryForAgentCall` reads `policy.historyWindows`.
   - tool-loop round cap reads `policy.maxToolRoundsPerAgent`.
   - call budget reads `policy.maxCallsPerTurn`.
   - depth gate reads `policy.maxDepth`.
4. Update `AgentCallTurnState` and/or returned result metadata.
   - Include current call count and max calls.
   - Include current depth and max depth.
5. Enable limited nested `agent_call`.
   - Delegated Agent tool loop receives `allowAgentCall=true` only when the delegated depth is still below `policy.maxDepth`.
   - Visible contacts are the delegated Agent's own contacts.
   - Nested calls reuse the same root-turn `AgentCallTurnState`.
6. Update delegated Agent guard text.
   - Remove MVP-specific "do not call agent_call again" wording.
   - Tell delegated Agents they may consult their own contacts only when the tool is listed.
7. Improve structured errors.
   - Budget exceeded includes caller/target/depth/budget metadata.
   - Depth exceeded includes caller/target/depth/maxDepth metadata.
   - Delegated failures include caller/target/depth metadata.
8. Improve `agent_called` trace summaries in `workspace-tools.ts`.
   - Add caller/depth/maxDepth/callCount/maxCallsPerTurn when present.
   - Keep summaries compact; do not persist raw prompts or large outputs.
9. Check diagnostics.
   - Confirm existing diagnostics pick up `agent_called` error/fact fields.
   - Update only if necessary to expose the new facts.
10. Update active docs/specs.
   - `docs/active/current-state-handoff.md`
   - `docs/active/agent-framework-runtime-workspace-direction.md`
   - `.trellis/spec/platform-web/frontend/type-safety.md` if contract/signature details change.
11. Add focused probes/tests.
   - Root `agent_call` still succeeds.
   - Non-contact target still fails.
   - Missing target still fails.
   - Invalid `historyMode` still fails.
   - First-level delegated Agent can use workspace tools / `skill_load` / non-`agent_call` actions.
   - Delegated Agent can perform one nested `agent_call` to its own contact.
   - Depth beyond `maxDepth=2` fails with structured metadata.
   - Shared root-turn budget limits root and nested calls together.
   - `agent_called` trace includes caller/target/depth/budget facts.
   - Session transcripts include nested delegated Agent records.
12. Run validation.
   - `npm run build:contracts` if contract package changes.
   - `npm run build:web` for platform-web changes.
   - focused runtime probe for nested collaboration behavior.
   - `python3 ./.trellis/scripts/task.py validate 06-14-agent-runtime-collaboration-completeness`.
   - `git diff --check`.

## Risk Points

- Off-by-one depth semantics. Keep the design definition: root step depth `0`, first delegated Agent depth `1`, nested delegated Agent depth `2`, no calls from depth `2`.
- Prompt/tool mismatch. If delegated Agent prompt lists `agent_call`, the runtime must provide `runAgentCall`; if runtime disables it, the prompt should not advertise it.
- Budget accounting. Increment call count once per accepted call before delegated execution, so failed delegated execution still consumes budget like an attempted runtime collaboration.
- Trace payload size. Record metadata and summaries only.
- Existing tests/probes may assert nested `agent_call` is unavailable; update only the expectations that correspond to the approved behavior change.

## Rollback Plan

If limited recursion proves unstable, set default `maxDepth` back to `1` while keeping the explicit policy object and improved metadata. That restores MVP behavior without undoing the policy cleanup.

## Implementation Result

- Added `AgentRuntimeCollaborationPolicy` / `AgentRuntimeCollaborationPolicyInput` to `apps/platform-web/src/agent-runtime/index.ts`.
- Default collaboration policy is `maxCallsPerTurn=4`, `maxDepth=2`, `historyWindows={ minimal: 0, recent: 6, scene: 12 }`, and `maxToolRoundsPerAgent=3`.
- Delegated Agents now receive their own visible contacts in tool instructions when depth and budget allow nested `agent_call`.
- `agent_call` observations and structured errors include compact metadata: caller/target ids, caller/target depth, max depth, call count, max calls, and history mode.
- `agent_called` trace summaries flatten the compact metadata while continuing to omit raw prompts and large payloads.
- Runtime diagnostics did not need code changes because existing fact extraction already preserves error/details summaries and health call counts.

## Validation Result

- `npm run build:web` passed.
- In-memory `tsx` runtime probe passed for root `agent_call`, one nested delegated call, depth-limit failure, shared budget failure, missing target, invalid `historyMode`, trace metadata, and nested delegated transcript records.
- In-memory `tsx` runtime probe passed for non-contact target failure plus delegated `workspace_read`, `skill_load`, and non-`agent_call` `action_call`.
