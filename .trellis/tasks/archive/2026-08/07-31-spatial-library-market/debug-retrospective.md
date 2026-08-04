# Bug Analysis: Dominant content loses Source curvature during CSS motion

## 1. Root Cause Category

- **Category**: B — Cross-Layer Contract, with E — Implicit Assumption.
- **Specific cause**: We assumed a descendant CSS transition remained inside the HTML-in-Canvas Source texture. Flag Chromium promoted the animated subtree into a planar compositor layer; it bypassed the curved WebGL mesh until the transition ended and then snapped back into the Source.

## 2. Why Earlier Fixes Failed

1. Stronger CSS timing/displacement changed presentation parameters but not layer ownership.
2. Bounded Source repaint fixed skipped/stale texture generations, but repaint cannot curve a compositor layer that escaped Source capture.
3. `out-in`, stacked opacity, and pre-capture/double-mount experiments addressed empty or stale frames while retaining the same invalid descendant-compositor animation boundary.

## 3. Prevention Mechanisms

| Priority | Mechanism | Specific action | Status |
|---|---|---|---|
| P0 | Architecture | Dominant Market/Detail content swaps immediately inside one Source texture; no compositor-promoting CSS transition | DONE |
| P0 | Documentation | Record the planar-during-motion/curved-at-end diagnostic in `spatial-ui.md` | DONE |
| P0 | Review guide | Add animated-frame ownership and curvature-during-transition checks to the cross-layer guide | DONE |
| P1 | Manual runtime gate | Judge normal Flag Chromium navigation and inspect curvature during motion, not only endpoints or HMR | DONE |
| P2 | Platform capability | Design renderer-owned old/new textures on one curved mesh before restoring dominant animated handoffs | FOLLOW-UP |

## 4. Systematic Expansion

- **Similar issues**: Popovers, dialogs, selects, and list entries still use local CSS motion; disable an individual class if Flag Chromium shows the same planar escape.
- **Design improvement**: A real curved content transition belongs to the renderer and needs explicit old/new texture ownership, progress, interruption, reduced-motion, and context-loss contracts.
- **Process improvement**: Classify visual artifacts by owning layer—DOM compositor, Source texture, or GPU renderer—before tuning animation parameters or repaint frequency.

## 5. Knowledge Capture

- [x] Updated `.trellis/spec/platform-web/frontend/spatial-ui.md`.
- [x] Updated `.trellis/spec/guides/cross-layer-thinking-guide.md`.
- [x] Updated task PRD/design/verification.
- [ ] Commit/archive after the user-owned Flag Chromium acceptance gate.

---

# Bug Analysis: Spatial Select closes before projected option resolution

## 1. Root Cause Category

- **Category**: B — Cross-Layer Contract, with D — Test Coverage Gap.
- **Specific cause**: `SpatialSelect` listened for document-capture `pointerdown` to close on outside input. In Spatial mode the trusted browser target is always the full-screen input plane. The handler therefore closed and hid the listbox before `SpatialViewportController` could inverse-project the same gesture and resolve an option.

## 2. Why Earlier Fixes Failed

1. Adjusting projected click cancellation fixed the `mousedown`/activation boundary but did not change the earlier trusted document-capture event.
2. Changing absolute versus flow layout changed geometry without changing event order.
3. Keeping options permanently mounted proved their rectangles were stable, but the trusted capture handler still applied `visibility:hidden` and `pointer-events:none` before hit resolution.
4. The first probe showed the second click falling back to the trigger; the final probe showed only the opening click. Together they distinguish geometry fallback/no-hit from successful option delivery.

## 3. Prevention Mechanisms

| Priority | Mechanism | Specific action | Status |
|---|---|---|---|
| P0 | Architecture | Source outside-pointer logic ignores trusted input-plane events and consumes routed synthetic targets | DONE |
| P0 | Test coverage | Cover trusted-plane, routed-inside, and routed-outside decisions plus mounted option identity | DONE |
| P0 | Documentation | Record the trusted-plane/synthetic-Source event boundary in `spatial-ui.md` | DONE |
| P1 | Runtime evidence | Probe event count, target, mapped coordinates, element rectangles, and `elementsFromPoint` together | DONE |

## 4. Systematic Expansion

- **Similar issues**: Any Source-local menu, dialog, popover, focus trap, or outside-click directive that listens on `document` can repeat this race.
- **Design improvement**: Treat trusted input-plane events and synthetic Source events as separate domains; never infer the projected target from the former's `event.target`.
- **Process improvement**: When a projected control disappears before hit-testing, inspect event ordering and state mutation before changing geometry again.

## 5. Knowledge Capture

- [x] Updated `.trellis/spec/platform-web/frontend/spatial-ui.md`.
- [x] Updated `.trellis/spec/guides/cross-layer-thinking-guide.md`.
- [x] Added durable Select regression coverage.
- [x] User confirmed the fix in Flag Chromium; temporary probe UI was removed.
