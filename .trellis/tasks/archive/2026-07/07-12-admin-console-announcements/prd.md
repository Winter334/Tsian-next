# Admin console and announcements

## Goal

Add a separate developer/admin management web app for Creative Workshop operations and announcement publishing, while adding a player-side announcement center and current online-user count to the platform desktop taskbar.

## User Value

- Developers can manage Creative Workshop content without exposing admin UI inside the normal player platform bundle.
- Players can see platform announcements from a durable announcement center without disruptive modal flows.
- Players can see a lightweight current online count from the platform desktop taskbar.

## Confirmed Facts

- The platform shell is a Vue desktop UI. Desktop launchers and windows are registered in `apps/platform-web/src/desktop-apps.ts`; Creative Workshop is the existing `market` app with label/title/caption at `apps/platform-web/src/desktop-apps.ts:93` and route `/market` at `apps/platform-web/src/router/index.ts:16`.
- The desktop taskbar is rendered in `apps/platform-web/src/components/desktop/DesktopShell.vue:68`; it currently contains the start button, open-window task buttons, account-center button, and clock (`apps/platform-web/src/components/desktop/DesktopShell.vue:68`, `apps/platform-web/src/components/desktop/DesktopShell.vue:94`, `apps/platform-web/src/components/desktop/DesktopShell.vue:112`). Its shared styling lives in `apps/platform-web/src/style.css:185`.
- Existing global feedback surfaces are transient toasts (`apps/platform-web/src/components/feedback/ToastHost.vue:1`, `apps/platform-web/src/composables/useToast.ts:1`) and modal/floating windows (`apps/platform-web/src/components/feedback/FloatingWindow.vue:1`, `apps/platform-web/src/components/feedback/ConfirmHost.vue:1`). No durable announcement inbox/banner system was found in the searched code/docs.
- Creative Workshop backend routes already support public list/count/detail/download and authenticated owner upload/update/delete under `/api/v1/market/...` (`apps/platform-server/internal/server/server.go:46`). The current owner-management check only allows a package uploader to update/delete their own package (`apps/platform-server/internal/market/handler.go:343`, `apps/platform-server/internal/market/handler.go:400`).
- Shared workshop contract types currently cover packages, uploaders, list responses, and counts only (`packages/contracts/src/market.ts:0`).
- Auth currently exposes a `User` without role/admin fields (`packages/contracts/src/user.ts:2`). Server config has Discord registration gate settings but no admin-user config yet (`apps/platform-server/internal/config/config.go:9`).
- The SQLite schema has `users`, `auth_identities`, `sessions`, and `market_packages`, but no admin roles, announcements, presence, or workshop-hidden-state fields (`apps/platform-server/internal/storage/db.go:39`, `apps/platform-server/internal/storage/db.go:58`, `apps/platform-server/internal/storage/db.go:66`).
- No WebSocket/SSE/presence implementation was found by keyword search; online-user count needs a new presence flow.
- Prior archived Trellis tasks confirm Creative Workshop is the intended user-facing concept and that route/code identifiers may remain `market` while visible copy says “创意工坊”.

## Requirements

### R1: Separate admin web app

- The admin console is a separate management page/app, not a desktop app inside the normal player platform.
- Implement the management frontend as a separate `apps/admin-web` app for MVP, reusing shared contracts and platform-server admin APIs instead of embedding admin components into `apps/platform-web`.
- The normal player platform bundle must not include admin routes/components/copy, beyond minimal API/auth behavior that is unavoidable.
- The admin app should be deployable under a standalone management path such as `/admin/` or behind a separate host later.

### R2: Admin access control

- Admin APIs and UI must not be available to ordinary logged-in users.
- MVP admin identity is configured by a server-side Discord user ID allowlist, for example `TSIAN_ADMIN_DISCORD_IDS=123456789,987654321`.
- The admin frontend verifies access through an admin-only API such as `/api/v1/admin/me`.
- The backend remains the authority for all admin permissions; frontend hiding is never a security boundary.
- Ordinary users who reach the admin page manually receive login/forbidden states and cannot call admin APIs successfully.

### R3: Creative Workshop admin management

- Admins can view all workshop resources across uploaders.
- Admins can filter/search resources by resource type, keyword, uploader, and visibility state where practical.
- List rows must show scan-friendly metadata: resource type, title/name, uploader, downloads, visibility state, created/updated time, and primary action entry.
- Admins can hide/unhide resources. Hidden resources are not visible/downloadable through ordinary Creative Workshop endpoints.
- Admins can edit publish metadata such as title, summary, and tags.
- Admins can physically delete a resource only from a clearly marked dangerous action with confirmation.
- Governance features are out of MVP unless later added: uploader bans, report queues, full review workflow, featured/pinned resources, replacing another uploader's package bytes, and complete audit-log UI.

### R4: Announcement publishing and player display

