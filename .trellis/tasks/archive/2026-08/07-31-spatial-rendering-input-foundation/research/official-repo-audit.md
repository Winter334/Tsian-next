# Research: Official HTML-in-Canvas Repository Audit

- Query: Audit the current official `WICG/html-in-canvas` repository against this task's design, prior assumptions, and `apps/platform-web/src/spatial/engine` implementation.
- Scope: mixed
- Date: 2026-07-31

## Executive Summary

The official repository currently demonstrates one canonical WebGL path: create a `webgl2` context and call `texElementImage2D(TEXTURE_2D, RGBA8, element[, config])`. The optional config contains source-rectangle and destination `width`/`height` members. The repository retains the old six-argument upload only as a temporary compatibility fallback. It contains no evidence for this project's two-argument `"compact"` signature or for WebGL1 as a supported current path.

`RGBA8`/WebGL2 is therefore the correct foundation baseline, but not necessarily the eventual only format. The still-open Khronos WebGL PR proposes `RGBA8`, `SRGB8_ALPHA8`, `RGBA16F`, and `RGBA32F`, with implied `UNSIGNED_BYTE`, `UNSIGNED_BYTE`, `HALF_FLOAT`, and `FLOAT` source types respectively. That PR still disagrees with the WICG explainer about whether a mip `level` argument exists, demonstrating that the API remains unstable.

The official WebGL cube example is not an interaction example: it marks the HTML source `inert`. The official interactive demo uses Canvas 2D, applies the returned affine transform to the source element, and relies on ordinary browser hit testing/focus. Upstream has no demonstrated solution for nonlinear/curved WebGL hit testing. Issues #135, #140, and #148 explicitly treat custom nonlinear remapping as unresolved. Our inverse-projection router is a reasonable lab experiment, but it cannot be documented as upstream-supported native interaction, and its synthetic events cannot reproduce trusted-event default actions.

The direct-child rule remains the current explainer contract. A proposed `drawable` descendant model is active discussion, not current API. Nested HTML-in-Canvas is available in Chromium Canary 152+, and paint events now fire in reverse tree order, but neither change makes arbitrary descendants valid upload sources today.

The highest-priority local corrections are:

1. Remove WebGL1 and the unsupported two-argument `compact` upload negotiation; model WebGL2 as canonical and keep only a clearly temporary six-argument legacy fallback if needed.
2. Stop relying on `UNPACK_FLIP_Y_WEBGL` for element upload; the current WebGL WG draft says all `UNPACK_*` pixel-store parameters are ignored.
3. Add removed-element invalidation/resource release (or explicitly guarantee synchronous registry removal); the WHATWG draft change referenced by official issue #85 adds `removedElements`, while our event type and adapter ignore it.
4. Do not filter pointer targets merely because they are `aria-hidden`, `aria-disabled`, or natively disabled. These states do not remove elements from browser hit testing; activation policy must be handled after target resolution.
5. Treat text caret placement, native picker opening, range behavior, and synthetic pointer default actions as explicit browser-probe outcomes. The current proportional-character approximation must not be reported as native caret support.

## Files Found

### Official repository at audited HEAD

