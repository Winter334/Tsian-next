# 优化创意工坊封面流量 — Design

## Overview

This task changes the workshop/market pipeline from “store and serve uploaded cover bytes” to “derive WebP display assets at upload time, serve lightweight URLs, and page list results with cursor-based load-more”. It spans:

- contracts: shared market response shapes
- platform-server: upload processing, media storage, repository pagination/counts, cover serving
- platform-web: API client, paginated list state, image rendering

Old market test data does not need migration or display compatibility.

## Current Boundaries

- Contracts live in `packages/contracts/src/market.ts`.
- Web client API wrapper lives in `apps/platform-web/src/platform-host/api-client.ts`.
- Main market UI state lives in `apps/platform-web/src/views/AppMarketView.vue`.
- Grid/detail cover rendering lives in:
  - `apps/platform-web/src/components/market/MarketPackageGrid.vue`
  - `apps/platform-web/src/components/market/MarketPackageDetail.vue`
- Server routes are registered in `apps/platform-server/internal/server/server.go`.
- Server market handler/repository/domain live in `apps/platform-server/internal/market/`.
- SQLite schema/migration helper lives in `apps/platform-server/internal/storage/db.go`.
- Blob storage abstraction lives in `apps/platform-server/internal/storage/blobstore.go`.

## Image Pipeline

### Dependencies

Use pure-Go-friendly dependencies:

- `github.com/gen2brain/webp`
  - WebP encode/decode.
  - CGo-free; can use dynamic shared libwebp if available, with pure-Go transpiled fallback.
  - Prefer over `github.com/chai2010/webp`, which requires GCC/MinGW/cgo-style setup.
- `github.com/disintegration/imaging`
  - Resize/crop helpers over `image.Image`.

### Accepted Inputs

Process raster covers extracted from `cover/*` in uploaded game-card zips:

- JPEG
- PNG
- GIF, first frame only
- WebP, first/static frame as decoded by library

Do not process SVG as market display cover in this task. SVG sanitization is separate product/security work.

### Output Assets

For a valid cover:

- Display cover:
  - Max long edge: 1280px
  - WebP quality: 72
  - Key: `market/<packageID>/cover.webp`
  - URL: `/api/v1/market/packages/<id>/cover`
- Grid thumbnail:
  - Exact dimensions: 512x640 (4:5), center-cropped/fill
  - WebP quality: 68
  - Key: `market/<packageID>/cover-thumb.webp`
  - URL: `/api/v1/market/packages/<id>/cover-thumb`

The thumbnail dimensions match the grid card's `aspect-[4/5]`; using fill/crop avoids downloading unused pixels and avoids layout distortion.

### Failure Behavior

- Missing cover: upload still succeeds with `coverUrl = null` and `coverThumbUrl = null`.
- Unsupported cover or decode/encode failure: upload still succeeds without market cover URLs.
- Oversized/unreasonable cover should be guarded before full decode when practical. If guard fails, omit generated cover.
- Raw uploaded cover is not stored as market display media.

### Zip Normalization

To reduce server storage, the stored downloadable zip should also stop carrying the original large cover:

1. Validate uploaded zip and parse `game-card.json`.
2. Extract first usable `cover/*` raster image.
3. Generate WebP display image.
4. Rewrite the zip before storing package blob:
   - remove all original `cover/*` entries
   - add `cover/cover.webp` using the display WebP bytes
   - update top-level package manifest `coverFiles` to a single WebP entry
   - update inner `manifest.cover.workspacePath` to `.cover/cover.webp`
   - preserve `manifest.cover.alt` when present
5. Store rewritten zip at `market/<packageID>.zip`.

The downloaded package content changes bytes but preserves resource semantics: installed game card still has a cover, now normalized to WebP.

## Database / Repository Design

### Schema

Keep existing `cover_blob_key` as display cover key. Add:

- `cover_thumb_blob_key TEXT`

Also update table creation so fresh DBs include it. Since old data is disposable, no thumbnail backfill is required. Existing `ensureMarketPackageColumns` can still add the column idempotently if a local DB exists.

### Domain Model

`Package` gains:

- `CoverThumbBlobKey string`

`ListFilter` gains:

- `Cursor string`
- `Limit int` already exists and will be set by handler

Repository gains count support, preferably:

- `CountByResourceType(ctx, filter)` or `Counts(ctx, filter)` returning map/count struct

Counts should serve sidebar global resource counts. Current sidebar counts are global by type, not filtered by search/tag; keep that behavior unless product later asks for filtered counts.

