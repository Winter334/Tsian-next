# official-default play frontend — 模块接手说明

`builtin/play-frontends/official-default` 是当前官方默认游玩前端。它是纯 DOM 实现，通过 `PlayFrontendBridge` 与平台通信。

## 当前职责

- 渲染对话主线。
- 提交玩家输入到 `bridge.interaction.sendMessage({ content })`。
- 展示 AI debug、checkpoint、runtime snapshot、stateRecords。
- 通过 `platform.runAction({ action: "restore-checkpoint" })` 恢复 checkpoint。

## 当前数据来源

- `bridge.runtime.getRuntimeSnapshot()`
- `bridge.query.query({ resource: "history" })`
- `bridge.query.query({ resource: "ai-debug" })`
- `bridge.query.query({ resource: "checkpoints" })`
- `bridge.query.query({ resource: "state-records" })`
- `bridge.debug?.onTurnDebugReady(cb)`

Removed old panels: mod overview, events, archives, retrieval debug, workflow debug, globals write demo.

## Quality

随 `platform-web` 一起构建：

```bash
npm run build:web
```
