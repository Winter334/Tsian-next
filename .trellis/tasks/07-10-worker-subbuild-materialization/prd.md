# Worker 子构建与产物物化

## Goal

在浏览器内源码前端构建链中支持明确的 Worker 导入形式，由同一 `esbuild-wasm + Map VFS` 发起独立子构建，并把 Worker JS 与依赖资源写入 `frontend/dist/**` 后通过 Service Worker 虚拟 URL 加载。

## Requirements

- 依赖 `07-10-vue-vfs-css-modules` 的 canonical VFS 和 output materialization 基础。
- 首版只支持明确选择的一种 Worker 入口语法；优先评估 `?worker`，不同时承诺全部 Vite/new URL 语法。
- Worker 使用独立 esbuild-wasm build，避免把 worker entry 混入主页面执行上下文。
- Worker 输出文件命名稳定且与主构建产物不冲突；stale cleanup 同时认识主/worker 新产物。
- 支持 module worker 所需的 chunks/assets，或在首版明确限制为单文件输出。
- 处理 build failure、abort、重复 worker entry、循环依赖和 CDN/bare import 限制。
- 不使用 Blob URL 作为持久入口；优先复用 packaged frontend 的 SW-backed same-origin URL。

## Acceptance Criteria

- [ ] 支持范围内的 Worker import 可创建并与主线程通信。
- [ ] Worker 源码及相对依赖从 Map VFS 构建。
- [ ] Worker JS/assets 写入 `frontend/dist/**` 并由 SW 成功加载。
- [ ] 重构建会替换新 Worker 产物并清理 stale outputs，不误删当前产物。
- [ ] 不支持的 Worker 语法或构建失败清晰可诊断。
- [ ] `npm run build:web` 与浏览器内真实 Worker fixture 通过。
- [ ] 真实 `play-frontend-dev` 源码包无回归。

## Out of Scope

- SharedWorker、Service Worker 源码构建，除非设计阶段单独扩展。
- Node worker_threads。
- 任意 Vite worker plugin 兼容。
