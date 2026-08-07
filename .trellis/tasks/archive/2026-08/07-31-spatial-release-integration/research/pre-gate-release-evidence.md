# Spatial Release Evidence — 2026-08-07

## Checkpoint status

- The user confirmed that the real browser product matrix completed successfully. `SPATIAL_RELEASE_READY` is now `true`, while setting it back to `false` remains the immediate production rollback path.
- Spatial registry completeness is structural: every application definition requires a Spatial component, and the production pending presentation and its styles are removed.
- RetroOS and Spatial settings consume one concise environment-guidance constant. Runtime capability and renderer fallback messages remain the detailed source of failure feedback.
- Registry/route parity is derived from `platformAppRegistry` and its focused tests rather than a second maintained application-id checklist.

## Announcement draft points

- Availability: Spatial Desktop targets desktop Chromium with the experimental HTML-in-Canvas capability enabled.
- Flag: enable `chrome://flags/#canvas-draw-element` or the equivalent flag exposed by the Chromium distribution, then restart the browser.
- First-release environment: a fine pointer (mouse or trackpad), a viewport of at least `1024×640`, WebGL2, and the required HTML-in-Canvas API.
- Fallback: incompatible input, viewport, browser API, WebGL initialization, lazy-load, renderer, or context conditions return the current launch to RetroOS without rewriting the saved UI preference or business data.
- Session behavior: switching UI mode saves the complete platform configuration and preserves the current route across reload; the in-memory window session is intentionally not migrated.
- Known limits: HTML-in-Canvas is experimental and Chromium behavior may vary by build. Native picker/file/IME surfaces remain flat browser escapes, and Play uses native fullscreen for primary gameplay input.
- Runtime independence: the announcement is guidance only. Capability detection and safe RetroOS fallback do not depend on the announcement being available.

## Automated evidence

- Registry rollback checkpoint: `platform-apps.test.ts`, `spatial-window-surface.test.ts`, and `window-session.test.ts` passed (3 files, 24 tests).
- Guidance checkpoint: `platform-apps.test.ts`, `platform-ui-mode.test.ts`, `AppearanceScreen.test.ts`, and `SpatialSettingsView.test.ts` passed (4 files, 25 tests).
- Full Spatial plus release-config run passed: 45 files, 256 tests.
- Controller/component/view cross-child run passed: 23 files, 79 tests.
- `npm run build:web` passed (`vue-tsc -b` and Vite production build, 3,281 modules transformed). The output contains 29 Spatial JS/CSS chunks. Existing third-party pure-annotation, mixed dynamic/static import, and chunk-size warnings remain non-blocking.
- `npm test` passed on the first run: 120 files, 899 tests. No isolated timeout rerun was needed.
- Production source/output isolation passed: no pending surface/style/probe copy, obsolete local-experiment/gate copy, or Spatial lab marker; Spatial application source contains no RetroOS class or route-view presentation embedding.
- `git diff --check` passed. The unrelated user-owned `.codex/config.toml` change was not edited.

## User-confirmed browser product matrix

The user reported that the full real-browser matrix below passed before authorizing the production gate to open:

- Flag-enabled desktop Chromium: enter Spatial; exercise registry-derived routes/deep links, launcher, multi-window open/focus/drag/resize/minimize/restore/close, and Play singleton/fullscreen retention.
- Projected input: center/edge click, hover, wheel, native scrollbar, context menu, keyboard focus/Tab, text input, primary modal flows, file/IME escapes, and pointer capture cancellation.
- Lifecycle: mode reload route/data retention, reduced motion, idle texture uploads, dirty Source isolation, dynamic media, minimize/close disposal, and context loss/restore.
- Fallback: no Flag/API, coarse pointer, viewport below `1024×640`, WebGL/renderer failure, and lazy shell-load failure all produce a complete RetroOS surface with a concise reason.
- Final visual/copy review: independent curved surfaces and depth, readable established window styling, no pending/lab/RetroOS presentation residue, and no long setup tutorial in either settings presentation.

## Production-gate validation

- Focused UI-mode/registry/settings tests passed: 4 files, 25 tests.
- The full `npm test` run completed 119/120 files and 898/899 tests. Its only failure was the known non-Spatial `platform-host/frontend-actions/schema.test.ts` validator-cache case exceeding the 5-second timeout under parallel load.
- The isolated schema rerun passed: 1 file, 13 tests, 2.09-second total duration (1.58-second test time), confirming parallel timing noise rather than a release regression.
- `npm run build:web` passed (`vue-tsc -b` plus Vite production build, 3,281 modules transformed) and emitted both `SpatialDesktopShell-Cz62rpfA.js` and `SpatialDesktopShell-BMSfmIcQ.css`.
- Production source/output isolation passed: no pending surface/style/probe, obsolete experiment/gate copy, closed release constant, Spatial lab marker, or RetroOS route-view presentation embedding.
- The trellis-check accessibility correction is retained: RetroOS appearance options expose `aria-pressed`, with focused assertions for current and non-current modes.
- `git diff --check` passed; only line-ending conversion warnings were reported. The unrelated `.codex/config.toml` change remains untouched.

## Final full-scope check

- Focused Spatial/release checks passed: 46 files, 258 tests.
- Controller/component/view checks passed: 23 files, 79 tests.
- `npm run build:web` passed with 3,281 modules transformed.
- Final `npm test` passed without timeout: 120 files, 899 tests.
- Source/output isolation and `git diff --check` passed; no final review findings remained.
