# Verification

## Automated checks

- `npm test -- --run apps/platform-web/src/spatial`: 17 files, 76 tests passed.
- `npm exec vue-tsc -- -b apps/platform-web/tsconfig.json`: passed.
- `npm run build:web`: Vue type-check and Vite production build passed; 3102 modules transformed.
- `git diff --check`: passed.
- Production output contains no `spatial-lab.html`, lab-named chunk, `spatial-lab`, `SpatialInteractionLab`, `data-spatial-source`, `texElementImage2D`, or `Spatial Foundation` marker.
- All 52 currently untracked active-task and Spatial files also pass `git diff --no-index --check` with CR-at-EOL normalization.

## Browser acceptance

On 2026-08-01 the user completed the final Flag-enabled manual acceptance pass and reported it passed after the last quality fixes. The accepted matrix covered the curved source orientation/visual result, center and edge interaction, text input and Chinese IME, custom/native select and file-picker paths, drag/resize/scroll behavior, full-screen parallax, particle background, diagnostics access, and WebGL context loss/restore.

Browser evidence is user-run rather than automated because the agent-accessible browser does not expose the required experimental APIs. DPR/paint timing and lifecycle behavior retain automated math/state/resource coverage plus the accepted target-browser result; repeat the full browser matrix when Chromium changes the flag/API or before production release integration.

No production route is enabled. The development lab and its experimental API markers are absent from production output.
