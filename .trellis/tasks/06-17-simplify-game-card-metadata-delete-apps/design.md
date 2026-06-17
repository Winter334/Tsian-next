# Design

## Metadata Contract

- Keep `GameCardManifest.summary` as the single intro field because it is already required across package import/export and display helpers.
- Remove `GameCardManifest.description`.
- Keep `version` in the contract for package compatibility, but make it internal to ordinary UI.
- Import/normalize old `description` as a compatibility input only. It is not re-exported.

## UI

- Game Card Detail overview property panel:
  - `名称`
  - `简介`
  - `保存属性` for local/imported cards
  - `另存为本地副本` for any card, with an automatically generated local id
  - `删除应用` for local/imported cards only
- Remove visible version/id fields and the overview version datum.
- My Apps gets a delete affordance for the selected local/imported card. This complements Game Card Detail and solves the "imported but cannot delete" path.

## Delete Semantics

- `deletePlatformGameCard(cardId)` rejects built-in cards.
- It deletes:
  - the Game Card record;
  - packaged frontend files for that card;
  - all Save Instances whose `gameCardId` matches the card manifest id;
  - those saves' snapshots, history, runtime workspace files, and checkpoints through existing `deleteLocalSave`.
- If the deleted card owned the active save, platform-host selects a remaining save or resets the runtime snapshot.

## Compatibility

- Existing old records may still have a runtime `description` property in IndexedDB. Storage normalization and package export should strip it.
- Legacy imported packages may include `description`; import normalization folds it into `summary` only when `summary` is missing.
- No IndexedDB migration is added during prototype development.

## Rollback

Changes are isolated to contract shape, platform-web normalization/helpers, and route views. Rollback can restore the previous metadata fields and omit delete action wiring if needed.
