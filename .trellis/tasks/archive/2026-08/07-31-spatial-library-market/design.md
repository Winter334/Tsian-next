# Spatial Library and Market Technical Design

## 1. Boundary

This child owns the first three real Spatial application presentations:

- My Apps (`my-apps` / `/library`)
- App Market (`market` / `/market`)
- Game Card detail/property (`game-launcher` / `/cards/:cardId`)

It also owns the minimum shared controller extraction required for RetroOS and Spatial to share behavior, plus a reusable Spatial image policy for later panel children.

It does not own renderer/projection geometry/window-session changes, global Toast/Confirm/FloatingWindow presentation, other application groups, backend/contracts/storage schema, or the production Spatial release gate. It may add the minimum viewport/frame-scheduler bridge needed to recapture opt-in application Sources during bounded CSS transitions, plus the minimum projected-default-action adapter required for custom Select clicks and native scrollbar thumb dragging. Neither exception may change curve math, hit resolution, window presentation, or idle scheduling.

## 2. Evidence and Constraints

- `platform-apps.ts` already separates `retro` and `spatial` registrations, but the helper currently marks every Spatial presentation `pending` and omits its component.
- `SpatialWindowSurface.vue` mounts a dedicated Spatial component only when registration is `ready`; otherwise it renders `SpatialPendingAppSurface`.
- The three RetroOS views are presentation/business monoliths (641/1286/1004 lines). Their existing platform-host calls are valid and must remain the sole mutation paths.
- Route changes are already observed by both shells. A view can navigate to `/account`, `/market`, `/library`, or a card detail route without importing either shell's window manager.
- Close guards already live in `composables/window-close-guards.ts` and are consumed by both RetroOS and Spatial window sessions.
- The Spatial source tree stays mounted for every non-closed window. View state therefore remains per component instance; no persistence layer is needed for focus/minimize preservation.
- Market covers are server-provided same-origin paths. Local card workspace covers are preloaded Blobs. User-authored external cover URLs are the only expected CORS-sensitive source in this child.
- Product direction requires the application windows to look native to the accepted Spatial shell. Layout parity with RetroOS is not required and may be changed when the Spatial window context benefits.

## 3. Target Topology

```text
platform app registry
  -> retro component --------------------┐
  -> spatial component ------------------┤
                                         v
                         shared per-instance controllers
                           -> platform-host / market API
                           -> auth + confirm/toast commands
                           -> existing change events
                           -> shell-neutral router navigation

spatial presentations
  -> Spatial app CSS/primitives
  -> domain-specific Spatial components
  -> shared Spatial image resolver
  -> Source-local context menus/dialogs
```

The controller owns domain state and commands. Each presentation owns markup, responsive arrangement, focus policy, context-menu coordinates, and visual state composition.

## 4. Shared Controller Extraction

### 4.1 My Apps controller

Extract a per-instance controller that owns:

- card list, selected/active ids, update metadata and async/error/feedback flags;
- authoritative refresh and existing game-card/active-card event subscriptions;
- create/import/copy/load/update/delete commands;
- capability predicates and confirmation messages.

Keep route opening, card focus order and context-menu placement at the presentation boundary. The controller may receive shell-neutral callbacks such as `openCard(cardId)` or the views may call `router.push` directly.

### 4.2 Game Card detail controller

Extract a per-instance controller that owns:

- card/active-card/frontend-file loading;
- metadata, cover and frontend-binding drafts;
- save/load/delete/export/import commands and derived capability/status fields;
- upload-preview URL lifetime;
- active-card refresh and `detailWindowIdFor(cardId)` close-guard registration.

The tab arrangement and form markup stay presentation-owned. A reactive card id is accepted so one controller instance can reset and reload when route props change.

### 4.3 Market controller modules

The current market view has three natural seams. Preserve those seams instead of moving the whole script into another god file:

1. catalog/detail state: resource type, scope, query/tag/sort, pagination, detail loading;
2. local resource inventory: cards/files/assistant resources and Agent/Skill/Tool option derivation;
3. package operations: upload/export, install targeting, update/replacement and delete.

Expose one view-facing controller composed from focused modules or pure helpers. Shared state must be passed explicitly; do not create a global market singleton. Clear search/tag timers and any subscriptions during unmount.

