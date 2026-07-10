# Planning Research: Browser Sass / Less Baseline

Date: 2026-07-10

## Package Baselines

- `sass@1.101.0`
  - official Dart Sass package;
  - npm browser/default export: `sass.default.js` / `sass.default.cjs`;
  - Node export is separate (`sass.node.*`);
  - npm engine: Node `>=20.19.0` for install/platform build;
  - browser supports `compileString()` / `compileStringAsync()` with custom importers; filesystem `compile()` APIs are unavailable;
  - official README requires web bundlers to disable identifier renaming, citing esbuild `--keep-names`.
- `less@4.6.7`
  - npm engine: Node `>=18`;
  - package root browser export targets `dist/less.cjs`, but inspection shows the browser distribution may embed bootstrap behavior; it is not the chosen adapter entry;
  - package exports also permit `less/lib/less/index.js`, a core factory accepting `(environment, fileManagers, version)` and returning isolated parser/render APIs without DOM bootstrap;
  - chosen entry is the exact-version-pinned core factory subpath; upgrades require revalidating export/signature/security.

Version checks:

```bash
npm view sass version
npm view less version
npm view sass@1.101.0 engines --json
npm view less@4.6.7 engines --json
npm view sass@1.101.0 exports --json
npm view less@4.6.7 exports --json
```

## Sass API Decision

Use memoized literal dynamic import and `compileStringAsync()`:

```ts
const sass = await import("sass")
await sass.compileStringAsync(source, {
  syntax: "scss" | "indented",
  url: entryCanonicalUrl,
  importer,
})
```

Map importer owns canonicalization/loading. Recommended URL:

```text
tsian-vfs:///frontend/src/<path>
```

Candidate behavior must cover partial/index and ambiguity; do not use NodePackageImporter or loadPaths.

Source maps may use `sourceMap` + `sourceMapIncludeSources`, but implementation must prove browser-safe chaining into Vue/esbuild. No Node `Buffer`.

## Less API Decision

Use the exported core factory subpath:

```ts
const { default: createLess } = await import("less/lib/less/index.js")
const less = createLess(environment, [vfsFileManager], "4.6.7")
const result = await less.render(source, options)
```

Bootstrap source was inspected from the npm tarball. `lib/less-browser/bootstrap.js` reads/writes `window.less`, consumes `window.LESS_PLUGINS`, scans Less `<link>/<style>` elements, and may temporarily hide the page. The package root browser distribution cannot be assumed free of this behavior, so it is not used.

`lib/less/index.js` is an exported low-level factory that builds core render APIs from an explicit environment/file-manager list and has no DOM bootstrap. Browser probe must assert:

- factory dynamic import leaves `window.less` and `window.LESS_PLUGINS` unchanged;
- no DOM stylesheet scan or injected page-hiding style;
- production chunk contains no Node-only entry;
- pinned factory signature still returns Promise-capable `render()`.

Use Promise-based `less.render()` and async Map-backed FileManager. Because the project preprocesses Less before Vue `compileStyleAsync`, it does not use compiler-sfc's built-in Less bridge and does not require `syncImport` or `loadFileSync`.

Security options:

```ts
{
  javascriptEnabled: false,
  disablePluginRule: true,
  rewriteUrls: "all",
  sourceMap: false,
}
```

Both JavaScript and `@plugin` must be disabled.

## Existing Integration Seams

- `engine.ts`: ensure preprocessors enter sources Map as text. A parallel workspace editable-text task is currently replacing the private extension allowlist with shared media/text projection; Sass/Less implementation must wait for that task's commit and reuse its single classification source.
- `workspace-source-plugin.ts`: extension candidate lists, query bypass, `css`/`local-css` loader selection.
- `sfc-plugin.ts`: style-lang validation and preprocess-before-`compileStyleAsync` seam.
- Preserve `OnResolveResult.suffix`; query text must never be concatenated into esbuild path.

## Validation Policy

The repository has no committed frontend test runner. This task uses repeatable adapter fixtures, a production build, and browser compiler-entry/security probes to validate its implementation boundary. The complete browser esbuild-wasm + IndexedDB + SW + packaged iframe loop is deferred to a consolidated test frontend package after all capability children of the parent task are complete. Node-side probes remain useful but do not replace that parent-level final integration gate.
