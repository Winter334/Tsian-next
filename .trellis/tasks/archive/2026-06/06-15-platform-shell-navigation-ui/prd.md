# Platform Home Navigation UI

## Resolution

Superseded by `.trellis/tasks/archive/2026-06/06-16-retroos-multi-window-desktop-shell`.

This task was created for the earlier home-navigation-hub direction. The product direction has since moved to a real RetroOS multi-window desktop shell with desktop icons, application windows, taskbar entries, focus/minimize/close behavior, and `/play` as a desktop application window. That archived task now owns the shell/navigation foundation.

Do not continue this task as an implementation target. Remaining shell polish should be tracked as narrow follow-up work, for example start-menu behavior, account/profile placement, status bar refinements, empty-state copy, or deep-link/window focus fixes.

## Goal

Establish the platform home navigation hub and page-level wayfinding for the UI phase.

## Parent

- `.trellis/tasks/06-15-platform-ui-development-phase`

## Requirements

- Replace the current prototype shell wording and session lobby with UI-phase product vocabulary.
- Make `/` a visually memorable home screen that doubles as the primary navigation hub.
- Avoid a traditional persistent sidebar/topbar as the primary navigation model.
- Provide home actions for start game, continue game, Game Card library, settings, diagnostics, and future account/profile placement.
- Keep `/play` outside the platform shell so game frontends remain unframed.
- Add or reorganize platform routes only when they map to real child surfaces.
- Surface active Game Card, active Save Instance, storage status, and AI config status in a compact way.
- Provide coherent empty states for no cards, no saves, no frontend, and no AI config.
- Allow the home screen to be more cinematic than management pages while staying functional.
- Provide page-level return/breadcrumb/context actions for deeper pages so they do not depend on a global nav bar.
- Use existing UI primitives under `components/ui/`.

## Acceptance Criteria

- [ ] Home screen presents Tsian identity, quick actions, and route entry points without requiring a traditional persistent nav bar.
- [ ] Start/continue actions communicate why they are available or unavailable.
- [ ] Game Card library, settings, and diagnostics are reachable from the home screen.
- [ ] Deeper platform pages include clear wayfinding back to home or parent surfaces.
- [ ] Route structure clearly distinguishes platform management views from `/play`.
- [ ] Active context summary shows enough card/save/status information to orient the user.
- [ ] Empty states route users to the next useful action.
- [ ] Existing lobby/settings/debug/play routes still load.
- [ ] `npm run build:web` passes.
- [ ] Browser smoke verifies desktop and narrow viewport layout do not overlap.

## Dependencies

- Parent UI roadmap.
- May be easier after `06-15-game-card-library-save-flow-ui` establishes concrete card/save UI context.

## Out Of Scope

- Implementing full Game Card library behavior.
- Workspace file editor.
- Agent/Skill authoring.
- Default game frontend.
