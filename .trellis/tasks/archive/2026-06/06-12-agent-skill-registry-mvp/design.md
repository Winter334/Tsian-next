# AGENT.md/SKILL.md Registry MVP Design

## Scope

This task adds registry discovery for workspace-defined agents and skills. It does not change runtime execution.

After this task, Tsian can answer:

- Which agents are defined in the active save workspace?
- Which lightweight skills are available globally or locally to an agent?
- Where is the source `AGENT.md` or `SKILL.md` file?

It cannot yet load full skill details, execute actions, or run workspace-defined agents.

## Architecture

### Contracts

Add shared registry shapes to `packages/contracts/src/runtime.ts`:

- `AgentRegistryEntry`
- `SkillRegistryScope = "shared" | "agent-local"`
- `SkillRegistryEntry`

These are bridge-visible data shapes. Runtime validation and Markdown parsing stay in `platform-web`.

Suggested fields:

```ts
interface AgentRegistryEntry {
  id: string
  title: string
  summary: string
  path: string
  contacts: string[]
  defaultSkills: string[]
  contextPaths: string[]
  updatedAt: number
}

interface SkillRegistryEntry {
  id: string
  title: string
  summary: string
  path: string
  scope: "shared" | "agent-local"
  agentId?: string
  triggers: string[]
  appliesTo: string[]
  updatedAt: number
}
```

### Metadata Format

Use Markdown with optional YAML-like frontmatter:

```md
---
id: master
title: Master Agent
summary: Coordinates each AIRP turn.
contacts:
  - narrative
defaultSkills:
  - agent-call
contextPaths:
  - history/timeline.md
  - world/README.md
---

# Master Agent

...
```

Skill frontmatter:

```md
---
id: relationship-maintainer
title: Relationship Maintainer
summary: Tracks durable relationship changes.
triggers:
  - relationship changes
  - emotional stakes shift
appliesTo:
  - master
  - narrative
---

# Relationship Maintainer

...
```

For compatibility with existing skill conventions:

- `name` can substitute for `id` or `title`.
- `description` can substitute for `summary`.
- `applicability` can substitute for `appliesTo`.

The parser should support only the simple subset needed now:

- `---` delimited frontmatter at the start of the file;
- scalar `key: value`;
- simple list values as repeated `- item` lines;
- no nested objects required.

This avoids adding a YAML parser dependency while preserving the familiar skill shape.

### Registry Parser

Create a parser module under `apps/platform-web/src/agent-runtime/registry.ts`.

It should be pure and operate on workspace files passed to it. It should not import Dexie or bridge objects.

Inputs:

- `WorkspaceFile[]` or a local file-like shape containing `path`, `content`, `updatedAt`.

Outputs:

- `AgentRegistryEntry[]`;
- `SkillRegistryEntry[]`.

Path rules:

- agent file: `agents/<agentId>/AGENT.md`;
- shared skill: `skills/<skillId>/SKILL.md`;
- agent-local skill: `agents/<agentId>/skills/<skillId>/SKILL.md`.

Fallbacks:

- id from path segment if missing;
- title from `title`, `name`, first H1 heading, then id;
- summary from `summary`, `description`, first non-heading body paragraph, then empty string;
- arrays from frontmatter list values or comma-separated scalar values;
- malformed frontmatter should degrade to path/body fallbacks.

Sorting:

- agents by id;
- skills by scope, agentId, id, then path.

### Workspace Defaults

Extend default workspace initialization in `apps/platform-web/src/storage/workspace.ts` with:

- `agents/master/AGENT.md`;
- `agents/master/notes.md`;
- `agents/master/session.jsonl`;
- `agents/narrative/AGENT.md`;
- `agents/narrative/notes.md`;
- `agents/narrative/session.jsonl`.

Do not create a default shared `SKILL.md` in this task. Registry support for skills can be validated by writing a skill file through the workspace API or by direct helper coverage later. Avoid implying `agent.call` is executable before it exists.

### Bridge API

Extend `apps/platform-web/src/platform-host/index.ts` query handling:

- `agent-registry`
  - active save required;
  - reads workspace files;
  - returns `AgentRegistryEntry[]`.
- `skill-registry`
  - active save required;
  - reads workspace files;
  - optional params:
    - `agentId?: string`;
    - `includeShared?: boolean`;
    - `includeLocal?: boolean`;
  - returns `SkillRegistryEntry[]`.

Default behavior for `skill-registry`:

- include shared skills;
- include all local skills unless `agentId` is provided, in which case include only that agent's local skills.

### Data Flow

```text
new save
  -> initializeWorkspaceForSave
  -> creates default AGENT.md files

frontend/runtime caller
  -> bridge.query("agent-registry" | "skill-registry")
  -> platform-host gets active save id
  -> storage lists workspace files
  -> registry parser builds entries
  -> bridge returns lightweight registry entries
```

### Compatibility

- The current in-code Agent Runtime prompts remain authoritative for execution.
- Existing workspace files and checkpoints continue to work because default AGENT files are additive.
- Existing saves created under `tsian-agent-runtime-v2` before this task will not automatically receive default AGENT files unless a later migration/backfill task adds it. The MVP acceptance focuses on newly created saves.

### Trade-Offs

- A simple frontmatter parser is enough for this stage and avoids dependency churn.
- Deferring full skill detail loading preserves progressive disclosure and keeps action exposure out of the always-visible registry.
- Keeping registry parsing pure makes it easier to test and later reuse in the runtime orchestration layer.

## Rollback

The change is additive:

- Remove registry contract types.
- Remove `agent-runtime/registry.ts`.
- Remove default AGENT files from workspace initialization.
- Remove bridge query cases.

