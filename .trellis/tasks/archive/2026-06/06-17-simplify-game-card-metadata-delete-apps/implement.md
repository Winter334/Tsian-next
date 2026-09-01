# Implementation Plan

## Checklist

- [x] Remove `description` from `GameCardManifest`.
- [x] Normalize legacy `description` into `summary` on import/storage read-write paths.
- [x] Strip `description` from exported manifests.
- [x] Simplify Game Card Detail metadata UI to name + intro only.
- [x] Auto-generate unique local copy ids in platform-host.
- [x] Add storage/platform-host delete Game Card helpers.
- [x] Add delete app entry in Game Card Detail and My Apps.
- [x] Run `npm run build:contracts`.
- [x] Run `npm run build:web`.

## Likely Files

- `packages/contracts/src/game-card.ts`
- `apps/platform-web/src/storage/game-cards.ts`
- `apps/platform-web/src/storage/game-card-packages.ts`
- `apps/platform-web/src/platform-host/index.ts`
- `apps/platform-web/src/lib/game-card-display.ts`
- `apps/platform-web/src/views/GameCardDetailView.vue`
- `apps/platform-web/src/views/GameCardLibraryView.vue`

## Validation Notes

- Manual browser smoke should cover:
  - imported/local card delete;
  - built-in card delete blocked;
  - local copy creation without visible id;
  - legacy package import if an old package is available.
