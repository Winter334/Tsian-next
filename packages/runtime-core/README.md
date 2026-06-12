# runtime-core

`@tsian/runtime-core` 是极薄的共享接口包。

它只定义 `RuntimeEngine` 这类跨包接口，不承载浏览器宿主实现、Agent Runtime 编排、记忆流程、模型调用或存储逻辑。

当前浏览器实现位于：

- `apps/platform-web/src/runtime-host/engine.ts`
- `apps/platform-web/src/platform-host/index.ts`
- `apps/platform-web/src/agent-runtime/index.ts`
