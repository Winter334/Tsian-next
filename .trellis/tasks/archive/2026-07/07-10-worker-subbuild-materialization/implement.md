# Implementation Plan: Worker 子构建与产物物化

## 0. Preflight and Activation

- [x] 阅读父任务 `prd.md` 以及本任务 `prd.md`、`design.md`、`implement.md`。
- [x] 运行 `git status --short`，确认未提交的其它任务目录和 `tmp/` 不被误改、误提交。
- [x] 验证 `implement.jsonl` / `check.jsonl` 各有真实上下文条目。
- [x] 用户审核规划后运行 `task.py start 07-10-worker-subbuild-materialization`；不启动父任务。
- [x] 按 Phase 2.1 将实现交给 `trellis-implement` agent。

## 1. Shared Build Context and Module Boundary

- [x] 新建 `apps/platform-web/src/frontend-build/worker-build/`，不要继续膨胀 `engine.ts` 或 `workspace-source-plugin.ts`。
- [x] 定义 `FrontendBuildContext` / `WorkerBuildResult` 等内部类型；上下文每次 `buildFrontend()` 创建，避免跨卡片状态污染。
- [x] 提供 stable worker key 生成函数，覆盖嵌套路径、同名不同目录、特殊字符和潜在 collision。
- [x] 反向搜索现有 path/hash helper；能复用则复用，不能复用时在 `worker-build/paths.ts` 中局部实现并记录语义差异。

## 2. Main Graph `?worker` Plugin

- [x] 实现主图 `?worker` onResolve/onLoad：只接受相对路径和 `@/` alias。
- [x] 对 `?worker&url`、`?worker&inline`、`?sharedworker` 和混合 query 明确报错。
- [x] 解析 canonical worker entry，复用同 entry 的 `Promise<WorkerBuildResult>`。
- [x] onLoad 等待 worker 子构建并生成默认导出 constructor wrapper。
- [x] wrapper 允许 `new WorkerCtor(options?)`，但生成 `{ ...options, type: "module" }`，强制 module worker。
- [x] wrapper URL 使用 `new URL("./assets/workers/<key>/entry.js", window.location.href)` 或等价 document-root 解析方式，避免依赖主 JS/lazy chunk 的当前模块路径。

## 3. Raw Worker Constructor Diagnostics

- [x] 在主图 JS/TS/JSX/TSX 文本模块增加 fast gate：无 `Worker` 文本不加载 parser。
- [x] 复用或新增懒加载 parser helper，检测直接 `new Worker(...)` / `new SharedWorker(...)` / `new Worker(new URL(...))`。
- [x] 在 entry stdin、workspace JS/TS/JSX/TSX、Vue `<script>` / `<script setup>`、Worker 子图 JS/TS/JSX/TSX 四个可执行源码边界接入 scanner。
- [x] 诊断 message 提示当前只支持 `import X from "./x?worker"`。
- [x] 避免扫描 CSS、JSON、assets、query module 和 Vue virtual style。
- [x] Worker 子图内也禁止直接 constructor，避免绕过物化入口。

## 4. Worker Subbuild Coordinator

- [x] 实现 `buildWorkerEntry()`，复用已初始化的 `esbuild-wasm` service，不再次调用 `initialize()`。
- [x] 使用 `stdin.sourcefile = workerEntryPath`、`resolveDir = "frontend/src"`、`format = "esm"`、`splitting = true`、`write = false`、worker-specific `outdir`。
- [x] 设置 `entryNames = "entry"`、`chunkNames = "chunks/[name]-[hash]"`、`assetNames = "assets/[name]-[hash]"`。
- [x] 从 worker metafile 精确选择 `frontend/src/${entryPath}` 对应的 JS entry output；零/多匹配 fail-loud。
- [x] 子构建失败包装为包含 worker entry 的诊断，不吞掉 esbuild 原始 location。
- [x] 验证实现避免在 plugin callback 内嵌套 `esbuild.build()`：主构建只排队 worker entry，主构建成功后再运行 worker 子构建。

## 5. Worker Source Plugin

