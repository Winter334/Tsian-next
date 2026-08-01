# Spatial Desktop Shell Evidence

## Current Boot and Configuration

- `apps/platform-web/src/App.vue` mounts `DesktopShell` unconditionally and calls `preheatPlatformConfig()` only after `initializePlatformHost()` inside `onMounted`. A dual-shell startup therefore needs an explicit boot state that awaits configuration before either shell mounts.
- `apps/platform-web/src/config/platform-config.ts` already owns `.tsian/local/platform-config.json`, defaults, normalization, cloning, full-write semantics, and a synchronous cache. The new mode belongs in an `appearance` section here; localStorage would create a second authority.
- Existing config normalization is additive for ordinary missing sections. A saved file from before Spatial must keep provider/tunable data and receive `appearance.uiMode="retro"`.
- The Settings hub is already a screen registry. A development-only Appearance entry can call a shared save-and-reload command without making Spatial selectable in production.

## Current Registry and RetroOS Session

- `apps/platform-web/src/desktop-apps.ts` combines route identity, app metadata, async RetroOS components, singleton/detail/editor identity, and RetroOS geometry. Router route records are separately duplicated in `router/index.ts`.
- Parameterized identities already exist for Game Card detail, Workspace editor and media windows. These ids are consumed by before-close guards and must stay stable through the registry extraction.
- `apps/platform-web/src/composables/useDesktopWindows.ts` keeps window state in one shell-local instance while `beforeCloseHandlers` is module-level. It intentionally preserves mounted non-closed windows and does not persist a session across reload.
- `DesktopShell.vue` treats the URL as the active/deep-linked surface and guards route pushes against loops. This is the behavior to preserve, not the flat geometry implementation.
- `DesktopWindow.vue` owns flat pointer drag/resize and browser fullscreen integration. Spatial needs its own window component because input arrives through projected routing and geometry is world/camera based.

## Foundation Capabilities and Gaps

- The archived foundation verification records 76 passing Spatial tests, Vue type-check, production build isolation and a completed Flag-enabled browser matrix.
- `SpatialRenderer` already renders multiple direct-child Source textures by DOM rect and z attribute, separates environment/surface/composite passes, supports DPR supersampling, and recovers WebGL resources.
- `FrameScheduler` already reserves `camera` and `animated-source` reasons. Shell camera motion can extend this scheduler without a second rAF loop.
- `projection.ts`, `input/coordinates.ts`, `scene.ts`, `geometry.ts` and the pointer router provide the curve, inverse curve, topmost Source, ray/quad, soft-cylinder-snap and routed input primitives needed by the shell.
- `SpatialLabController` currently owns reusable capability/renderer/scheduler/input/lifecycle behavior together with lab diagnostics and probe reporting. Product code must extract a framework-neutral viewport/runtime controller and leave the lab as a thin diagnostics adapter.
- The current renderer reads `getBoundingClientRect()` for both source placement and hit ownership. Spatial world/camera layout should therefore materialize its final planar geometry in Source DOM CSS before rendering; a GPU-only source transform would break input alignment.

## Planning Conclusions

- Use an unbounded horizontal world strip with stationary focus. User browser testing rejected automatic focus-driven camera movement; focus now changes only active state, z-order, and route.
- User testing rejected per-window wheel zoom because it changes window size rather than camera distance. Remove it; defer background-wheel camera zoom and instead use a larger readable default window size.
- User testing also rejected the cylinder-only feel and top/bottom dead bands. Move to a shallow invertible bi-axial spherical/lens projection with full Source-domain coverage.
- Apply side depth/snap as a smooth CSS-layout result, never as a renderer-only transform and never as a fixed slot/grid. DOM border boxes, GPU source rects and projected target resolution remain identical.
- Keep minimized Source roots mounted and non-zero, explicitly release their texture, and restore/paint before making them visible.
- Use a development-only dynamic Spatial shell import behind one release-ready resolver. Production validation must confirm the dead development branch does not expose a selectable partial shell.
- Until panel children provide native Spatial components, route-backed windows render a Spatial pending surface carrying only shell-neutral app metadata. RetroOS views are not imported into those sources.

## Relevant Historical Decisions

- `.trellis/tasks/archive/2026-06/06-16-retroos-multi-window-desktop-shell/` defines the existing URL/session, singleton Play, deep-link and before-close behavior being preserved.
- `.trellis/tasks/archive/2026-06/06-27-platform-config/` defines platform-config as the assistant-visible, non-checkpointed authority with full-write + cache semantics.
- Trellis memory session `019fb6e5-906e-7143-9abd-da749bbbda90` ends with the explicit next step: plan the Spatial desktop shell after foundation acceptance, while keeping it a development entry and not embedding unadapted old panels.
