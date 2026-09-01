# My Apps And Game Card Launcher UI Implementation Plan

## Scope

Implement the first desktop-backed Tsian RetroOS My Apps, App Market placeholder, and Game Card Detail flow:

`/market`, `/library -> /cards/:cardId -> /play`

The implementation should remove the old lobby entry, make installed Game Cards browseable as desktop applications, make saves manageable from a selected card launcher, represent Workspace as a folder-like launcher tab, and establish reusable RetroOS chrome without building a real multi-window desktop.

## Pre-Development Checks

- Read `.trellis/spec/guides/index.md`.
- Read `.trellis/spec/platform-web/frontend/index.md` and linked docs before editing `apps/platform-web`.
- Inspect existing route/view/component/storage patterns.
- Confirm `platform-host` exports still cover:
  - `listPlatformGameCards`
  - `getPlatformGameCard`
  - `listPlatformSaves`
  - `createPlatformSaveFromGameCard`
  - `selectPlatformSave`
  - `deletePlatformSave`
  - `getPlatformActiveSaveId`

## Implementation Checklist

1. Route skeleton
   - Add `/market` route for the App Market placeholder.
   - Add `/library` route for the My Apps view.
   - Add `/cards/:cardId` route for the Game Card Detail view.
   - Keep `/play` unchanged and outside any platform window chrome.
   - Preserve existing `/`, `/settings`, and `/debug` routes.
   - Remove `/lobby` route from the active route table.

2. RetroOS shared surface
   - Add the smallest useful shared component or CSS layer for route-backed RetroOS windows:
     - window frame;
     - title bar;
     - toolbar/menu row;
     - inset content pane;
     - status bar;
     - raised/inset buttons or utility classes.
   - Keep it practical and local to platform UI. Do not build draggable windows, z-index management, or a desktop compositor.

3. Desktop entries and App Market
   - Desktop icons should include App Market and My Apps instead of Runtime Lobby.
   - App Market is a placeholder window for future player upload/download Game Card flows.
   - App Market should link installed-card browsing back to My Apps.

4. My Apps view
   - Load cards through `listPlatformGameCards()`.
   - Render a RetroOS-style Explorer window with toolbar area, large-icon cover grid, and status footer.
   - Card icon resting state shows cover/fallback preview plus title.
   - Hover/focus/selected state reveals truncated summary overlay.
   - Open `/cards/:cardId` on click/keyboard activation.
   - Provide loading, error, and empty states.
   - Avoid dense metadata on icons.

5. Game Card Detail view
   - Load selected card through `getPlatformGameCard(cardId)`.
   - Load all saves through `listPlatformSaves()` and filter by `save.gameCardId === card.manifest.id`.
   - Load active save id through `getPlatformActiveSaveId()`.
   - Render a RetroOS properties/launcher window.
   - First screen:
     - left poster pane with cover/fallback, title, full description, author, and minimal card facts;
     - right save-slot pane with recent/active save, save list, create, continue/open, delete.
   - Add local tabs or property-sheet navigation for `Overview`, `Saves`, `Workspace`, `Frontend`, `Agents`, and `Diagnostics`.
   - Add an Overview affordance that opens the Workspace tab as a folder.
   - Workspace tab should show folder-level roots for card-owned content, save runtime data, and `.tsian` metadata.
   - Placeholder tabs should be honest and low-noise if included.

6. Save-slot actions
   - Create a save with `createPlatformSaveFromGameCard(cardId, { name })`.
   - Select a save with `selectPlatformSave(saveId)`.
   - Continue/play by selecting the save and routing to `/play`, only when the card has a frontend binding.
   - If no frontend is configured, disable play/continue and show a not-playable-yet explanation.
   - Delete a save with `deletePlatformSave(saveId)` after explicit confirmation that names the save and clarifies the Game Card is not deleted.
   - Refresh cards/saves/active id after mutating actions.

7. Fallback content and formatting
   - Use `GameCardManifest.name`, `summary`, `description`, `author`, and `cover` when available.
   - Provide a cover fallback for the built-in blank card and cards without cover.
   - Format timestamps consistently and compactly.
   - Keep visible labels product-facing and avoid ids unless needed in errors/debug states.

8. Accessibility and responsive layout
   - Keyboard activation works for cards and save actions.
   - Focus states are visible in the RetroOS style.
   - Narrow viewport stacks the poster and save panes cleanly.
   - Text does not overflow title bars, buttons, tabs, cards, or save rows.

9. Documentation follow-through
   - If implementation establishes reusable RetroOS component conventions, update the relevant platform frontend spec or active docs.
   - If implementation changes storage/platform contracts, update child design/PRD and run contract validation as needed.

## Validation

- `npm run build:web`
- Browser smoke, desktop viewport:
  - verify desktop shows App Market and My Apps, with no Runtime Lobby entry;
  - open `/market` and navigate to My Apps;
  - open `/library`;
  - verify My Apps window renders large Game Card icons;
  - open a card detail page;
  - open the Workspace tab from the launcher;
  - create a save;
  - select/continue a save;
  - verify frontend-less cards communicate not playable instead of failing silently;
  - delete a save through confirmation.
- Browser smoke, narrow viewport:
  - `/library` grid remains usable;
  - `/cards/:cardId` stacks poster and save-slot panels without overlap.

## Risk And Rollback Points

- Route changes are low risk; rollback by removing new routes and views.
- RetroOS shared CSS/components may affect existing surfaces if global selectors are broad. Keep selectors scoped or class-based.
- Save delete is destructive. Use the existing `deletePlatformSave` helper and require confirmation.
- `/play` behavior must remain unchanged for frontend-less cards; the new UI should prevent accidental navigation where possible.
- Do not duplicate Dexie access in Vue components. If a missing helper becomes necessary, add it in storage/platform-host with a narrow contract.

## Deferred

- True draggable overlapping windows.
- Start menu implementation.
- Import/export package UI.
- Workspace file editor.
- Agent/Skill editor.
- Default packaged game frontend.
