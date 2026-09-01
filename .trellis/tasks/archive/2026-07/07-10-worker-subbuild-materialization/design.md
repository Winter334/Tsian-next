# Design: Worker 子构建与产物物化

## Scope and Constraints

本任务只在 `apps/platform-web/src/frontend-build` 的浏览器内源码前端构建链中加入首版 Web Worker 支持。输入仍是预加载后的 `Map<string, string | Uint8Array>`，输出仍写回 `frontend/dist/**` 并由现有 packaged frontend Service Worker 通过 same-origin 虚拟 URL 加载。

核心约束：

- 不运行 Vite、Rollup worker 插件、Node `fs/path` 或临时磁盘文件。
- 不修改 Game Card contract、Dexie schema、Service Worker DB 名、play bridge 或 iframe sandbox。
- 首版只支持 `import WorkerCtor from "./worker.ts?worker"`，默认导出 Worker constructor。
- `?worker&url`、`?worker&inline`、`?sharedworker`、直接 `new Worker(...)`、直接 `new SharedWorker(...)` 和 `new Worker(new URL(..., import.meta.url))` 都构建期失败。
- Worker 子构建输出走 `frontend/dist/**` 持久文件，不使用 Blob URL 作为 packaged frontend 的持久入口。
- Worker 子任务做聚焦验证和父任务 handoff；完整 Sass/Less + `import.meta.glob` + Worker + Vue/CSS/VFS 综合浏览器产品回路由父任务最终集成阶段执行。

## Product Contract

### Supported syntax

```ts
import DemoWorker from "./workers/demo.worker.ts?worker"

const worker = new DemoWorker({ name: "demo" })
worker.postMessage({ type: "ping" })
```

生成模块默认导出一个 constructor-like class/function。调用方可传标准 `WorkerOptions`，但生成代码始终强制 `type: "module"`：

```ts
export default class TsianWorker extends Worker {
  constructor(options) {
    super("./assets/workers/<entry-key>/entry.js", { ...options, type: "module" })
  }
}
```

若调用方传 `{ type: "classic" }`，生成代码也会覆盖为 module；classic worker 不进入首版范围。

### Worker module graph

Worker 子构建首版允许：

- JS / TS / JSX / TSX 源码；
- JSON；
- `?raw` / `?url` / `?inline` 资源；
- 相对路径和 `@/` VFS alias；
- JS/TS 模块里的 `import.meta.glob`；
- dynamic import chunks 和 file-loader assets。

Worker 子构建首版拒绝：

- Vue SFC；
- CSS / Sass / Less 样式模块；
- bare package imports 和 CDN externals；
- Worker 图内部再次 `?worker` / `?sharedworker`；
- `SharedWorker`、Service Worker 源码构建、Node `worker_threads`。

这些拒绝项必须构建期 fail-loud，错误 message 自包含 importer、能力名和支持范围。

## Architecture

### Proposed module structure

```text
apps/platform-web/src/frontend-build/
├── engine.ts
├── write-back.ts
├── worker-build/
│   ├── index.ts              # public types + worker build coordinator
│   ├── paths.ts              # worker request parsing, stable output key, URL helpers
│   ├── plugin.ts             # main graph ?worker plugin + raw Worker constructor diagnostics
│   └── worker-source-plugin.ts # worker graph source loader with stricter allowed loaders
├── plugins/
│   ├── workspace-source-plugin.ts
│   └── sfc-plugin.ts
└── glob-transform/
```

`worker-build/` 是独立能力模块，避免把子构建编排、wrapper 生成、输出路径和 unsupported raw constructor 检测继续塞进 `workspace-source-plugin.ts` 或 `engine.ts`。`engine.ts` 只负责创建上下文、挂插件、汇总主/worker outputs 并调用写回。

### Build context

新增一个每次 `buildFrontend()` 调用内创建的上下文对象：

```ts
interface FrontendBuildContext {
  sources: Map<string, WorkspaceSourceContent>
  workerBuilds: Map<string, Promise<WorkerBuildResult>>
}

interface WorkerBuildResult {
  entryPath: string
  entryOutputPath: string
  outputFiles: esbuild.OutputFile[]
  metafile: esbuild.Metafile
}
```

- `workerBuilds` key 是 canonical VFS source key，例如 `workers/demo.worker.ts`。
- 同 key 多次 `?worker` import 复用同一个 Promise，满足去重。
- 不同 Worker entry 独立子构建，不共享 chunks。
- 上下文只活在一次 `buildFrontend()` 里，避免跨卡片污染。

