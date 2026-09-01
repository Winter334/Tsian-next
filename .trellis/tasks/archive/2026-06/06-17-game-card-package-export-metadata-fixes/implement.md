# Implementation Plan

## Checklist

- [x] Fix built-in blank refresh so frontend bindings survive.
- [x] Include the default cover asset in `apps/platform-web/public/`.
- [x] Export bundled cover files when a cover can be resolved locally.
- [x] Import bundled cover files into card-owned `.cover/` content and update manifest cover metadata.
- [x] Add storage/platform-host helpers for metadata updates and local card copy.
- [x] Add a compact metadata panel to Game Card Detail Overview.
- [x] Inspect the provided exported package and identify missing cover / built-in id problems.
- [ ] Browser-smoke a fresh export/import after fixes.
- [x] Run `npm run build:web`.

## Likely Files

- `apps/platform-web/src/storage/game-cards.ts`
- `apps/platform-web/src/storage/game-card-packages.ts`
- `apps/platform-web/src/platform-host/index.ts`
- `apps/platform-web/src/views/GameCardDetailView.vue`
- `apps/platform-web/public/default-card-cover.webp`

## Validation

- Required: `npm run build:web`
- Inspect package entries with `fflate` because `unzip` is unavailable in this environment.
- Browser-level import/export smoke can be manual if the user wants to test in the running app.
