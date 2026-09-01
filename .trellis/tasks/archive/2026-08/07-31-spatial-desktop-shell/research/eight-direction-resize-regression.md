# Research: Eight-direction resize regression

- Query: Why does product-window eight-direction pointer resize remain inert, and why did the authored-handle target-resolver patch produce no visible change?
- Scope: internal
- Date: 2026-08-02

## Findings

### Conclusion

The current pointer-resize path is not owned by `target-resolver.ts` after pointer-down. The resolver is consulted only to choose the initial synthetic DOM down target. The actual resize operation is component-local state in `SpatialWindowSurface.vue`, continued by pointer events captured to the window root, and finally emitted into `SpatialDesktopShell.vue` / `SpatialWindowSession`.

The first architectural divergence from the accepted Lab path is the split of gesture ownership across two layers: the shared input router owns pointer capture and Source projection, while `SpatialWindowSurface.vue` separately owns the resize mode, direction, previous local point, delta calculation, and completion. The archived foundation contract instead made the input plane/router own the logical operation until up/cancel, and explicitly required drag/resize to be handled by the unified input system rather than by each control correcting coordinates (`.trellis/tasks/archive/2026-08/07-31-spatial-rendering-input-foundation/prd.md:40`; `design.md:283-290`). The accepted Lab verification confirms that this centralized path passed drag/resize in the Flag-enabled browser (`verification.md:12-16`).

That split, not transparent-handle hit selection, is the strongest source-backed regression seam. The product path has no integration test that drives down -> promoted capture -> projected local move -> component-local delta -> session mutation. Existing tests independently assert router promotion (`pointer-router.test.ts:65-91`), handle markup/static strings (`spatial-window-style.test.ts:63-75`), and pure geometry (`window-layout.test.ts:283-313`), so they cannot prove the runtime chain.

### Actual runtime call path

1. Trusted input arrives only on the full-screen input plane (`SpatialDesktopShell.vue:31`, `viewport-controller.ts:715-728`).
2. `resolveInput()` projects the trusted viewport point into a window Source-local `localClient` (`viewport-controller.ts:897-1015`, `projection.ts:67-71`).
3. For a window, `resolveProjectedResizeTarget()` is tried before generic `elementsFromPoint()` (`viewport-controller.ts:1016-1039`). This is the latest patch.
4. `PointerRouter.down()` dispatches synthetic `pointerdown`/`mousedown` to the selected target, then promotes capture from a `[data-spatial-gesture-start]` descendant to `[data-spatial-gesture-owner]` (`pointer-router.ts:93-108`, `viewport-controller.ts:674-677`).
5. Resize starts in `SpatialWindowSurface.beginResize()`, which records `kind`, `direction`, `pointerId`, and the synthetic event's Source-local `clientX/clientY` (`SpatialWindowSurface.vue:197-209`). The component accepts only untrusted/router-generated events (`252-255`).
6. On every later trusted move, `resolveInput()` sees the router's captured window root and uses the frozen captured Source projection (`viewport-controller.ts:902-989`). Target resolution, including `resolveProjectedResizeTarget()`, is bypassed.
7. `PointerRouter.move()` dispatches synthetic `pointermove` directly to the captured root (`pointer-router.ts:85-90`). Root `continueInteraction()` subtracts successive synthetic Source-local `clientX/clientY` samples and emits `resize` (`SpatialWindowSurface.vue:185-220`).
8. `SpatialDesktopShell.resizeWindow()` gates on visible presentation, calls `session.resize()`, reapplies Source layout, marks it dirty, and requests a frame (`SpatialDesktopShell.vue:376-395`). `SpatialWindowSession.resize()` calls `resizeSpatialGeometry()` (`window-session.ts:151-166`), where direction-to-edge mutation is conventional and complete (`window-layout.ts:189-226`).

This proves that `target-resolver.ts` is on-path only for the initial down. It cannot repair an inert gesture after component state initialization or captured motion delivery.

### Why the target-resolver patch had no visible effect

`SpatialWindowSurface` already has a root fallback that classifies all four corners and four edges from the same Source-local event coordinates (`SpatialWindowSurface.vue:116-162`). If generic projected targeting returns the Source root/frame instead of an empty handle, that fallback calls `beginResize()` (`116-121`). Therefore selecting the authored `<span>` instead of the root does not materially change resize initiation.

After down, capture is promoted to the root and all motion bypasses target resolution (`viewport-controller.ts:925-991`). The patch consequently cannot affect the decisive continuation/delta/session path. The user's report of absolutely no behavioral change is consistent with this code and falsifies the patch's stated hypothesis that omitted transparent handle boxes were the blocker.

Recommendation: remove `resolveProjectedResizeTarget()`, its import/call in `viewport-controller.ts`, `data-spatial-resize-direction` if it has no remaining semantic consumer, and the coupled static assertions. Keeping it adds a window-product policy branch to the shared engine, duplicates the existing root edge classifier, and uses live authored DOM rectangles without addressing operation ownership. Retain the semantic eight handles and keyboard resize entry points.

### Minimal concrete fix recommendation

Restore one resize owner at the controller/router boundary instead of routing resize motion through synthetic component-local state:

