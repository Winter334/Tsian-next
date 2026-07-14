# 轻量云备份自动同步 — Implementation Plan

## Preconditions

- Task remains in `planning` until PRD/design/implementation plan are reviewed and approved.
- Do not start code changes until the task is activated with `task.py start`.
- Before coding in Phase 2, load `trellis-before-dev` and relevant spec docs.

## Implementation Checklist

### 1. Shared contracts

- Add `packages/contracts/src/cloud-backup.ts` with type-only request/response shapes for cloud backup summaries, manifests, prepare/commit requests, and list responses.
- Export the new module from `packages/contracts/src/index.ts`.
- Keep runtime validation out of contracts.

Validation after this slice:

```bash
npm run build:contracts
```

### 2. Server storage and repository

- Extend `apps/platform-server/internal/storage/db.go` with additive `cloud_backups` and `cloud_backup_blobs` tables plus owner/card indexes.
- Add `apps/platform-server/internal/cloudbackup/` package:
  - domain structs / errors
  - SQLite repository for listing by owner/card, get by id, upsert current manifest, delete backup, blob row lookup/upsert/delete, owner usage calculation, and orphan blob discovery
  - helper for current-manifest hash collection and user-level GC
- Keep owner isolation in every query.

Validation after this slice:

```bash
go -C ./apps/platform-server test ./...
```

### 3. Server handlers and routes

- Implement authenticated handlers:
  - `GET /api/v1/cloud-backups?cardId=`
  - `POST /api/v1/cloud-backups/prepare`
  - `PUT /api/v1/cloud-backups/blobs/{hash}`
  - `POST /api/v1/cloud-backups/{id}/commit`
  - `GET /api/v1/cloud-backups/{id}/manifest`
  - `GET /api/v1/cloud-backups/{id}/blobs/{hash}`
  - `DELETE /api/v1/cloud-backups/{id}`
- Register routes in `apps/platform-server/internal/server/server.go` with `RequireAuth`.
- Enforce:
  - 100MB per-user product quota by manifest size sum
  - request body limits
  - SHA-256 hash/size verification for uploaded blobs
  - path whitelist and safe path normalization
  - commit only when every referenced blob exists for the owner
  - `409` conflict when expected revision mismatches and `force` is not true
  - owner-level orphan blob GC after delete/replacement

Validation after this slice:

```bash
go -C ./apps/platform-server test ./...
```

### 4. Platform config for player opt-in

- Add `cloudBackup: { autoBackupEnabled: false }` to `PlatformConfig` defaults and normalization in `apps/platform-web/src/config/platform-config.ts`.
- Preserve existing config merge behavior: screens read whole config, merge their section, and save full config.
- Keep default off.

Validation after this slice:

```bash
npm run build:web
```

### 5. Local save metadata

- Add optional local bookkeeping fields to `LocalSaveRecord` in `apps/platform-web/src/storage/db.ts`:
  - `cloudBackupId?: string`
  - `cloudBackupRevisionId?: string`
  - `cloudBackedUpAt?: number`
- Update save mutation helpers to preserve these fields when renaming/updating version and to clear/update them only through backup flows.
- Do not add a Dexie index unless implementation discovers a real need. If the Dexie store schema changes, follow storage spec: bump DB name and update the service worker mirror.

Validation after this slice:

```bash
npm run build:web
```

### 6. Save snapshot / local import-export module

- Add a focused storage module, e.g. `apps/platform-web/src/storage/save-backups.ts`.
- Implement reusable helpers:
  - collect a save-owned snapshot from `listWorkspaceFilesForSave(saveId)`
  - filter only `save/**` and allowed `.tsian/**`
  - compute SHA-256 for text and binary files
  - infer media types centrally
  - apply a snapshot to a new local save
  - replace an existing local save workspace when explicitly confirmed
- Implement local export:
  - `.tsian-save.zip`
  - `save-backup.json` manifest
  - raw file entries under `workspace/<path>`
  - support binary files as raw zip entries
- Implement local import:
  - validate schema, paths, card id, and manifest/file consistency
  - create a new local save by default
  - no checkpoint import

Validation after this slice:

```bash
npm run build:web
```

Focused manual/probe checks:

- export/import round-trip with a text-only save
- export/import round-trip with at least one binary workspace file
- import rejects mismatched card id
- import rejects unsafe paths

