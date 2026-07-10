# Sass / Less VFS Adapter Validation and Parent Handoff

Date: 2026-07-10

## Scope Decision

This child validates browser compiler entries, Map-backed adapters, integration code, diagnostics, security boundaries, type safety, and production output. The complete upload → IndexedDB → browser esbuild-wasm → dist write-back → Service Worker → packaged iframe loop will run once after the Sass/Less, `import.meta.glob`, and Worker children are complete.

## Dependency Baseline

- Node: `v22.21.1`
- `sass`: `1.101.0`
- `less`: `4.6.7`
- Sass entry: literal dynamic `import("sass")`
- Less entry: literal dynamic `import("less/lib/less/index.js")`
- Production name preservation: Vite `esbuild.keepNames: true`

## Completed Checks

- `npm run build:web` passed, including `vue-tsc -b` and the production Vite build.
- `git diff --check` passed; Git only reported an informational LF-to-CRLF warning for `sfc-plugin.ts`.
- No lint script exists in the repository.
- Sass probes covered SCSS/indented Sass, `@use`, `@forward`, imports, partial/index/import-only precedence, ambiguity, missing/binary inputs, root escape, invalid URL forms, and diagnostics.
- Less probes covered explicit/extension-less imports, nested asset rebasing, optional imports, policy violations, binary/root/query errors, and rejection of JavaScript and `@plugin` without sentinel execution.
- Diagnostics probes covered imported-file context and Vue inline-style positions mapped to full-SFC line text.
- Strict VFS probes rejected raw and double-encoded slash, backslash, query, hash, and NUL forms.
- Production chunk inspection found no `window.less`, `LESS_PLUGINS`, `less-browser`, `XMLHttpRequest`, `node:fs`, `node:path`, or direct `require("fs"/"path")` markers.

The probes were temporary implementation/review probes. The repository has no durable frontend test runner, so results are recorded here rather than represented as a committed automated suite.

## Production Lazy Chunks

| Chunk | Role | Raw bytes | Gzip bytes |
|---|---|---:|---:|
| `sass-Dw3PyxFu.js` | Sass adapter | 3,785 | 1,858 |
| `sass.default-B1PvU2NS.js` | Dart Sass compiler | 3,427,462 | 722,451 |
| `less-VtK5ePxW.js` | Less adapter | 3,437 | 1,812 |
| `index-Cqt1k9A7.js` | Less core compiler | 150,833 | 47,964 |

Separate chunks and literal dynamic imports prove the compilers are not statically included in the main platform chunk. Request-level isolation and cached reuse remain parent-level browser checks.

Non-blocking build warnings: existing `@vueuse/core` PURE annotation warnings and Vite's large-chunk warning.

## Known Limits

- Sass and Less source-map chaining is disabled.
- Sass imported-partial URLs retain entry stylesheet/SFC context.
- Less `(inline)` content has no per-origin URL-rewrite guarantee.
- Package imports, `pkg:`, node_modules/load paths, disk access, Stylus, Less JavaScript, and Less `@plugin` are unsupported.

## Parent Integration Fixture Handoff

The parent must build one repeatable source frontend package covering:

1. Existing Vue/VFS/CSS baseline: `<script setup>`, components, scoped CSS, default/named modules, aliases, directory imports, assets, and CSS `url(...)`.
2. Standalone `.scss`, indented `.sass`, `.less`, `.module.scss/.sass/.less`, extension-less/directory imports, and imported asset URLs.
3. Vue `lang="scss|sass|less"` with scoped/default/named modules, relative imports, asset URLs, `__scopeId`, and `__cssModules`.
4. Sass `@use`, `@forward`, regular import, partial/index/import-only precedence, ambiguity, missing/binary/root/scheme/query/package failures.
5. Less nested imports/assets, missing optional success, optional policy failure, JavaScript/`@plugin` rejection, and missing/binary/root/query failures.
6. `?raw`, `?url`, and `?inline` bypass without compiler loading.
7. Network isolation: plain loads neither compiler, Sass loads Sass only, Less loads Less only; repeated rebuilds reuse module promises. Record cold and warm durations.
8. Real upload → IndexedDB → esbuild-wasm → dist → SW → packaged iframe output, computed styles, module classes, scope attributes, assets, Console, and Network.
9. A failing variant that updates `frontend-build-status` while preserving the previous dist.
10. Real `play-frontend-dev` rebuild with no builder error or new asset 404.

## Completion Boundary

This child can be archived after its code, focused probes, production build, documentation, and spec update are complete. The parent cannot complete until the consolidated browser fixture passes this handoff matrix.
