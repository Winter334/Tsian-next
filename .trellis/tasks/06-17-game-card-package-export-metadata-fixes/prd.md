# Game Card Package Export And Metadata Fixes

## Goal

Fix issues found while manually testing Game Card package import/export and frontend binding.

## User Reports

- Remote frontend binding disappears after refresh.
- Exported Game Card packages do not include local cover assets, so distributed packages can lose cover art.
- Exporting the built-in blank card produces a package with `id: "tsian.builtin.blank"`, and re-import is rejected with `Built-in game cards cannot be overwritten by package import.`
- Game Cards do not yet have enough metadata editing/copy affordance to rename or create an importable local copy for package testing.

## Confirmed Evidence

- The provided package `/home/lyra/workspace/temp/files/Blank-Agent-Runtime-0.0.0.tsian-card.zip` contains `game-card.json` and `workspace/*` entries only. It has no `cover/*` entries.
- The package manifest keeps `manifest.id = "tsian.builtin.blank"` and `manifest.cover.url = "/default-card-cover.webp"`.
- `importGameCardPackage` intentionally rejects packages whose manifest id is the built-in blank id.
- `isCurrentBuiltinBlankGameCard` currently treats any built-in card with `manifest.frontend` as stale, so `ensureBuiltinBlankGameCard` can overwrite the user's remote binding.
- The default cover asset added for testing is currently uncommitted and should be included in this task's fix.

## Requirements

- Preserve remote or packaged frontend bindings on the built-in blank card across refresh/reload.
- Export local cover assets with Game Card packages when the cover points at a platform-local/static asset or card-owned cover data.
- Import packages with bundled cover assets so the imported Game Card displays its cover without depending on the exporting machine's `/default-card-cover.webp`.
- Keep import protection for `tsian.builtin.blank`; package import must not overwrite platform-owned built-ins.
- Provide a minimal Game Card metadata/copy flow so a built-in card can be saved as a local card with a new id/name before export/import testing.
- Keep saves, history, checkpoints, traces, and save runtime data out of Game Card packages.
- Keep `frontend.kind === "builtin"` unsupported.

## Acceptance Criteria

- [x] Saving a remote frontend binding on the built-in blank card survives refresh/reload.
- [x] Exporting a card with a local cover includes a bundled cover asset in the package.
- [x] Importing a package with a bundled cover displays that cover from card-owned content.
- [x] Re-importing an unchanged built-in blank package remains rejected.
- [x] A user can create an importable local copy of the built-in blank card with a distinct id/name through the UI.
- [x] Exporting that local copy produces a package whose id is importable after deleting/changing the local target or in a clean browser profile.
- [x] `npm run build:web` passes.

## Out Of Scope

- Full Game Card authoring suite.
- Game Card deletion UI.
- Batch package manager, install history, or online marketplace backend.
- Changing shared contract shapes unless strictly required.