The controller must not call `useDesktopWindows`. `openAccountCenter` becomes a route command so either shell opens the registered Account window.

### 4.4 Migration rule

Move one business seam at a time and switch the existing RetroOS consumer immediately. Build/type-check after each major extraction. Only after the RetroOS view is green may the corresponding Spatial presentation be added. This prevents a late, unreviewable rewrite of three unrelated workflows.

## 5. Spatial Presentation Structure

Place Spatial-only application code under a focused `src/spatial/apps/` tree rather than `views/` or the shell folder. A likely shape is:

```text
spatial/apps/
  spatial-apps.css
  media/
  library/
  game-card-detail/
  market/
```

Exact component splits follow real reuse seams, but the top-level registered components remain dedicated Spatial route presentations. They do not import the RetroOS views and do not depend on `retro-*` classes.

### 5.0 Visual-system contract and layout freedom

The accepted shell is the visual authority. Application content inherits and consumes its current variables rather than defining a parallel palette:

- `--spatial-window-body` / `--spatial-window-frame` for the warm gray-white material family;
- `--spatial-window-ink`, `--spatial-window-tab`, and `--spatial-window-tab-muted` for readable charcoal/gray hierarchy;
- `--spatial-window-accent` for restrained active/destructive emphasis;
- existing `--spatial-cyan*` and `--spatial-orange` only for the semantic roles already established by the framework, not as a new cyan HUD skin;
- JetBrains Mono for compact labels/status and Inter for readable headings/body where the shell already uses that relationship.

App CSS may introduce semantic aliases such as `--spatial-app-surface-muted`, but every alias must derive from an inherited framework token or a documented alpha of it. Repeated buttons, fields, segments, banners, cards, empty states, status strips and Source-local dialogs use one shared Spatial app primitive language across all three windows. Do not approximate the shell with separately hard-coded near-match colors.

Visual consistency does not imply layout parity. The RetroOS templates remain behavior evidence, not layout templates. Each Spatial presentation may change columns, grouping, density, command placement and responsive transitions when required by:

- curved-edge readability and projected target size;
- one clear scroll owner and stable keyboard order;
- recoverable Spatial window sizes rather than browser viewport breakpoints;
- clearer grouping of primary, secondary and destructive actions.

Every layout change must preserve the complete workflow, product terminology, status visibility and action discoverability. A new arrangement that merely looks different without improving one of the constraints above is not justified.

### 5.1 My Apps presentation

- Use the shared Spatial app primitives for a compact command region, scrollable responsive card collection and status feedback. Their exact placement may change from RetroOS when it improves curved-window use.
- A card is a semantic focusable action container, with nested copy/load/update controls kept as separate buttons.
- Pointer and keyboard context menus render absolutely inside the route root so projected coordinates remain source-local.
- Cover failure is a per-card presentation state supplied by the shared image component, not mutation of card records.

### 5.2 Game Card detail presentation

- Use Spatial tabs/segment controls for Overview and Frontend.
- Keep one scroll owner for long content. The overview may reorganize cover/identity and editable properties instead of preserving the RetroOS poster split; frontend may reorganize mode selection, binding editor and packaged file list while retaining their workflow.
- All fields bind to the shared draft state. Save and close-guard semantics are controller-owned.
- Native file inputs remain hidden triggers and open browser-owned pickers as an intentional flat escape.

### 5.3 App Market presentation

- Prefer a resource rail plus responsive results region at wide sizes and a compact selector at narrower recoverable window sizes, but allow another arrangement if real content density and projected interaction testing supports it.
- List, detail and upload are in-window screens over one controller instance, so returning from detail does not recreate catalog state.
- Build Spatial-specific market list/detail/upload/install/replacement components where the existing components encode RetroOS markup. Reuse shell-neutral market types and pure resource-option helpers instead of duplicating operations.
- Domain install/replacement dialogs are Source-local. Calls to platform-global `confirm`, `toast` and generic dialog commands remain shared and will receive their Spatial host in the later global-surfaces child.

### 5.4 Shared interaction primitives

The first real application group establishes reusable presentation primitives under `spatial/apps/components/` (exact names may follow implementation conventions):

1. **Spatial Action Button**
   - Renders one native semantic button and forwards ordinary attributes/events.
   - Supports text+icon, text-only and icon-only forms plus primary/quiet/danger variants.
   - Text+icon uses one `inline-flex` row with a fixed non-shrinking icon box and stable gap; SVG size/alignment is owned by the primitive, never by each caller.
   - Icon-only requires `aria-label` and a square hit box.

