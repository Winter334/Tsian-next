# Implementation Plan

## Checklist

- [x] Add platform-host helpers for frontend binding updates and packaged frontend file summaries.
- [x] Add import controls to App Market and My Apps using the existing package importer.
- [x] Add export action to Game Card Detail and download the generated package blob.
- [x] Replace the Game Card Detail Frontend placeholder with a property-panel style editor.
- [x] Keep launch to `/play` disabled until the card has a valid remote or packaged frontend binding.
- [x] Surface package and binding errors inline in the relevant window content/status area.
- [x] Run `npm run build:web`.
- [ ] Run focused manual/browser smoke for import error handling, remote binding save, clear binding, export download, and `/play` launch affordance.

## Files Likely To Change

- `apps/platform-web/src/platform-host/index.ts`
- `apps/platform-web/src/views/AppMarketView.vue`
- `apps/platform-web/src/views/GameCardLibraryView.vue`
- `apps/platform-web/src/views/GameCardDetailView.vue`
- Optional small helper under `apps/platform-web/src/lib/` if filename or URL normalization needs to be shared.

## Validation

- Required: `npm run build:web`
- Only run `npm run build:contracts` if shared contract shapes change.
- Browser smoke can be manual if the user prefers manual verification.

## Risk Points

- Updating a Game Card manifest must preserve card content files and source.
- Clearing frontend binding must not delete saves or packaged frontend files.
- Import failure must not navigate as if import succeeded.
- Blob download object URLs must be revoked after use.