- [x] 实现 worker graph 专用 source plugin，尽量复用当前 workspace resolver 语义。
- [x] 允许 JS/TS/JSX/TSX、JSON、`?raw`、`?url`、`?inline` 和 file-loader assets。
- [x] 对 JS/TS/JSX/TSX 文本运行现有 `import.meta.glob` transform。
- [x] 拒绝 Vue SFC、CSS/Sass/Less，错误说明 Worker 图不支持样式/SFC。
- [x] 拒绝 bare imports / CDN externals，说明主页面 import map 不作用于 Worker。
- [x] 拒绝 Worker 图内部 `?worker` / `?sharedworker`。
- [x] 保持 query/hash 在 `suffix` 中的 invariant，避免恢复先前 `?url` 输出 404 类问题。

## 6. Engine Integration

- [x] `engine.ts` 创建 build context，挂载 worker plugin，保持 Vue SFC plugin 在 workspace catch-all 前。
- [x] 主构建完成后等待/收集全部 worker build results。
- [x] 确保没有 worker import 的普通构建不触发 worker subbuild，也不加载 raw Worker scanner parser。
- [x] 主图 bare import/import map 逻辑维持不变；Worker 子图不使用该 CDN external plugin。

## 7. Write-back and Stale Cleanup

- [x] 扩展 `writeBackDist` 输入，接收主输出和 worker 输出的成功合集，或在 engine 层展平成一个 output set。
- [x] HTML entry selection仍只匹配主根 entry identity，不受 worker entry/chunks 干扰。
- [x] CSS link 仅来自主构建 CSS outputs；若 worker 输出 CSS，作为 invariant error 处理。
- [x] 成功时写入主/worker 所有 output files + `index.html`，然后统一 stale cleanup。
- [x] 构建失败时不调用 write-back，旧 dist 保持。

## 8. Focused Validation Fixtures

- [x] Pure fixtures：worker request parsing、stable key、wrapper generation、unsupported query、raw constructor diagnostics。
- [x] Map VFS + esbuild-wasm 相关路径经实现与 build:web 类型/打包检查覆盖；完整浏览器产品 fixture 仍由父任务最终综合阶段验证。
- [x] Error matrix：CSS/SFC/bare import/nested worker/direct constructor/syntax error/unsupported glob。
- [x] Stale cleanup 语义通过 transactional dist replacement 实现并经代码复核；完整浏览器旧 dist 保留场景留给父任务产品 fixture。
- [ ] Browser packaged iframe Worker fixture：constructor 创建 Worker，主线程和 Worker message round-trip，Network 看到 SW-backed worker entry/chunk/asset，Console 无构建器相关错误。（未在本轮运行，已记录到 `research/validation.md` 作为父任务 handoff）
- [x] 记录验证证据到 `research/validation.md`，包括已知限制和父任务 handoff 矩阵。

## 9. Required Checks and Review

- [x] `npm run build:web`。
- [x] `git diff --check`。
- [x] 如修改 contracts，额外运行 `npm run build:contracts`；当前设计不应修改 contracts。
- [x] 运行 `trellis-check`，处理 High/Medium 发现。
- [ ] 如形成稳定的 Worker/VFS runtime 契约，更新 `.trellis/spec/platform-web/frontend/quality-guidelines.md`。
- [x] 更新本任务 PRD acceptance / Completion Notes，区分子任务已验证项和父任务最终综合 fixture 延后项。

## 10. Finish Boundary

- [ ] 提交本子任务代码/文档，不包含 `tmp/` 和无关任务目录。
- [ ] 归档 `07-10-worker-subbuild-materialization`。
- [ ] 回到父任务 `07-10-browser-frontend-builder-official-adapters`，进行最终综合 fixture 阶段。

## Rollback Points

- Worker plugin 和 raw constructor diagnostics 可独立撤回，恢复 `?worker` unsupported query 报错。
- Worker source plugin 先用 pure/Map fixtures验证，再接 write-back/stale cleanup。
- Write-back 合并输出前后要保持“失败不写、旧 dist 保留”不变；若破坏该语义，优先回滚 write-back 扩展。
- 若 browser 中 plugin callback 嵌套子构建不可用，停止实现并回到规划，不用 Blob URL 或 runtime-only fallback 偷渡能力。
