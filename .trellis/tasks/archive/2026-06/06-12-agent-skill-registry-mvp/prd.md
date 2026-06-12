# AGENT.md/SKILL.md Registry MVP

## Goal

Introduce the first registry layer for workspace-defined agents and skills.

The platform should be able to scan the active save Runtime Workspace, recognize `AGENT.md` and `SKILL.md` files, extract lightweight registry metadata, and expose that registry through bridge queries. This creates the foundation for configurable agent teams and progressive skill loading without changing the current fixed `master-agent -> narrative-agent` runtime flow yet.

## Confirmed Facts

- Runtime Workspace storage/API MVP is already implemented.
- Workspace files are save-scoped text files stored in Dexie and exposed through `workspace-list`, `workspace-read`, `workspace-search`, `workspace-write`, and `workspace-delete`.
- New saves currently initialize top-level workspace README files but do not yet create `agents/master/AGENT.md`, `agents/narrative/AGENT.md`, or any `SKILL.md`.
- Direction docs define:
  - agents as workspace participants described by `agents/<agent>/AGENT.md`;
  - shared skills as `skills/<skill>/SKILL.md`;
  - agent-local skills as `agents/<agent>/skills/<skill>/SKILL.md`;
  - always-visible skill index metadata as id/title/summary/triggers/applicability;
  - skill details/actions/scripts as on-demand content, not registry content.
- Existing Codex/Trellis skills use Markdown with YAML frontmatter containing `name` and `description`; Tsian can begin with a compatible Markdown + frontmatter convention.
- Current Agent Runtime still uses fixed in-code prompts and two model calls in `apps/platform-web/src/agent-runtime/index.ts`.

## Requirements

- Add default `AGENT.md` files for new saves:
  - `agents/master/AGENT.md`;
  - `agents/master/notes.md`;
  - `agents/master/session.jsonl`;
  - `agents/narrative/AGENT.md`;
  - `agents/narrative/notes.md`;
  - `agents/narrative/session.jsonl`.
- Define a lightweight AGENT metadata convention based on Markdown frontmatter:
  - `id`;
  - `title` or `name`;
  - `summary` or `description`;
  - `contacts`;
  - `defaultSkills`;
  - `contextPaths`.
- Define a lightweight SKILL metadata convention based on Markdown frontmatter:
  - `id` or `name`;
  - `title`;
  - `summary` or `description`;
  - `triggers`;
  - `appliesTo` / `applicability`.
- Build agent registry entries from `agents/*/AGENT.md`.
- Build skill registry entries from:
  - shared `skills/*/SKILL.md`;
  - agent-local `agents/<agent>/skills/*/SKILL.md`.
- Expose registry data through bridge queries:
  - `agent-registry`;
  - `skill-registry`.
- The skill registry must expose only lightweight index metadata and file path. It must not expose actions, scripts, schemas, examples, or full skill instructions.
- Registry parsing should be tolerant:
  - if frontmatter is missing or partial, infer id/title from path or first Markdown heading where possible;
  - malformed files should not break the whole registry;
  - invalid entries should either be skipped or returned with safe fallbacks.
- Keep existing Runtime Workspace, checkpoint, save, message sending, AI debug, stateRecords, and current agent runtime behavior working.

## Acceptance Criteria

- [ ] Creating a new save initializes default `agents/master/AGENT.md` and `agents/narrative/AGENT.md`.
- [ ] `agent-registry` returns default master and narrative entries for a new save.
- [ ] `skill-registry` returns shared and agent-local skill index entries when matching `SKILL.md` files exist in workspace.
- [ ] Registry entries include path, id, title/name, summary/description, updated timestamp, and relevant relationship fields.
- [ ] Skill registry entries expose triggers/applicability but not actions or full instruction content.
- [ ] Missing or partial frontmatter does not crash registry queries.
- [ ] Current `interaction.sendMessage` behavior remains unchanged and continues to use the fixed MVP runtime flow.
- [ ] Contract changes build with `npm run build:contracts`.
- [ ] Platform web changes build with `npm run build:web`.

## Out Of Scope

- Loading full skill details into agent context.
- Parsing or exposing skill actions, schemas, examples, scripts, or references.
- Implementing `agent.call`.
- Implementing an action executor registry.
- Replacing the current `master-agent -> narrative-agent` runtime chain with workspace-defined agents.
- UI for viewing or editing registry entries.
- Strict YAML compatibility or a full YAML parser dependency.
- Platform validation of ordinary agent outputs.

## Planning Status

- No open product decision is currently blocking implementation.
- The MVP should use simple frontmatter-compatible metadata extraction and path-based fallbacks.

