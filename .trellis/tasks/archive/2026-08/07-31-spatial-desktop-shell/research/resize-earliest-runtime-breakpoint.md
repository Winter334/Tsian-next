# Research: Earliest runtime breakpoint for the resize regression

- Query: At the visible 3px product-window frame, what is the earliest runtime branch that can prevent a projected Scene hit and semantic resize target after five downstream fixes had no effect?
- Scope: internal
- Date: 2026-08-02

## Findings

### Conclusion

The unresolved breakpoint is before resize ownership, capture continuation, inverse/Jacobian handoff, and session mutation. Every rejected fix still required the initial uncaptured event to produce both a `projectedSceneHits()` mapping and a non-null semantic target from `resolveProjectedTarget()`. The first plausible failing boundary is therefore the uncaptured `resolveInput()` loop: either `projectedSceneHits()` yields no edge hit (`viewport-controller.ts:1009-1014`), or the projected Source-local point reaches `resolveProjectedTarget()` but `elementsFromPoint()` does not yield a selectable handle/root and `resolution.status !== "hit"` (`viewport-controller.ts:1015-1035`). Nothing later runs in either case.

The more source-specific hypothesis is the second branch. Step 5F introduced a real `3px` border while preserving the outer border-box size. The global shell rule uses `box-sizing: border-box` (`spatial-shell.css:45-49`), the root has `border: 3px` (`spatial-shell.css:296-307`), and the restored absolute handles are anchored at `0` (`spatial-shell.css:521-545`). With a real border, those positioned handle boxes begin at the inner border/padding edge, not over the visible outer 3px frame. Thus the declarations restored in Step 5K are the pre-Step-5F declarations, but their physical hit rectangles are not the pre-Step-5F rectangles. The current static contract even requires no `-3px` offset (`spatial-window-style.test.ts:250-271`). A point visibly on the captured frame can consequently map to the Source border while falling outside every handle rectangle.

This explains why title/top-region drag can work: the title/tab/drag-strip is an ordinary interior child target (`SpatialWindowSurface.vue:18-49`), so it exercises the same input plane, projection, resolver, synthetic dispatch, capture promotion, and root move delivery without depending on the newly introduced border pixels.

### Exact call chain and branch points

1. The only trusted pointer receiver is the full-screen `.spatial-desktop-input-plane` (`SpatialDesktopShell.vue:31`; `spatial-shell.css:118-138`).
2. Native hover/down enters `configureInputRouter()` (`viewport-controller.ts:714-727`) and calls `resolveInput()` with trusted viewport coordinates (`viewport-controller.ts:896-900`).
3. For an uncaptured pointer, `resolveInput()` builds eligible direct Canvas Source roots, excluding unavailable and `data-spatial-input="none"` Sources (`viewport-controller.ts:1007-1008,1084-1102`).
4. `projectedSceneHits()` visits Sources front-to-back and calls `unprojectSurfacePoint()` with the root `getBoundingClientRect()`, pose, viewport, and current parallax (`scene.ts:75-89,103-133`). The stable renderer also obtains `sceneSourceForElement()` from the same root and sends that rect to the GPU (`renderer.ts:364-369,1213-1277`), while texture upload sizes from the same `getBoundingClientRect()` (`element-textures.ts:257-271`). No separate renderer-only frame geometry is present in current source.
5. For each Scene hit, `resolveProjectedTarget()` calls `document.elementsFromPoint(localClient.x, localClient.y)` (`target-resolver.ts:177-205`). Canvas and input plane are ignored (`viewport-controller.ts:239-244`); candidates with no owning Source, effective hidden state, or effective `pointer-events:none` are skipped (`target-resolver.ts:55-82,144-169`). ARIA hidden/disabled state does not erase geometry. There is no Canvas/Source-root fallback when the candidate list has no selectable Source element.
6. Only `resolution.status === "hit"` reaches `finishResolvedInput()` (`viewport-controller.ts:1025-1035`), which creates Source-local synthetic coordinates (`viewport-controller.ts:1056-1081`). Otherwise the final result is `target/source/mapping: null` and status `no-hit` (`viewport-controller.ts:1038-1053`).
7. Hover/down mirrors the computed target cursor onto the transparent input plane (`viewport-controller.ts:720,725-727,1375-1385`). A handle target supplies `ns/ew/nwse/nesw-resize` from `spatial-shell.css:530-545`; a root/no-hit supplies the configured `default` fallback (`SpatialDesktopShell.vue:576-580`).
8. `PointerRouter.down()` is a no-op for a null target. For a target it dispatches synthetic `pointerdown` and `mousedown`, records the pressed target, then captures (`pointer-router.ts:93-124`). Capture promotion changes a `[data-spatial-gesture-start]` handle to its `[data-spatial-gesture-owner]` window root only after the original down dispatch (`viewport-controller.ts:673-677`).
9. `dispatchDomEvent()` creates an untrusted synthetic `PointerEvent` whose `clientX/clientY` are Source-local and whose auxiliary fields retain trusted screen coordinates (`viewport-controller.ts:1117-1161`).
10. A handle down calls `SpatialWindowSurface.beginResize()`, which accepts the untrusted primary event and creates component interaction state with pointer id, direction, and prior Source-local point (`SpatialWindowSurface.vue:65-76,142-155,197-201`).
11. Captured motion is possible only because pointer-down previously returned a Source, mapping, and captured target; only then is `capturedSceneProjections` populated (`viewport-controller.ts:728-747`). Later moves bypass target resolution, route to the captured root, and dispatch synthetic moves (`viewport-controller.ts:924-989`; `pointer-router.ts:85-90`).
12. The root computes successive Source-local resize deltas (`SpatialWindowSurface.vue:130-165`), then `SpatialDesktopShell.resizeWindow()` calls the session and refreshes layout/paint (`SpatialDesktopShell.vue:376-395`; `window-session.ts:151-166`; `window-layout.ts:189-226`).

