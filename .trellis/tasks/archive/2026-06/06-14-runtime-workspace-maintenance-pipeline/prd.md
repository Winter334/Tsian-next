# Runtime Workspace Maintenance Pipeline

## Goal

Define and implement the next foundation slice after Runtime Side-Effect Transactions: reliable Runtime Workspace maintenance primitives for Agent session transcripts and Skill-triggered AIRP memory file updates such as notes, history timeline, and memory summaries.

The pipeline should make successful turns leave useful, checkpoint-scoped Agent session artifacts and allow flexible Skill-directed memory maintenance without returning to a fixed per-turn workflow or making platform code own gameplay-specific world, character, relationship, or rules schemas.

## Parent Direction

Parent task: `.trellis/tasks/06-13-runtime-foundation-completion`

The original roadmap listed Controlled Execution Completeness as the second item, but after the transaction slice the user approved prioritizing Agent notes/session and timeline/current-summary maintenance first. This child should use the new staged workspace transaction boundary instead of inventing its own persistence semantics.

## User Value

- Successful turns create durable Agent-level session feedstock beyond raw player/assistant history.
- Future UI can inspect and edit meaningful workspace files rather than only trace/debug internals.
- Future concrete Agents and Skills can depend on stable maintenance conventions for session transcripts, timelines, and summaries.
- Maintenance writes remain checkpoint-scoped and rollback-safe because they use the same successful-turn transaction boundary.
- The platform remains AIRP-generic: it validates file operations and contracts, while Agent/Skill/workspace content owns semantic interpretation.

## Confirmed Facts

- New saves already include `agents/master/session.jsonl`, `agents/narrative/session.jsonl`, `agents/memory/session.jsonl`, Agent `notes.md` files, `history/timeline.md`, `memory/summaries/current.md`, and `memory/summaries/long-term.md`.
- `assembleAgentContext` already includes each Agent's `notes.md` and `session.jsonl` when present.
- Default master/narrative prompts already receive Agent notes/session and declared context files.
- The memory Agent already exists as a default contact of master and is instructed to return continuity findings, current-scene summary suggestions, long-term memory candidates, and facts worth preserving.
- Current `agent_call` can invoke the memory Agent and return its output as an observation, but it does not automatically write maintenance files.
- Current raw AIRP history writeback stores one successful player-facing exchange under `history/turns/turn-*.json`.
- Current Runtime Trace persists debug/audit summaries under `.tsian/traces/` and ordinary list/search hides trace by default.
- Runtime Side-Effect Transactions now provide staged workspace write/delete, same-turn read-after-write, successful-turn atomic commit, and failed/aborted-turn discard semantics.
- Active docs still list Agent notes/session automatic writeback and timeline/current-summary maintenance as missing.
- Previous raw history writeback intentionally excluded automatic timeline/current-summary and Agent session/notes maintenance.
- `trellis mem search "Agent notes timeline current summary writeback"` found no additional past conversation decision beyond the task/docs evidence.
- User decision: `agents/<agent>/session.jsonl` should be an automatic Agent session transcript, closer to Codex / Claude Code session records than to application logs. It may include detailed Agent input/output and tool-call material.
- User decision: logs should remain a separate concern with standard logging semantics: keep a bounded normal window and persist diagnostic windows when errors happen, rather than treating Agent session files as logs.
- User decision: `agents/<agent>/notes.md` may be open to automatic maintenance when governed by loaded Skill instructions that define what can be written and when.
- User decision: `history/timeline.md`, `memory/summaries/current.md`, and `memory/summaries/long-term.md` are enhanced memory surfaces maintained by the memory Agent and consumed by other Agents. This layer should be replaceable.
- User decision: `agents/<agent>/session.jsonl` should store structured Agent-facing transcripts, including context references and content snapshots that were actually injected, model outputs, parsed tool calls, tool observations, and delegated Agent interactions. It should exclude platform-only hidden implementation details that the Agent did not see.
- User decision: implement both layers in this child task as one vertical slice: first deterministic Agent session transcript persistence, then validated notes/timeline/summary maintenance plan writes.
- User decision: enhanced memory maintenance must not run automatically on every successful turn. The Agent framework's value over the old fixed workflow is flexible, need-driven execution. Maintenance should happen only when a workspace-defined Agent or Skill explicitly triggers it or explicitly records a no-op maintenance decision.
- User decision: enhanced memory maintenance should be exposed as a Skill action first, not as default `AGENT.md` instructions. Agents could technically use workspace write tools directly, but a Skill keeps the policy replaceable and can be moved into `AGENT.md` later if real usage shows that works better.
- User decision: having official default Skills is acceptable.
- User clarification: Skill-based extension should not require new platform code for each new capability when existing executors already cover the side effect. Maintenance should first use existing Skill executor surfaces such as `browser_script` or `platform_action/workspace-write`; adding a new platform action is only appropriate when the platform must expose a genuinely new privileged primitive.
- User decision: current platform actions/executors are sufficient for this task. The official maintenance Skill should use `browser_script` plus the existing workspace SDK as the default implementation path; this task should not add a maintenance-specific platform action.
- User decision: `agents/<agent>/session.jsonl` should be append-only in this slice, without segmentation, trimming, compression, or archival. Each record should carry schema/version/turn metadata so a later task can design compaction safely.
- Confirmed code fact: current runtime already supports `skill_load`, `tsian-actions`, `action_call`, and allow-listed `platform_action`, while default workspace currently has no shared `skills/*/SKILL.md` files.
- Confirmed code fact: Agent `defaultSkills` is parsed into registry entries, but runtime does not auto-load default skills today. Shared Skills are visible in the Skill Index and still require an explicit `skill_load`.
- Confirmed code fact: `initializeWorkspaceForSave` seeds default workspace files only when a save has zero workspace files; existing non-empty saves do not automatically receive newly added default files.
- User decision: the official maintenance Skill should be available to existing non-empty saves as well as new saves. Add a safe default-file upgrade/ensure path that creates missing official maintenance Skill files without overwriting user content, without auto-loading the Skill, and without triggering maintenance.