2. **Spatial Select**
   - Uses a semantic trigger plus a captured Source-local listbox; it does not invoke the native browser select popup.
   - Owns open/highlight/selected state, click-outside closure, Escape, ArrowUp/Down, Home/End, Enter/Space selection and disabled behavior.
   - Keeps focus on/returns focus to the trigger and exposes `aria-expanded`, `aria-controls`, `aria-activedescendant` and option selection state.
   - Listbox placement is bounded inside the owning application Source.

3. **Focus state**
   - The shell's accepted language has no focus rectangle. App controls use `outline: none`, no focus box-shadow and no focus-only extra border width.
   - Keyboard state may alter existing fill/text/accent/underline without changing box geometry. Pointer and keyboard activation remain semantically identical.

4. **Content transitions**
   - Market screen and Detail tab replacement is an immediate keyed DOM swap inside the existing Source texture. It uses no Vue `Transition` wrapper and no dominant-content `transform`, `opacity`, `filter`, `clip-path`, mask or related compositor-promoting CSS.
   - Runtime Flag Chromium evidence showed promoted descendant layers rendering temporarily as flat planar content outside the curved Source, then snapping back to curvature at transition completion. More Source repaint frames cannot correct that compositor escape.
   - Popover/dialog reveal and list/card entry may retain the shared short bounded local transitions while their continuously painted owning screen remains the authority. Re-evaluate them if Flag Chromium shows the same planar escape.
   - `prefers-reduced-motion` sets effective duration to zero/near-zero and preserves the same final DOM/state.

Local visual transitions remain app-content contracts, while HTML-in-Canvas recapture is a minimal engine boundary: an app Source explicitly opts in, `transitionrun` starts an `animated-source` frame reason, and matching end/cancel events or a hard deadline stop it. Each Source keeps at most one paint snapshot outstanding; the next dirty generation is requested only after the prior generation uploads, then one final capture settles the texture. Dominant content does not use this path. A future curved main-content transition requires a renderer-owned dual-texture/GPU presentation seam; no such reusable seam exists in this task, so it remains follow-up platform work.

## 6. Registry Integration

Refine registration creation so an app can explicitly provide:

```ts
spatial: {
  readiness: "ready",
  component: SpatialComponent,
  defaultSize,
  minSize,
}
```

Only `market`, `my-apps` and `game-launcher` change to ready in this task. Route identity, window id derivation, RetroOS components/defaults and all other pending registrations stay unchanged. Registry tests assert the exact ready set and keep the release-ready gate closed.

## 7. Spatial Image Resolver

Use one explicit boundary type rather than passing arbitrary display URLs through every panel:

```ts
type SpatialImageInput =
  | { kind: "none" }
  | { kind: "url"; url: string }
  | { kind: "blob"; blob: Blob }

type SpatialImageState =
  | { status: "empty" }
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "unavailable"; reason: "load" | "cors" | "invalid" }
```

Resolution rules:

1. Empty input returns `empty`.
2. Blob/File input creates one owned object URL and revokes it on replacement/unmount.
3. `blob:` and same-origin URLs can be used directly; the image component still reports decode/load failure.
4. Cross-origin HTTP(S) URLs are fetched with CORS, materialized to a Blob URL on success, and become `unavailable` on rejection or non-image response.
5. A monotonically increasing request token or cancellation signal prevents an old fetch from replacing a newer source.
6. Owned object URLs are distinct from caller-owned/direct URLs and only owned URLs are revoked.

The visual component renders a resource-specific icon/label fallback while preserving surrounding actions. No proxy or persisted media copy is introduced.

## 8. Input, Overlays, and Accessibility