The shared prerequisite is therefore exact: a non-null initial Source mapping and target must exist before any rejected resolver exception, root fallback, controller operation, component rollback, or captured inverse can matter. In particular, the visible-mesh/Jacobian experiment was strictly post-down because the capture record does not exist until `viewport-controller.ts:728-747`.

### Step 5F before/after geometry from task history

- Pre-Step-5F/Step-5E used the same physical per-Source mesh and split screen/local deltas, but still had independent GPU shadow/rim material (`implement.md:215-240`).
- Step 5F removed that material, added a captured `2–3px` Source frame inside the existing border box, and added an inner top drag strip while explicitly retaining projected geometry and input ordering (`implement.md:242-260`).
- Current source implements the frame as the root's real `3px` CSS border, not a pseudo/overlay frame; static checks forbid `.spatial-window-surface::before` (`spatial-shell.css:296-312`; `spatial-window-style.test.ts:223-249`).
- Step 5K restored component-owned interaction and the old `8px / 8px / 14px`, offset-`0` handle declarations, but deliberately retained the accepted 3px frame and drag strip (`implement.md:330-341`). Therefore the rollback restored source text/interaction shape, not the old physical handle-to-outer-edge alignment.
- Current root and renderer geometry remain one outer border box: inline width/height/translate are applied to the root (`SpatialDesktopShell.vue:175-203`), and both rendering and input derive the mesh from its `getBoundingClientRect()`. The likely mismatch is between that Source border box and descendant DOM hit rectangles, not between separate CPU and GPU window rectangles.

### Ranked hypotheses after user evidence

1. **Projected Scene hit succeeds, but semantic edge targeting fails at `resolveProjectedTarget()` (highest).** The real border occupies the visible outer 3px while restored handles start inward. `elementsFromPoint()` has no explicit Source-root fallback. Depending on target-browser layout-subtree hit behavior, the mapped border point can resolve to ignored canvas/input plane, no Source candidate, or only the root; none produces a resize cursor/current handle start. This explains the unchanged behavior of the handle resolver (it reused handle rects), component rollback (same declarations under a changed containing geometry), and captured inverse patch (never reached).
2. **`projectedSceneHits()` itself rejects the visible perimeter.** An event on the antialiased/outermost rendered edge may fall just outside the triangle mesh or differ from the last drawn Source extent. This is the earliest possible branch and best explains why root/controller classifiers also had no effect. It ranks below hypothesis 1 because current renderer and input both use the same root rect, pose module, mesh dimensions, and current parallax; no source-visible independent frame pass remains.
3. **The handle is resolved, but the down-to-interaction transition fails.** This becomes the leading hypothesis only if the cursor visibly changes to the correct resize arrow. The remaining narrow branches are synthetic down delivery, `beginResize()` state creation, or captured root move delivery. Title drag exonerates most of this shared router path, so no source evidence currently favors a broad capture/controller rewrite.
4. **Session geometry, direction signs, or repaint is the first failure (low).** These are downstream of a successful interaction, and both component-owned and controller-owned attempts reportedly had no effect. Pure direction mapping is conventional (`window-layout.ts:189-226`).

### Falsified hypotheses

- A dedicated transparent-handle resolver is sufficient: user verification found no effect; current generic resolver is restored (`implement.md:320-329`).
- A root edge classifier/fallback is sufficient: no effect and removed (`implement.md:330-339`).
- Controller ownership of resize direction/deltas is sufficient: no effect and superseded (`implement.md:320-328`).
- Restoring pre-Step-5F component state and `8/8/14` handle declarations restores the old runtime geometry: no effect; the retained real border means it did not restore physical outer-edge coverage (`implement.md:330-341`).
- Visible-mesh-only captured inverse/permanent Jacobian handoff is sufficient: no effect and reverted; it begins only after successful down/capture (`implement.md:343-345`; `viewport-controller.ts:728-747`).

### One discriminating runtime observation: resize cursor