### Main graph plugin

新增 `createWorkerPlugin(context)` 挂在主构建插件列表中，位置在 workspace source onLoad 前，让 `?worker` import 被专门处理。

职责：

1. 在主图 `onResolve` 中识别相对/`@/` 的 `?worker` request。
2. 保持 query/hash 仍走 esbuild `suffix` 语义；`?worker&url` / `?worker&inline` / `?sharedworker` 明确报错。
3. 复用或抽取共享的 VFS path resolution，得到 canonical worker entry。
4. 在 `onLoad` 中触发/等待对应 `buildWorkerEntry()`，生成默认导出 constructor 的 JS wrapper。

Wrapper 使用 dist-root 相对 URL 指向最终 worker entry output，而不是假设 wrapper 一定位于某个主 JS 文件旁边。生成代码应以 packaged iframe 当前文档 URL 为基准，例如：

```ts
const workerUrl = new URL("./assets/workers/<entry-key>/entry.js", window.location.href)
export default class TsianWorker extends Worker {
  constructor(options) {
    super(workerUrl, { ...options, type: "module" })
  }
}
```

这样即使用户从主入口或 lazy chunk 间接创建 worker，URL 仍从 `frontend/dist/index.html` 所在目录解析到 `frontend/dist/assets/workers/**`，再由 Service Worker 正常读取。

### Worker subbuild

`buildWorkerEntry()` 复用已经初始化好的 `esbuild-wasm` service，不再次调用 `initialize()`。一个 Worker entry 子构建使用：

```ts
await esbuild.build({
  stdin: {
    contents: sourceText,
    sourcefile: workerEntryPath,
    resolveDir: "frontend/src",
    loader: entryLoader,
  },
  bundle: true,
  format: "esm",
  splitting: true,
  write: false,
  outdir: `assets/workers/${stableWorkerKey}`,
  entryNames: "entry",
  chunkNames: "chunks/[name]-[hash]",
  assetNames: "assets/[name]-[hash]",
  metafile: true,
  sourcemap: true,
  plugins: [workerSourcePlugin({ sources })],
  loader: { ".json": "json" },
})
```

Notes:

- A local probe confirmed esbuild with `stdin.sourcefile = "workers/demo.ts"`, `resolveDir = "frontend/src"`, `outdir = "assets/workers/demo"`, `entryNames = "entry"` emits `assets/workers/demo/entry.js` and records `entryPoint: "frontend/src/workers/demo.ts"`.
- `stableWorkerKey` must be deterministic and path-safe. It can be derived from canonical entry path by replacing non `[a-zA-Z0-9._-]` characters with `-` and appending a short content/path hash if needed to avoid collisions.
- Worker child chunks/assets live under the same worker directory. Different worker entries do not share chunks in v1.

### Worker graph source loader

`workerSourcePlugin` should reuse the same resolution rules as `workspaceSourcePlugin` where possible, but its allowed loader set is narrower.

Allowed:

- `.ts/.tsx/.mts/.cts/.js/.jsx/.mjs/.cjs` with `import.meta.glob` transform;
- `.json`;
- assets with `?url` / `?inline` / default file-loader behavior;
- text with `?raw`.

Rejected:

- `.vue` with message like `Worker 构建暂不支持 Vue SFC: <path>`;
- `.css/.scss/.sass/.less` with message like `Worker 构建暂不支持样式导入: <path>`;
- any query other than exactly one of `raw` / `url` / `inline`; `worker` / `sharedworker` explicitly says nested worker is unsupported;
- bare imports with message like `Worker 构建暂不支持 bare import "<pkg>"；主页面 import map 不作用于 Worker 模块图`.

Worker graph JS/TS modules may use `import.meta.glob`; transform errors must map to original source location like the existing main graph integration.

### Raw Worker constructor diagnostics

Because direct `new Worker("./x.js")` could otherwise survive bundling and fail only in the iframe, JS/TS/JSX/TSX source text should be scanned before it is handed to esbuild. The scanner should be a reusable helper used at every source boundary that can contain executable JS:

- stdin entry transform in `engine.ts`;
- workspace JS/TS/JSX/TSX onLoad;
- Vue `<script>` / `<script setup>` before `compileScript`;
- Worker child graph JS/TS/JSX/TSX onLoad.

The scanner can live in `worker-build/plugin.ts` or a small helper and should be gated by source text containing `Worker` to avoid parser cost.

Scope:

