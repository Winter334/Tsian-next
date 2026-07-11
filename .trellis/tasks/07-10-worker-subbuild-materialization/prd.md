# Worker 子构建与产物物化

## Goal

在浏览器内源码前端构建链中支持明确的 Worker 导入形式，由同一 `esbuild-wasm + Map VFS` 发起独立子构建，并把 Worker JS、chunks 与资源写入 `frontend/dist/**` 后通过 Service Worker 虚拟 URL 加载。

## Background and Confirmed Facts

- 父任务 `07-10-browser-frontend-builder-official-adapters` 已完成 Vue/VFS + CSS Modules、Sass/Less、`import.meta.glob` 三个能力子任务；本任务是最后一个能力子任务。
- 主构建入口在 `apps/platform-web/src/frontend-build/engine.ts`：预加载 `frontend/src/**` 到 `Map<string, string | Uint8Array>`，运行 `esbuild-wasm`，并把 `result.outputFiles` 交给 `writeBackDist` 写入 `frontend/dist/**`。
- 当前 `workspaceSourcePlugin` 已把 import query 保存在 `suffix`，并明确对 `?worker` / `?sharedworker` fail-loud；本任务需要替换这条边界，而不是让 query 静默落入普通 loader。
- `writeBackDist` 已写回所有 esbuild output file，并基于新产物集合清理旧 `frontend/dist/**`；Worker 产物必须纳入同一个成功提交集合，避免重构建误删当前 worker 文件。
- packaged frontend Service Worker 按虚拟 URL 读取 IndexedDB 中的 `gameCardFrontendFiles`，可服务任意已写入的 `frontend/dist/**` 文件；首版不需要修改 Dexie schema、SW DB 名、play bridge 或 iframe sandbox。
- `import.meta.glob` 子任务已经证明：动态 chunks 会出现在 `outputFiles/metafile` 中，HTML 根入口必须按精确 root entry 选择；Worker 子构建也必须避免把 worker entry/chunks 误当主 HTML entry。
- Vite 官方语义包含 `?worker` 默认导出 Worker constructor、`?worker&inline`、`?worker&url`、`?sharedworker` 和 `new Worker(new URL(..., import.meta.url), { type: "module" })`；本任务首版只选择 `?worker` constructor 子集。

## Requirements

### R1. Browser/VFS build boundary

- Worker 源码和依赖必须来自预加载的 `frontend/src/**` Map VFS，不得依赖 Node `fs/path/process.cwd()` 或临时磁盘文件。
- Worker 使用独立 `esbuild-wasm` 子构建，避免把 worker entry 混入主页面执行上下文。
- Worker 输出使用 SW-backed same-origin URL，不使用 Blob URL 作为 packaged frontend 的持久入口。
- 不修改 Game Card contract、Dexie schema、Service Worker DB 名、play bridge 或 iframe sandbox。

### R2. Supported worker entry syntax

- 首版只支持 Vite 风格 `import WorkerCtor from "./worker.ts?worker"`。
- `?worker` 默认导出的 constructor 支持 `new WorkerCtor(options?)`，允许调用方传标准 `WorkerOptions`（如 `name`、`credentials`），但生成代码始终强制 `{ type: "module" }`；classic worker 不进入首版范围。
- `?worker&url`、`?worker&inline`、`?sharedworker`、直接 `new Worker(...)`、直接 `new SharedWorker(...)`、`new Worker(new URL(..., import.meta.url))` 均列为首版不支持，并在构建期给出明确诊断；首版只允许通过 `?worker` import constructor 创建 Worker。

### R3. Worker module graph

- Worker 模块图首版允许 JS/TS/JSX/TSX、JSON、`?raw` / `?url` / `?inline` 资源、相对/`@/` VFS 依赖，以及 JS/TS 文件内的 `import.meta.glob`。
- 首版支持 module worker 多文件输出，包括 Worker 内部 dynamic import chunks 与 file-loader assets；这些产物必须随主构建一起写入 `frontend/dist/**` 并由 SW 加载。
- Worker 模块图不支持导入 Vue SFC、CSS/Sass/Less 样式模块；这些能力在 Worker 中语义不清晰，必须构建期报错而不是运行时静默失效。
- Worker 内 bare package imports / CDN externals 暂不支持，因为主页面 HTML import map 不作用于 Worker 模块图；首版在构建期报错，避免 iframe 运行时才失败。
- 首版只允许主页面模块图使用 `?worker`；Worker 子构建内部再次导入 `?worker` / `?sharedworker` 时构建期报错，避免递归子构建、循环 Worker entry 和多层输出物化复杂度。