## Requirements

- Establish session transcript persistence that runs for every successful Agent participation, plus maintenance plan primitives that run only when explicitly triggered by loaded Skill action behavior.
- Use the active Runtime Workspace transaction so session transcript writes and triggered maintenance writes are staged, visible to later same-turn steps when applicable, committed with the accepted turn, and discarded if the turn fails before acceptance.
- Preserve the current successful raw AIRP history file as the authoritative per-turn source record.
- Add deterministic append-only session transcript records for Agents that participated in the turn, such as master, narrative, and delegated Agents when present.
- Do not segment, trim, compress, or archive `agents/<agent>/session.jsonl` in this slice.
- Treat Agent session records as replay/debuggable conversation substrate, not as operational logs. They may include the Agent-facing input bundle, model output, tool calls, tool observations, delegated Agent call summaries or transcripts, and execution metadata needed to understand what the Agent actually saw and did.
- Keep platform logs separate from Agent session files. If a future logging task is needed, design bounded log windows and error-window persistence separately.
- Add a validated maintenance plan contract exposed through an official default Skill action for maintenance writes to files such as `agents/<agent>/notes.md`, `history/timeline.md`, `memory/summaries/current.md`, and `memory/summaries/long-term.md`.
- Seed the official maintenance Skill for new saves and make it available to existing saves through a safe, versioned default workspace upgrade that does not overwrite existing workspace files.
- Do not add a new platform action solely for maintenance if existing Skill executor surfaces can safely perform the workspace writes.
- Do not treat default Skill availability as maintenance execution: the Skill must still be explicitly loaded and called by an Agent.
- Do not synthesize a global "this turn was maintained" or "no update needed" status for turns where no maintenance Skill was called. If an Agent explicitly decides no maintenance is needed, it can call the Skill with a valid empty maintenance plan or equivalent no-op decision.
- Validate maintenance write targets with ordinary workspace path rules and reject `.tsian/*`.
- Do not let maintenance failures erase or fail an otherwise successful player-facing turn unless the final atomic storage commit itself fails.
- Record maintenance success/failure summaries in Runtime Trace without persisting large raw payloads.
- Keep frontend bridge `platform.runAction` behavior unchanged.
- Keep `agent-runtime` platform-pure: maintenance orchestration and storage transactions belong in platform-host/storage capabilities, while prompt/model helpers may remain in `agent-runtime` only if they are storage-free.
- Update active docs/specs if this task makes a maintenance contract authoritative.

## Recommended Scope

Implement this as a runtime foundation feature, not a gameplay memory Skill package:

1. Always append structured session transcript records for Agents that actually participated in a successful turn.
2. Keep session transcript persistence platform-generic: capture Agent inputs/outputs/tool interactions, but do not interpret world, character, memory, relationship, or rules semantics.
3. Add Skill-triggered maintenance plan handling driven by workspace-defined Skills, producing a structured, validated maintenance plan for notes/timeline/current/long-term summary files only when an Agent loads and calls that Skill.
4. Allow `notes.md` maintenance when the loaded Skill declares what may be written and when. `AGENT.md` may instruct an Agent when to load the Skill, but should not bypass the Skill action in this slice.
5. Treat timeline and summary maintenance as replaceable enhanced memory behavior, primarily owned by the memory Agent and its Skills.
6. Seed an official default maintenance Skill, likely `skills/memory-maintenance/SKILL.md`, so the vertical slice has a default workspace-level entry point without forcing a fixed per-turn step.
7. Upgrade existing non-empty saves through a safe default-file path: create missing official maintenance Skill files for older workspace manifests, preserve any existing files at the same paths, and do not auto-load or run the Skill.
8. If a triggered maintenance plan fails validation, commit the successful turn, raw history, trace, and session transcripts, then trace the maintenance failure as diagnostic data.

This gives the platform real maintenance primitives while keeping semantic memory content authored by workspace-defined Agents/Skills rather than by hardcoded platform rules or fixed per-turn workflows.

This child task should implement both session transcript persistence and maintenance plan writes. If implementation discovers that the full vertical slice is larger than expected, the rollback point is to keep transcript persistence complete and explicitly re-plan the maintenance pass rather than silently dropping acceptance criteria.

## Acceptance Criteria

- [x] A successful normal turn appends session transcript records for participating default Agents under `agents/<agent>/session.jsonl`.
- [x] Session transcript records are valid JSONL, checkpoint-scoped, and omitted on failed or aborted turns.
- [x] Session transcript persistence is append-only and does not implement segmentation, trimming, compression, or archival.
- [x] Session transcript records include enough Agent-facing input/output and tool interaction material to understand what that Agent saw and did during the turn.
- [x] Session transcript records are not treated as platform operational logs; no bounded log-window or error-window logging behavior is implemented in this slice.
- [x] Enhanced memory maintenance is not run automatically on every successful turn.
- [x] Skill-triggered maintenance produces a structured maintenance plan that is parsed and validated before any writes are staged.
- [x] Maintenance plan application is available only through loaded Skill action flow, not as an always-visible runtime primitive or fixed per-turn platform step.
- [x] The default workspace includes an official maintenance Skill that can be loaded on demand.
- [x] Existing non-empty saves receive the official maintenance Skill through a safe default workspace upgrade, while existing user files at the same paths are preserved.
- [x] Default Skill seeding does not auto-load the Skill, call maintenance, or create notes/timeline/summary mutations by itself.
- [x] The maintenance Skill uses existing executor surfaces; no new maintenance-specific platform action is added unless implementation proves existing executors cannot safely satisfy the contract.
- [x] A successful turn with no maintenance trigger commits normally and does not create synthetic timeline/summary/notes updates.
- [x] A valid explicit no-op maintenance plan records that no writes were requested without mutating notes/timeline/summary files.
- [x] Valid maintenance plans can update declared `agents/<agent>/notes.md`, `history/timeline.md`, `memory/summaries/current.md`, and `memory/summaries/long-term.md` targets through staged workspace writes.
- [x] Notes maintenance is allowed only when authorized by the loaded maintenance Skill and validated by the platform maintenance contract.
- [x] Invalid maintenance JSON, invalid schema, invalid paths, `.tsian/*` targets, or oversized writes do not fail the player-visible turn and do not mutate ordinary workspace files.
- [x] Maintenance writes, raw history, successful trace, snapshot/history, and checkpoint are committed coherently through the successful-turn transaction.
- [x] Failed or aborted turns leave no session/timeline/summary maintenance writes, except host-owned failed trace diagnostics.
- [x] Runtime Trace records maintenance started/completed/failed summaries without large raw content.
- [x] Frontend bridge direct workspace write/delete remains immediate and compatible.
- [x] The maintenance contract is documented in active docs/specs.

## Out Of Scope

- Designing final memory UI, workspace editor UI, or Agent/Skill configuration UI.
- Hardcoding world, character, relationship, location, event, rule, or gameplay-specific schemas in platform code.
- Replacing raw AIRP history files with summaries as the authoritative record.
- Migrating `stateRecords` into workspace files.
- Remote HTTP, WASM, hosted execution, or executor trust UI.
- Full `agent_call` recursion or budget configuration overhaul unless required for maintenance execution.
