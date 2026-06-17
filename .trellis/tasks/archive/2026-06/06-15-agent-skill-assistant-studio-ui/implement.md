# Agent Skill And Assistant Studio UI Implementation Plan

## Checklist

1. Add active Game Card platform state.
   - Store one active Game Card id in local metadata.
   - Initialize it from existing saves or built-in blank card when missing.
   - Export `getPlatformActiveGameCardId`, `setPlatformActiveGameCard`, and active-card-aware helpers from platform-host.
   - Ensure create/select save also updates the active card.

2. Add Studio data helpers.
   - Build registries from active Game Card content when no active save exists.
   - Use effective workspace only when active save belongs to the active Game Card.
   - Provide UI-friendly helpers for roles, abilities, assistant availability, and detail lookup.

3. Add desktop app and route.
   - Add a `studio` route.
   - Add desktop launcher/window definition for "工作室".
   - Keep window dimensions similar to resource-management surfaces.

4. Implement lightweight Studio view.
   - Empty state: no loaded card -> guide to game-card loader/library.
   - Overview: current card title, assistant availability, role/ability counts.
   - Roles list: player-readable Agent summaries, not raw file dumps.
   - Abilities list: player-readable Skill summaries with secondary scope hint.
   - Detail panel: selected role/ability, missing paths/resources, and links to Workspace Explorer/Editor.

5. Wire existing Game Card surfaces.
   - Opening a Game Card detail should set the current Game Card.
   - Existing Agent placeholder tab should point to/open Studio or use the new Studio surface.
   - Do not add another card picker inside Studio.

6. Validate.
   - Run `npm run build:web`.
   - Browser smoke manually or with Playwright if useful:
     - open desktop
     - load/open a Game Card
     - open Studio
     - inspect role and ability empty/non-empty states
     - verify no save is required for registry display

## Risky Files

- `apps/platform-web/src/platform-host/index.ts`
- `apps/platform-web/src/storage/game-cards.ts`
- `apps/platform-web/src/views/GameCardDetailView.vue`
- `apps/platform-web/src/desktop-apps.ts`
- `apps/platform-web/src/router/index.ts`

## Review Gates

- Active save and active card must not silently drift into invalid runtime workspace composition.
- Studio should remain moderate-density and avoid raw registry/path-heavy first screen.
- Assistant chat must remain out of scope.
