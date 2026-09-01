# Skill 按需加载 MVP

## Goal

Implement the first on-demand detail-loading layer for workspace-defined skills.

After the registry MVP, the platform can answer which skills exist and where their `SKILL.md` files live. This task should let callers take a selected registry entry and load the skill's detailed instructions without putting all skill bodies into the always-visible registry.

This creates the second half of progressive disclosure:

1. `skill-registry` exposes lightweight summary/triggers/applicability.
2. A new detail-loading query loads the chosen skill's `SKILL.md` content and enough resource metadata for the agent/runtime to decide what to read next.

## Confirmed Facts

- Runtime Workspace storage/API exists and exposes save-scoped virtual files.
- `workspace-read` can already read any single workspace file by path.
- `agent-registry` and `skill-registry` exist.
- `SkillRegistryEntry` includes `id`, `title`, `summary`, `path`, `scope`, optional `agentId`, `triggers`, `appliesTo`, and `updatedAt`.
- Shared skills live at `skills/<skill>/SKILL.md`.
- Agent-local skills live at `agents/<agent>/skills/<skill>/SKILL.md`.
- Current registry intentionally does not expose full skill content, actions, schemas, examples, scripts, or references.
- Direction docs say skills must use progressive disclosure: metadata first, then selected skill details, then bundled resources as needed.
- Existing Codex-style skills treat `SKILL.md` as the entry file and keep references/scripts as optional bundled resources loaded or executed only when needed.
- Current runtime execution remains fixed `master-agent -> narrative-agent`; this task should not migrate runtime execution yet.
- Product decision: `skill-detail` should load only the selected `SKILL.md` content by default and return bundled resources as an index, not as full file contents. This follows mainstream agent progressive disclosure patterns and avoids reintroducing prompt bloat.

## Requirements

- Add shared contract shapes for a loaded skill detail response if needed by bridge consumers.
- Add a pure detail-loading helper near the registry parser that:
  - accepts workspace files and a skill selector;
  - recognizes only valid shared and agent-local skill paths;
  - returns the selected skill's registry metadata;
  - returns the selected `SKILL.md` file content;
  - returns a lightweight index of files under the skill directory, excluding `SKILL.md`.
- Expose a bridge query, tentatively `skill-detail`, that:
  - requires an active save;
  - accepts `path` from a `SkillRegistryEntry` as the primary selector;
  - returns zero or one loaded skill detail item;
  - returns empty `items` when no active save exists, the path is invalid, or the skill file does not exist.
- Keep the default behavior narrow:
  - `skill-registry` remains lightweight and unchanged;
  - `skill-detail` loads the selected `SKILL.md` content;
  - resource files are indexed but not loaded by default.
- Preserve current `interaction.sendMessage` behavior and the fixed MVP runtime flow.
- Keep ordinary skill instructions as a soft protocol; do not validate arbitrary skill prose.
- Do not execute actions, scripts, remote code, browser JavaScript, or HTTP calls in this task.
- Do not parse or validate action schemas in this task.
- Do not add UI in this task.

## Acceptance Criteria

- [ ] A valid shared skill path such as `skills/example/SKILL.md` can be loaded through `skill-detail`.
- [ ] A valid agent-local skill path such as `agents/narrative/skills/style/SKILL.md` can be loaded through `skill-detail`.
- [ ] The loaded detail includes registry metadata and the full selected `SKILL.md` workspace file content.
- [ ] The loaded detail includes a lightweight resource index for sibling files under the skill directory.
- [ ] `skill-detail` does not return sibling file contents by default.
- [ ] Invalid paths, missing skill files, non-skill paths, and missing active saves return empty results rather than crashing.
- [ ] `skill-registry` remains unchanged and still does not expose full skill instructions.
- [ ] Current `interaction.sendMessage` behavior remains unchanged.
- [ ] Contract changes build with `npm run build:contracts`.
- [ ] Platform web changes build with `npm run build:web`.

## Out Of Scope

- Loading skill details into live agent prompts.
- Agent deciding which skill to load during `interaction.sendMessage`.
- Replacing hard-coded master/narrative prompts with workspace-defined `AGENT.md`.
- Executing skill actions.
- Parsing action definitions or schemas into callable tools.
- Loading all references/examples/actions/scripts content automatically by default.
- A dedicated UI for inspecting loaded skill details.
- Strict YAML compatibility or a new YAML parser dependency.

## Planning Status

- The default loading scope is decided: `skill-detail` returns `SKILL.md` content plus a resource index only.
- No open product decision is currently blocking technical design.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
