# Game Card Package And Frontend Binding UI

## Goal

Expose Game Card package import/export and frontend-binding workflows in the platform UI.

## Parent

- `.trellis/tasks/06-15-platform-ui-development-phase`

## Current Alignment

Keep this task. It is not affected by the RetroOS shell pivot because the core goal is package import/export and frontend binding. Implement it inside the current desktop shell: App Market should own package import/export entry points, and the Game Card detail `Frontend` tab should own per-card remote/packaged binding inspection and editing.

Do not split this into a standalone desktop app for the first version. The UX should stay close to the user's current management context:

- App Market / My Apps handles local `.tsian-card.zip` installation/import.
- Game Card Detail handles exporting the currently selected card.
- Game Card Detail > Frontend handles per-card frontend status and binding edits.
- A heavier Package Manager app is deferred until there is a real need for batch install, install history, queues, or repository management.

## Requirements

- Let users import `.tsian-card.zip` packages through the browser UI.
- Keep local package import discoverable from the App Market and My Apps surfaces.
- Let users export local Game Cards without Save Instance state.
- Keep per-card export on the Game Card Detail surface, not as a global package-manager flow.
- Show package validation errors clearly.
- Let users inspect or configure frontend binding state for a Game Card:
  - no frontend;
  - remote URL;
  - packaged entry.
- Let users clear a frontend binding when they need to return a card to a non-playable content/template state.
- Show stored packaged frontend files from the selected Game Card so missing-entry and load failures can be diagnosed.
- Let users open `/play` from the card detail once a valid frontend binding exists.
- Keep `frontend.kind === "builtin"` unsupported.
- Do not require Tsian to build frontend source projects.
- Keep packaged frontend files as Game Card assets, not Save workspace files.

## Acceptance Criteria

- [x] Import UI accepts valid `.tsian-card.zip` packages.
- [x] Import UI reports malformed or unsafe packages without mutating unrelated data.
- [x] Export UI produces a Game Card package without saves, history, checkpoints, traces, or player-mutated workspace.
- [x] Remote frontend binding can be displayed and edited when scoped by this child design.
- [x] Packaged frontend entry and stored frontend files are visible enough to debug load failures.
- [x] Frontend binding can be cleared without deleting card content, saves, or packaged frontend files.
- [x] `/play` can be reached from a card once a valid frontend binding exists.
- [x] `npm run build:web` passes.
- [x] `npm run build:contracts` passes if package contract shapes change.

## Dependencies

- `06-15-game-card-library-save-flow-ui` recommended first, so import/export has a clear library surface.
- Existing `game-card-packages.ts` and packaged frontend Service Worker path.
- Existing `importPlatformGameCardPackage` and `exportPlatformGameCardPackage` platform-host functions.
- Existing Game Card Detail `frontend` placeholder tab.

## Out Of Scope

- Online workshop/account backend.
- Moderation or upload service.
- Source-project build pipeline.
- Default packaged game frontend content.
- Batch package installation, installation history, upload queues, and a standalone Package Manager desktop app.
