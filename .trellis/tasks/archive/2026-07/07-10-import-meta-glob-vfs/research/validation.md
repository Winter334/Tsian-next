# import.meta.glob VFS Validation

Date: 2026-07-10

## Dependency and browser-bundle evidence

- Direct runtime dependencies: `@babel/parser@^7.29.7`, `magic-string@^0.30.21`, `picomatch@^4.0.4`.
- Direct development dependency: `@types/picomatch@^4.0.3`.
- `picomatch/posix` default import bundled successfully for `platform: "browser"`; the 59,013-byte unminified probe contained no `node:` imports or `require("fs"|"path"|"os"|"process")` calls.
- Final production `npm run build:web` emitted `assets/transform-8RHP8jrG.js` at 364.60 kB / 101.45 kB gzip. Babel parser, MagicString, and Picomatch live behind the memoized literal `import("./transform")` boundary rather than the plain frontend-build module path.
- The fast gate checks for both an `import.meta` token shape and `glob`, so ordinary source bypasses the dynamic import while spaced/computed/optional unsupported forms still reach semantic diagnostics.

## Metafile and exact entry evidence

A minimal `esbuild-wasm@0.28.1` probe confirmed:

- `stdin.sourcefile: "main.ts"` plus `stdin.resolveDir: "frontend/src"` records the root output entry as `frontend/src/main.ts`.
- Lazy VFS imports resolved by the workspace plugin record dynamic entry identities such as `workspace:pages/a.ts`.
- Exact root selection therefore receives `frontend/src/${entryPath}` and requires exactly one JavaScript output with that identity. It no longer depends on metafile object order or the first truthy `entryPoint`.

## Pure transform fixtures

A temporary bundled probe under `research/probes/` exercised and passed:

- plain source unchanged fast path;
- lazy relative glob code generation;
- eager alias glob with namespace imports;
- result-key semantics for nested relative and `@/` patterns;
- stable lexical key ordering, case-sensitive matching, hidden-segment exclusion and importer self-exclusion;
- empty match as `{}`;
- multiple calls, TS, TSX, JSX and no-expression template literals;
- binding-name collision avoidance;
- globstar, braces, extglob and character-class grammar;
- dynamic/interpolated/array patterns rejected;
- unknown, non-boolean, spread, computed, duplicate and shorthand options rejected;
- computed access, optional call, property reference and destructured reference rejected;
- bare, absolute, scheme, backslash/control, query/hash, encoded separator and root-escape paths rejected;
- source parse errors with importer plus line/column diagnostics.

The probe bundles are generated evidence only and are not product runtime files.

## Map VFS + esbuild-wasm fixture

A real in-process esbuild-wasm build used the production `workspaceSourcePlugin`, `createSfcPlugin`, and transform boundary with a Map containing:

- an entry-module lazy glob;
- a nested workspace module with both lazy relative and eager `@/` glob calls;
- a Vue `<script setup lang="ts">` lazy TSX glob;
- ordinary CSS, scoped Vue CSS and an SVG asset.

Observed outputs:

- root: `assets/stdin.js <- frontend/src/main.ts`;
- lazy chunks: `workspace:pages/a.ts`, `workspace:pages/b.ts`, and `workspace:vue-pages/widget.tsx`;
- eager module remained in the root graph rather than becoming a dynamic entry;
- one shared chunk, source maps, CSS output and emitted SVG asset;
- no surviving `import.meta.glob` text in emitted JavaScript.

This covers the planned entry, nested workspace, Vue script, lazy/eager, asset and metafile integration points without reading the filesystem for source matching.

## Production and regression checks

- `npm run build:web`: passed in the final review pass after implementation and diagnostic type cleanup.
- Focused transform smoke assertions: 10 representative checks passed in the final review pass (plain, lazy/eager, ordering, hidden exclusion, dynamic/property/computed/destructured/root-escape failures).
- Existing no-glob platform source completed Vue type-check and Vite production build, providing the available `play-frontend-dev`-adjacent plain-path regression signal in this child.
- `git diff --check`: passed; Git emitted only informational LF-to-CRLF working-copy warnings.

## Known limits

- Generated macro code currently does not emit an intermediate sourcemap. Original parser/semantic errors retain source locations, while later esbuild diagnostics from generated imports refer to transformed code positions.
- Existing write-back links every emitted CSS output from HTML. Lazy glob does not promise Vite-equivalent on-demand CSS injection timing.
- The focused Node-hosted esbuild-wasm fixture validates the same Map plugins and emitted graph, but it is not the complete browser product loop.

## Parent integration handoff

The parent consolidated fixture should verify:

1. Upload source package -> IndexedDB -> browser esbuild-wasm -> dist write-back -> Service Worker -> packaged iframe.
2. Observable lazy/eager results, relative and `@/` keys, stable ordering and empty matches.
3. Entry, nested TS/JSX and Vue script usage.
4. Dynamic JS/CSS/assets in Network and Console; retain the documented all-CSS-linking limitation.
5. Unsupported syntax reaches `frontend-build-status` with file/line and preserves the old dist.
6. Plain build does not request the transform chunk; measure first glob cold load and repeated warm build reuse.
7. Rebuild the real `play-frontend-dev` source package through the browser product path.
