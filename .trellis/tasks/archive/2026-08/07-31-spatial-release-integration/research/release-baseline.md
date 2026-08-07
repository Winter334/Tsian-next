# Spatial Release Baseline — 2026-08-07

## Completed prerequisites

- Spatial rendering/input foundation, desktop shell, library/market, workspace, Agent, system, and Play/global children are archived.
- `platformAppRegistry` contains 13 first-release platform applications and every one currently receives a Spatial component.
- Spatial runtime already owns capability detection, renderer fallback, route/window identity, projected input, reduced motion, texture metrics and resource disposal.

## Current release blockers found by repository inspection

1. `apps/platform-web/src/config/platform-ui-mode.ts` keeps `SPATIAL_RELEASE_READY = false`.
2. `apps/platform-web/src/config/platform-ui-mode.test.ts` asserts the production gate remains closed.
3. Both settings presentations still call Spatial a local experiment / work in progress.
4. `SpatialPresentationRegistration` still models `pending | ready`, and `SpatialWindowSurface` retains `SpatialPendingAppSurface` even though every registry entry is ready.
5. The final browser matrix, concise Flag guidance, parent acceptance review and production gate opening have not been recorded.

## Automated baseline

- `npx vitest run apps/platform-web/src/spatial/engine/renderer.test.ts apps/platform-web/src/spatial/shell/window-layout.test.ts`
  - 2 files / 36 tests passed.
- `npm test`
  - 118/119 files and 892/893 tests passed on the first full parallel run.
  - The only failure was `platform-host/frontend-actions/schema.test.ts` timing out at 5 seconds in the validator-cache test.
- Isolated rerun of `schema.test.ts`
  - 1 file / 13 tests passed in 2.13 seconds, classifying the full-run result as parallel timing noise rather than a Spatial product failure.
- `npm run build:web`
  - passed, with existing third-party pure-annotation and chunk-size warnings.

## User-owned release communication decision

- Keep control-panel copy brief: desktop Chromium + experimental HTML-in-Canvas Flag + mouse/trackpad + automatic RetroOS fallback.
- Put detailed setup, version and known-limit information in the platform announcement.
- Runtime capability detection remains authoritative and gives a concrete fallback reason; correctness does not depend on announcement availability.