- detect `new Worker(...)` and `new SharedWorker(...)`, including `window.Worker` only if a simple AST pass can identify it without broad false positives;
- report a build-time diagnostic telling users to use `import X from "./x?worker"`;
- do not scan CSS, JSON, assets, query module, or Vue virtual style modules;
- Worker child graph should reject direct constructors too, because allowing them would bypass VFS subbuild/materialization.

Implementation can reuse `@babel/parser` already present for `import.meta.glob`, but it should stay behind a fast text gate and not add a new eager dependency to plain source paths.

### Output materialization

`writeBackDist()` currently receives only main build output files. Extend the call contract to accept a flat successful output set containing:

- main build outputs;
- all completed worker output files;
- generated `index.html`.

The write-back should still be all-or-old-dist semantics:

- If main build or any worker subbuild fails, throw before writing; old dist remains intact through existing trigger behavior.
- Only after all builds succeed, write every output file and then clean stale `frontend/dist/**` not in the new set.
- CSS link generation should still use only main build CSS outputs. Worker CSS imports are not supported, so worker CSS outputs should not exist; if they do, treat as invariant failure.
- HTML entry selection continues to use exact main root entry identity, never worker entry identities.

### URL and Service Worker behavior

No Service Worker code change is planned. It already serves any stored `frontend/dist/**` file under `/__tsian_game_card_frontends/<cardId>/...` with `no-store` and Blob `Content-Type`.

Generated worker URLs are resolved from the packaged iframe document URL (`frontend/dist/index.html`) to worker output paths. Browser resolution plus the existing SW virtual path should fetch:

```text
/__tsian_game_card_frontends/<cardId>/frontend/dist/assets/workers/<key>/entry.js
/__tsian_game_card_frontends/<cardId>/frontend/dist/assets/workers/<key>/chunks/...
/__tsian_game_card_frontends/<cardId>/frontend/dist/assets/workers/<key>/assets/...
```

## Diagnostics

Diagnostic messages must be self-contained because `frontend-build-status` persists only the final message and optional location.

Required error matrix:

- `?worker&url`, `?worker&inline`, `?sharedworker`;
- direct `new Worker(...)`, direct `new SharedWorker(...)`, `new Worker(new URL(..., import.meta.url))`;
- missing worker source, binary worker entry, unsupported worker extension;
- worker imports Vue/CSS/Sass/Less;
- worker imports bare package or CDN external;
- nested worker import inside worker graph;
- worker build failure from syntax error or unsupported `import.meta.glob` pattern;
- duplicate canonical entry import reuses one result rather than producing duplicate files.

## Validation and Parent Handoff

Child focused validation:

1. Pure/source-level fixtures for request parsing, stable worker key collision handling, wrapper generation, raw Worker constructor diagnostics, and unsupported query matrix.
2. Map VFS + esbuild-wasm probe with:
   - main entry importing one worker via `?worker`;
   - duplicated import of the same worker entry;
   - second distinct worker entry;
   - worker-internal TS dependency, JSON, `?raw`, `?url` asset, dynamic import chunk, and `import.meta.glob`;
   - unsupported worker CSS/SFC/bare import/nested worker/direct constructor cases.
3. Write-back/stale cleanup focused check: successful rebuild replaces old worker outputs and does not delete current main or worker files; failed worker subbuild preserves old dist.
4. Browser packaged iframe fixture: create a Worker through the generated constructor, exchange messages with main thread, verify Network has worker entry/chunk/asset loads through SW and Console has no builder-related errors.
5. `npm run build:web`.
6. `git diff --check`.
7. Real `play-frontend-dev` source-package regression signal, if feasible inside this child; otherwise record as parent handoff item without marking complete.

Parent final integration handoff:

- One comprehensive source package should cover Sass/Less, `import.meta.glob`, Worker, Vue/CSS Modules, assets, Console/Network, failure diagnostics, old dist preservation, and real `play-frontend-dev` rebuild through upload → IndexedDB → browser esbuild-wasm → dist write-back → SW → packaged iframe.

## Compatibility and Rollback

- No schema/contract/SW migration.
- If nested esbuild child builds inside plugin callbacks prove unreliable in the browser, rollback point is before broad integration: change to a two-phase pre-scan/worker-build plan or return to planning; do not add Blob URL fallback as a hidden behavior.
- `worker-build/` can be disabled by removing the worker plugin and restoring `?worker` unsupported query diagnostics; existing non-worker build paths should remain unchanged.