- Store announcements server-side so new/returning users can see relevant announcements after reload.
- Keep MVP announcement rules simple: no draft/published/archived workflow, no expiry time, no critical/important severity matrix, no segmentation, and no must-read blocking flow.
- MVP announcement fields are limited to practical display needs: title, Markdown body, and creation/update/publish time.
- Announcement Markdown must render well for common authoring needs: paragraphs, headings, emphasis, lists, blockquotes, links, tables, inline code, and fenced code blocks.
- Announcement Markdown rendering must be safe: raw HTML/script/event-handler injection is not allowed, and rendered links must avoid dangerous URL schemes.
- Admins can create, edit, list, and delete announcements from `apps/admin-web`.
- The player-side announcement center is a desktop-window app opened from a compact taskbar announcement button, not a desktop icon for MVP.
- New announcements may surface a non-blocking toast prompt; the durable source of truth is the announcement center window with list/detail/history.
- The taskbar announcement button shows unread state, such as an unread count or highlighted signal state.
- Read/dismiss state may be tracked locally in the player browser for MVP; cross-device read sync is not required.

### R5: Online-user count in desktop taskbar

- Show current online-user count in the bottom desktop taskbar.
- MVP online count uses heartbeat-based approximate presence, not WebSocket/SSE realtime connection tracking.
- Count active browser sessions, including anonymous visitors and logged-in users, whose heartbeat was seen recently; use a 60-second active window unless technical validation suggests a small adjustment.
- The platform web app sends heartbeat roughly every 25-30 seconds while open.
- The taskbar display fits the existing compact retro taskbar next to account/clock controls and handles loading/error states gracefully, such as `在线 --` or hiding the count when unavailable.

### R6: UX quality over decorative UI

- Visual ambition is secondary; UX quality is the priority.
- Admin pages optimize for readability and management efficiency: clear hierarchy, searchable/filterable tables, obvious item states, predictable actions, and low-friction edit flows.
- Destructive actions are visually separated into a dangerous area and require confirmation.
- Hidden/restored/public resource states are easy to scan in lists without opening every detail page.
- Announcement authoring stays simple and hard to misuse: title, Markdown body, preview, publish/save action, and clear success/error feedback.
- The player-side announcement center is easy to read, with obvious unread/read distinction and no distracting visual effects.

## Technical Notes

- `apps/admin-web` should be a separate Vite/Vue app and separate build output, not a route chunk inside `apps/platform-web`.
- `platform-server` likely needs an admin static directory or equivalent deployment mechanism so `/admin/` can serve the separate admin bundle while `/` continues serving the platform desktop SPA.
- Workshop hide/unhide likely requires a new persistent hidden/visibility field on `market_packages`; ordinary public endpoints must filter hidden resources while admin endpoints can include them.
- Announcement APIs should be split by authority: public/player read APIs under `/api/v1/announcements`, admin mutation APIs under `/api/v1/admin/announcements`.
- Presence can be implemented with a lightweight cookie-backed session ID and heartbeat table or equivalent repository; exact realtime socket infrastructure is intentionally out of scope.

## Acceptance Criteria

- [ ] A separate `apps/admin-web` management frontend exists and can be built independently from `apps/platform-web`.
- [ ] Admin users can access the management app; unauthenticated users see a login path/state; non-admin logged-in users see a forbidden state.
- [ ] All admin APIs require backend admin authorization based on the Discord ID allowlist.
- [ ] Admin users can inspect Creative Workshop resources across all uploaders with readable searchable/filterable management UI.
- [ ] Admin users can hide and restore workshop resources; hidden resources are absent from ordinary Creative Workshop list/detail/download flows.
- [ ] Admin users can edit resource title/summary/tags without replacing package bytes.
- [ ] Admin users can permanently delete a resource only after an explicit dangerous confirmation.
- [ ] Admin users can create, edit, list, and delete simple Markdown announcements.
- [ ] Announcement Markdown is rendered safely and readably in both admin preview and player announcement center, including headings, lists, links, tables, and code blocks.
- [ ] Players can open the announcement center from the desktop taskbar, read announcement history, and distinguish unread/read announcements.
- [ ] New announcements can produce a non-blocking player-side prompt without requiring a modal/must-read flow.
- [ ] The desktop taskbar shows an online-user count from heartbeat-based presence and handles loading/error states without breaking layout.
- [ ] Backend tests cover admin authorization, workshop hide/unhide filtering, announcement APIs, and online-count semantics.
- [ ] Frontend/contract builds pass for affected packages.

## Out of Scope

- Admin UI embedded in the player platform desktop.
- Full community moderation workflow with reports, appeals, audit logs, reviewer queues, or uploader bans.
- Featured/pinned resources or replacing package bytes on behalf of another uploader.
- Rich announcement segmentation by user cohort, game card, locale, or A/B test group.
- Announcement draft/publish/archive lifecycle, expiry time, severity matrix, or must-read blocking flow.
- Push notifications outside the web app (browser push, email, Discord).
- Exact realtime presence with WebSocket/SSE fanout.
- Cross-device announcement read/dismiss sync.

## Open Questions

None currently blocking the MVP scope.
