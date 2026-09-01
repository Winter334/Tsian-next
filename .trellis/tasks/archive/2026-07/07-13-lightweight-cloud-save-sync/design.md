# 轻量云备份自动同步 — Design

## 1. Overview

This task adds two player-facing backup paths for Save Instances:

- **云备份**: authenticated, server-backed backup of the current save state.
- **本地导入/导出**: zip-based local save backup files.

Both paths share the same serialization boundary: save-owned runtime files only. They never serialize the effective workspace as a whole, because effective workspace also overlays reusable card content and frontend files.

Primary existing anchors:

- Local save metadata: `apps/platform-web/src/storage/db.ts:12`
- Save workspace rows: `apps/platform-web/src/storage/db.ts:57`
- Save runtime path policy: `apps/platform-web/src/storage/workspace-paths.ts:49`
- Save workspace filtering helper: `apps/platform-web/src/storage/workspace.ts:405`
- Existing server auth/user context: `apps/platform-server/internal/middleware/auth.go:11`, `apps/platform-server/internal/user/user.go:42`
- Existing server blob abstraction: `apps/platform-server/internal/storage/blobstore.go:10`
- Existing package zip utilities/patterns: `apps/platform-web/src/storage/game-card-packages.ts:13`

## 2. Terminology Boundary

Player-facing UI uses **云备份** language:

- 备份 = 本机存档上传到云端。
- 同步云端 = 当前游戏卡的云端备份拉取到本机。
- 导出 / 导入 = 本地文件备份。

Technical implementation may use `cloudBackup`, `manifest`, `blob`, and `revisionId`, but these terms must not appear in player-facing labels or help text.

## 3. Serialization Scope

A backup snapshot contains only save-owned files:

- Include:
  - `save/**`
  - `.tsian/**` except `.tsian/local/**`
- Exclude:
  - `.tsian/local/**`
  - checkpoints and local checkpoint blob table rows
  - embedding index rows
  - temp/assistant attachments
  - game card content (`agents/**`, `skills/**`, `docs/**`, schemas, etc.)
  - game card frontend (`frontend/**`)
  - synthesized `game-card.json`

Implementation should centralize this as one reusable snapshot builder so cloud backup and local export cannot drift. The builder should read `localDb.saves` + `listWorkspaceFilesForSave(saveId)`, filter with `isSaveRuntimePersistencePath`, and produce normalized file entries preserving `createdAt` / `updatedAt` and binary payloads.

## 4. Shared Contract Types

Add a new contract module, e.g. `packages/contracts/src/cloud-backup.ts`, exported from `packages/contracts/src/index.ts`.

Suggested public shapes:

```ts
export interface CloudBackupFileEntry {
  path: string
  hash: string
  size: number
  mediaType: string
  kind: "text" | "binary"
  createdAt: number
  updatedAt: number
}

export interface CloudBackupSummary {
  id: string
  name: string
  cardId: string
  cardVersion: string
  revisionId: string
  sizeBytes: number
  fileCount: number
  updatedAt: string
  createdAt: string
}

export interface CloudBackupListResponse {
  backups: CloudBackupSummary[]
  usageBytes: number
  quotaBytes: number
}

export interface CloudBackupPrepareRequest {
  backupId?: string
  expectedRevisionId?: string | null
  force?: boolean
  name: string
  cardId: string
  cardVersion: string
  files: CloudBackupFileEntry[]
}

export interface CloudBackupPrepareResponse {
  backupId: string
  missingHashes: string[]
  usageBytesAfterCommit: number
  quotaBytes: number
}

export interface CloudBackupCommitRequest extends CloudBackupPrepareRequest {
  backupId: string
}

export interface CloudBackupManifestResponse extends CloudBackupSummary {
  files: CloudBackupFileEntry[]
}
```

Contracts remain type-only. Runtime validation stays in platform-web and platform-server.

## 5. Server Design

### 5.1 Package and Routes

Add a server package such as `apps/platform-server/internal/cloudbackup` with:

- `types.go` — domain structs and request/response DTOs.
- `sqlite_repo.go` — SQLite persistence.
- `handler.go` — HTTP handlers and validation.

Register routes in `apps/platform-server/internal/server/server.go` behind `RequireAuth`:

```txt
GET    /api/v1/cloud-backups?cardId=<optional>
POST   /api/v1/cloud-backups/prepare
PUT    /api/v1/cloud-backups/blobs/{hash}
POST   /api/v1/cloud-backups/{id}/commit
GET    /api/v1/cloud-backups/{id}/manifest
GET    /api/v1/cloud-backups/{id}/blobs/{hash}
DELETE /api/v1/cloud-backups/{id}
```

All endpoints require auth. A user may only access their own backup rows and blobs.

### 5.2 Tables

Extend `apps/platform-server/internal/storage/db.go` with two tables:

```sql
CREATE TABLE IF NOT EXISTS cloud_backups (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  card_id TEXT NOT NULL,
  card_version TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  file_count INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cloud_backups_owner_updated
  ON cloud_backups(owner_user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_cloud_backups_owner_card_updated
  ON cloud_backups(owner_user_id, card_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS cloud_backup_blobs (
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hash TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  media_type TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(owner_user_id, hash)
);

CREATE INDEX IF NOT EXISTS idx_cloud_backup_blobs_owner
  ON cloud_backup_blobs(owner_user_id);
```

`manifest_json` stores the current file list only. No historical revisions table is needed for MVP.

### 5.3 Blob Storage

Use the existing `BlobStore` abstraction. Store blob bytes under deterministic per-user hash paths, for example:

```txt
cloud-backups/<ownerUserId>/blobs/<sha256>
```

The server must compute SHA-256 from uploaded bytes and compare it to the path hash before writing/upserting the blob row. The uploaded size must also be recorded from actual bytes, not trusted from the client.

### 5.4 Quota

Use a server constant for MVP:

```txt
cloudBackupQuotaBytes = 100 * 1024 * 1024
```

Quota accounting is product-simple:

```txt
sum(current cloud_backups.size_bytes for owner)
```

When preparing/committing an update:

```txt
projected = ownerCurrentTotal - existingBackupOldSize + incomingManifestSize
reject if projected > quota
```

Blob physical dedupe may save disk space for identical hashes under one user, but quota accounting does not need to dedupe across backup manifests.

### 5.5 Request Safety

- `prepare` and `commit` validate:
  - non-empty `name`, `cardId`, `cardVersion`
  - path whitelist (`save/**`, `.tsian/**` except `.tsian/local/**`)
  - safe normalized paths: no absolute paths, traversal, NUL, empty segments
  - hash format: SHA-256 hex
  - non-negative finite sizes and sane JSON size
  - total manifest size <= quota
- Blob upload validates:
  - path hash is valid SHA-256 hex
  - request body max is bounded by quota plus small overhead
  - computed hash equals path hash
- Commit validates every referenced blob exists for the owner and has the declared size.
- Delete and replacement call a simple owner-level GC:
  - collect hashes referenced by all current manifests for owner
  - delete unreferenced `cloud_backup_blobs` rows and BlobStore files

### 5.6 Conflict Handling

Each cloud backup row has a current `revision_id`.

- Normal update sends `expectedRevisionId`.
- If existing row revision differs and `force !== true`, return HTTP `409` with a short error.
- UI may re-run prepare/commit with `force: true` after player confirms “覆盖云端”.
- Server should generate a new `revision_id` on every successful commit.

## 6. Platform-Web Local Storage Design

### 6.1 LocalSaveRecord Cloud Metadata

Add optional non-indexed fields to `LocalSaveRecord` in `apps/platform-web/src/storage/db.ts`:

```ts
cloudBackupId?: string
cloudBackupRevisionId?: string
cloudBackedUpAt?: number
```

These are internal bookkeeping, not workspace-visible gameplay/config data. They do not require a new Dexie index. If implementation decides a new index/table is needed, follow storage spec rules for Dexie schema changes.

### 6.2 Platform Config

Add a `cloudBackup` section to `PlatformConfig`:

```ts
interface PlatformConfigCloudBackup {
  autoBackupEnabled: boolean
}
```

Default is `false`. It is saved through `.tsian/local/platform-config.json`, consistent with existing platform config behavior.

### 6.3 Save Snapshot Module

Add a focused module, e.g. `apps/platform-web/src/storage/save-backups.ts`, responsible for:

- collecting backup snapshots from a local save
- computing per-file SHA-256
- converting files to cloud manifest entries
- exporting/importing local zip backup packages
- applying backup files to a new or existing local save

This module should be independent from Vue UI.

## 7. Local Save Export / Import

### 7.1 Zip Format

