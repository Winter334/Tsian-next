# Game Card Library And Save Instance Model Implementation Plan

## Checklist

1. Contracts
   - Add `packages/contracts/src/game-card.ts`.
   - Export new contracts from `packages/contracts/src/index.ts`.
   - Keep contracts type-only.

2. Storage Schema
   - Add `LocalGameCardRecord` to `apps/platform-web/src/storage/db.ts`.
   - Extend `LocalSaveRecord` with optional `gameCardId` and `gameCardVersion`.
   - Add `gameCards` Dexie table.
   - Bump database name per prototype schema-reset policy.

3. Workspace Template Extraction
   - Export a helper from `storage/workspace.ts` that returns cloned default workspace template files as game-card template files.
   - Preserve current default workspace initialization behavior for existing callers.

4. Game Card Storage Helpers
   - Add `storage/game-cards.ts`.
   - Implement list/get/put helpers.
   - Implement built-in blank game card seeding.
   - Export helpers through `storage/index.ts`.

5. Save Creation From Card
   - Add `createLocalSaveFromGameCard`.
   - Make `createLocalSave` delegate to the built-in blank card compatibility path.
   - Ensure save, snapshot, history, copied workspace files, and initial checkpoint are written consistently.
   - Preserve `commitSuccessfulRuntimeTurnForSave`, delete, select, and list behavior.

6. Platform Host Surface
   - Ensure `initializePlatformHost()` seeds the built-in blank card.
   - Keep `createPlatformSave()` working.
   - Add future-facing card APIs: list/get cards and create save from card.
   - Include card association where useful without changing final UI yet.

7. Docs And Specs
   - Update active direction docs.
   - Update relevant Trellis specs for contracts and platform-web storage.

8. Verification
   - Run builds and Trellis validation.

## Validation Commands

```bash
npm run build:contracts
npm run build:runtime-core
npm run build:web
python3 ./.trellis/scripts/task.py validate 06-14-game-card-library-save-model
git diff --check
```

## Focused Checks

- A built-in blank game card is available after platform initialization.
- `createPlatformSave()` still creates a usable save.
- A save created from the built-in blank card has `gameCardId/gameCardVersion`.
- The initial checkpoint includes workspace files copied from the card template.
- Deleting/selecting/listing saves still works.
- Import/export package format is not implemented in this child.

## Risky Files

- `packages/contracts/src/index.ts`
- `packages/contracts/src/game-card.ts`
- `apps/platform-web/src/storage/db.ts`
- `apps/platform-web/src/storage/workspace.ts`
- `apps/platform-web/src/storage/saves.ts`
- `apps/platform-web/src/storage/index.ts`
- `apps/platform-web/src/platform-host/index.ts`
- `docs/active/*`
- `.trellis/spec/contracts/backend/directory-structure.md`
- `.trellis/spec/platform-web/frontend/state-management.md`

## Rollback

If the card-derived save transaction becomes too invasive, keep the contract and `gameCards` table but make `createLocalSaveFromGameCard()` reuse existing `createLocalSave()` plus a follow-up workspace replacement transaction. This is less ideal but preserves the product model.
