# 优化创意工坊封面流量 — Implementation Plan

## Preconditions

- Task status must be `in_progress` before code edits.
- Before code edits, run `trellis-before-dev` and read relevant specs.

## Implementation Checklist

### 1. Contracts

- [ ] Update `packages/contracts/src/market.ts`:
  - [ ] add `coverThumbUrl: string | null` to `MarketPackage`
  - [ ] add `MarketPackageListResponse`
  - [ ] add `MarketPackageCountsResponse`
  - [ ] add any useful list param/count types

### 2. Server Dependencies

- [ ] Add Go image dependencies:
  - [ ] `github.com/gen2brain/webp`
  - [ ] `github.com/disintegration/imaging`
- [ ] Confirm dependency graph does not require bumping module `go` version beyond 1.24.

### 3. Server Domain / Schema / Repository

- [ ] `apps/platform-server/internal/storage/db.go`
  - [ ] add `cover_thumb_blob_key TEXT` to fresh table definition
  - [ ] add idempotent `ensureMarketPackageColumns` entry
  - [ ] add indexes if needed for stable cursor sorts
- [ ] `apps/platform-server/internal/market/market.go`
  - [ ] add `CoverThumbBlobKey`
  - [ ] extend `ListFilter` for cursor state if needed
  - [ ] add count repository method shape
- [ ] `apps/platform-server/internal/market/sqlite_repo.go`
  - [ ] select/insert/scan/hydrate `cover_thumb_blob_key`
  - [ ] implement `limit + 1` pagination
  - [ ] stabilize sorting with `id` tie-breaker
  - [ ] implement counts query

### 4. Server Image Processing / Zip Rewrite

- [ ] In `handler.go`, refactor upload flow so package ID is known before stored zip bytes are finalized.
- [ ] Extract cover from uploaded game-card zip.
- [ ] Decode supported raster image types.
- [ ] Generate display WebP (`1280px` long edge / q72).
- [ ] Generate thumbnail WebP (`512x640` fill crop / q68).
- [ ] Rewrite zip to remove original `cover/*` and add `cover/cover.webp`.
- [ ] Update package manifest inside zip:
  - [ ] `coverFiles`
  - [ ] `manifest.cover.workspacePath`
  - [ ] preserve `manifest.cover.alt` when available
- [ ] Store rewritten zip and WebP blobs.
- [ ] Ensure cleanup deletes both cover blobs if repo create fails.

### 5. Server HTTP API

- [ ] `packageResponse` adds `coverThumbUrl`.
- [ ] `listResponse` adds `nextCursor`.
- [ ] `HandleList` parses `limit` and `cursor`.
- [ ] Add `HandleCounts`.
- [ ] Add `HandleCoverThumb` or a shared cover variant helper.
- [ ] Register counts and cover-thumb routes in `server.go`.

### 6. Frontend API Client

- [ ] Update imports/types from contracts.
- [ ] Update `marketApi.list()` to return list response and accept `limit/cursor`.
- [ ] Add `marketApi.counts()`.

### 7. Frontend Market View

- [ ] Add page size, cursor, loading-more, and request guard state.
- [ ] `refresh()` loads first page and replaces packages.
- [ ] `loadMore()` appends next page.
- [ ] Replace sidebar count list calls with `marketApi.counts()`.
- [ ] Add load-more footer states.
- [ ] Reset pagination on type/search/tag/sort changes.

### 8. Frontend Image Components

- [ ] `MarketPackageGrid.vue`
  - [ ] use `pkg.coverThumbUrl ?? pkg.coverUrl`
  - [ ] add `loading="lazy"`
  - [ ] add `decoding="async"`
  - [ ] add error fallback to visual placeholder
- [ ] `MarketPackageDetail.vue`
  - [ ] add `decoding="async"`
  - [ ] add error fallback to visual placeholder

### 9. Tests

- [ ] Update `apps/platform-server/internal/server/market_test.go`:
  - [ ] build a valid test PNG/JPEG cover in test zip
  - [ ] assert upload response cover URLs
  - [ ] assert `/cover` and `/cover-thumb` WebP headers
  - [ ] assert downloaded zip contains normalized WebP cover and manifest updates
  - [ ] assert counts endpoint
  - [ ] assert cursor pagination across multiple packages

### 10. Validation

Run:

```bash
go -C ./apps/platform-server test ./...
npm run build:contracts
npm run build:web
```

If Go build is run separately, verify `apps/platform-server/platform-server.exe` is not accidentally committed.

## Risky Files / Rollback Points

- `apps/platform-server/internal/market/handler.go`: largest change; keep image processing helpers small and testable.
- `apps/platform-server/internal/market/sqlite_repo.go`: cursor predicates must match sort order.
- `apps/platform-web/src/views/AppMarketView.vue`: stale async list responses can corrupt pagination state; use request guard.
- Go image dependencies may increase build time; if unacceptable, keep pagination/counts changes and revert WebP processing separately.
