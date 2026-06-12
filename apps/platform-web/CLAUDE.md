# platform-web — 模块接手说明

`apps/platform-web` 是浏览器侧平台壳。它拥有 Vue UI、本地平台 host、Agent Runtime 宿主、Dexie 存储、bridge 和官方默认前端装载。

## 当前职责

- 启动平台壳 UI：大厅、设置、调试、游戏视图。
- 管理本地会话：创建、选择、删除、保存 snapshot/history、checkpoint。
- 通过 `PlayFrontendBridge` 向游玩前端暴露受控能力。
- 通过 OpenAI 兼容 chat API 记录 AI debug。
- 调度 MVP Agent Runtime：`master-agent` → `narrative-agent`。

## 当前目录

```text
src/
  agent-runtime/        MVP Agent Runtime turn flow
  bridge/               PlayFrontendBridge factory and debug bridge
  config/               browser AI config
  package-loader/       builtin official-default frontend loader
  platform-host/        local platform orchestrator
  runtime-host/         LocalRuntimeEngine and AI client
  storage/              Dexie schema and save/checkpoint/state helpers
  views/                Lobby / Play / Settings / Debug
```

Removed old active surfaces: workflow host/editor, resource library, prompt presets, world books, builtin mods, events/archives storage, retrieval debug.

## Bridge Surface

Current `PlayFrontendBridge` exposes:

- `runtime.getRuntimeSnapshot()`
- `interaction.sendMessage({ content })`
- `query.query({ resource })`
- `platform.getPlatformContext()`
- `platform.runAction({ action: "restore-checkpoint", params })`
- `debug.getAiDebugRecords()`
- `debug.onTurnDebugReady(cb)`

Current query resources:

- `history`
- `checkpoints`
- `state-records`
- `ai-debug`

## Storage

Dexie database name: `tsian-agent-runtime-v1`.

Tables:

- `meta`
- `saves`
- `saveSnapshots`
- `saveHistory`
- `checkpoints`
- `stateRecords`

No old local data migration is expected.

## Quality

Run after changes:

```bash
npm run build:contracts
npm run build:runtime-core
npm run build:web
```

For browser smoke, create a contentless session, send one message, confirm two AI debug records (`master-agent`, `narrative-agent`), history update, checkpoint creation, and checkpoint restore.
