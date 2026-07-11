# import.meta.glob Planning Research

Date: 2026-07-10

## Confirmed Repository Facts

- `buildFrontend()` preloads `frontend/src/**` into a Map and builds with browser `esbuild-wasm`, ESM format, splitting, `write: false`, outdir assets and metafile.
- Dynamic chunks/assets already flow through `writeBackDist` into `frontend/dist/**`; the existing Service Worker serves arbitrary stored dist paths.
- Plugin registration order means a separate post-processing `onLoad` plugin cannot reliably transform every source. Integration is required at the entry, workspace JS/TS loader and Vue script compilation boundaries.
- Workspace source resolution has canonical relative/alias behavior, but ordinary relative imports clamp extra `..`; glob patterns require a separate strict root-bound resolver.
- `findEntryOutputPath()` currently chooses the first metafile output carrying `entryPoint`; lazy glob chunks can also carry entry identities, so exact root selection must be probed and implemented.
- Existing write-back links all emitted CSS in HTML. This does not reproduce Vite lazy CSS timing and remains an explicit non-blocking limit.

## Browser-Safe Dependency Decision

- `@babel/parser`: browser-bundleable parser with JS/TS/JSX locations. Use a Babel 7 version compatible with the repository Node baseline; current Babel 8 requires a substantially newer Node engine.
- `magic-string`: browser ESM build and positional transforms.
- `picomatch/posix`: pure string matcher without package-root OS detection. Do not use `tinyglobby`, whose runtime imports Node modules.
- Declare direct dependencies; do not rely on current transitive copies from Vite/Vue.
- Use a source-text fast gate plus memoized literal dynamic import so ordinary frontend builds do not request the transform toolchain.

## Resolved Product Decisions

- `@/views/*.ts` produces result key `/views/a.ts`.
- Static no-expression template literals are accepted alongside quoted strings.
- Pattern grammar exposes picomatch globstar/braces/extglob/character classes.
- Non-direct `import.meta.glob` references fail at build time.
- MVP remains one pattern plus optional static boolean `eager`; arrays, negatives and other Vite options are rejected.

## Parent Handoff Boundary

This child should provide focused transform/esbuild/browser-bundle evidence and a reusable case matrix. The complete upload → IndexedDB → browser esbuild-wasm → dist → Service Worker → packaged iframe loop remains the parent task's final consolidated validation after the Worker child is complete.
