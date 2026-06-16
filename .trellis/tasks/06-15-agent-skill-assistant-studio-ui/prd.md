# Agent Skill And Assistant Studio UI

## Goal

Build management UI for Game Card-defined Agents, Skills, Skill details, and the Studio Assistant entrypoint.

## Parent

- `.trellis/tasks/06-15-platform-ui-development-phase`

## Requirements

- Show Agent registry entries from the selected Game Card content.
- Show selected Agent context from the effective runtime view, combining card-owned definitions with save runtime data when a Save Instance is selected.
- Show Skill registry entries with shared/local/agent-local distinctions from the selected Game Card content.
- Load selected Skill details and resource indexes through `skill-detail`.
- Surface the Game Card assistant entrypoint when present.
- Treat Agents and Skills as Game Card content, not hidden platform personas and not ordinary save data.
- Avoid exposing full Skill bodies through lightweight registry views.
- Provide edit entry points that either use Runtime Workspace Studio behavior or link to it.

## Acceptance Criteria

- [ ] Agent registry appears for a selected Game Card, even before a Save Instance is created when the foundation supports card-owned content reads.
- [ ] Studio Assistant is discoverable when the selected Game Card provides it.
- [ ] Agent context view uses `agent-context` and shows missing paths without crashing.
- [ ] Skill registry view uses lightweight entries.
- [ ] Skill detail view loads only after selection.
- [ ] Skill resource index does not include resource file contents by default.
- [ ] `npm run build:web` passes.
- [ ] Browser smoke covers registry/detail selection and empty states.

## Dependencies

- Runtime Workspace Studio UI recommended before or alongside edit flows.
- Requires a resolved foundation design for card-owned Agent/Skill content plus save-owned runtime data.
- Existing registry/detail/context contracts currently read from save workspace files and will need adjustment or an effective-workspace adapter.

## Out Of Scope

- Autonomous assistant edits.
- Full assistant chat product.
- Designing final default Agent teams.
- New Skill execution capabilities.
