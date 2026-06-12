# Design: Agent Framework And Runtime Workspace Direction

## 1. Core Thesis

Tsian should develop a native AIRP Agent Framework.

It should not copy personal-assistant systems whose main problems are channel routing, host tools, filesystem access, and server safety. Tsian's agents live inside an AIRP runtime. Their main job is to coordinate story, memory, rules, world state, frontend data, and save evolution.

The framework should optimize for:

- configurable agents;
- replaceable agents;
- expandable skills;
- agent-to-agent collaboration;
- progressive context loading;
- save-scoped runtime data that authors and players can inspect and edit;
- hosted-first product shape with local/self-hosted capability preserved.

## 2. Agent Model

An agent is a workspace-defined participant.

Each agent has an `AGENT.md` entry file under the runtime workspace, for example:

```text
agents/
  master/
    AGENT.md
    session.jsonl
    notes.md
    skills/
  narrative/
    AGENT.md
    session.jsonl
    notes.md
```

`AGENT.md` is a soft instruction and metadata document. It should describe:

- the agent's role;
- when it should act;
- what style or output expectations it has;
- what skills it may use;
- what other agents it may contact and when;
- what files it should auto-load or maintain.

The platform should not enforce strict input/output contracts for ordinary agent text. Agent output is often narrative, judgement, planning, or task-specific prose. It is better governed by instructions and optional output-spec skills than by a rigid platform schema.

Hard validation belongs at execution boundaries:

- tool/action call input;
- action result where declared;
- workspace write operations if structured;
- remote execution result;
- checkpoint/commit operations;
- platform model/tool capability calls.

## 3. Agent Collaboration

Do not introduce an explicit `team.json` as the primary collaboration model.

Use:

- a runtime entry agent, usually `agents/master/AGENT.md`;
- an agent registry derived from workspace files;
- contact declarations in `AGENT.md`;
- a generic `agent.call` skill/capability.

The team emerges from the network of agents that can contact each other.

An agent only needs to see contacts that matter to its job. For example, master may know narrative/state/memory agents, while narrative may only know style/critic agents if a content package provides them.

Agent-to-agent handoff should normally be direct through `agent.call`, not through mandatory handoff files. Files are for persistent or reusable shared memory, not for every intermediate message.

## 4. Skill Model

A skill is a progressively loaded capability package.

Each skill has a `SKILL.md` entry file. Skills can live in shared or agent-local locations:

```text
skills/
  relationship-maintainer/
    SKILL.md
    actions/
    schemas/
    examples/
    scripts/

agents/
  narrative/
    skills/
      prose-style/
        SKILL.md
```

Shared skills under `skills/` can be used across the workspace. Agent-local skills under `agents/<agent>/skills/` are indexed for that agent by default.

New skills created by an agent should default to that agent's local `skills/` directory. A later product action can promote an agent-local skill into shared `skills/` when it proves reusable.

## 5. Progressive Skill Loading

The always-visible skill index should be small. It should contain only enough information for an agent to decide whether to load the skill:

- id;
- title;
- summary;
- triggers;
- applicability.

Actions should not be listed in the always-visible index. They are revealed only after the skill is selected and loaded.

Recommended flow:

```text
Turn starts
  -> Orchestrator builds an agent context with relevant skill index entries
  -> Agent decides which skills are relevant
  -> Skill registry loads selected SKILL.md details and related files
  -> Agent receives instructions/examples/schemas/actions for loaded skills
  -> Agent may call loaded skill actions
```

This keeps prompts clean, prevents action-list noise, and supports remote/lazy skill details.

## 6. Skill Actions And Executors

An action is a callable capability exposed by a loaded skill or platform tool.

Agent-facing concepts should remain simple:

- action name;
- description;
- input schema;
- output description/schema if useful;
- when to use it.

How an action executes is an implementation detail. Executors may include:

- platform-native function;
- browser JavaScript;
- remote-loaded browser script;
- remote HTTP execution;
- WASM;
- future hosted execution environments.

The platform should normalize all of these into one action call path:

