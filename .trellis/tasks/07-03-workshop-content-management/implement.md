# 创意工坊内容管理 — Implementation Plan

## Preconditions

- Task remains in planning until PRD/design/implement artifacts are reviewed.
- Do not start implementation until the user approves moving this task to `in_progress`.
- Before editing platform-web code, load `trellis-before-dev` for the relevant specs.

## Ordered Checklist

### 1. Shared contracts

- Add `updatedAt: string` to `MarketPackage` in `packages/contracts/src/market.ts`.
- If useful for type clarity, add shared list-scope/update parameter interfaces without adding runtime validation or browser APIs to contracts.
- Confirm `packages/contracts/src/index.ts` still exports `market.ts` through the existing barrel.

Validation after this slice:

- `npm run build:contracts`

### 2. Server domain and repository

- Extend `internal/market/market.go`:
  - `ListFilter.UploaderID`.
  - `CountFilter`.
  - `PackageUpdate`.
  - Repository methods `Counts(ctx, filter)`, `Update`, and `Delete`.
- Update `internal/market/sqlite_repo.go`:
  - Apply optional uploader filter to list queries.
  - Apply optional uploader filter to counts queries.
  - Implement `Update` with tags JSON marshal and `updated_at` refresh.
  - Implement `Delete` by package id.
  - Stop changing `updated_at` in `IncrementDownloadCount`, so `updatedAt` means publishing/update time rather than download time.

Validation after this slice:

- `go -C ./apps/platform-server test ./internal/market ./internal/server` if package selection works; otherwise defer to full server test.

### 3. Server handlers and routes

- Register authenticated routes in `internal/server/server.go`:
  - `GET /api/v1/market/my/packages`
  - `GET /api/v1/market/my/packages/counts`
  - `PATCH /api/v1/market/packages/{id}`
  - `DELETE /api/v1/market/packages/{id}`
- Add handlers in `internal/market/handler.go`:
  - `HandleListMine`
  - `HandleCountsMine`
  - `HandleUpdate`
  - `HandleDelete`
- Refactor upload/update shared helpers where it reduces duplication:
  - multipart parsing and max-size read
  - manifest-derived metadata fallback
  - cover processing and blob writes
  - best-effort blob cleanup
- Ensure update flow:
  - reads existing package first;
  - checks owner before reading/storing replacement blobs;
  - validates replacement with the existing resource type;
  - allows resourceId to change;
  - updates DB only after replacement blob/cover writes succeed;
  - cleans old cover blobs when cover keys change or clear.
- Ensure delete flow:
  - checks owner;
  - deletes DB record;
  - cleans zip, cover, and thumb blobs using keys from the target package.
- Add `updatedAt` to `packageResponse` and version cover URLs with `updatedAt` so replaced covers do not show stale browser-cached images.

Validation after this slice:

- `go -C ./apps/platform-server test ./...`

### 4. Server integration tests

Add/extend tests in `apps/platform-server/internal/server/market_test.go`:

- Owner can update metadata without replacing file; detail/list returns changed metadata and updatedAt.
- Owner can replace a package with the same resourceType and different resourceId; download returns replacement bytes, detail returns new resourceId/resourceVersion.
- Replacement with a different resourceType returns 400.
- Unauthenticated update/delete returns 401.
- Non-owner update/delete returns 403.
- Owner can hard-delete a package; list/detail/download/cover endpoints no longer expose it.
- Delete does not affect another package.

Use existing mock auth helpers where possible. If a second user is needed, create another session/user through repository or a test-only helper rather than weakening production auth.

### 5. Frontend API client

Update `apps/platform-web/src/platform-host/api-client.ts`:

- Add `marketApi.listMine(...)` and `marketApi.countsMine()` or support a `scope` parameter that selects public vs my endpoints internally.
- Add `marketApi.update(id, fileOrNull, params)` using multipart `PATCH`.
- Add `marketApi.delete(id)` using `DELETE`.
- Reuse `marketUploadFileName(resourceType)` for replacement upload filenames.

### 6. Frontend sidebar and scope state

Update `AppMarketView.vue` and `MarketResourceTypeSidebar.vue`:

- Add `MarketScope = "all" | "mine"` state.
- Sidebar receives current scope and emits a scope toggle.
- Sidebar bottom button label swaps between “我的上传” and “全部资源”.
- List params choose public/my endpoints based on scope.
- When scope is `mine` and not logged in, skip list/count requests and show in-pane login prompt with existing account-center affordance.
- Ensure switching resource type preserves current scope.
- Ensure switching scope returns to list screen, clears detail, resets pagination, and refreshes counts/list when appropriate.

### 7. Frontend detail management UI

Update `MarketPackageDetail.vue` and parent state in `AppMarketView.vue`:

- Compute owner status from `currentUser?.id === detailPackage.uploader.id`.
- Show owner-only “你的发布物” actions.
- Add inline edit mode for title/version/author/summary/tags.
- Track dirty flags for title/version/author/summary; keep tags independent from replacement manifest defaults.
- Add save/cancel states and updating error feedback.
- Keep install action available outside edit mode; do not mix delete into edit save flow.

### 8. Replacement selection dialog

Add `MarketReplacementDialog.vue` under `components/market/`:

- Use `FloatingWindow`, following the compact list-button pattern from `MarketInstallDialog.vue`.
- Props include current package/resource type, loading state, and available same-type replacement options.
- Emits selected `MarketUploadSelectionPayload` or a replacement-specific payload.
- Empty states stay concise: “没有可替换的 Agent。” etc.
- Do not add long explanatory source-scope text.

Parent behavior:

- Opening replacement dialog loads upload resources if needed.
- Replacement options use the same source scope as upload:
  - game cards: all local non-builtin cards;
  - Agent/Skill: current loaded card + desktop assistant.
- Selecting replacement reads manifest defaults from local option/export helpers and only fills non-dirty metadata fields.
- Saving exports the selected replacement package and sends it through `marketApi.update`.

### 9. Delete flow

- Add owner delete action in detail management area.
- Use existing `confirm` with danger style and concise “无法撤销” warning.
- On success:
  - toast success;
  - return to list;
  - clear detail;
  - refresh list/counts in current scope.

### 10. Final validation

Run:

- `npm run build:contracts`
- `npm run build:web`
- `go -C ./apps/platform-server test ./...`

Manual UI smoke test if a dev server is available:

- Public browse still works logged out.
- Logged out “我的上传” shows login prompt in creative workshop.
- Logged in upload → “我的上传” shows the resource.
- Owner detail shows edit/delete; non-owner does not.
- Edit metadata only updates list/detail.
- Replace package updates download bytes and resource metadata.
- Delete removes package from list/detail/download.

## Risk Areas / Rollback Points

- **Blob and DB consistency**: update writes blobs before DB update; failures must not leave DB pointing to missing content. Keep cleanup best-effort but visible in errors.
- **Cover cache**: replaced covers may be browser-cached unless cover URLs are versioned with `updatedAt`.
- **updatedAt semantics**: download count must not mutate `updated_at` after this task.
- **Owner checks**: frontend owner UI is not security; server must enforce uploader checks.
- **AppMarketView size**: if edit/replacement logic makes the view too large, move focused state/helpers into small market components or composables instead of adding unrelated concerns to the route view.

## Review Gate Before `task.py start`

- User approves the PRD/design/implement artifacts.
- `implement.jsonl` and `check.jsonl` contain real context entries, not only examples.
- The active task is then moved to `in_progress` with `task.py start`.
