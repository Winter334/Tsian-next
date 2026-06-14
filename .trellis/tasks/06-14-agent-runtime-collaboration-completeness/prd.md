# Agent Runtime Collaboration Completeness

## Goal

Complete the `agent_call` collaboration substrate enough that future concrete Agent roles, management Agents, diagnostic Skills, and workspace UI can rely on stable delegation semantics.

This task should mature `agent_call` without designing gameplay-specific Agent teams or turning collaboration into a fixed workflow. Agent relationships should still emerge from `AGENT.md contacts`, and platform code should only own generic execution limits, context assembly, trace, failure reporting, and persistence boundaries.

## Parent Direction

Parent task: `.trellis/tasks/06-13-runtime-foundation-completion`

Parent roadmap item: Agent Runtime Collaboration Completeness.

## User Value

- Concrete Agent designs can depend on predictable delegation behavior instead of MVP-only limits.
- Specialized Agents can cooperate through contacts without reintroducing a rigid workflow graph or `team.json`.
- Future management/self-repair Agents can inspect trace/session facts and reason about collaboration failures.
- Cost and loop risk stay bounded through platform-owned limits, trace, and structured errors.

## Confirmed Facts

- `agent_call` is already a first-class Runtime Workspace tool, not a Skill action.
- `agent_call` is only exposed when the current Agent has visible contacts and the current runtime step allows `agent_call`.
- The tool can only target Agents listed in the caller Agent's `contacts`.
- Target Agent context is assembled from its own `AGENT.md`, notes/session files, Skill Index, and declared context files.
- Delegated Agents can use the normal workspace tool loop, including workspace read/list/search, `skill_load`, and non-`agent_call` `action_call`.
- Before this task, delegated Agents could not call other Agents: `allowAgentCall` was false for delegated steps and `MAX_AGENT_CALL_DEPTH` was hardcoded to `1`.
- Root master and narrative steps both receive `allowAgentCall: true`, share the same root-turn call count, and start at `agentCallDepth: 0`.
- Before this task, collaboration limits were hardcoded in `apps/platform-web/src/agent-runtime/index.ts`: `MAX_AGENT_CALLS_PER_TURN = 4`, `MAX_AGENT_CALL_DEPTH = 1`, and `MAX_WORKSPACE_TOOL_ROUNDS_PER_AGENT = 3`.
- `historyMode` is semantic and currently supports `minimal`, `recent`, and `scene`; the concrete windows are platform policy and moved into the collaboration policy in this slice.
- `agent_call` arguments currently include `agentId`, `request`, optional `reason`, optional `contextSummary`, optional `expectedOutput`, and optional `historyMode`.
- Delegated prompts include target Agent context, caller summary, request fields, selected recent history, stateRecords, and current player input.
- Runtime trace records `agent_step_started`, `agent_step_completed`, `agent_step_failed`, model calls, and `agent_called` summaries.
- Agent session transcript writeback already captures delegated Agent model messages, outputs, tool calls, and observations for successful turns.
- Before this task, active docs described `agent_call` as MVP: contacts-gated, bounded by root-turn call count, and nested calls forbidden. This task updates those docs to the limited-recursion contract.
- User decision: enable limited nested `agent_call` by default in this slice, with a conservative `maxDepth = 2`, contacts gating at every hop, and shared root-turn total call budget.

## Requirements