```text
agent emits action call
  -> platform validates input
  -> executor runs
  -> platform validates/normalizes result where declared
  -> result returns as observation/context
  -> platform records trace
```

This allows broad skill reuse without forcing agents to understand where code runs.

## 7. Runtime Workspace

The save instance should evolve toward a virtual filesystem-like Runtime Workspace.

The workspace is the unified container for:

- agent definitions;
- agent sessions and notes;
- shared and local skills;
- world data;
- structured game state;
- memory;
- conversation history;
- frontend data;
- archives;
- platform metadata.

Structured game state should not be a separate conceptual layer from workspace files. It can live as JSON, JSONL, Markdown, schema files, and README-described directories inside the workspace.

Directory README files are the main way to decouple data structures from agents and skills. Agents and skills can read the README/schema for a directory before working with that data shape.

## 8. Suggested Workspace Layout

Recommended default layout:

```text
/
  README.md

  agents/
    master/
      AGENT.md
      session.jsonl
      notes.md
      skills/
    narrative/
      AGENT.md
      session.jsonl
      notes.md

  skills/
    relationship-maintainer/
      SKILL.md
      actions/
      schemas/
      examples/
      scripts/

  history/
    conversation.jsonl
    timeline.md

  world/
    README.md
    canon.md
    characters.json
    locations.json
    relationships.json
    rules.md

  memory/
    README.md
    summaries/
      current.md
      long-term.md
    facts.jsonl

  frontend/
    README.md
    view-state.json

  archive/

  .tsian/
    manifest.json
    traces/
    checkpoints/
    indexes/
    cache/
```

Guidelines:

- Root `README.md` explains the workspace and important entry points.
- `agents/` contains agent definitions and agent-owned state.
- `skills/` contains shared skill definitions.
- `agents/<agent>/skills/` contains agent-local skills.
- `history/` contains conversation and compressed story timeline, not every internal step.
- `world/` contains current world facts and structured game state.
- `memory/` contains long-term memory, summaries, and retrievable facts.
- `frontend/` contains data the frontend package agrees to read.
- `archive/` holds retired or compressed material.
- `.tsian/` is platform metadata/cache/debug/checkpoint space.

## 9. Turns And Traces

Avoid writing a large normal workspace directory for every turn by default.

Detailed traces should live under `.tsian/traces/` or another platform/debug retention area, with a retention policy. The normal workspace should store durable, useful knowledge:

- conversation history;
- timeline summaries;
- world updates;
- memory facts;
- agent notes;
- frontend data.

This avoids turning the workspace into an unsearchable pile of intermediate artifacts.

## 10. Agent-Created Skills

Long-term, agents should be able to help create and improve skills.

Recommended staged policy:

1. Agent proposes patches to `AGENT.md`, `SKILL.md`, or related files.
2. User/player/author approves the diff.
3. Trusted or scoped agents may later auto-edit local skills.
4. Mature local skills can be promoted to shared skills.

This is not mainly a security concern; it is about keeping the system debuggable when an agent changes its own behavior.

## 11. Safety And Product Boundary

Tsian does not need a host-safety model like OpenClaw's personal assistant gateway.

The lightweight runtime boundary should still preserve:

- platform control of model keys and provider calls;
- platform commit/checkpoint behavior;
- timeout/abort for scripts and remote calls;
- action input/output validation where declared;
- trace records for loaded skills, actions, file reads/writes, and agent calls;
- no direct access to platform internals except through exposed tools/actions.

This is enough for AIRP runtime stability without over-designing a server-agent sandbox.

## 12. Implementation Implications

Future implementation should likely proceed in this order:

1. Add active documentation and current-state guidance.
2. Define workspace file APIs and storage shape.
3. Introduce `AGENT.md` and `SKILL.md` parsing/indexing.
4. Build progressive skill loading.
5. Build action execution adapters.
6. Migrate current fixed master/narrative flow into workspace-defined agents.
7. Move current `stateRecords` semantics into workspace-backed files/directories or a compatibility layer.
8. Add UI for browsing/editing workspace files, agents, and skills.

This task only records the direction and does not implement these steps.
