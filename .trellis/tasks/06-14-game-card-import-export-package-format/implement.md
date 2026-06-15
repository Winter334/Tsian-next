# Game Card Import Export Package Format Implementation Plan

## Checklist

1. Add shared package/frontend contracts:
   - package manifest schema types;
   - `GameCardFrontendBinding` packaged variant;
   - packaged frontend file metadata shapes if shared across platform/import/export.
2. Add local packaged frontend storage:
   - Dexie table for game-card frontend files;
   - Blob/ArrayBuffer-capable record shape with card id, path, media type, size, timestamps;
   - clone/list/replace helpers beside game-card storage.
3. Add zip import/export implementation:
   - choose a small browser zip dependency;
   - parse `game-card.json`;
   - normalize and validate package paths;
   - import workspace text files;
   - import frontend binary/text files;
   - export a local game card back to zip.
4. Add packaged frontend virtual serving:
   - register a Service Worker or equivalent same-origin virtual resource layer;
   - serve `/__tsian_game_card_frontends/<cardId>/<path>` from stored frontend files;
   - return clear errors when the package entry is missing or the browser cannot register the resource layer.
5. Extend frontend loading:
   - update `PlayView` to handle `frontend.kind === "packaged"`;
   - reuse the existing iframe bridge adapter once a packaged URL is resolved;
   - keep `remote` and `builtin` behavior unchanged.
6. Add minimal platform-host/storage APIs:
   - import package from browser `File`/`Blob`;
   - export local game card to `Blob`;
   - list/get behavior remains compatible with current game card library helpers.
7. Add minimal UI affordance if needed:
   - prefer a small library/debug-facing import/export path over full workshop UI;
   - do not build final lobby/workshop UX in this child.
8. Update docs/specs:
   - package format;
   - packaged frontend boundary;
   - Service Worker/virtual URL behavior;
   - import conflict semantics.
9. Validate:
   - `npm run build:contracts`;
   - `npm run build:runtime-core`;
   - `npm run build:web`;
   - `python3 ./.trellis/scripts/task.py validate 06-14-game-card-import-export-package-format`;
   - `python3 ./.trellis/scripts/task.py validate 06-14-remote-game-frontend-foundation`;
   - `git diff --check`.

## Risky Files / Rollback Points

- `packages/contracts/src/game-card.ts`: frontend binding and package schema changes affect future tooling.
- `apps/platform-web/src/storage/db.ts`: Dexie schema/table changes require prototype DB reset rules.
- `apps/platform-web/src/storage/game-cards.ts`: import/export and conflict behavior must not mutate existing saves.
- `apps/platform-web/src/views/PlayView.vue`: packaged frontend loading must preserve builtin and remote paths.
- `apps/platform-web/public/` or equivalent Service Worker entry: virtual frontend serving must be scoped and predictable.

Rollback should leave existing local Game Card records and remote frontend loading intact. If needed, remove only packaged frontend loading and package file storage while preserving manifest/workspace import/export code.

## Pre-Start Review Notes

- Confirm implementation uses built static frontend files, not source builds.
- Confirm zip dependency choice before coding if package size or dependency policy becomes a concern.
- Confirm no final workshop/library UI is expected in this child.
