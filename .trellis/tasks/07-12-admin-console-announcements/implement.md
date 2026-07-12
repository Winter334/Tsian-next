# Admin console and announcements — Implementation Plan

Planning artifact for `.trellis/tasks/07-12-admin-console-announcements/`.

## Implementation Strategy

Implement in vertical slices, keeping backend authority and user-visible flows testable at each step:

1. Shared contracts and backend primitives.
2. Admin authorization and admin static serving.
3. Workshop admin APIs and hidden-resource filtering.
4. Announcement APIs and player announcement center.
5. Presence heartbeat and taskbar online count.
6. Separate `apps/admin-web` management UX.
7. Full validation and polish.

Do not start by building admin UI mock screens against fake data; backend contracts and authorization should land first so the admin app exercises real API states.

## Step 1 — Shared contracts

Files:

- `packages/contracts/src/announcement.ts`
- `packages/contracts/src/admin.ts`
- `packages/contracts/src/presence.ts`
- `packages/contracts/src/market.ts`
- `packages/contracts/src/index.ts`

Tasks:

- Add announcement request/response types.
- Add `AdminMeResponse`.
- Add `PresenceSummaryResponse`.
- Add admin market extensions (`AdminMarketPackage`, list response, metadata update request).
- Keep public `MarketPackage` unchanged unless needed for normal player flows.

Validation:

- `npm run build:contracts`

## Step 2 — Server config, admin authorization, and static serving

Files:

- `apps/platform-server/internal/config/config.go`
- `apps/platform-server/internal/admin/authorizer.go` or equivalent
- `apps/platform-server/internal/middleware/admin.go`
- `apps/platform-server/internal/server/server.go`
- `apps/platform-server/internal/server/server_test.go`

Tasks:

- Add `TSIAN_ADMIN_DISCORD_IDS` parsing.
- Add `TSIAN_ADMIN_STATIC_DIR` with default `../admin-web/dist`.
- Add backend admin authorization using Discord `auth_identities.subject` allowlist.
- Add `GET /api/v1/admin/me`.
- Add `/admin/` static SPA serving from `AdminStaticDir`, separate from platform `StaticDir`.
- Ensure `/api/` never falls through to either SPA.

Tests:

- unauthenticated `/api/v1/admin/me` -> `401`.
- logged-in non-admin -> `403`.
- logged-in allowlisted Discord identity -> `200`.
- `/admin/` serves admin static when available without breaking platform root.

Validation:

- `go test ./...` from `apps/platform-server`.

## Step 3 — Database additions

Files:

- `apps/platform-server/internal/storage/db.go`

Tasks:

- Add additive migration helpers for `market_packages.hidden_at` and `market_packages.hidden_by`.
- Add `announcements` table and index.
- Add `presence_sessions` table and indexes.
- Follow the existing `ensureMarketPackageColumns` additive migration style.

Tests:

- Existing legacy DB migration test should be extended or supplemented so old `market_packages` tables get the new hidden columns.
- New tables exist after `OpenSQLite`.

Validation:

- `go test ./...` from `apps/platform-server`.

## Step 4 — Workshop hidden-resource model and admin APIs

Files:

- `apps/platform-server/internal/market/market.go`
- `apps/platform-server/internal/market/sqlite_repo.go`
- `apps/platform-server/internal/market/handler.go`
- `apps/platform-server/internal/market/admin_handler.go`
- `apps/platform-server/internal/server/server.go`
- `apps/platform-server/internal/server/market_test.go`

Tasks:

- Extend repository model with `HiddenAt` / `HiddenBy` for admin responses.
- Add list/detail support for admin visibility filters.
- Update public list/count/get/download/cover/cover-thumb to exclude hidden packages.
- Add admin endpoints:
  - `GET /api/v1/admin/market/packages`
  - `GET /api/v1/admin/market/packages/{id}`
  - `PATCH /api/v1/admin/market/packages/{id}` for metadata only
  - `POST /api/v1/admin/market/packages/{id}/hide`
  - `POST /api/v1/admin/market/packages/{id}/unhide`
  - `DELETE /api/v1/admin/market/packages/{id}`
- Reuse existing delete blob cleanup behavior.
- Do not add package-byte replacement to admin metadata update.

Tests:

- Admin list sees all visible/hidden resources.
- Public list/count/detail/download do not see hidden resources.
- Hide/unhide transitions update admin response and public visibility.
- Admin metadata update changes title/summary/tags only.
- Admin delete removes DB row and blob endpoints like owner delete.
- Non-admin cannot call admin market APIs.

Validation:

- `go test ./...` from `apps/platform-server`.

## Step 5 — Announcement backend APIs

Files:

- `apps/platform-server/internal/announcement/announcement.go`
- `apps/platform-server/internal/announcement/sqlite_repo.go`
- `apps/platform-server/internal/announcement/handler.go`
- `apps/platform-server/internal/server/server.go`
- new/extended server tests

Tasks:

- Implement announcement repository.
- Implement public `GET /api/v1/announcements`.
- Implement admin list/create/update/delete under `/api/v1/admin/announcements`.
- Validate trimmed title/body, non-empty, max lengths.
- Return newest first.

Tests:

- Public list returns announcements.
- Admin create/update/delete works for allowlisted admins.
- Non-admin mutation attempts fail.
- Empty/too-long title/body return `400`.

Validation:

- `go test ./...` from `apps/platform-server`.

## Step 6 — Presence backend APIs

Files:

- `apps/platform-server/internal/presence/presence.go`
- `apps/platform-server/internal/presence/sqlite_repo.go`
- `apps/platform-server/internal/presence/handler.go`
- `apps/platform-server/internal/server/server.go`
- new/extended server tests

