# @tsian/runtime-core — 模块接手说明

`@tsian/runtime-core` 是极薄共享接口包。它定义 `RuntimeEngine`，浏览器实现留在 `apps/platform-web`。

## Public Interface

```ts
export interface RuntimeEngine {
  getSnapshot(): Promise<RuntimeSnapshotShell>
  sendMessage(input: MessageInteractionRequest): Promise<MessageInteractionResult>
  query<T = unknown>(request: DeepQueryRequest): Promise<DeepQueryResult<T>>
  getPlatformContext(): Promise<PlatformContextShell>
}
```

## Boundaries

- 不放 Agent Runtime 编排。
- 不放浏览器 `fetch`、Dexie、Vue 或前端包装载逻辑。
- 不放记忆系统、状态维护或模型调用实现。

## Build

```bash
npm run build:runtime-core
```
