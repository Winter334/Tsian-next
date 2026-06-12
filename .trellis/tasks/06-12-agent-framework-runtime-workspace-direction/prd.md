# Record Agent Framework And Runtime Workspace Direction

## Goal

Record the agreed Tsian Agent Framework direction as current planning guidance so future development can build on a clear AIRP-specific model instead of drifting back toward generic personal-assistant agents, rigid workflow DAGs, or hardcoded runtime state structures.

The immediate work is documentation only: capture the direction in Trellis task artifacts and then update active project docs so future sessions can find it.

## User Value

- Future Agent Runtime work has a stable product and architecture reference.
- Agent, skill, tool, and runtime workspace discussions do not need to be reconstructed from chat context.
- The project can move toward configurable, replaceable, expandable agent teams without introducing a heavy personal-server security model.
- The runtime data model becomes easier for players, authors, frontends, agents, and skills to understand because it is expressed as a save-scoped virtual workspace.

## Confirmed Facts

- Current project direction is Agent-Orchestrated AIRP Runtime, recorded in `docs/active/airp-workflow-platform-direction.md`.
- Current implementation has a browser-hosted Agent Runtime MVP with a fixed `master-agent` to `narrative-agent` flow.
- The current MVP stores conversation, snapshots, checkpoints, and generic `stateRecords`.
- The project is not trying to become an OpenClaw-style personal assistant that controls a user's server, filesystem, browser, or messaging accounts.
- The likely product direction is hosted-first and local-capable, not self-host-only.
- The user wants a Tsian-native agent framework, not a generic autonomous agent framework.
- The user wants agents to be configurable, replaceable, and extensible.
- The user wants players/authors to compose their own agent networks.
- Explicit team configuration is not desired as the primary model; collaboration should emerge from agent contact declarations and a generic agent-call capability/skill.
- The user wants skills to support progressive disclosure: only skill index entries are visible by default, while detailed instructions/actions/schemas/scripts load on demand.
- Skill actions do not need to be visible in the always-loaded skill index.
- The user wants skills to be capable, including web-executable scripts and remote execution adapters where useful.
- The user does not want platform-enforced agent input/output contracts for normal agent text; ordinary output style should live in `AGENT.md` or output-spec skills.
- Hard validation should exist only at execution boundaries such as tool/action calls, state/workspace write operations, script results, and remote execution results.
- The user wants a runtime workspace model similar to an agent app workspace or virtual filesystem.
- Agent/session context, world state, memory, frontend data, agent definitions, and skill definitions should all live in the virtual workspace rather than being split into separate conceptual stores.
- Agent-local skills and shared skills should both be supported.
- Agents may eventually create or edit skills, first by proposing patches and later with more autonomy where appropriate.

## Requirements

- Record the Agent Framework direction as current architecture guidance.
- Define Agent as an AIRP runtime participant described by `AGENT.md`.
- Define Skill as a progressively loaded capability package described by `SKILL.md`.
- Define Skill Index as always-visible lightweight metadata containing summary/triggers/applicability, not action lists.
- Define Skill Action as a callable action that becomes visible only after a skill is loaded.
- Define Tool/Action execution through a unified action abstraction; implementation details such as browser script, remote script, remote HTTP, WASM, or platform-native function are executor details, not agent-facing concepts.
- Define a generic agent-call skill/capability so agents can contact only relevant downstream agents instead of relying on explicit team configuration.
- Define Runtime Workspace as the save-scoped virtual filesystem that stores agent definitions, skills, world data, memory, history, frontend data, and platform metadata.
- Define directory conventions for:
  - root README and manifest;
  - `agents/`;
  - shared `skills/`;
  - agent-local `agents/<agent>/skills/`;
  - `history/`;
  - `world/`;
  - `memory/`;
  - `frontend/`;
  - `archive/`;
  - `.tsian/` platform metadata.
- Avoid default per-turn file spam; detailed traces should live under platform metadata/debug retention rather than normal workspace content.
- Avoid default handoff/inbox directories as the primary agent-to-agent communication path; direct agent-call should be the main collaboration mechanism.
- Clarify that ordinary agent text is a soft protocol guided by `AGENT.md` and skills.
- Clarify that hard schemas are used only where the platform executes or commits something.
- Clarify that security should be lightweight and product-shaped: no host-filesystem safety model is needed for the current AIRP runtime, but model keys, platform internals, commit boundaries, timeout/abort, and traceability should remain controlled by the platform.
- Update active docs rather than only archiving this task record, so future development searches find the direction.

## Acceptance Criteria

- [x] The task PRD records the confirmed product and architecture decisions from the discussion.
- [x] A design artifact describes the Agent, Skill, Action, agent-call, and Runtime Workspace model.
- [x] An implementation artifact lists the exact documentation updates needed.
- [x] Active docs gain a discoverable Agent Framework / Runtime Workspace direction document or equivalent active section.
- [x] Active docs explain that Runtime Workspace is the future save data container abstraction and can contain structured game state as files/directories.
- [x] Active docs explain that agent collaboration is contact/agent-call based rather than explicit team-config based.
- [x] Active docs explain progressive skill loading: index first, details/actions on demand.
- [x] Active docs explain agent-local and shared skill placement.
- [x] Active docs explain that agent-created/edited skills are a desired future capability, with patch/proposal flow as the safer early path.
- [x] Active docs update the reading order or current-state handoff so future sessions can find the new direction.
- [x] No runtime implementation changes are made in this task.
- [x] No new Agent Framework code, schema migration, UI, or storage rewrite is implemented in this task.

## Out Of Scope

- Implementing Runtime Workspace storage.
- Migrating current `stateRecords` into workspace files.
- Implementing `AGENT.md` or `SKILL.md` parsers.
- Implementing skill loading, script execution, remote execution, or agent-call.
- Implementing UI for editing workspace files, agents, or skills.
- Implementing agent-created skill diffs or approval UI.
- Designing every final frontmatter field in detail.
- Introducing a heavy OpenClaw-style host sandbox, personal-server gateway, or remote channel security model.

## Open Questions

- None blocking documentation. Field-level schema details can be refined when the implementation task starts.

## Spec Update Decision

No `.trellis/spec/` update is needed for this task. The work records product and architecture direction in active docs; it does not introduce executable API contracts, storage schemas, command behavior, coding conventions, or implementation patterns yet.