- All ordinary presentation DOM remains under the window Source and existing projected pointer router.
- Source-local menus/dialogs use absolute positioning and are included in the same texture/input candidate.
- Pointer-derived menu coordinates are translated through the route root's explicit rectangle; keyboard invocation anchors to the focused card.
- Use native buttons/inputs/labels/list semantics and visible `:focus-visible` treatment. Card activation handles Enter/Space without also firing nested action controls.
- Native file/select/IME top layers remain browser-owned escapes as permitted by the Spatial contract.
- The existing engine owns pointer capture, curved inverse mapping, reduced motion and lifecycle exclusion; this task must not add alternate input math.
- Routed `pointerdown` cancellation suppresses activation, while compatibility `mousedown.preventDefault()` may suppress focus without suppressing the later click. This distinction lets Source-local listbox options preserve trigger focus and still update state.
- Synthetic pointer events do not execute the browser's trusted native scrollbar drag. Reconstruct a real layout scrollbar thumb from Source-local border/client geometry, use the existing logical capture outside the thumb, clamp and emit scroll on change, dirty only the owning Source, and release exactly once on pointer/source/controller teardown. Overlay/no-gutter and unsupported geometry remain explicit instead of becoming broad edge hit zones.

## 9. Data Flow and Error Handling

```text
user action
  -> presentation command
  -> shared controller validation/confirm
  -> existing platform-host / market API mutation
  -> existing success event or explicit refresh
  -> authoritative re-read
  -> both presentations render the same result
```

- Async flags prevent duplicate mutation calls.
- Failed mutations update controller error/feedback state and do not manufacture local success.
- Event subscriptions are mounted once per open window and removed only on close.
- Detail close veto never mutates controller state. Approval follows the existing shell close lifecycle.
- Image errors are presentation degradation only and never block domain operations.

## 9.1 Test ownership

- Unit tests are required for long-lived state contracts: controllers, request sequencing, mutation guards, close guards, media URL ownership, registry readiness and release gate.
- The themed Select receives focused keyboard/state tests where they can be expressed without mounting the full Spatial renderer.
- Avoid exact CSS-value snapshots, screenshots-as-unit-tests, animation-frame snapshots and assertions coupled to source formatting. Visual alignment, motion richness and curved rendering are manual product checks.
- Focused frame-scheduler and Source-animation tests own the new bounded recapture contract. Other shell/engine tests remain outside this child's ownership; a pre-existing failure in untouched modules is reported as baseline drift rather than repaired opportunistically.

## 10. Compatibility, Rollback, and Ownership

- Expected changes are limited to platform-web view/controller helpers, new `spatial/apps/**` presentation code, the shell-neutral registry and focused tests.
- No engine/shell geometry/config/backend/contracts/storage-schema change is allowed without returning to planning.
- The production Spatial gate remains false. If a Spatial presentation fails, rollback is to mark only the affected registration pending/remove its component; RetroOS remains operational.
- Reverting a Spatial component must not require reverting shared controller extraction once RetroOS regression tests are green.

## 11. Principal Risks

- **Controller extraction regression:** migrate one view/seam at a time and verify RetroOS before adding its Spatial consumer.
- **Market controller becomes another god file:** split catalog, resource inventory and package operation seams; keep pure option builders directly testable.
- **Projected menu/input mismatch:** keep menus in the Source and translate pointer coordinates relative to the route root; verify at visible curve edges.
- **Cross-origin image omission:** resolve all Spatial images through one helper and test same-origin/Blob/CORS/failure states.
- **Object URL leak:** track ownership, revoke on source replacement/unmount and cover-draft reset, and add lifecycle tests.
- **Global overlay visual mismatch during development:** reuse command APIs and leave host presentation to the owning global-surfaces child; do not fork confirm/toast state here.
- **Visual drift between app windows and shell:** treat inherited shell tokens and shared app primitives as authority, review all three windows beside Dock/window chrome, and reject independent near-match palettes.
- **Layout redesign hides parity actions:** map every existing command/state to the new arrangement and run a workflow parity audit in addition to visual review.
- **Native select escapes the curved visual language:** replace Spatial product selects with the shared Source-local listbox primitive; keep native select only where a browser-owned surface is explicitly desired.
- **Icon/text buttons drift:** route all Spatial icon buttons through one primitive and prohibit caller-owned SVG sizing/alignment.
- **CSS motion escapes Source curvature:** never animate dominant screen/tab content with compositor-promoting CSS. Replace it immediately in the Source texture; reserve true curved main-content transitions for a future renderer-owned dual-texture/GPU seam. Local transitions remain serialized, bounded and subject to Flag Chromium review.
- **Test suite becomes a visual snapshot burden:** retain behavior and release-boundary tests, while leaving visual tuning and transition quality to manual acceptance.
