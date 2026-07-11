# Worker 子构建与物化验证记录

Date: 2026-07-11

## Implementation summary

本子任务实现了首版 `?worker` 子集：

- 主页面模块图只支持静态默认导入 `import WorkerCtor from "./x?worker"`。
- 生成的默认导出 constructor 接受 `WorkerOptions`，但强制 `{ type: "module" }`。
- `?worker&url`、`?worker&inline`、`?sharedworker`、direct `new Worker(...)` / `new SharedWorker(...)`、dynamic import/re-export/type import/import-attributes 等非首版语法构建期失败。
- Worker entry 在主构建期间只排队，主构建成功后再按 canonical entry 独立运行 esbuild 子构建；同 entry 去重，不同 entry 不共享 chunks。
- Worker 输出写入 `assets/workers/<stable-key>/entry.js`，chunks/assets 写入该 entry 目录下的 `chunks/` / `assets/`。
- Worker constructor 使用 `new URL("./assets/workers/<key>/entry.js", window.location.href)`，以 packaged iframe document/dist root 为基准解析 SW-backed URL。
- Worker 图支持 JS/TS/JSX/TSX、JSON、`?raw` / `?url` / `?inline`、相对/`@/` VFS 依赖、dynamic import chunks、file-loader assets 和现有 `import.meta.glob` transform。
- Worker 图拒绝 Vue SFC、CSS/Sass/Less、bare/CDN/URL imports、nested worker imports 和 direct Worker constructors。
- `writeBackDist()` 改为一次性提交主构建 outputs + Worker outputs + `index.html`，再清理 stale `frontend/dist/**`；构建失败时不会调用写回。

## Review fixes applied

`trellis-check` 复核后修复了以下 Worker-scope 问题：

1. 主图 `?worker` 语法收紧为 exactly `?worker`，拒绝 `?worker=1`、重复 worker keys 和额外 query。
2. 主图 `?worker` 只允许 `import-statement`，拒绝 CommonJS `require()` 和其它 import kind。
3. Worker 图资源 query 必须 exactly one of `raw`、`url`、`inline`，拒绝重复/混合 query。
4. Worker 图增加资源类型 allowlist，未知资源无 query 不再落入 text loader。
5. direct Worker constructor scanner 的 fast gate 放宽，避免较长/括号表达式漏检。
6. `?worker` 静态 import metadata 校验拒绝 type import 和 import attributes；parse failure 诊断不再误标为 direct Worker usage。
7. `replaceLocalGameCardFrontendDist()` 增加 `frontend/dist/` 路径约束。
8. dist replacement 的 existing lookup、createdAt preservation、put、stale delete 和 card `updatedAt` 更新放进同一 Dexie transaction。

主会话最终复核又修复了一个边界：

- Worker 图允许未知非样式资源在显式 `?raw` / `?url` / `?inline` 下导入；无 query 的未知资源仍构建期报错。

## Checks run

### `git diff --check`

Command:

```bash
git -C F:/workspace/Tsian diff --check
```

Result: passed. Git only emitted LF-to-CRLF working-copy warnings for existing tracked files.

### `npm run build:web`

Command:

```bash
npm --prefix F:/workspace/Tsian run build:web
```

Result: passed in the final main-session run.

Notes:

- Vite/Rollup emitted existing warnings for `@vueuse/core` PURE annotations and large chunks.
- No contracts build was required; this task did not modify `packages/contracts`.

## Known validation gap / parent handoff

A real browser packaged-iframe Worker fixture was not run in this pass. Parent/follow-up validation should still verify:

1. Upload/source-package → IndexedDB → browser esbuild-wasm → dist write-back → Service Worker → packaged iframe.
2. `new WorkerCtor()` message round-trip.
3. Network shows SW-backed Worker entry, chunk, and asset requests under `frontend/dist/assets/workers/**`.
4. Console has no Worker/build/runtime errors.
5. Failure cases preserve old dist and surface build status diagnostics.
6. The final parent consolidated fixture also covers Sass/Less、`import.meta.glob`、Worker、Vue/CSS/VFS combinations and real `play-frontend-dev` source-package regression.
