# Simplify Game Card Metadata And Delete Apps

## Goal

Simplify Game Card metadata editing for ordinary players and add a clear way to delete installed applications.

## User Intent

- Game Card metadata UI should feel like ordinary player-facing app properties, not a manifest editor.
- `id` is an internal package identity and should not be shown to ordinary players.
- `version` can be automatically managed by the program or edited manually in package JSON by advanced users; it should not be shown in the ordinary UI.
- `summary` and `description` should be destructively merged during prototype development. Keep one player-facing field: `简介`.
- Imported/local apps need a delete entry. A user should not get stuck with imported cards forever.

## Requirements

- Game Card Detail metadata UI exposes only:
  - name (`名称`);
  - intro (`简介`, backed by `manifest.summary`).
- Remove `description` from the Game Card manifest contract and primary storage/export path.
- Import legacy packages with `description` by folding it into `summary` when `summary` is missing or blank.
- Do not expose Game Card id or version in ordinary UI.
- Local copy creation auto-generates a unique local id.
- Version stays stored/exported internally and defaults to `0.0.0` when needed.
- Add delete app actions for local/imported Game Cards.
- Built-in Game Cards cannot be deleted.
- Deleting a Game Card also deletes its Save Instances and associated runtime data/checkpoints to avoid orphaned data in this local prototype.
- Delete flows must use explicit confirmation that names the card and associated save count.

## Acceptance Criteria

- [x] Game Card Detail property panel shows only `名称` and `简介`.
- [x] `description` is removed from the `GameCardManifest` contract.
- [x] Stored/exported Game Card manifests no longer include `description` after normalization/export.
- [x] Legacy package import folds old `description` into `summary` when needed.
- [x] Built-in card "另存为本地副本" works without exposing id/version.
- [x] My Apps and/or Game Card Detail provide a delete app entry for local/imported cards.
- [x] Built-in cards cannot be deleted through the UI or platform-host helper.
- [x] Deleting a card removes its frontend files and associated saves/runtime data/checkpoints.
- [x] `npm run build:contracts` passes.
- [x] `npm run build:web` passes.

## Out Of Scope

- Full manifest editor for advanced users.
- Online marketplace ownership, cloud uninstall, or remote package deletion.
- Save export/backup before deletion.
