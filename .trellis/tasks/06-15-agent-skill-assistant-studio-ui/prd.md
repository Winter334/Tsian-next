# Agent Skill And Assistant Studio UI

## Goal

Build a lightweight Studio UI for Game Card-defined Agents and Skills, with Assistant discovery kept separate from the eventual desktop chat application.

## Parent

- `.trellis/tasks/06-15-platform-ui-development-phase`

## Current Alignment

Keep this task, but avoid turning it into an Agent/Skill IDE. The player-facing shape should be an understandable Game Card Studio surface that explains "roles" and "abilities" for the currently loaded Game Card with moderate information density.

The Assistant itself should become a desktop chat application later. It is still bound to the currently loaded Game Card, but it should not live as a dense panel inside this Studio UI. This task may show whether a Game Card provides an assistant and where it is configured, but the full assistant conversation UX is out of scope.

Use the current Game Card detail / desktop-window model and reuse `agent-registry`, `agent-context`, `skill-registry`, and `skill-detail`. Route edit affordances through Runtime Workspace Studio or the same generic workspace operations rather than inventing a separate editor stack.

## Requirements

- Treat the active target as the currently loaded Game Card; do not add another card picker inside this Studio surface.
- Provide the minimal platform state/API needed for one currently loaded Game Card, separate from the active Save Instance.
- Show Agent registry entries from the current Game Card content using player-friendly "role" language.
- Show selected Agent context from the effective runtime view, combining card-owned definitions with save runtime data when a Save Instance is selected.
- Show Skill registry entries from the current Game Card content using player-friendly "ability" language.
- Keep shared/local/agent-local distinctions available without making them the first thing players must understand.
- Load selected Skill details and resource indexes through `skill-detail` after selection.
- Surface whether the Game Card provides an Assistant, but leave the chat interface to a separate desktop Assistant app.
- Treat Agents and Skills as Game Card content, not hidden platform personas and not ordinary save data.
- Avoid exposing full Skill bodies, raw paths, or registry internals by default.
- Provide edit entry points that either use Runtime Workspace Studio behavior or link to it.
- Prefer an overview plus simple detail panel/drawer over a multi-pane control-console layout.

## Acceptance Criteria

- [ ] Agent/role registry appears for the currently loaded Game Card, even before a Save Instance is created when the foundation supports card-owned content reads.
- [ ] The platform can remember one currently loaded Game Card independent of active save selection.
- [ ] The Studio surface does not require selecting a Game Card again after one is loaded.
- [ ] Assistant availability is discoverable when the current Game Card provides it, without implementing the chat UI in this task.
- [ ] Agent context view uses `agent-context` and shows missing paths without crashing.
- [ ] Skill/ability registry view uses lightweight, player-readable entries.
- [ ] Skill detail view loads only after selection.
- [ ] Skill resource index does not include resource file contents by default.
- [ ] Raw paths and scope labels are secondary or advanced details, not primary overview content.
- [ ] `npm run build:web` passes.
- [ ] Browser smoke covers registry/detail selection and empty states.

## Dependencies

- Runtime Workspace Studio UI recommended before or alongside edit flows.
- Requires a resolved foundation design for card-owned Agent/Skill content plus save-owned runtime data.
- Existing registry/detail/context contracts currently read from save workspace files and will need adjustment or an effective-workspace adapter.
- Current-loaded-Game-Card desktop context should exist before removing all local card-selection fallbacks from implementation.

## Out Of Scope

- Autonomous assistant edits.
- Full assistant chat product; that should be a separate desktop Assistant app bound to the currently loaded Game Card.
- Designing final default Agent teams.
- New Skill execution capabilities.
- Multi-card simultaneous loading or per-app card selection.
