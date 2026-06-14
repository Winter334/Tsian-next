# @tsian/contracts — 模块接手说明

`@tsian/contracts` 是 type-only 的共享契约包。不要在这里放运行时验证、存储、Vue 状态、模型调用或平台逻辑。

## Public Modules

- `runtime.ts`：conversation message、JSON 值、runtime snapshot、workspace/query/runtime diagnostic、message interaction、deep query、platform action。
- `bridge.ts`：`PlayFrontendBridge` 及 runtime/interaction/query/platform/debug 子桥。
- `debug.ts`：`AiDebugRecord`、`AiChatMessage`、`CheckpointSummary`。
- `frontend-package.ts`：`PlayFrontendManifest`。
- `memory.ts`：generic memory schema 类型。当前没有 `memory-core` 运行时包。

Removed old active contracts: mod manifests, prompt presets, world books, workflow DAG definitions, events/archives, retired generic platform-state write shapes, maintenance patch/write-runtime compatibility shapes, workflow/retrieval debug types.

## Build

```bash
npm run build:contracts
```

修改契约后也要构建消费方，通常是：

```bash
npm run build:web
```