Use `fflate` as existing package code does.

Suggested extension:

```txt
<safe-save-name>.tsian-save.zip
```

Zip contents:

```txt
save-backup.json
workspace/save/...
workspace/.tsian/...
```

Manifest schema:

```json
{
  "schema": "tsian.save-backup.v1",
  "name": "存档名",
  "cardId": "tg-break",
  "cardVersion": "3.1.2",
  "exportedAt": 1234567890,
  "files": [
    {
      "path": "save/history/turns/turn-000001.json",
      "kind": "text",
      "mediaType": "application/json",
      "size": 1234,
      "createdAt": 123,
      "updatedAt": 456
    }
  ]
}
```

Text files are UTF-8 encoded. Binary files are raw zip entries and restored as `Blob`s with the manifest media type.

### 7.2 Import Behavior

- Import is launched from the current card’s launcher.
- `cardId` must match current card id; otherwise show a player-facing card mismatch error.
- Import always creates a new local save; it never overwrites an existing local save.
- The imported save should be selected as active but not auto-continued into gameplay unless UI explicitly chooses to.
- Imported files are written as current save workspace files. Imported checkpoint history is not supported.

## 8. Cloud Backup Client Flows

### 8.1 Manual “备份”

For one local save:

1. Collect snapshot and hashes.
2. Call `prepare` with existing `cloudBackupId` / `cloudBackupRevisionId` if present.
3. If `409`, show player confirmation; on confirm repeat with `force: true`.
4. Upload missing blobs.
5. Commit manifest.
6. Update local save cloud metadata with returned backup id / revision id / timestamp.
7. Emit saves changed and update UI status.

### 8.2 Automatic Backup

Triggered after a successful player turn commit only when:

- user is logged in,
- `cloudBackup.autoBackupEnabled === true`,
- there is an active save.

The job is debounced and non-blocking. It performs the same operation as manual “备份” for the active save. Failure must not interrupt gameplay; record/show a lightweight status or toast as appropriate.

### 8.3 “同步云端”

Launcher-level button flow:

1. Fetch cloud backups for current card id.
2. If none: show “暂无云端备份”.
3. If one: use it.
4. If multiple: show selection dialog with name, updated time, size, card version.
5. Fetch selected manifest and blobs.
6. If a local save with matching `cloudBackupId` exists: confirm before replacing that save’s workspace.
7. If no matching local save exists: create a new local save from the cloud backup.
8. Update local cloud metadata and refresh save list.

### 8.4 Delete Local Save

If local save has `cloudBackupId`, the delete dialog offers:

- 同时删除云端备份
- 只删除本机存档

The first option deletes the server backup before/with local delete and runs server GC. If the cloud delete fails, do not silently delete both; surface the failure and let the player retry or choose local-only.

## 9. UI Placement

### 9.1 Settings Hub

Add `控制面板 → 云备份`.

Screen responsibilities:

- automatic backup checkbox (default off)
- usage `已用 X / 100 MB`
- cloud backup list for viewing and deleting only
- no restore/pull button here
- logged-out state prompts player to log in

### 9.2 Account Center

Update text to avoid promising card sync or default sync. Use wording like:

```txt
登录后可在控制面板开启云备份，用于换设备继续游玩。
```

### 9.3 Launcher

Top actions:

```txt
新建存档 / 导入 / 同步云端
```

Per local save row:

```txt
继续 / 重命名 / 备份 / 导出 / 删除
```

## 10. Rollback / Compatibility

- Cloud backup server tables are additive.
- Local optional save fields are backward-compatible for existing saves.
- Cloud backup disabled by default, so existing gameplay is unchanged until the player opts in or uses manual buttons.
- Local save import/export has no server dependency.
- If cloud endpoints are unavailable, local gameplay and local import/export should still work.

## 11. Validation Strategy

- Contracts: `npm run build:contracts`
- Platform web: `npm run build:web`
- Server: `go -C ./apps/platform-server test ./...`
- Diff hygiene: `git diff --check`

Focused checks should cover:

- path whitelist accepts `save/**` and allowed `.tsian/**`, rejects `.tsian/local/**` and card-content roots
- save export/import round-trip including binary file
- cloud quota rejection over 100MB
- hash mismatch rejection
- conflict 409 then force overwrite
- launcher sync with 0/1/many cloud backups
- delete local save with and without cloud delete
