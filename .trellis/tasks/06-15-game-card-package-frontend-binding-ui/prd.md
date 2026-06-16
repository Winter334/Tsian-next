# Game Card Package And Frontend Binding UI

## Goal

Expose Game Card package import/export and frontend-binding workflows in the platform UI.

## Parent

- `.trellis/tasks/06-15-platform-ui-development-phase`

## Requirements

- Let users import `.tsian-card.zip` packages through the browser UI.
- Let users export local Game Cards without Save Instance state.
- Show package validation errors clearly.
- Let users inspect or configure frontend binding state for a Game Card:
  - no frontend;
  - remote URL;
  - packaged entry.
- Keep `frontend.kind === "builtin"` unsupported.
- Do not require Tsian to build frontend source projects.
- Keep packaged frontend files as Game Card assets, not Save workspace files.

## Acceptance Criteria

- [ ] Import UI accepts valid `.tsian-card.zip` packages.
- [ ] Import UI reports malformed or unsafe packages without mutating unrelated data.
- [ ] Export UI produces a Game Card package without saves, history, checkpoints, traces, or player-mutated workspace.
- [ ] Remote frontend binding can be displayed and edited when scoped by this child design.
- [ ] Packaged frontend entry and stored frontend files are visible enough to debug load failures.
- [ ] `/play` can be reached from a card once a valid frontend binding exists.
- [ ] `npm run build:web` passes.
- [ ] `npm run build:contracts` passes if package contract shapes change.

## Dependencies

- `06-15-game-card-library-save-flow-ui` recommended first, so import/export has a clear library surface.
- Existing `game-card-packages.ts` and packaged frontend Service Worker path.

## Out Of Scope

- Online workshop/account backend.
- Moderation or upload service.
- Source-project build pipeline.
- Default packaged game frontend content.