- In `viewport-controller.ts`, when a window Source receives primary pointer-down, classify the eight edge/corner bands from the already computed `hit.mapping.localClient` relative to `hit.source.rect`, before ordinary DOM activation policy. Store `{ pointerId, sourceId, direction, previousLocalClient, capturedProjection }` beside `capturedSceneProjections`.
- In the captured branch of `resolveInput()` / the input-plane `pointermove` handler, compute the new Source-local point from the retained projection and emit one typed resize-delta callback directly from the controller. On up/cancel, clear it exactly once.
- Add a narrow `onWindowResize(sourceId, direction, delta)` option to `SpatialViewportControllerOptions`; wire it in `SpatialDesktopShell.vue` to the existing `resizeWindow()` function. Source ids already use the stable `window:<id>` form (`SpatialWindowSurface.vue:7`, `SpatialDesktopShell.vue:603-605`).
- Remove pointer resize state/delta ownership from `SpatialWindowSurface.vue`; keep its eight focusable handles for keyboard resize and semantics. Title drag can remain on its current screen-delta path unless separately regressed.

Exact files/functions: `engine/viewport-controller.ts` (`SpatialViewportControllerOptions`, `configureInputRouter`, captured input state/cleanup), `shell/SpatialDesktopShell.vue` (controller construction and existing `resizeWindow`), and `shell/SpatialWindowSurface.vue` (`beginResize`, resize branch of `continueInteraction`, resize interaction fields). No direction/sign change is indicated in `resizeSpatialGeometry()`; its mapping and pure tests cover all eight directions.

This is the smallest recommendation that restores the accepted foundation invariant: one layer owns Source projection, logical capture, resize direction, local deltas, and lifecycle. It also discriminates the fix from the failed hit-target hypothesis.

### Hot-reload discrimination cases

- Begin on the visible 3px frame where generic targeting resolves the Source root, then move one pixel: geometry must change on the first move. This proves handle selection is unnecessary.
- Begin on each semantic handle and immediately move over window content, another Source, background, and outside the canvas before release. Resize must continue and stop exactly once; this proves operation capture rather than hover/target resolution.
- At center and a strongly yawed/pitched edge window, drag E/S positively, W/N positively toward the interior, and all four corners. Expected signs follow `window-layout.ts:197-209`; no UV/Y flip is needed.
- Pointer-down in ordinary content more than 14px from corners, 8px from side/bottom edges, and 3px from the top must not resize. The 3-12px top strip remains drag.
- Keyboard resize on all eight handles must remain unchanged. If keyboard works while pointer resize fails, session mutation and direction mapping are exonerated and the pointer gesture-owner seam is confirmed.

## Files Found

- `apps/platform-web/src/spatial/engine/viewport-controller.ts` — trusted input, Source projection, initial target resolution, logical capture integration, and synthetic dispatch.
- `apps/platform-web/src/spatial/engine/input/pointer-router.ts` — logical capture and down/move/up event routing.
- `apps/platform-web/src/spatial/engine/input/target-resolver.ts` — generic DOM resolution plus the recent authored resize-target patch.
- `apps/platform-web/src/spatial/engine/scene.ts` — retained Source pose/rect projection and screen-to-local differential.
- `apps/platform-web/src/spatial/engine/projection.ts` — physical mesh inverse and Source-local client coordinates.
- `apps/platform-web/src/spatial/engine/physical-surface.ts` — CPU/GPU physical orientation; local Y maps top-to-bottom consistently.
- `apps/platform-web/src/spatial/shell/SpatialWindowSurface.vue` — current resize gesture owner and eight handle markup.
- `apps/platform-web/src/spatial/shell/SpatialDesktopShell.vue` — resize event wiring, presentation gate, layout refresh, and renderer paint scheduling.
- `apps/platform-web/src/spatial/shell/window-session.ts` — session mutation entry point.
- `apps/platform-web/src/spatial/shell/window-layout.ts` — direction/edge geometry mutation and clamp.
- `.trellis/tasks/archive/2026-08/07-31-spatial-rendering-input-foundation/{prd.md,design.md,verification.md}` — accepted Lab ownership contract and browser evidence.

## External References

- None required. The archived foundation research already records that nonlinear projected routing is application-owned and not supplied by HTML-in-Canvas (`research/official-repo-audit.md:179-195`).

## Related Specs

- `.trellis/spec/platform-web/frontend/spatial-ui.md` — Source-local projected input, retained capture pose, lifecycle availability, and synthetic-event limitations.
- `.trellis/spec/platform-web/frontend/component-guidelines.md` — Vue component behavior and semantic controls.
- `.trellis/spec/platform-web/frontend/state-management.md` — reactive session mutation boundaries.

## Caveats / Not Found

- The research-agent role forbids git operations, so the deleted HEAD Lab files (`spatial-lab-controller.ts`, `LabSurface.vue`, `SpatialInteractionLab.vue`) could not be recovered with `git show`. The Lab comparison above is based on the archived foundation PRD/design and its explicit accepted browser verification, not a line-by-line deleted-source diff.
- No tests, builds, type-check, lint, diff check, browser automation, or runtime verification were run, per instruction.
- Static inspection proves the current call path and disproves target resolution as the post-down owner. It cannot identify the exact runtime statement at which the browser ceases visible behavior without instrumentation; the recommendation removes that split seam rather than adding another target-selection exception.
