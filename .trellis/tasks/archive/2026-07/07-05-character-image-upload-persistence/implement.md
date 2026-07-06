# 角色形象上传与持久化 — Implementation Plan

## Preconditions

- Review `prd.md` and `design.md`.
- Read relevant specs:
  - `.trellis/spec/contracts/backend/index.md`
  - `.trellis/spec/contracts/frontend/type-safety.md`
  - `.trellis/spec/platform-web/frontend/index.md`
  - `.trellis/spec/platform-web/frontend/type-safety.md`
  - `.trellis/spec/platform-web/frontend/state-management.md`
  - `.trellis/spec/platform-web/frontend/component-guidelines.md`
  - `.trellis/spec/platform-web/frontend/quality-guidelines.md`
  - `.trellis/spec/platform-web/storage/index.md`
  - `.trellis/spec/guides/cross-layer-thinking-guide.md`
  - `.trellis/spec/guides/data-fileification-principle.md`

## Checklist

### 1. Task setup

- [ ] Replace `implement.jsonl` / `check.jsonl` placeholders with real context entries.
- [ ] Start Trellis task with `python ./.trellis/scripts/task.py start 07-05-character-image-upload-persistence`.

### 2. Default avatar assets

- [ ] Create `apps/play-frontend-dev/src/assets/avatars/`.
- [ ] Copy `F:/workspace/tmp/avarar/默认头像-女.png` → `default-female.png`.
- [ ] Copy `F:/workspace/tmp/avarar/默认头像-男.png` → `default-male.png`.

### 3. Bridge binary write support

- [ ] Update `packages/contracts/src/bridge.ts` so `WorkspaceWriteRequest.content` is `string | Blob`.
- [ ] Update `packages/play-bridge/src/tsian-api.ts` API type and implementation to accept `string | Blob`.
- [ ] Update `apps/platform-web/src/bridge/remote-iframe-bridge.ts` normalizer to allow Blob.
- [ ] Confirm `apps/platform-web/src/platform-host/index.ts` passes `req.content` through unchanged.
- [ ] Update `docs/sdk/play-frontend-api.md` workspace write docs to mention Blob / binary media writes.

### 4. Character data parsing

- [ ] Add `CharacterPortraitMeta` type and `CharacterEntity.portrait`.
- [ ] Add `CharacterEntity.gender` for top-level gender compatibility.
- [ ] Parse top-level `gender` and `portrait` in `parse-character.ts`.

### 5. Helpers

- [ ] Add `character-avatar.ts` to select default avatar by gender, with male fallback.
- [ ] Add `image-processing.ts` for MIME/size validation, image decode, 3:4.15 crop, WebP export.
- [ ] Add helper for deriving portrait path from entity ref/localId, or keep it local to `CharacterPortrait.vue` if only used once.

### 6. UI wiring

- [ ] `CharacterSlot.vue`: handle `portrait-updated` by reloading entity.
- [ ] `CharacterCard.vue`: compute default avatar URL and `canUploadPortrait`, pass portrait props to `CharacterPortrait`.
- [ ] `CharacterPortrait.vue`:
  - [ ] Read `portraitPath` via `tsian.workspace.read(path, "save-runtime")`.
  - [ ] Create/revoke object URL from `file.binary`.
  - [ ] Render custom image if loaded; otherwise fallback default avatar image.
  - [ ] Remove glyph fallback from runtime behavior.
  - [ ] Add hidden file input and overlay upload/change button for protagonist only.
  - [ ] Upload selected image, write Blob, patch entity JSON, emit `portrait-updated`.
  - [ ] Surface upload/read errors without crashing.

### 7. Schema/template notes if touched

- [ ] If updating built-in schema text, add optional `portrait` as frontend-readable UI/media metadata and clarify it does not replace `appearance`.
- [ ] Avoid adding instructions that make AIRP read/inject image content by default.

## Validation Commands

Run in order:

```bash
npm run build --workspace @tsian/contracts
npm run build --workspace @tsian/play-bridge
npm run build --workspace play-frontend-dev
npm run build:web
```

## Manual/Code Review Checks

- [ ] No uploaded image → default male/female avatar, no glyph.
- [ ] Unknown/missing gender → male avatar.
- [ ] `portrait.path` missing/read failure → default avatar.
- [ ] Protagonist shows upload/change control.
- [ ] NPC does not show upload control.
- [ ] Upload writes WebP Blob under `save/assets/portraits/characters/`.
- [ ] Entity JSON gets `portrait` metadata.
- [ ] Object URL is revoked on replacement/unmount.
- [ ] Existing string `workspace.write` callers still typecheck.

## Rollback Points

- Bridge extension is isolated to contract/API/normalizer. If binary write causes platform issues, revert those files and the portrait upload path cannot function; default avatars can remain independently.
- UI upload code can be reverted without affecting default avatar fallback if split carefully.
- No Dexie schema changes are planned.