### 7. Frontend API client and cloud backup service

- Add cloud backup methods to `apps/platform-web/src/platform-host/api-client.ts` or a focused adjacent module using `apiFetch`.
- Support JSON endpoints and binary blob upload/download.
- Add a platform-web service module for orchestration:
  - manual backup one save
  - force overwrite after conflict confirmation
  - list backups for current card
  - pull selected backup to local save
  - delete cloud backup
  - compute/display usage
- Keep player-facing errors simple: “空间不足”, “暂无云端备份”, “请先登录”, “云端备份已在其他设备更新”.

Validation after this slice:

```bash
npm run build:web
```

### 8. Launcher UI

- Update `apps/platform-web/src/components/play/GameLauncherPanel.vue`:
  - top actions: `新建存档 / 导入 / 同步云端`
  - per-save actions: `继续 / 重命名 / 备份 / 导出 / 删除`
- Implement hidden file input for `.tsian-save.zip` import.
- Implement “同步云端” flow:
  - fetch current-card cloud backup list
  - 0 backups: toast/message “暂无云端备份”
  - 1 backup: use it
  - multiple backups: selection dialog with name, updated time, size, card version
  - matching local backup id: confirm before overwrite
  - no matching local save: create new local save
- Update delete dialog to offer local-only vs delete cloud too when local save has `cloudBackupId`.
- Keep no persistent cloud-only rows in the launcher.

Validation after this slice:

```bash
npm run build:web
```

### 9. Settings cloud backup screen

- Add a Settings Hub entry “云备份”.
- Add a new settings screen component for:
  - auto backup checkbox
  - usage display `已用 X / 100 MB`
  - cloud backup list for viewing/deleting only
  - logged-out prompt
- Wire the screen through `SettingsView.vue` and platform config saving.
- Do not put restore/pull actions in this screen.

Validation after this slice:

```bash
npm run build:web
```

### 10. Account copy update

- Update `apps/platform-web/src/views/AccountView.vue` text so it does not promise automatic card/save sync.
- Suggested meaning: logged-in users can enable cloud backup from Control Panel for cross-device play.

Validation after this slice:

```bash
npm run build:web
```

### 11. Automatic backup hook

- Hook after successful player-turn commit in `apps/platform-web/src/platform-host/index.ts`, after `commitSuccessfulRuntimeTurnForSave(...)` succeeds.
- Trigger only if:
  - user is logged in / cloud API is available,
  - `getPlatformConfig().cloudBackup.autoBackupEnabled === true`,
  - there is an active save id.
- Debounce and fire-and-forget; failure must not affect turn completion.
- Reuse the same backup service as manual “备份”.

Validation after this slice:

```bash
npm run build:web
```

### 12. Final verification

Run full required checks:

```bash
npm run build:contracts
npm run build:web
go -C ./apps/platform-server test ./...
git diff --check
```

Manual scenarios to verify:

1. Logged out:
   - 云备份 screen prompts login.
   - local import/export still works.
2. Manual backup:
   - new cloud backup created for one save.
   - second backup updates same cloud backup.
3. Conflict:
   - expected revision mismatch returns conflict.
   - player confirmation allows force overwrite.
4. Quota:
   - projected usage over 100MB rejects with player-facing error.
5. Sync cloud:
   - no cloud backups → “暂无云端备份”.
   - one backup → pull flow.
   - multiple backups → selection dialog.
   - matching local save → confirm overwrite.
   - no matching local save → create new save.
6. Delete:
   - local-only delete leaves cloud backup.
   - delete cloud too removes backup and frees usage after GC.
7. Import/export:
   - zip export/import round-trips text and binary save files.
   - wrong card id import fails clearly.
8. Scope:
   - exported/cloud-backed data excludes game-card content, frontend, checkpoints, embedding index, `.tsian/local/**`, and temp attachments.

## Risk / Rollback Points

- **Server tables**: additive, but route/handler mistakes can expose private data. Owner filtering is the main review point.
- **Blob GC**: verify GC only deletes unreferenced blobs for the current owner.
- **Local save overwrite**: only “同步云端” with confirmation may replace an existing local save workspace.
- **Auto backup hook**: must be fire-and-forget and must not alter the runtime turn success path.
- **Dexie schema**: avoid store schema/index changes unless necessary; if they become necessary, bump DB name and service worker DB name together.