| Observation over the visible 3px frame | What it proves | Safest next implementation |
|---|---|---|
| Cursor changes to the correct resize arrow | `projectedSceneHits()`, `resolveProjectedTarget()`, and `syncProjectedCursor()` reached an actual handle. Do not change frame, inverse, resolver, or ownership again. | Add only a temporary handle-scoped trace/assertion at `SpatialWindowSurface.beginResize()` and the first `continueInteraction()` resize branch, using the existing pointer id/direction/local point. Remove it after locating the first missing transition, then patch only that transition. Exact functions: `beginResize`, `continueInteraction`, and only if delivery is absent, `PointerRouter.down`/`dispatchDomEvent`.
| Cursor remains default | A semantic handle was not returned. This localizes the problem to `projectedSceneHits()` or `resolveProjectedTarget()` before down/capture. | First add two narrow fields to the existing pointer snapshot at the uncaptured `resolveInput()` loop: Scene-hit count/source id and per-hit resolution status/target label. Do not add a new overlay. If a Scene hit exists but resolution is root/no-hit, make the frame visual rather than layout border: replace the real border with equivalent `3px` root padding plus a pointer-transparent inset frame overlay, keeping handles at z=8 and offset `0`; this preserves the outer border box/interior allocation while returning actual handle boxes to the outer edge. If Scene-hit count is zero, do not make the CSS change; patch only edge inclusion against the same projected mesh in `projectedSceneHits()` after capturing the failing visual/local coordinate. Do not combine both fixes.

The CSS-only semantic-target correction, if confirmed, belongs in `spatial-shell.css` (`.spatial-window-surface`, frame overlay, `.spatial-resize-handle*`) plus its coupled static assertions in `spatial-window-style.test.ts`. The Scene-hit correction, if confirmed instead, belongs only in `scene.ts:projectedSceneHits`/`projection.ts:unprojectSurfacePoint` with `viewport-controller.ts:resolveInput` diagnostics removed after use.

### Files found

- `apps/platform-web/src/spatial/engine/viewport-controller.ts` — native input listeners, uncaptured/captured resolution, cursor mirroring, synthetic DOM dispatch, and capture-record creation.
- `apps/platform-web/src/spatial/engine/scene.ts` — Source rect/pose snapshot and front-to-back projected hit loop.
- `apps/platform-web/src/spatial/engine/projection.ts` — exact GPU-mesh triangle inverse and edge rejection.
- `apps/platform-web/src/spatial/engine/input/target-resolver.ts` — `elementsFromPoint()` candidate policy; no Canvas/root fallback.
- `apps/platform-web/src/spatial/engine/input/pointer-router.ts` — synthetic down ordering and capture promotion.
- `apps/platform-web/src/spatial/engine/renderer.ts` — renderer uses the same Source root rect and physical mesh uniforms as input.
- `apps/platform-web/src/spatial/engine/element-textures.ts` — Source texture size derives from the same border box.
- `apps/platform-web/src/spatial/shell/SpatialWindowSurface.vue` — real Source root, semantic handles, drag and component interaction state.
- `apps/platform-web/src/spatial/shell/SpatialDesktopShell.vue` — input plane, outer root layout, cursor fallback, resize/session wiring.
- `apps/platform-web/src/spatial/shell/spatial-shell.css` — real 3px frame, border-box rule, drag strip, and restored handle rectangles.
- `apps/platform-web/src/spatial/shell/spatial-window-style.test.ts` — current post-rollback source/CSS contract.
- `.trellis/tasks/07-31-spatial-desktop-shell/implement.md` — Step 5E/5F boundary and rejected 5J/active 5K/rejected 5L history.

### Related specs

- `.trellis/spec/platform-web/frontend/spatial-ui.md:75-81` — direct non-zero Canvas Sources and reverse-z projected input.
- `.trellis/spec/platform-web/frontend/spatial-ui.md:95-100` — full input plane, shared forward/inverse geometry, target policy, and synthetic delivery limits.
- `.trellis/spec/platform-web/frontend/spatial-ui.md:113-116` — outside-domain no-hit and delivery-vs-native-state diagnostics.
- `.trellis/tasks/07-31-spatial-desktop-shell/design.md:420-430` — shared physical mesh/inverse, Source-local resize deltas, and frame inside the existing border box.

### External references

None consulted; the request limited this pass to source and persisted task history.

## Caveats / Not Found

- No runtime/browser observation was performed. The resize-cursor result is intentionally the single requested discriminator and remains unknown in this research pass.
- The rejected transient implementations have already been removed. `implement.md` records their exact intent and outcome, while current source/tests record the rollback state; their deleted line-for-line patches were not available without a forbidden git operation.
- A default cursor alone cannot distinguish Scene-hit count zero from a Scene hit whose DOM resolution returns root/no-hit. That is why the recommended no-arrow change begins with two fields at the existing snapshot boundary, not another behavioral fallback.
