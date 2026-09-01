# Game Card Import Export Package Format

## Goal

Design and implement the first browser-local package format for moving game cards between local storage, player files, and future workshop/account systems.

The first package format should support built game frontend packages, not source projects. During development, authors can bind a game card to a remote dev URL such as `http://localhost:5174/`; for distribution, authors package the built static frontend output together with the game card.

## Parent

- `.trellis/tasks/06-14-remote-game-frontend-foundation`

## Requirements

- Define a game card package format containing manifest, workspace template files, cover metadata/assets, and optional frontend-related metadata.
- Use a single browser-friendly package artifact for import/export. Recommended first artifact: `.tsian-card.zip`.
- Support built packaged frontends as static files, e.g. `frontend/index.html` plus `frontend/assets/*`.
- Do not require platform-side source builds, npm install, bundling, or frontend framework awareness.
- Define validation and versioning behavior.
- Define import conflict behavior for same id/version, same id/new version, and local edits.
- Define export behavior from a local game card.
- Imported game cards should not create save instances by default.
- Packaged game frontends should load through the same iframe/postMessage bridge boundary as remote frontends.
- Preserve the distinction between game card package and save instance export.
- Keep future workshop upload/download and account identity as later UI/backend concerns.

## Acceptance Criteria

- [x] Package format records manifest and workspace template files.
- [x] Package format can include built packaged frontend files under `frontend/`.
- [x] Package format has a versioned schema.
- [x] Import validation rejects malformed or unsafe packages with clear errors.
- [x] Import can create or update a local game card without creating a save instance by default.
- [x] Export can serialize a local game card without save history/checkpoints unless explicitly exporting a save.
- [x] A packaged frontend game card can be loaded in `/play` through iframe bridge semantics.
- [x] Remote URL game cards remain supported for development workflows.
- [x] Package format distinguishes game card templates from save instances/checkpoints.
- [x] Future workshop/library UI can build on the package contract.

## Dependencies

- Deferred until after `06-14-game-card-library-save-model`.
- Prefer to wait until `06-14-remote-iframe-frontend-bridge` stabilizes the frontend binding fields.

## Out Of Scope

- Account system.
- Online workshop backend.
- Moderation/review workflow.
- Final library/workshop UI.
- Building frontend source projects inside Tsian.
- Running packaged frontend code in the platform JS realm.
- Save instance export format, unless explicitly split into a related task.

## Resolved Questions

- The first local frontend package should be a built static frontend output, not source code.
- Development remote frontends can use any available browser URL/port; the Game Card only needs to update `frontend.url`.
- Distribution should prefer a single game-card package file over a loose directory upload.