- [`README.md`](https://github.com/WICG/html-in-canvas/blob/d4433e329697c4341a9f915f75dbd9608f3939fa/README.md) — living explainer, current IDL, paint/snapshot rules, flag, and privacy restrictions.
- [`Examples/webGL.html`](https://github.com/WICG/html-in-canvas/blob/d4433e329697c4341a9f915f75dbd9608f3939fa/Examples/webGL.html) — official WebGL2/RGBA8 cube example and temporary old-signature fallback.
- [`Examples/webGLSetup.js`](https://github.com/WICG/html-in-canvas/blob/d4433e329697c4341a9f915f75dbd9608f3939fa/Examples/webGLSetup.js) — cube buffers, texture coordinates, projection, and draw pass.
- [`Examples/text-input.html`](https://github.com/WICG/html-in-canvas/blob/d4433e329697c4341a9f915f75dbd9608f3939fa/Examples/text-input.html) — interactive 2D controls relying on returned CSS transform.
- [`Examples/pie-chart.html`](https://github.com/WICG/html-in-canvas/blob/d4433e329697c4341a9f915f75dbd9608f3939fa/Examples/pie-chart.html) — focusable canvas children and `drawFocusIfNeeded` example.
- [`Examples/complex-text.html`](https://github.com/WICG/html-in-canvas/blob/d4433e329697c4341a9f915f75dbd9608f3939fa/Examples/complex-text.html) — transformed complex text and device-pixel sizing.
- [`security-privacy-questionnaire.md`](https://github.com/WICG/html-in-canvas/blob/d4433e329697c4341a9f915f75dbd9608f3939fa/security-privacy-questionnaire.md) — readback and sensitive-rendering constraints.

Audit baseline: commit [`d4433e329697`](https://github.com/WICG/html-in-canvas/commit/d4433e329697c4341a9f915f75dbd9608f3939fa), dated 2026-07-14. It is the repository HEAD as of this audit and clarifies reverse-tree-order `paint` delivery.

### Local task and implementation

- `.trellis/tasks/07-31-spatial-rendering-input-foundation/design.md` — intended adapter, rendering, input, native-control, accessibility, DPR, and lifecycle contracts.
- `.trellis/tasks/07-31-spatial-rendering-input-foundation/research/foundation-evidence.md` — prior API assumptions, including the now-stale WebGL1 decision.
- `apps/platform-web/src/spatial/engine/capabilities.ts` — current API/context/signature negotiation.
- `apps/platform-web/src/spatial/engine/html-in-canvas-types.d.ts` — experimental IDL declarations.
- `apps/platform-web/src/spatial/engine/element-textures.ts` — direct-child registry, dirty tracking, upload, and texture lifecycle.
- `apps/platform-web/src/spatial/engine/renderer.ts` — framebuffer, source composition, curved pass, DPR policy, and restore lifecycle.
- `apps/platform-web/src/spatial/engine/input/*` — projected coordinates, target resolution, pointer routing, native-control escapes.
- Remaining engine, shader, and test files — pure rendering math, state machines, resource tracking, and coverage.

## Findings

### 1. Current Web IDL and canonical WebGL path

The current WICG explainer defines:

```webidl
dictionary WebGLCopyElementImageConfig {
  GLfloat sx;
  GLfloat sy;
  GLfloat swidth;
  GLfloat sheight;
  GLsizei width;
  GLsizei height;
};

partial interface WebGLRenderingContext {
  void texElementImage2D(GLenum target, GLenum internalformat,
                         (Element or ElementImage) element,
                         optional WebGLCopyElementImageConfig config = {});
};
```

Evidence: [`README.md` lines 203-216](https://github.com/WICG/html-in-canvas/blob/d4433e329697c4341a9f915f75dbd9608f3939fa/README.md#L203-L216).

Exact current invocation forms are therefore:

- Three arguments when defaults are acceptable: `gl.texElementImage2D(gl.TEXTURE_2D, gl.RGBA8, element)`.
- Four arguments when source/destination sizing is explicit: `gl.texElementImage2D(gl.TEXTURE_2D, gl.RGBA8, element, { width, height })`.
- The old six-argument form is only a temporary compatibility fallback in the demo.
- There is no official two-argument `(target, element)` form in the current repo.

The official 3D example creates only a `webgl2` context ([`webGL.html` lines 103-114](https://github.com/WICG/html-in-canvas/blob/d4433e329697c4341a9f915f75dbd9608f3939fa/Examples/webGL.html#L103-L114)), selects `gl.RGBA8`, and makes the current three-argument call ([lines 55-72](https://github.com/WICG/html-in-canvas/blob/d4433e329697c4341a9f915f75dbd9608f3939fa/Examples/webGL.html#L55-L72)). Issue [#132](https://github.com/WICG/html-in-canvas/issues/132) identifies this as the Chrome 150.0.7869.0+ migration path and shows the old six-argument form only as transitional compatibility.

The Khronos WebGL work is also under the WebGL 2.0 spec, not WebGL 1.0: [KhronosGroup/WebGL PR #3752](https://github.com/KhronosGroup/WebGL/pull/3752). Its current draft permits:

| Internal format | Implied source type |
|---|---|
| `RGBA8` | `UNSIGNED_BYTE` |
| `SRGB8_ALPHA8` | `UNSIGNED_BYTE` |
| `RGBA16F` | `HALF_FLOAT` |
| `RGBA32F` | `FLOAT` |

The format discussion is recorded in stable review comments [here](https://github.com/KhronosGroup/WebGL/pull/3752#discussion_r3326731085) and [here](https://github.com/KhronosGroup/WebGL/pull/3752#discussion_r3326747525). `RGBA8` is the canonical current implementation path, but “RGBA8 is the only possible final format” would overstate the open WebGL proposal.

Important instability: the current WICG explainer/Chrome syntax has no mip `level`, while the still-open WebGL WG draft currently includes one. Earlier WG discussion proposed removing it, then later review questioned that special case. Do not expose the WG-draft shape outside the adapter, and do not describe the IDL as standardized.

The current WebGL draft also states that all `UNPACK_*` pixel-store parameters are ignored for element uploads; see the proposal discussion at [Khronos PR #3752](https://github.com/KhronosGroup/WebGL/pull/3752) and the explicit review request [discussion_r3424178463](https://github.com/KhronosGroup/WebGL/pull/3752#discussion_r3424178463). Consequently, `UNPACK_FLIP_Y_WEBGL` is not a portable orientation control for `texElementImage2D`.

### 2. Official examples: exact patterns

#### WebGL/3D example

The example uses:

- CSS canvas size `638px × 318px` and initial grid attributes `638 × 318` ([`webGL.html` lines 11-25](https://github.com/WICG/html-in-canvas/blob/d4433e329697c4341a9f915f75dbd9608f3939fa/Examples/webGL.html#L11-L25)).
- One `400px × 400px` direct child, explicitly `inert` “to prevent hit testing in this example” ([lines 25-42](https://github.com/WICG/html-in-canvas/blob/d4433e329697c4341a9f915f75dbd9608f3939fa/Examples/webGL.html#L25-L42)).
- `webgl2`, not `webgl` ([lines 103-114](https://github.com/WICG/html-in-canvas/blob/d4433e329697c4341a9f915f75dbd9608f3939fa/Examples/webGL.html#L103-L114)).
- `RGBA8` and the current three-argument upload, followed by the old six-argument fallback on exception ([lines 55-72](https://github.com/WICG/html-in-canvas/blob/d4433e329697c4341a9f915f75dbd9608f3939fa/Examples/webGL.html#L55-L72)).
- `LINEAR` minification and `CLAMP_TO_EDGE` on both axes; no mipmaps ([lines 75-80](https://github.com/WICG/html-in-canvas/blob/d4433e329697c4341a9f915f75dbd9608f3939fa/Examples/webGL.html#L75-L80)). The default magnification filter is already linear.
- A continuous `requestAnimationFrame` loop because the cube rotates ([lines 83-101](https://github.com/WICG/html-in-canvas/blob/d4433e329697c4341a9f915f75dbd9608f3939fa/Examples/webGL.html#L83-L101)).
- `main()` called from `onpaint`, one initial `requestPaint()`, and a `ResizeObserver` copying `devicePixelContentBoxSize` directly to `canvas.width/height` ([lines 180-192](https://github.com/WICG/html-in-canvas/blob/d4433e329697c4341a9f915f75dbd9608f3939fa/Examples/webGL.html#L180-L192)).
- The perspective aspect ratio uses `gl.canvas.clientWidth / clientHeight`, not backing-store dimensions ([`webGLSetup.js` lines 157-182](https://github.com/WICG/html-in-canvas/blob/d4433e329697c4341a9f915f75dbd9608f3939fa/Examples/webGLSetup.js#L157-L182)).

The example is illustrative rather than lifecycle-safe production code. Every `paint` calls `main()`, recreates buffers/program/texture, and starts another rAF chain. It does not delete resources, stop loops, or update only changed textures. Our registry, event-driven scheduler, and context lifecycle are useful improvements and should not be weakened to imitate this sample.

The example calls `pixelStorei(UNPACK_FLIP_Y_WEBGL, true)` only after the element has already been uploaded ([`webGL.html` lines 163-169](https://github.com/WICG/html-in-canvas/blob/d4433e329697c4341a9f915f75dbd9608f3939fa/Examples/webGL.html#L163-L169)); it therefore cannot be evidence that flipping is required for the element upload.

#### Interactive and focus examples

The interactive example is Canvas 2D. Its `paint` handler resets the context, calls `drawElementImage`, applies the returned affine transform to `element.style.transform`, requests an initial paint, and sizes from `devicePixelContentBoxSize` ([`text-input.html` lines 51-67](https://github.com/WICG/html-in-canvas/blob/d4433e329697c4341a9f915f75dbd9608f3939fa/Examples/text-input.html#L51-L67)). It includes text input, checkbox, radio, range, and a button, but no select, file input, contenteditable, nonlinear mapping, or WebGL interaction.

The pie-chart example keeps labels focusable with `tabindex=0`, updates each label's CSS transform after drawing, and draws a focus ring based on `document.activeElement` ([`pie-chart.html` lines 22-31](https://github.com/WICG/html-in-canvas/blob/d4433e329697c4341a9f915f75dbd9608f3939fa/Examples/pie-chart.html#L22-L31), [lines 60-77](https://github.com/WICG/html-in-canvas/blob/d4433e329697c4341a9f915f75dbd9608f3939fa/Examples/pie-chart.html#L60-L77)). This supports the design goal of retaining real DOM focus, but only for affine positioning that the browser can hit-test.

### 3. `layoutsubtree`, snapshots, paint, and invalidation

Current constraints are explicit:

- `layoutsubtree` must have been specified in the most recent rendering update.
- The uploaded/drawn element must have been a direct canvas child in the most recent rendering update.
- It must have generated boxes (not `display:none`).
- Source CSS transforms are ignored for captured rendering, although they still affect hit testing/accessibility.
- Both layout and ink overflow are clipped to the source border box.
- Explicit `width`/`height` describe the destination size; omitted values default to the element's on-screen size/proportion in canvas coordinates.

Evidence: [`README.md` lines 27-40](https://github.com/WICG/html-in-canvas/blob/d4433e329697c4341a9f915f75dbd9608f3939fa/README.md#L27-L40).

Snapshot semantics:

- A snapshot of all canvas children is recorded just before `paint`.
- An upload/draw during `paint` observes the current frame snapshot.
- A call outside `paint` uses the previous frame snapshot.
- Calling before any initial snapshot throws.

Evidence: [`README.md` lines 30-32](https://github.com/WICG/html-in-canvas/blob/d4433e329697c4341a9f915f75dbd9608f3939fa/README.md#L30-L32).

Paint semantics:

- `paint` fires when rendering of a canvas child changes.
- It fires once per rendering update after the browser has locked in that update's painted content.
- DOM mutations made inside `paint` appear only in the next frame.
- Changing a source CSS transform does not trigger `paint`, because that transform is ignored by capture.
- With multiple canvases, events fire in reverse tree order so descendants paint before ancestors.
- `requestPaint()` schedules one `paint` even without child changes; it is one-shot, analogous to rAF, not a continuous mode.

Evidence: [`README.md` lines 44-48](https://github.com/WICG/html-in-canvas/blob/d4433e329697c4341a9f915f75dbd9608f3939fa/README.md#L44-L48), [`README.md` lines 351-365](https://github.com/WICG/html-in-canvas/blob/d4433e329697c4341a9f915f75dbd9608f3939fa/README.md#L351-L365), and commit [`d4433e329697`](https://github.com/WICG/html-in-canvas/commit/d4433e329697c4341a9f915f75dbd9608f3939fa).

`PaintEvent.changedElements` remains a `FrozenArray<Element>`, not a map; see [`README.md` lines 237-246](https://github.com/WICG/html-in-canvas/blob/d4433e329697c4341a9f915f75dbd9608f3939fa/README.md#L237-L246) and issue [#95](https://github.com/WICG/html-in-canvas/issues/95#issuecomment-4434236914).

There is an upstream documentation mismatch around removal. Issue [#85](https://github.com/WICG/html-in-canvas/issues/85#issuecomment-4434185481) says `removedElements` was added to the WHATWG draft PR, but the WICG README's IDL still exposes only `changedElements`. Treat `removedElements` as a near-term draft feature, not a universally available runtime field. The engine still needs a deterministic removal path now (event field when present, explicit registry removal, or scoped mutation observation) to prevent texture leaks.

Direct children remain current. Issue [#134](https://github.com/WICG/html-in-canvas/issues/134) proposes a future `drawable` attribute for arbitrary descendants, with independent drawable subtrees and accessibility behavior, but the proposal is still actively changing. Do not implement or declare `drawable` yet.

Nested HTML-in-Canvas is separately supported in Chromium Canary 152.0.7944.0+ according to issue [#120](https://github.com/WICG/html-in-canvas/issues/120#issuecomment-4961512321) and repository commit [`cd4ad61c9599`](https://github.com/WICG/html-in-canvas/commit/cd4ad61c9599586956358a6da7ee1b5a393f1b43). This does not relax the direct-child source rule for ordinary uploads.

There is no API-owned WebGL texture lifetime. Allocation, deletion, context-loss recovery, and scheduling remain application responsibilities. A proposed `texSubElementImage2D` for update-without-reallocation is still open as issue [#147](https://github.com/WICG/html-in-canvas/issues/147); repeated `texElementImage2D` updates may redefine/reallocate storage.

### 4. Native controls, focus, popups, accessibility, and curved rendering

#### What is supported/documented upstream

- Canvas descendants remain in ordinary tab order; issue [#14](https://github.com/WICG/html-in-canvas/issues/14#issuecomment-2375374819) confirms that focus navigation behaves like existing canvas fallback content.
- The intended affine model is to synchronize the source element's DOM position with the canvas draw transform so browser hit testing, focus, intersection observation, and accessibility geometry agree ([`README.md` lines 52-72](https://github.com/WICG/html-in-canvas/blob/d4433e329697c4341a9f915f75dbd9608f3939fa/README.md#L52-L72)).
- Top-layer content and native popups remain outside canvas capture. Issue [#53](https://github.com/WICG/html-in-canvas/issues/53#issuecomment-3598797982) explicitly describes native/custom select popups, context menus, and similar UI as a separate flat/top-layer model. This matches the project's “native escape” visual policy.
- IME popups and distinctive IME formatting must not be painted into readable canvas pixels. They were added to the sensitive-information list by commit [`4181ff27215d`](https://github.com/WICG/html-in-canvas/commit/4181ff27215d95a4ea088b3a3d6f64662ab3ec36); see [`README.md` lines 286-295](https://github.com/WICG/html-in-canvas/blob/d4433e329697c4341a9f915f75dbd9608f3939fa/README.md#L286-L295).
- Form control rendering, scrollbars, selection, and caret blink may be captured subject to the privacy rules, but autofill previews, OS-sensitive colors/themes, spelling markers, visited state, cross-origin content, and IME UI are excluded ([`README.md` lines 280-300](https://github.com/WICG/html-in-canvas/blob/d4433e329697c4341a9f915f75dbd9608f3939fa/README.md#L280-L300)).

#### What is not demonstrated or solved upstream

- The WebGL example disables interaction with `inert`.
- There is no official WebGL/3D example that maps a pointer through perspective or a curved shader to descendants.
- There is no official select/file-picker example and no official recommendation to call `showPicker()` from a projected input plane. That is a plausible application escape, but it must remain a browser gate.
- A synthetic `PointerEvent`, `MouseEvent`, or `.click()` is not trusted and cannot be assumed to trigger all browser default actions, caret placement, popup opening, drag behavior, or accessibility event behavior.
- CSS/DOMMatrix synchronization handles affine/projective placement only. It cannot describe nonlinear per-pixel curvature.
- A source that is semantically present may still have flat/offscreen accessibility geometry that does not match a curved visual surface.

The gap is explicit upstream:

- Issue [#135](https://github.com/WICG/html-in-canvas/issues/135) is redesigning transform and hit-test synchronization. Its July discussion proposes canvas transforms and WebGL/WebGPU `currentTransform`, but the shape is not settled.
- Issue [#140](https://github.com/WICG/html-in-canvas/issues/140) requests manual nonlinear coordinate routing.
- Issue [#148](https://github.com/WICG/html-in-canvas/issues/148) states that WebGL/WebGPU has no pixel-perfect nonlinear hit testing and explores a custom callback/worklet model.
- Issue [#49](https://github.com/WICG/html-in-canvas/issues/49#issuecomment-4099409706) confirms that the current author-managed transform works for only one affine hit region and that the browser does not natively solve arbitrary 3D placement.
- Issue [#94](https://github.com/WICG/html-in-canvas/issues/94#issuecomment-4273244961) records real 3D demo failures: transform drift, subpixel pointerdown/up mismatch, and camera-control listeners intercepting panel clicks.
- Issue [#134](https://github.com/WICG/html-in-canvas/issues/134) remains open because direct-child flattening can damage semantic structure and accessibility.

Conclusion: our inverse projection, capture plane, `elementsFromPoint`, and event router are application-owned experiments needed for the requested nonlinear screen. They preserve source DOM layout as a lookup structure, but they do not inherit the browser's guarantee of trusted native interaction or correctly curved accessibility hit geometry.

### 5. Experimental status, tests, versions, and recent changes

The README calls itself a continuously updated living explainer and requires `chrome://flags/#canvas-draw-element` ([`README.md` lines 5-10](https://github.com/WICG/html-in-canvas/blob/d4433e329697c4341a9f915f75dbd9608f3939fa/README.md#L5-L10), [lines 302-309](https://github.com/WICG/html-in-canvas/blob/d4433e329697c4341a9f915f75dbd9608f3939fa/README.md#L302-L309)). Issue [#115](https://github.com/WICG/html-in-canvas/issues/115#issuecomment-4293212966) explicitly says Chrome Canary plus that flag is required. Chromium is the only implementation with a prototype; issue [#111](https://github.com/WICG/html-in-canvas/issues/111#issuecomment-4240493385) says WebKit and Gecko have not prototyped it.

There is no draft spec file or test suite in the WICG repository tree. Issue [#145](https://github.com/WICG/html-in-canvas/issues/145) is still open to create a draft spec. Relevant normative work is split across open [WHATWG HTML PR #11588](https://github.com/whatwg/html/pull/11588) and open [Khronos WebGL PR #3752](https://github.com/KhronosGroup/WebGL/pull/3752). Chromium has implementation tests, including the top-layer test referenced by issue [#53](https://github.com/WICG/html-in-canvas/issues/53#issuecomment-3582437780), but these are not exposed as a WICG conformance suite.

Material recent changes:

- [`97558b894afe`](https://github.com/WICG/html-in-canvas/commit/97558b894afe024cef348205ccf0c729aaccc23a) / PR [#128](https://github.com/WICG/html-in-canvas/pull/128) — changed WebGL/WebGPU IDL.
- [`89a54862ce06`](https://github.com/WICG/html-in-canvas/commit/89a54862ce069ea45c10a1f6b65963409feb5722) / PR [#130](https://github.com/WICG/html-in-canvas/pull/130) — updated the WebGL demo for the new syntax.
- Issue [#132](https://github.com/WICG/html-in-canvas/issues/132) — Chrome 150 breaking migration notice.
- [`4181ff27215d`](https://github.com/WICG/html-in-canvas/commit/4181ff27215d95a4ea088b3a3d6f64662ab3ec36) — IME popups/formatting classified as sensitive.
- [`cd4ad61c9599`](https://github.com/WICG/html-in-canvas/commit/cd4ad61c9599586956358a6da7ee1b5a393f1b43) — nested canvas support note.
- [`d4433e329697`](https://github.com/WICG/html-in-canvas/commit/d4433e329697c4341a9f915f75dbd9608f3939fa) — reverse-tree-order paint clarification.

Other implementation risks worth tracking:

- [#147](https://github.com/WICG/html-in-canvas/issues/147) — no `texSubElementImage2D`, so efficient stable-storage updates are missing.
- [#138](https://github.com/WICG/html-in-canvas/issues/138) — generalized supersampled capture remains requested/unclear, especially outside WebGL's explicit `width`/`height` config.
- [#121](https://github.com/WICG/html-in-canvas/issues/121) — compositor-driven opacity/filter transitions have flashed source descendants above the canvas in some Chromium versions.
- [#116](https://github.com/WICG/html-in-canvas/issues/116) — slots/Shadow DOM behavior is still being fixed.
- [#31](https://github.com/WICG/html-in-canvas/issues/31#issuecomment-4094093772) — animated images/video invalidation remains incomplete in Chromium.

## Concrete Divergences and Classification

### Must-fix now

#### A. Canonical context/signature negotiation

Local evidence:

- Prior research chooses WebGL1: `.trellis/tasks/07-31-spatial-rendering-input-foundation/research/foundation-evidence.md:32-37`.
- Design says “Acquire a WebGL 1 context”: `.trellis/tasks/07-31-spatial-rendering-input-foundation/design.md:78-85`.
- Code advertises `current | compact | legacy` and `webgl2 | webgl1`: `apps/platform-web/src/spatial/engine/capabilities.ts:1-2`.
- Code falls back from WebGL2 to WebGL1: `capabilities.ts:85-105`.
- Code probes unsupported `(target, element)` compact calls: `capabilities.ts:117-119`, `168-177`.

Action:

- Make WebGL2 the required current context and type the capability as `WebGL2RenderingContext`.
- Current call: `(TEXTURE_2D, RGBA8, element, {width,height})`.
- If compatibility is still required, retain only the official old six-argument call and label it temporary legacy.
- Remove `compact`, WebGL1 fallback, and tests that present either as supported official variants.
- Add `"unresolved"` or `"not-yet-uploaded"` diagnostic state; the current `apiVariant` getter reports a preferred variant before successful negotiation (`capabilities.ts:136-138`).

#### B. Element upload pixel-store assumption

Local evidence: `capabilities.ts:152-155` sets `UNPACK_FLIP_Y_WEBGL` before every upload.

Action: remove reliance on this state for element upload. Verify orientation through the source shader/UV convention using the flagged browser. The WebGL draft says unpack state is ignored, and the official example does not set flip until after its element upload.

#### C. Experimental declarations do not match the current official surface

Local evidence:

- `apps/platform-web/src/spatial/engine/html-in-canvas-types.d.ts:14-30` adds current, unsupported compact, and legacy overloads to WebGL1.
- `html-in-canvas-types.d.ts:33-48` repeats all three on WebGL2.
- `PaintEvent` has only `changedElements`: `html-in-canvas-types.d.ts:3-6`.

Action:

- Declare the current optional-config signature on WebGL2.
- Keep legacy compatibility as a private adapter call type instead of advertising it globally as current Web IDL.
- Remove the two-argument overload.
- Add optional/source-guarded `removedElements` support at the adapter boundary while acknowledging that the WICG README is currently stale relative to the WHATWG draft.

#### D. Removed sources and source eligibility

Local evidence:

- Paint handler forwards only `changedElements`: `capabilities.ts:142-150`.
- Registry only checks current `parentElement`: `apps/platform-web/src/spatial/engine/element-textures.ts:35-40`.
- Zero-size/non-box sources are forced to at least 1×1 and retried: `element-textures.ts:142-167`.
- Texture release on removal exists only when `remove()` is explicitly called: `element-textures.ts:56-63`.

Action:

- Forward a normalized paint payload containing changed and removed elements when available.
- Ensure every DOM removal synchronously calls registry removal, with a mutation observer only if lifecycle wiring cannot guarantee that.
- Preflight/diagnose disconnected, no-longer-direct-child, and no-generated-box sources instead of silently converting them to 1×1 and retrying forever.
- Add tests for removed event entries, external removal, `display:none`, disconnected sources, and no initial snapshot.

#### E. Target resolution incorrectly conflates accessibility/activation with hit testing

Local evidence:

- `selectTargetCandidate` drops `disabled`, `ariaHidden`, and `pointerEventsNone` together: `apps/platform-web/src/spatial/engine/input/target-resolver.ts:23-31`.
- `isDisabled` treats `aria-disabled=true` as native disabled: `target-resolver.ts:84-87`.
- Design requires skipping disabled and `aria-hidden`: `.trellis/tasks/07-31-spatial-rendering-input-foundation/design.md:213-222`.

Action:

- `aria-hidden` must not remove a pointer hit; it controls accessibility exposure.
- `aria-disabled` must not remove a pointer hit or act like native `disabled` by itself.
- Native disabled controls may still be geometric/hover targets; suppress activation/default-control mutation after resolution rather than choosing an element beneath them.
- Keep `display:none`, hidden ancestors, visibility, and effective `pointer-events:none` as hit-test exclusions.
- Update resolver tests to separate geometric target, activation eligibility, and accessibility state.

#### F. Synthetic interaction must not report native success

Local evidence:

- `PointerRouter` dispatches synthetic pointer/mouse sequences and manually focuses/activates: `apps/platform-web/src/spatial/engine/input/pointer-router.ts:58-115`.
- Design describes this as mirroring browser expectations: `.trellis/tasks/07-31-spatial-rendering-input-foundation/design.md:224-240`.
- Input caret placement approximates character offset from horizontal width: `apps/platform-web/src/spatial/engine/input/native-controls.ts:136-145`.
- Range mutation assumes a left-to-right horizontal control: `native-controls.ts:110-133`.
- Picker fallback does not itself enforce same-task trusted-handler invocation: `native-controls.ts:84-107`.

Action:

- Label routed events as synthetic/application-owned and record whether the intended state actually changed.
- Do not consider focus alone proof of caret placement, IME support, checkbox/radio activation, or popup opening.
- Replace the input/textarea proportional-character approximation with either a browser-proven narrow adapter or an explicit unsupported result; it is wrong for proportional fonts, bidi, selection ranges, padding, and scrolling.
- Treat range orientation, RTL, vertical writing, keyboard interaction, and commit semantics as separate probes.
- Ensure `showPicker()`/fallback runs synchronously in the original trusted input-plane handler; expose `NotAllowedError` and unsupported outcomes.
- Keep keyboard/IME on the real focused DOM, but record that IME popup/formatting is intentionally not captured.

### Spec-doc correction

#### G. WebGL2/RGBA8 baseline and instability

Update `.trellis/tasks/07-31-spatial-rendering-input-foundation/design.md:63-85` and `research/foundation-evidence.md:22-37`:

- WebGL2 + RGBA8 is the canonical current path.
- Current API is three arguments, or four with optional config; old six arguments are temporary legacy.
- WebGL1 and compact are not current official paths.
- Khronos/WHATWG work is open and can change the call again; exact declarations remain adapter-local.

#### H. Paint/snapshot latency and removals

Update `design.md:141-160`:

- Document that upload during `paint` gets the current snapshot, while a scheduled later upload gets the previous snapshot and may add one frame of latency.
- `requestPaint()` is a one-shot event request; an empty changed list does not mean “all sources changed.” It may only authorize already-dirty sources to consume the available snapshot.
- Document removed-element handling and reverse-tree-order delivery for future nested canvases.

The registry's current `markChanged([])` behavior (`element-textures.ts:97-106`) is reasonable for already-dirty initial/restore records; it should not be generalized to dirty all clean textures.

#### I. Nonlinear input and accessibility guarantees

Update `design.md:199-271` and `foundation-evidence.md:39-66`:

- Manual inverse projection is a project workaround for an explicitly open platform problem.
- Browser-native pointer default actions are not preserved merely by dispatching synthetic events.
- DOM semantics, keyboard focusability, and keyboard/IME ownership can remain real, but curved pointer geometry and accessibility hit geometry are not natively synchronized.
- Select/file/customizable-select/context menu/IME popups are flat native/top-layer escapes and are not included in the curved texture.
- The official interactive evidence is affine Canvas 2D, not curved WebGL.

#### J. DPR and raster sizing

Local evidence:

- Design says canvas and source sizes use effective DPR clamped to 1/2: `design.md:273-280`.
- `computeBackingStoreSize` clamps to `[1,2]`: `apps/platform-web/src/spatial/engine/input/coordinates.ts:211-229`.
- Renderer forces a minimum raster scale of 2 even on DPR1: `apps/platform-web/src/spatial/engine/renderer.ts:47`, `95-116`.

Correction:

- Official examples use exact `ResizeObserverEntry.devicePixelContentBoxSize` for the canvas backing store.
- Explicit WebGL config `width/height` may deliberately choose another element-texture resolution, including the project's 2× floor, but this is local supersampling policy, not canonical DPR behavior.
- Clarify whether the lab is testing actual DPR1 backing or a DPR1 display with a deliberate 2× internal raster. Metrics and acceptance rows must distinguish the two.

### Useful future enhancement

#### K. Sub-image updates

`apps/platform-web/src/spatial/engine/element-textures.ts:135-170` reuses texture objects but calls `texElementImage2D`, which can redefine storage. Track issue [#147](https://github.com/WICG/html-in-canvas/issues/147) and add `texSubElementImage2D` only after an actual API ships. Until then, metrics should not imply that a dirty reupload is allocation-free.

#### L. Future native hit-test hooks

Keep `projection.ts`, `geometry.ts`, `coordinates.ts`, and `target-resolver.ts` modular so an eventual canvas-global/per-element hit-test API from issues [#135](https://github.com/WICG/html-in-canvas/issues/135) or [#148](https://github.com/WICG/html-in-canvas/issues/148) can replace synthetic routing without rewriting curve math.

#### M. Descendant `drawable` and structured accessibility

Track issue [#134](https://github.com/WICG/html-in-canvas/issues/134), but retain direct-child enforcement now. If `drawable` ships, revisit source ownership, flattening, ancestor clips, paint order, and accessibility tree behavior as one coordinated change.

#### N. Shadow DOM, animated media, compositor effects, and color formats

- Shadow DOM/slots: [#116](https://github.com/WICG/html-in-canvas/issues/116).
- Animated images/video invalidation: [#31](https://github.com/WICG/html-in-canvas/issues/31).
- Compositor transition leakage: [#121](https://github.com/WICG/html-in-canvas/issues/121).
- Additional texture formats/wide color: [Khronos PR #3752](https://github.com/KhronosGroup/WebGL/pull/3752).

These should not expand the current foundation acceptance gate unless a concrete task requirement depends on them.

### No action

- Direct-child registration in `element-textures.ts:35-40` matches the current explainer.
- Dirty-generation tracking and “upload only dirty” behavior in `element-textures.ts:87-170` is stronger than the official example and consistent with `changedElements`.
- `CLAMP_TO_EDGE` and linear texture filtering in `element-textures.ts:215-224` match the official WebGL sample.
- Event-driven scheduling in `frame-scheduler.ts` is a valid project optimization; the official continuous loop exists only because its cube rotates continuously.
- Resource ownership/context-loss handling in `resources.ts` and `renderer.ts:174-226` is application responsibility and appropriately explicit.
- Curve/projection/geometry/shader modules are project-specific nonlinear rendering logic; the official API neither prescribes nor conflicts with them.
- Keeping source controls non-`inert` is correct for this interactive lab. The official WebGL sample's `inert` is explicitly demo-specific.

## File-by-File Actionable List

| File | Classification | Action |
|---|---|---|
| `.trellis/tasks/07-31-spatial-rendering-input-foundation/design.md` | spec-doc correction | Replace WebGL1 with WebGL2/RGBA8 current syntax; document snapshot latency, removal, synthetic-input limits, flat popups/IME, accessibility geometry caveat, and local-vs-device DPR policy. |
| `.trellis/tasks/07-31-spatial-rendering-input-foundation/research/foundation-evidence.md` | spec-doc correction | Correct the prior WebGL1 conclusion and narrow the native-control claims to browser-proven outcomes. |
| `.trellis/tasks/07-31-spatial-rendering-input-foundation/prd.md` | no action | Direct-child and experimental-status statements remain valid; acceptance already requires real-browser proof and unsupported-as-failure. |
| `.trellis/tasks/07-31-spatial-rendering-input-foundation/implement.md` | spec-doc correction | Step 4 should say current WebGL2 + temporary six-argument legacy only, add removed-source/event and no-generated-box probes; Step 9 should explicitly record synthetic/trusted status and accessibility geometry. |
| `engine/capabilities.ts` | must-fix now | Require WebGL2; remove WebGL1/compact; remove unpack-flip reliance; represent unresolved/current/legacy accurately; normalize changed+removed paint payload. |
| `engine/capabilities.test.ts` | must-fix now | Replace WebGL1/compact tests with canonical 3/4-argument current and optional six-argument legacy tests; test unresolved diagnostics, removals, and ignored unpack-state policy. |
| `engine/html-in-canvas-types.d.ts` | must-fix now | Match current optional-config WebGL2 shape; remove two-argument and global legacy overloads; add guarded removal field if consumed. |
| `engine/element-textures.ts` | must-fix now | Handle removed sources deterministically; reject/diagnose disconnected, no-box, and stale-parent sources; keep empty-changed handling limited to already-dirty records. |
| `engine/element-textures.test.ts` | must-fix now | Add external removal, removed event, `display:none`/zero-box, stale parent, initial snapshot, and non-retryable failure cases. |
| `engine/renderer.ts` | spec-doc correction | Propagate WebGL2 capability type; clarify exact canvas device-pixel backing versus deliberate 2× source/scene supersampling; verify texture orientation without unpack flip. |
| `engine/renderer.test.ts` | must-fix now | Update capability context/type fixtures and add orientation/backing-policy assertions affected by the adapter correction. |
| `engine/input/target-resolver.ts` | must-fix now | Stop treating `aria-hidden`, `aria-disabled`, and native disabled as “not geometrically hit”; return activation/accessibility metadata separately. |
| `engine/input/target-resolver.test.ts` | must-fix now | Cover disabled hover target, blocked activation, `aria-hidden` pointer target, `aria-disabled` semantics, and true pointer-events/visibility exclusion. |
| `engine/input/pointer-router.ts` | must-fix now | Make synthetic/trusted limitations explicit in result/diagnostics; never infer native default-action success solely from dispatch/focus. |
| `engine/input/pointer-router.test.ts` | must-fix now | Assert cancellation/activation outcome reporting and separate routed event delivery from verified native state mutation. |
| `engine/input/native-controls.ts` | must-fix now | Require synchronous trusted picker invocation; replace approximate text caret success with proven/unsupported result; separate range variants and actual state verification. |
| `engine/input/native-controls.test.ts` | must-fix now | Add unsupported/trusted picker results, proportional/bidi caret non-claims, range direction/orientation cases, and verified event/state outcomes. |
| `engine/input/coordinates.ts` | spec-doc correction | Keep inverse math; document it as app-owned nonlinear mapping and distinguish CSS coordinates from device-pixel backing and local supersampling. |
| `engine/input/coordinates.test.ts` | no action | Existing CSS-vs-device-pixel separation is useful; add cases only if backing/supersampling policy changes. |
| `engine/frame-scheduler.ts` | no action | Event-driven idle behavior is a sound improvement over the rotating demo's continuous loop. |
| `engine/frame-scheduler.test.ts` | no action | Current scheduler state tests remain relevant. |
| `engine/geometry.ts` | no action | Project-specific 3D ray/quad math; useful boundary for future native hit-test replacement. |
| `engine/geometry.test.ts` | no action | Pure geometry coverage remains valid. |
| `engine/gl-program.ts` | no action | Generic shader/program lifecycle is unaffected by HTML-in-Canvas API drift. |
| `engine/gl-program.test.ts` | no action | Existing cleanup/failure tests remain valid. |
| `engine/metrics.ts` | useful future enhancement | If feasible, distinguish upload call count from known texture redefinition/allocation; current API cannot promise allocation-free updates. |
| `engine/metrics.test.ts` | useful future enhancement | Extend only when allocation/redefinition metrics are introduced. |
| `engine/projection.ts` | no action | Analytic inverse projection is the appropriate local workaround for missing nonlinear platform hit testing. |
| `engine/projection.test.ts` | no action | Dense round-trip/out-of-domain coverage remains essential. |
| `engine/resources.ts` | no action | Explicit application-owned WebGL resource lifetime is required. |
| `engine/resources.test.ts` | no action | Current release/restore coverage remains relevant. |
| `engine/scene.ts` | no action | Project-specific z/order and NDC mapping are outside upstream API scope. |
| `engine/scene.test.ts` | no action | Existing scene mapping tests remain valid. |
| `engine/shaders/scene.ts` | must-fix now | Verify source texture orientation after removing unpack-flip reliance; code change only if the flagged browser proof shows inversion. |
| `engine/shaders/curve.ts` | no action | Nonlinear final pass is project-owned and upstream-neutral. |
| `engine/shaders/curve.test.ts` | no action | Curve shader contract remains relevant. |
| `engine/shaders/environment.ts` | no action | Visual-only project shader; no upstream API coupling. |

## Related Specs

- `.trellis/spec/platform-web/frontend/type-safety.md:1-4` — strict TypeScript and runtime-boundary normalization support keeping all unstable API casts/declarations in one adapter.
- `.trellis/spec/guides/cross-layer-thinking-guide.md:42-47` — exact boundary inputs, outputs, and errors must be defined; this applies directly to paint payload normalization and upload signature selection.
- `.trellis/spec/guides/cross-layer-thinking-guide.md:53-69` — avoid implicit external-format assumptions and leaky abstractions; WebGL1/compact negotiation is currently an unsupported assumption leaking into engine types/tests.
- `.trellis/spec/platform-web/frontend/quality-guidelines.md` — real-browser and failure-path verification remains necessary for behavior Happy DOM cannot reproduce.

## Caveats / Not Found

- No browser automation or runtime probes were performed, per request. Native-control, orientation, snapshot timing, and flag/version behavior remain browser gates.
- No implementation files, task design files, or specs were modified.
- No tests or full checks were run.
- The WICG repository contains examples but no conformance test suite and no draft spec file.
- The WICG README, WHATWG HTML PR, Khronos WebGL PR, and current Chromium implementation are not fully synchronized. In particular, `removedElements` and the WebGL mip `level` argument differ across sources.
- `drawable`, nonlinear native hit testing, `texSubElementImage2D`, generalized supersampling, Shadow DOM, and animated-media invalidation are open proposals/issues, not current contracts.
- The official repository does not demonstrate select/file picker behavior, `showPicker()` from a projected plane, curved accessibility hit geometry, or trusted native default actions after synthetic routing.
