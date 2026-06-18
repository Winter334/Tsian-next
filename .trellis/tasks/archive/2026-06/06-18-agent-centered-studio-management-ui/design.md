# Design: Agent-Centered Studio Management UI

## Scope

This task changes the Studio route, Agent workspace parsing/context assembly, default workspace files, and shared runtime contracts as needed for `SOUL.md` and per-Agent Skill enablement.

## Current Behavior

- Agents are discovered from `agents/<agent>/AGENT.md`.
- Agent context includes `AGENT.md`, save-runtime `notes.md`, `session.jsonl`, declared `contextPaths`, and a visible Skill index.
- Skill registry discovers global Skills from `skills/<skill>/SKILL.md` and Agent-local Skills from `agents/<agent>/skills/<skill>/SKILL.md`.
- For an Agent-specific context, all global Skills and that Agent's local Skills are currently visible.
- Studio can browse Agents/Skills and open files in the Workspace editor, but it cannot directly manage Skill enablement.

## Target Model

### Agent Files

- `AGENT.md` remains the registry and metadata entrypoint.
- `SOUL.md` becomes the Agent's durable identity/work-style prompt file.
- `notes.md` remains runtime/save-side sediment and is not promoted to a primary player editing concept.

Default Agent directories should look like:

```text
agents/<agent>/
  AGENT.md
  SOUL.md
  skills/
```

Save runtime keeps:

```text
save/agents/<agent>/notes.md
save/agents/<agent>/session.jsonl
```

### Runtime Context

- `AgentContextEntry` should expose an optional `soulFile`.
- Runtime prompt assembly includes `SOUL.md` after `AGENT.md` when available.
- Missing `SOUL.md` is not an error for existing cards.

### Skill Enablement

Recommended storage: per-Agent metadata in `AGENT.md`, not file movement.

Reasoning:

- File location should describe origin/installation location.
- Enablement is an Agent decision.
- Global official Skills can be enabled/disabled per Agent without copying or editing the official Skill file.
- Agent-local Skills can also be disabled without moving them out of the Agent directory.

Recommended fields:

```yaml
enabledSkills:
  - memory-maintenance
disabledSkills:
  - framework-knowledge
```

MVP interpretation:

- If `enabledSkills` is present and non-empty, only matching global/local Skills are enabled for that Agent.
- If `enabledSkills` is absent or empty, matching defaults are used:
  - global Skills with `appliesTo` include the Agent only when the Agent id/title is listed;
  - global Skills without `appliesTo` are enabled for all Agents;
  - Agent-local Skills under `agents/<agent>/skills/*` are enabled for that Agent.
- `disabledSkills` always removes matching Skills from the Agent-visible index.
- Matching should accept Skill `id`, `name`, `title`, or path-derived id.
- Existing `defaultSkills` remains compatibility input and can seed or be treated as enabled Skill ids, but Studio should write the new fields.

### Studio UI

Studio becomes Agent-centered:

- Left pane: Agent list.
- Right pane: selected Agent management.
- Suggested tabs/sections:
  - `AGENT.md`: edit entry metadata/body.
  - `SOUL.md`: edit soul prompt content.
  - `Skills`: list all recognizable global and selected-Agent-local Skills with enabled toggles.
  - `Tools`: reserved for tool availability management.
  - `权限`: reserved for permission level management.
  - `高级`: file paths and direct Workspace entrypoints.

UI labels for real files should use literal file names. Do not rename `notes.md` or `SOUL.md` to product aliases in a way that hides actual workspace paths.

## Data Flow

### Read

1. `getPlatformStudioSnapshot()` loads the active Game Card/effective workspace.
2. Registry helpers build Agent entries and Skill entries.
3. Studio selects an Agent and derives Skill enabled state from Agent metadata plus Skill metadata.
4. `getPlatformStudioAgentContext(agentId)` returns optional `soulFile` for previews/runtime-compatible detail reads.

### Write

- Editing `AGENT.md` or `SOUL.md` writes card content through platform-host resource-manager style APIs.
- Toggling Skill enablement updates selected Agent's `AGENT.md` frontmatter list fields.
- Writes refresh Studio from platform/storage APIs after mutation.

## Compatibility

- Existing cards without `SOUL.md` continue to use `AGENT.md` only.
- Existing `defaultSkills` remains readable.
- Existing global Skills remain discoverable.
- Existing Agent-local Skills remain discoverable.
- No Dexie schema migration is required because Game Card content files are already stored as path/content records.
- Built-in default card refresh may add new official `SOUL.md` card content for built-in cards.

## Deferred Tool And Permission Management

Real tool availability and permission enforcement is intentionally deferred to a follow-up task. This task should not add editable controls for tools or permissions unless those controls are backed by runtime behavior.
