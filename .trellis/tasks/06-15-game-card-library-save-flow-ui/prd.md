# Game Card Library And Save Flow UI

## Goal

Build the first usable Game Card Library, Game Card detail, and Save Instance management UI.

## Parent

- `.trellis/tasks/06-15-platform-ui-development-phase`

## Requirements

- Show local Game Cards, including the built-in blank card.
- Present Game Cards as browsable cards in a dedicated library surface.
- Keep library cards visually minimal: normally show only the cover image or cover fallback.
- On hover/focus/selection, show an overlay on the cover with card name and short summary; overlay text may be truncated.
- Do not show ids, versions, frontend status, authoring controls, or dense metadata directly on library cards by default.
- Let users open a Game Card detail page from the library.
- Make the Game Card detail page player-first and the convergence point for full editing and management sections.
- On the detail first screen, use a poster-like layout: the left side is dominated by the cover image, with title, full untruncated description, author, and card information overlaid near the lower area; the right side is Save Instance management.
- Add local detail-page navigation for save management and later Workspace Studio, frontend binding, Agent/Skill, and diagnostics sections.
- Show whether each Game Card has no frontend, a remote frontend, or a packaged frontend.
- Show Save Instances and their source Game Card when available.
- Let users create a Save Instance from a selected Game Card.
- Let users select, enter, and delete Save Instances.
- Make frontend-less cards explicit: they can seed workspace content but cannot provide a playable `/play` experience yet.
- Keep checkpoint and runtime play data as Save Instance internals, not top-level card objects.
- Avoid implying that Save Instances own copied Agent/Skill/schema content if the card-owned content model is approved.
- Do not implement import/export package UI in this child unless needed as a stub entry point.
- Use `GameCardManifest.summary`, `description`, `author`, and `cover` when available, with graceful fallback for cards such as the built-in blank card.

## Acceptance Criteria

- [ ] Users can see the local Game Card library as cards.
- [ ] Library cards show only cover/fallback art in their resting state.
- [ ] Hover/focus/selected card states reveal card name and truncated summary on the cover.
- [ ] Users can open a Game Card detail page from a card.
- [ ] Game Card detail first screen shows a poster-style left panel with full description and author information when available.
- [ ] Game Card detail first screen shows Save Instance management on the right side.
- [ ] Game Card detail includes local navigation entries or placeholders for later Workspace Studio, frontend binding, Agent/Skill, and diagnostics integrations.
- [ ] Users can see the Save Instance list scoped clearly enough to avoid confusing saves with reusable Game Cards.
- [ ] Users can create a save from a chosen Game Card.
- [ ] Users can select an existing save and enter `/play`.
- [ ] Frontend-less cards show a clear not-playable-yet state.
- [ ] Save delete flow remains explicit and does not delete reusable Game Cards.
- [ ] Existing storage helpers are reused rather than duplicating Dexie access in components.
- [ ] `npm run build:web` passes.
- [ ] Browser smoke covers create/select/delete and `/play` missing-frontend behavior.

## Dependencies

- Existing Game Card and Save Instance storage helpers.
- Existing `/play` missing frontend error after builtin frontend removal.
- Home navigation hub can link to the library, but this child should remain usable through direct routes.
- Deep Workspace/Agent/Skill editing depends on the card-owned content plus save-owned runtime data model decision.

## Out Of Scope

- `.tsian-card.zip` import/export.
- Workspace file editor.
- Agent/Skill editor.
- Default packaged game frontend.
