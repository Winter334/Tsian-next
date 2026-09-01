# Current Architecture and HTML-in-Canvas Research

## Platform Shell Evidence

- `apps/platform-web/src/App.vue:3` directly mounts `DesktopShell`; there is no UI-mode resolver.
- `apps/platform-web/src/desktop-apps.ts` is the central app/window registry. It owns app ids, routes, icons, components, singleton/detail ids, and RetroOS geometry.
- `apps/platform-web/src/components/desktop/DesktopShell.vue` owns route watching, launcher/taskbar behavior, desktop bounds, fullscreen coordination, and the live `useDesktopWindows()` instance.
- `apps/platform-web/src/composables/useDesktopWindows.ts:57` creates an in-memory window session with open/focus/minimize/close/move/resize/fullscreen/clamp commands.
- `apps/platform-web/src/components/desktop/DesktopWindow.vue` mounts each route component inside window chrome and owns pointer drag/resize.
- `apps/platform-web/src/style.css:5` starts the RetroOS token/theme block; `style.css:168` starts desktop-shell styling. Theme, shell, and content chrome are not currently separated.
- `apps/platform-web/src/router/index.ts` preserves hash-route deep links; the desktop shell watches the route and mounts registry components directly.

## State and Persistence Evidence

- Platform views use Vue refs/computed/watch plus explicit platform/storage APIs; the project forbids a new global store library.
- Cross-view refresh uses `CustomEvent` modules and authoritative re-reads, not shared mutable payload state.
- Existing window behavior preserves mounted components until close so scroll, form drafts, editor state, and running views survive focus/minimize changes.
- `.tsian/local/platform-config.json` is the existing assistant-visible, cross-session platform preference file. `apps/platform-web/src/config/platform-config.ts` normalizes defaults, preheats an in-memory cache, and performs full-document writes.
- The UI mode belongs in a new `appearance` section in that file; localStorage would create a hidden second authority.

## Reuse and Extraction Evidence

- Platform route views already reuse platform-host/storage APIs, but many route components mix domain controllers with RetroOS templates/classes.
- Spatial presentation must not mount those RetroOS views. Child tasks should extract pure helpers or explicit controller composables only where both presentations consume the behavior.
- Existing projected event sequencing in `apps/platform-web/src/platform-host/frontend-inspector-dom.ts:635`–`758` demonstrates pointer/mouse ordering and focus/default activation, but it is inspector-domain code. A second consumer justifies extracting low-level dispatch helpers; importing the inspector into Spatial Desktop or copying its sequence is prohibited.
- Existing WebGL code lives in `apps/play-frontend-dev`, not platform-web. It is useful as shader/resource-lifecycle precedent but is not a platform renderer to import wholesale.

## HTML-in-Canvas Facts

Canonical source: <https://github.com/WICG/html-in-canvas>

- `<canvas layoutsubtree>` promotes direct children into layout, hit testing, and the accessibility tree while leaving their ordinary paint invisible until explicitly drawn.
- `drawElementImage()` draws a direct child and returns a DOM synchronization transform.
- WebGL exposes `texElementImage2D`; WebGPU exposes `copyElementImageToTexture`.
- `paint` reports changed direct children; source DOM changes during a paint handler appear in the next frame.
- `captureElementImage()` supports transferable snapshots for worker/offscreen use.
- The privacy-preserving paint model may omit cross-origin images, embedded content, system theme data, visited-link state, and other sensitive pixels.
- Official 3D examples treat non-planar interactive input as an application responsibility; the cube demo is deliberately `inert`.
- Current availability is experimental Chromium behind `chrome://flags/#canvas-draw-element` (or the Chromium-fork equivalent).

## Consequences for Spatial Desktop

1. Every captured top-level window must be a direct child of the layout-subtree canvas.
2. Source DOM is the authority for semantics, form state, focus, keyboard input, and events.
3. A nonlinear curved post-process cannot rely on one DOMMatrix for hit testing. The project needs an inverse projection and event-routing subsystem.
4. Pointer projection must be proven before adapting domain panels; otherwise edge controls, drag, scroll, and native form behavior will fail silently.
5. Nonstandard API calls must be isolated behind one capability/texture adapter because the explainer is still changing.
6. Paint/texture upload should be dirty-driven, while camera/effect motion owns bounded rAF windows.
7. External cover/avatar/media sources need one shared materialization/fallback policy. Do not add per-panel CORS workarounds or an unrestricted server proxy.

## First Vertical Slice Rationale

The first product surface is Spatial My Apps after the foundation and shell:

- uses the shared application registry and route sync;
- exercises a real card grid, images, hover/focus, quick actions, context menus, keyboard activation, and change-event refresh;
- exposes cross-origin/Blob cover behavior early;
- has lower runtime risk than Assistant, Workspace Editor, or Play while still being representative.

This slice is an internal proof only. Production Spatial mode remains gated until every first-release surface passes parity review.