Tasks:

- Add `POST /api/v1/presence/heartbeat`.
- Add `GET /api/v1/presence/summary`.
- Generate/use `tsian_presence` cookie.
- Upsert `last_seen_at` and optional `user_id`.
- Count sessions active in the last 60 seconds.
- Opportunistically prune stale rows older than the retention window.

Tests:

- Heartbeat creates cookie and counts one online session.
- Repeated heartbeat with same cookie does not double-count.
- Multiple cookies count as multiple browser sessions.
- Old `last_seen_at` rows are excluded.

Validation:

- `go test ./...` from `apps/platform-server`.

## Step 7 — Player platform API client and taskbar presence

Files:

- `apps/platform-web/src/platform-host/api-client.ts`
- `apps/platform-web/src/components/desktop/DesktopShell.vue`
- optional composable: `apps/platform-web/src/composables/usePresence.ts`
- `apps/platform-web/src/style.css` if taskbar CSS needs shared classes

Tasks:

- Add presence API helpers.
- Send heartbeat on mount and every ~30 seconds while the desktop is active.
- Display online count in the desktop taskbar near account/clock controls.
- Handle loading/error states without breaking layout.
- Clean up timers on unmount.

Validation:

- `npm run build:web`

## Step 8 — Player platform announcement center

Files:

- `apps/platform-web/src/platform-host/api-client.ts`
- `apps/platform-web/src/views/AnnouncementCenterView.vue`
- `apps/platform-web/src/desktop-apps.ts`
- `apps/platform-web/src/router/index.ts`
- `apps/platform-web/src/components/desktop/DesktopShell.vue`
- optional composable: `apps/platform-web/src/composables/useAnnouncements.ts`

Tasks:

- Add public announcement API helper.
- Add announcement center route/window registration without adding a desktop launcher icon.
- Add taskbar announcement button.
- Track read IDs in localStorage.
- Render announcement body Markdown with the safe announcement Markdown renderer.
- Show unread count in taskbar.
- Mark announcement read when opened/selected.
- Optionally show non-blocking toast only for newly discovered announcements after initial load.

Validation:

- `npm run build:web`

## Step 9 — Create separate admin web app

Files/directories:

- `apps/admin-web/package.json`
- `apps/admin-web/index.html`
- `apps/admin-web/vite.config.ts`
- `apps/admin-web/tsconfig*.json`
- `apps/admin-web/src/main.ts`
- `apps/admin-web/src/App.vue`
- `apps/admin-web/src/style.css`
- `apps/admin-web/src/api-client.ts`
- `apps/admin-web/src/views/WorkshopAdminView.vue`
- `apps/admin-web/src/views/AnnouncementsAdminView.vue`
- `apps/admin-web/src/views/OverviewView.vue` or simple landing view
- root `package.json`

Tasks:

- Add `apps/admin-web` workspace.
- Add root `build:admin` script.
- Configure Vite alias for `@tsian/contracts`.
- Set production base to `/admin/`.
- Implement auth probe states:
  - loading;
  - login required;
  - forbidden;
  - authorized shell.
- Implement simple admin layout: top bar, side nav, content.
- Implement workshop management page against real admin APIs.
- Implement announcement management page against real admin APIs.
- Implement Markdown authoring with preview using the shared safe announcement Markdown renderer.
- Prioritize readable tables, clear states, and confirmation dialogs over decorative styling.

Validation:

- `npm run build:admin`

## Step 10 — Integration polish

Tasks:

- Ensure admin-web and platform-web can both use cookies with same API origin.
- Verify ordinary platform bundle has no admin UI imports/routes.
- Verify public workshop pages handle hidden resources as not found.
- Verify taskbar layout at normal and narrow widths.
- Verify admin UX failure states: network errors, empty lists, validation errors, unauthorized session expiry.
- Update any docs/readme if needed for admin env vars and build/deploy commands.

Validation:

- `npm run build:contracts`
- `npm run build:web`
- `npm run build:admin`
- `go test ./...` from `apps/platform-server`

## Risk / Rollback Points

- **Admin authorization**: if Discord allowlist lookup is wrong, admin access can be blocked or over-granted. Keep tests for unauth/non-admin/admin before adding mutation APIs.
- **Hidden resource filtering**: easy to miss public cover/download endpoints. Test every public route that exposes a package or blob.
- **Admin static serving**: `/admin/` routing must not break existing platform SPA fallback. Keep server tests around `/api/`, `/admin/`, and `/`.
- **Presence count**: heartbeat over-counts browser sessions by design. Do not reinterpret it as unique account count in UI copy; use “在线” rather than “在线用户”.
- **Announcement read state**: localStorage read state is local-only. Avoid UI wording that promises cross-device sync.
- **Markdown rendering**: do not display announcement Markdown with unsanitized `v-html`; admin preview and player display must use the same safe renderer and handle headings, lists, links, tables, and code blocks readably.
- **New admin app setup**: if workspace/package setup threatens schedule, build a minimal admin app shell first, then add pages incrementally; do not move admin UI into `platform-web` as a shortcut because that violates the PRD security/UX decision.

## Definition of Done

- PRD acceptance criteria pass.
- `apps/admin-web` is a separate build and contains the admin UX.
- `apps/platform-web` contains only player-facing taskbar, presence, and announcement center work.
- Admin APIs are backend-protected by the Discord ID allowlist.
- Hidden workshop resources are consistently excluded from public flows.
- Simple announcements are manageable by admins and readable by players.
- Heartbeat online count appears in the taskbar with graceful degradation.
- Required validation commands have passed or failures are reported with output.