- Preserve `agent_call` as a runtime primitive, not a Skill action.
- Preserve contacts-gated collaboration; do not introduce `team.json`, explicit workflow DAGs, or gameplay-specific Agent roles.
- Keep default AIRP flow `master -> narrative`; collaboration remains optional and Agent-triggered.
- Add an explicit collaboration policy/limits shape in Agent Runtime rather than leaving collaboration limits as scattered hardcoded constants.
- Keep policy code-level/default-only for this slice; no Settings UI, localStorage config, or runtime prompts.
- Mature budget reporting: observations and trace should include enough metadata to understand call count, max calls, depth, max depth, caller, target, and history mode.
- Mature context/history policy without exposing exact message-count control to Agents unless a later task approves it.
- Implement limited nested `agent_call` under contacts, depth, and total-call limits.
- Keep delegated Agent tool loops bounded and traceable.
- Keep failures as structured tool observations where possible so caller Agents can recover or choose another path.
- Preserve existing successful MVP behavior for root master/narrative calls to contact Agents.
- Ensure session transcript behavior remains compatible and continues to capture delegated Agent interactions.
- Update active docs/specs for whichever collaboration contract becomes authoritative.

## Recommended Initial Scope

Recommended implementation:

- Introduce a small Agent Runtime collaboration policy object with defaults:
  - `maxCallsPerTurn`: existing `4`.
  - `maxDepth`: `2`.
  - `historyWindows`: existing semantic windows for `minimal`, `recent`, and `scene`.
  - `maxToolRoundsPerAgent`: existing `3`, kept as one policy field or clearly documented as shared tool-loop policy.
- Keep policy injectable through runtime capabilities or a local normalization helper for tests/future host configuration, with no UI.
- Allow delegated Agents to use `agent_call` only when:
  - current depth is below `maxDepth`;
  - target is in the delegated Agent's own contacts;
  - root-turn total call budget remains available.
- When recursion is not allowed by policy, return `AGENT_CALL_UNAVAILABLE` or a more specific structured code with depth/limit metadata.
- Update delegated Agent platform guard so it no longer says "MVP 中不要再次调用 agent_call" when policy allows nested calls.
- Add trace/diagnostic/session facts sufficient to distinguish root calls from nested delegated calls.

## Out Of Scope

- Designing concrete master/narrative/memory/state/rules/critic role workflows.
- Adding Agent team UI, collaboration UI, or runtime configuration UI.
- Reintroducing workflow DAGs, `team.json`, or fixed every-turn collaboration.
- Parallel Agent execution or long-running task queues.
- Agent-to-Agent persistent mailboxes or handoff files.
- New memory/state gameplay schemas.
- Agent notes/session compression or archival policy beyond preserving current transcript behavior.
- Changing `stateRecords` storage.

## Acceptance Criteria

- [x] `agent_call` collaboration limits are represented by an explicit policy/limits shape rather than only hardcoded scattered constants.
- [x] Existing contacts-gated root `agent_call` behavior remains compatible.
- [x] The task selects limited recursion for this phase, with rationale recorded.
- [x] If limited recursion is enabled, nested calls are contacts-gated, depth-limited, total-budget-limited, traceable, and transcript-compatible.
- [x] Delegated Agent history/context policy remains semantic and bounded.
- [x] Tool-loop stability remains bounded for root and delegated Agents.
- [x] Failure reporting includes caller/target/depth/budget facts without raw prompt or large payload exposure.
- [x] Agent session transcripts remain compatible and include delegated interactions as before.
- [x] Runtime diagnostics can identify collaboration failures through facts, not hardcoded repair advice.
- [x] Active docs/specs are updated for the selected collaboration contract.

## Implementation Result

- Added a code-level Agent Runtime collaboration policy with defaults for call budget, depth, semantic history windows, and per-Agent tool rounds.
- Enabled limited nested `agent_call` under contacts, depth, and shared root-turn budget constraints.
- Added compact caller/target/depth/budget metadata to successful observations, structured failures, delegated step trace facts, and `agent_called` trace summaries.
- Kept diagnostics facts-only; existing diagnostic extraction can surface the new trace/error metadata without adding hardcoded repair advice.
- Updated active docs, parent roadmap facts, and platform-web type-safety spec for the selected collaboration contract.

## Open Questions

- None.

## Resolved Questions

- Limited nested `agent_call` should be enabled by default with `maxDepth = 2`.
- Nested calls must remain contacts-gated at each hop and share the root-turn total call budget.