### R4. Multiple worker entries and materialization

- 多个 Worker entry 首版采用每个 canonical Worker entry 独立子构建的策略。
- 同一个 entry 被多处 `?worker` import 时去重并复用同一套产物。
- 不同 entry 之间首版不做共享 chunk 优化。
- Worker 输出文件命名必须稳定且与主构建产物、其它 worker entry 产物不冲突。
- stale cleanup 必须同时认识主构建和 Worker 子构建的新产物：成功重构建替换旧 Worker 产物，不误删当前主/worker 产物；失败时保留旧 dist。

### R5. Diagnostics and validation boundary

- 不支持的 Worker 语法、Worker 子构建失败、missing source、binary entry、unsupported imports、nested worker、bare imports 等必须构建期 fail-loud，错误 message 自包含文件/能力/原因。
- `triggerFrontendRebuild` 现有失败链路应继续记录可读 build status；构建失败不得发出 reload，不得清理旧 dist。
- Worker 子任务只完成 Worker 聚焦验证与父任务 handoff：覆盖 `?worker` constructor、Worker 内 VFS 依赖、chunks/assets、unsupported 诊断、stale cleanup、`npm run build:web` 和可移交矩阵。
- 完整 Sass/Less + `import.meta.glob` + Worker + Vue/CSS/VFS 综合浏览器产品回路留给父任务最终集成阶段。

## Acceptance Criteria

- [ ] `import WorkerCtor from "./x?worker"` 可创建 module Worker，并与主线程完成 message round-trip。
- [ ] `new WorkerCtor(options?)` 保留标准 options，同时强制 module worker；classic worker 不被支持或承诺。
- [ ] Worker 源码、相对/`@/` 依赖、JSON、`?raw` / `?url` / `?inline` 资源、dynamic import chunks 和 `import.meta.glob` 均从 Map VFS 构建。
- [ ] Worker JS/chunks/assets 写入 `frontend/dist/**`，packaged iframe 内由 SW 虚拟 URL 成功加载。
- [ ] 同一个 canonical Worker entry 被多处 import 时只构建/物化一套产物；不同 Worker entry 输出互不冲突。
- [ ] 重构建会替换新 Worker 产物并清理 stale outputs，不误删当前主构建或 Worker 产物；Worker 构建失败时旧 dist 保留。
- [ ] `?worker&url`、`?worker&inline`、`?sharedworker`、直接 `new Worker(...)` / `new SharedWorker(...)`、Worker 图内 nested worker、Worker 图内 Vue/CSS/Sass/Less、bare/CDN import 均构建期清晰报错。
- [ ] `npm run build:web` 通过。
- [ ] Worker 聚焦浏览器 fixture 通过，记录 Console/Network、message round-trip、SW-backed worker entry/chunk/asset 加载证据。
- [ ] 真实 `play-frontend-dev` 源码包无回归；若完整产品回路按父任务边界延后，本子任务必须在 handoff 中明确记录，不误标完成。

## Completion Notes

- 已实现首版 `?worker` 默认 constructor 导入、module worker 强制、Worker entry 去重、独立 Worker 子构建、Worker 输出物化、direct Worker constructor 诊断、Worker 图支持/拒绝矩阵和 transactional dist replacement。
- 已运行 `git diff --check`：通过，仅有 LF-to-CRLF 工作区提示。
- 已运行 `npm --prefix F:/workspace/Tsian run build:web`：通过；Vite/Rollup 仅报告既有 `@vueuse/core` PURE annotation 与 large chunk warnings。
- 已记录验证与 handoff 到 `research/validation.md`。
- 未在本子任务运行真实 browser packaged-iframe Worker round-trip fixture；按父任务边界，最终综合 fixture 需要覆盖 Worker message round-trip、SW-backed worker entry/chunk/asset Network 和 Console 证据。

## Out of Scope

- `?worker&url`、`?worker&inline`、`?sharedworker`。
- 直接 `new Worker(...)` / `new SharedWorker(...)` 或 `new Worker(new URL(..., import.meta.url))` 语法支持。
- Classic Worker、SharedWorker、Service Worker 源码构建、Node `worker_threads`。
- Worker 图内 Vue SFC、CSS/Sass/Less 样式语义。
- Worker 图内 bare package import、CDN external import 或 import map 注入。
- 不同 Worker entry 之间共享 chunks。
- 任意 Vite worker plugin 兼容、完整 Vite 配置或 Node-only 插件。
- 父任务最终综合 source package 的完整上传 → IndexedDB → browser esbuild-wasm → dist write-back → SW → packaged iframe 回路。
