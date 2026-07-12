# Implement — 存档版本提示与创意工坊资源版本统一

## Checklist

### Already implemented in first iteration

- [x] Add `updateLocalSaveGameCardVersion` preserving `updatedAt`.
- [x] Add `updatePlatformSaveGameCardVersion` and export it.
- [x] Gate old-version save launch in `GameLauncherPanel.vue`.
- [x] Add old-save badge and one-time confirmation.
- [x] Add initial market overwrite save warning.

### Resource version unification

1. Frontend package export
   - [ ] Add `GameCardPackageExportOptions` and version override to `exportGameCardPackage` / `exportPlatformGameCardPackage`.
   - [ ] Add `inspectGameCardPackage` helper for package manifest id/version/name.
   - [ ] Add `ResourcePackageExportOptions` to Agent/Skill/Tool exporters.
   - [ ] Ensure export validation rejects blank version through existing manifest validation or explicit UI validation.

2. Market upload UI
   - [ ] Change upload dialog version label to `版本`.
   - [ ] Require version before upload with copy `版本不能为空。`.
   - [ ] Pass version into exporter.
   - [ ] Stop sending version as independent market metadata.
   - [ ] Sync local Game Card version after successful game-card upload.

3. Market edit/replacement UI
   - [ ] In `MarketPackageDetail.vue`, make version read-only unless replacement is selected.
   - [ ] Require version only when replacement is selected.
   - [ ] Emit save-edit metadata with replacement-aware version behavior.
   - [ ] In `AppMarketView.vue`, pass version to exporter only for replacement.
   - [ ] Stop sending version as independent metadata on update.

4. Game Card install prompt
   - [ ] Download package before overwrite prompt.
   - [ ] Inspect downloaded package manifest and use real id/version/name.
   - [ ] Use real version for affected-save count and player-facing warning.
   - [ ] Reuse downloaded blob for import.

5. Server authority
   - [ ] Update `formPublishMetadata` / `publishMetadata` so version no longer comes from multipart form.
   - [ ] Upload persists parsed package manifest version.
   - [ ] Metadata-only update preserves existing version.
   - [ ] Replacement update persists replacement package manifest version.
   - [ ] Update market tests and add mismatch cases.

6. Specs / validation
   - [ ] Update `.trellis/spec/` with resource package version authority contract.
   - [ ] Run `npm run build:web`.
   - [ ] Run relevant platform-server Go tests.
   - [ ] Run `git diff --check` on task files.

## Commands

```bash
npm run build:web
go test ./internal/server -run Market
```

Run Go tests from `apps/platform-server` unless package layout requires a narrower command.

## Risk Points

- Do not mutate local Game Card version before upload succeeds.
- Do not send or trust independent `version` metadata after package export starts embedding versions.
- Ensure metadata-only edit cannot drift version.
- Game Card install should not download twice.
- Existing dirty files outside this task must not be touched.

## Review Notes

- Search for `version:` in market upload/update calls after implementation.
- Search for `ResourceVersion:` in server handler to confirm authority is package/existing only.
- Verify UI copy remains player-facing.
