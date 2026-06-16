# My Apps And Game Card Launcher UI

## Goal

Build the first usable desktop-backed My Apps, App Market placeholder, Game Card launcher, and Save Instance management UI.

This child should follow the Tsian RetroOS direction: the desktop replaces the old lobby as the primary entry point, My Apps feels like an Explorer folder of installed Game Cards, the App Market reserves the future upload/download surface, the detail surface feels like a properties/launcher window, and save management feels like familiar save-slot operations.

## Parent

- `.trellis/tasks/06-15-platform-ui-development-phase`

## Requirements

- Show local installed Game Cards, including the built-in blank card, from a desktop `My Apps` entry.
- Remove the old lobby from the main UX; save creation and play entry now converge from each Game Card launcher.
- Add an `App Market` desktop entry as a placeholder for later player upload/download flows.
- Present Game Cards as installed applications in a dedicated RetroOS Explorer-style window.
- The My Apps window can borrow Explorer-like view structure: toolbar/menu actions, large-icon thumbnail grid, selection state, and status/footer information.
- Use large icons for the first slice; future icon-size/view-mode controls can be added later.
- Keep Game Card icons visually minimal: show the cover/fallback preview and title, with short summary only on hover/focus/selection.
- Do not show ids, versions, frontend status, authoring controls, or dense metadata directly on My Apps icons by default.
- Let users open a Game Card detail page from My Apps.
- Make the Game Card detail page player-first and the convergence point for full editing and management sections, presented as a RetroOS properties/launcher window.
- On the detail first screen, use a poster-like layout: the left side is dominated by the cover image, with title, full untruncated description, author, and card information overlaid near the lower area; the right side is Save Instance management.
- Add local detail-page navigation for save management and later Workspace Studio, frontend binding, Agent/Skill, and diagnostics sections. Tabs/property sheets are preferred because they match the RetroOS metaphor.
- Treat Workspace as a folder-like tab reachable from the launcher: the launcher owns play/save/config decisions, while workspace files should feel like opening the Game Card root directory.
- Show whether each Game Card has no frontend, a remote frontend, or a packaged frontend.
- Show Save Instances and their source Game Card when available.
- Let users create a Save Instance from a selected Game Card.
- Let users select, enter, and delete Save Instances.
- Save Instance management should feel like classic save slots: explicit slot rows, last-used/created metadata where available, continue/open actions, create-new-slot action, and confirmation before delete.
- Make frontend-less cards explicit: they can seed workspace content but cannot provide a playable `/play` experience yet.
- Keep checkpoint and runtime play data as Save Instance internals, not top-level card objects.
- Avoid implying that Save Instances own copied Agent/Skill/schema content if the card-owned content model is approved.
- Do not implement import/export package UI in this child unless needed as a stub entry point.
- Use `GameCardManifest.summary`, `description`, `author`, and `cover` when available, with graceful fallback for cards such as the built-in blank card.
- Use RetroOS styling as interaction structure, not as a blocker: first implementation should not require draggable overlapping windows.

## Acceptance Criteria

- [ ] Users can see local installed Game Cards from the desktop `My Apps` application.
- [ ] Old lobby navigation is removed from the main desktop and route table.
- [ ] `App Market` exists as a RetroOS desktop application placeholder for future upload/download flows.
- [ ] My Apps is presented as a RetroOS Explorer-style window rather than a generic SaaS page.
- [ ] My Apps uses a large-icon view for Game Cards.
- [ ] Hover/focus/selected icon states reveal truncated summary on the cover preview.
- [ ] Users can open a Game Card detail page from a card.
- [ ] Game Card detail is presented as a RetroOS-style properties/launcher window with local tabs or equivalent property-sheet navigation.
- [ ] Game Card detail first screen shows a poster-style left panel with full description and author information when available.
- [ ] Game Card detail first screen shows Save Instance management on the right side.
- [ ] Game Card detail includes local navigation entries or placeholders for Workspace, frontend binding, Agent/Skill, and diagnostics integrations.
- [ ] Workspace is represented as a folder-like launcher tab, not only as hidden save internals.
- [ ] Users can see the Save Instance list scoped clearly enough to avoid confusing saves with reusable Game Cards.
- [ ] Save Instance controls use explicit save-slot language and confirmation patterns.
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
- Desktop shell links to My Apps and App Market, but this child should remain usable through direct routes.
- Deep Workspace/Agent/Skill editing depends on the card-owned content plus save-owned runtime data model decision.
- Parent UI direction now prefers Tsian RetroOS and classic Windows-inspired UX patterns.

## Out Of Scope

- `.tsian-card.zip` import/export.
- Full Workspace file editor.
- Agent/Skill editor.
- Default packaged game frontend.
