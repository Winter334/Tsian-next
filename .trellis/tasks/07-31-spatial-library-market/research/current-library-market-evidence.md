# Spatial Library and Market Current Evidence

## Registry and shell boundary

- `apps/platform-web/src/platform-apps.ts:60` defines Spatial readiness as `pending | ready`; `presentation()` at line 125 currently writes `pending` for every app at line 134.
- The three owned registrations begin at `platform-apps.ts:149` (`market`), `:155` (`my-apps`) and `:191` (`game-launcher`). Route identity and RetroOS component/defaults already live beside the Spatial registration.
- `apps/platform-web/src/spatial/shell/SpatialWindowSurface.vue:54` mounts a Spatial component only when readiness is `ready`; otherwise line 57 mounts `SpatialPendingAppSurface`.
- Both shells watch the router and open/focus the descriptor for the current route. Application views should navigate by route and must not import a shell-specific window manager.
- `apps/platform-web/src/App.vue:20` mounts Spatial as a shell peer. Global `ToastHost`, `ConfirmHost` and `FloatingWindow` remain at lines 37–39 for both shells and are owned by the later global-surfaces child.

## My Apps current behavior

- `GameCardLibraryView.vue:324` performs the authoritative card/active-card refresh and filters builtin cards.
- The view creates, imports, opens, copies, loads, updates and deletes through existing platform-host APIs; no direct storage writes belong in either presentation.
- Source-local context-menu translation begins at `GameCardLibraryView.vue:400`, using the route root rectangle rather than viewport-fixed placement.
- Existing card and active-card subscriptions are registered at lines 606–607, removed at 612–613, and respond with complete re-reads at 620/627.
- The template calls `getGameCardCoverUrl` repeatedly at lines 94–95. Spatial must instead pass a stable typed source into the new media resolver.

## App Market current behavior

- `AppMarketView.vue:427` owns catalog refresh; filters, pagination and request sequencing are local to the component.
- The view imports `openDialogForm` at line 211 and `useDesktopWindows` at line 239, creating a shell-specific Account navigation dependency at lines 272 and 1143. The controller extraction must remove only the window-manager dependency; generic dialog/confirm/toast commands remain shared platform APIs.
- The workflow naturally separates into catalog/detail, local resource inventory/option derivation, and upload/install/manage operations. Moving all 1000+ script lines into one composable would preserve the current structural problem.
- Market cover URLs are API-provided same-origin paths (`coverUrl` / `coverThumbUrl`), so they do not need a proxy or persistent media copy.

## Game Card detail current behavior

- `GameCardDetailView.vue:491` defines the cover draft union; `hasUnsavedChanges` begins at line 549.
- The view registers/clears the stable detail-window close guard at lines 961/967 and resolves the veto at line 980.
- `composables/window-close-guards.ts:14` is shell-neutral. `spatial/shell/window-session.ts:107` already executes the same guard and forgets it only after approved close at line 131.
- Metadata and cover are draft-until-saved. Frontend binding has none/remote/packaged modes, pending package input, file listing, import/export and clear behavior. All of those states must move together into the shared detail controller.

## State and event contracts relevant to this child

- Use per-window Vue `ref`/`computed`/`watch`; do not add Pinia/Vuex or another singleton cache.
- Platform-host and market APIs remain authoritative. After a mutation, use the existing success event or an explicit complete re-read instead of assuming an optimistic local record is authoritative.
- `GAME_CARDS_CHANGED_EVENT` and `ACTIVE_CARD_CHANGED_EVENT` are payload-light invalidation signals. Subscribe on mount, unsubscribe on unmount, and re-read the current view context.
- Non-closed Spatial windows stay mounted through focus, occlusion and minimize. The controller state therefore survives those transitions naturally; only close may dispose subscriptions, timers and object URLs.
- Shared composables expose explicit mutation commands. Persistence remains in platform-host/storage APIs, and timers/subscriptions are cleaned during unmount.

## Media evidence

- `lib/game-card-display.ts:45` provides `getGameCardCoverUrl`; for workspace covers it creates a new object URL at line 70 on every call and does not expose ownership. That helper is unsuitable as the Spatial media lifecycle boundary.
- Local card records already preload `coverContentFile.data` as a Blob. Spatial can pass that Blob directly to a controlled resolver.
- User-authored `manifest.cover.url` may be cross-origin. HTML-in-Canvas can omit unreadable pixels, so external HTTP(S) images must succeed under CORS and be materialized as an owned Blob URL; rejection becomes a designed placeholder.
- Market server cover paths are same-origin. Upload cover previews are caller-owned draft URLs until the detail controller resets or unmounts.
- No backend image proxy, storage schema, contract field or persisted duplicate is required for the known sources.

## Required preservation matrix

- RetroOS route identity, shell chrome and current workflows remain unchanged after controller extraction.
- `market`, `my-apps` and `game-launcher` are the only Spatial registrations allowed to become ready in this child.
- Production Spatial selection remains gated.
- Engine projection/input/window presentation modules are read-only for this task; application components consume their existing contracts.

## Product clarification: visual unity before layout parity

- The user requires these application windows to share the visual language of the completed Spatial framework. The current shell authority is `spatial-shell.css`: warm off-white body/frame, charcoal controls and ink, muted gray hierarchy, restrained red accent, plus existing cyan/orange semantic tokens and the JetBrains Mono/Inter type relationship.
- Archived shell acceptance explicitly rejects cyan-heavy technology panels, glow, gradient, backdrop blur, bevel/shadow material depth and a separate active-window decoration language. Application content must not reintroduce those patterns as its own theme.
- Layout may change when necessary. Existing RetroOS templates define required information and actions, not pixel placement. Spatial layouts may regroup columns, command areas, cards and detail sections for curved-edge readability, projected target size, keyboard order and recoverable window dimensions.
- Visual consistency and functional parity are separate review gates: matching the framework does not excuse missing workflows, and preserving workflows does not excuse a visually unrelated app skin.

## Manual product findings: shared controls and motion

Evidence screenshots:

- `codex-clipboard-d7ac2af5-c5a0-497f-a792-ea1d2b544aac.png` — Market native sort `<select>` opens a browser-themed white/blue popup that does not follow the curved Spatial Source; icon+text upload action lacks a stable shared alignment contract.
- `codex-clipboard-99a53bc1-a3cf-4082-a530-e7af10cca203.png` — Detail name input shows a prominent red focus rectangle, and several icon+text actions render with awkward vertical/baseline relationships.

Repository evidence:

- `spatial-apps.css` currently applies a global 2px accent outline and offset to every focusable control.
- The base `.spatial-app__button` lacks an explicit flex/icon layout; SVG size is declared but icon/text alignment and gap are not.
- `SpatialAppMarketView.vue` uses native `<select>` for sort and compact resource type.
- Spatial app views mostly use `v-if`/`v-else` replacement without shared Vue transitions; only reduced-motion override rules exist.

Product decisions:

- Establish a Source-local custom Select, one Action Button primitive, no outer focus rectangles and richer bounded content transitions in this task.
- Browser testing is performed manually by the user. Automated coverage remains focused on durable behavior/state contracts.
- Do not continuously repair or expand unrelated legacy tests; the five reproducible failures in untouched shell/engine tests are recorded as baseline drift and are not part of this child.