### Cursor Pagination

List response returns:

```json
{
  "packages": [ ... ],
  "nextCursor": "..." | null
}
```

Cursor should be opaque base64url JSON. It encodes the last row's sort keys and the sort mode. Suggested internal payload:

```json
{
  "sort": "newest",
  "createdAt": "2026-07-03T12:00:00Z",
  "downloadCount": 3,
  "id": "pkg-id"
}
```

Sorting:

- `newest`: `created_at DESC, id DESC`
- `downloads`: `download_count DESC, created_at DESC, id DESC`

Cursor predicates:

- newest:
  - `(created_at < ? OR (created_at = ? AND id < ?))`
- downloads:
  - `(download_count < ? OR (download_count = ? AND created_at < ?) OR (download_count = ? AND created_at = ? AND id < ?))`

Fetch `limit + 1`; if extra row exists, drop it and produce `nextCursor` from the last returned row.

Validate/clamp `limit` in handler:

- default: 24
- max: 100
- invalid non-number: 400 or clamp; prefer 400 for malformed query and clamp for out-of-range if consistent with existing repository behavior.

## HTTP API Design

### Package Response

Add `coverThumbUrl` while keeping `coverUrl`:

```json
{
  "coverUrl": "/api/v1/market/packages/<id>/cover",
  "coverThumbUrl": "/api/v1/market/packages/<id>/cover-thumb"
}
```

For resources with no cover, both are `null`.

### List

`GET /api/v1/market/packages`

Query params:

- `resourceType`
- `q`
- `tag`
- `sort`
- `limit`
- `cursor`

Response:

```json
{
  "packages": [...],
  "nextCursor": null
}
```

### Counts

Use an explicit route before dynamic id route:

`GET /api/v1/market/packages/counts`

Response:

```json
{
  "counts": {
    "game_card": 0,
    "agent": 0,
    "skill": 0
  }
}
```

### Cover Routes

- `GET /api/v1/market/packages/{id}/cover`
- `GET /api/v1/market/packages/{id}/cover-thumb`

Both return `Content-Type: image/webp` for generated covers and keep cache headers.

## Contracts Design

Update `packages/contracts/src/market.ts`:

- `MarketPackage.coverThumbUrl: string | null`
- `MarketPackageListResponse`
- `MarketPackageCountsResponse`
- Optionally `MarketPackageListParams` if useful for API client typing.

## Frontend Design

### API Client

`marketApi.list()` returns `MarketPackageListResponse` and accepts `limit` / `cursor`.

Add `marketApi.counts()` returning `MarketPackageCountsResponse`.

### AppMarketView State

Introduce:

- `PAGE_SIZE = 24`
- `nextCursor = ref<string | null>(null)`
- `loadingMore = ref(false)`
- request sequence guard to ignore stale responses

Behavior:

- `refresh()` loads first page and replaces packages.
- `loadMore()` appends next page when `nextCursor` exists.
- type/search/tag/sort changes call `refresh()` and reset pagination.
- `refreshCounts()` calls `marketApi.counts()` once.
- After upload, refresh list and counts; keep existing current type behavior unless implementation naturally switches to uploaded type.

### Grid / Detail Images

Grid:

- source = `pkg.coverThumbUrl ?? pkg.coverUrl`
- `loading="lazy"`
- `decoding="async"`
- on error, fall back to existing visual placeholder

Detail:

- source = `pkg.coverUrl`
- `decoding="async"`
- on error, fall back to visual placeholder

## Testing Strategy

Backend integration tests should cover:

- upload/list/download still works
- cover upload generates `coverUrl` and `coverThumbUrl`
- cover endpoints return WebP content type
- stored download zip contains `cover/cover.webp` and no original `cover/*`
- manifest `coverFiles` and `manifest.cover.workspacePath` point to WebP
- counts endpoint returns counts by type
- cursor pagination returns multiple batches without duplicates
- filter/sort combinations continue to work

Frontend build tests:

- `npm run build:contracts`
- `npm run build:web`

Backend validation:

- `go -C ./apps/platform-server test ./...`

## Rollback Shape

The change is contained to market APIs and UI. If WebP processing causes trouble:

- Revert upload zip rewrite and cover generation changes.
- Keep pagination/counts if stable, because they are independent.
- Existing raw cover behavior can be restored by returning `cover_blob_key` to original extraction flow.

No production data migration is required for this task.
