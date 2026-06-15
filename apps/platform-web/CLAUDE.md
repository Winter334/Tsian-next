# platform-web — 模块接手说明

`apps/platform-web` 是浏览器侧平台壳。它拥有 Vue UI、本地平台 host、Agent Runtime 宿主、Dexie 存储、bridge 和 remote/packaged 前端装载。

## 当前职责

- 启动平台壳 UI：大厅、设置、调试、游戏视图。
- 管理本地会话：创建、选择、删除、保存 snapshot/history、checkpoint。
- 通过 `PlayFrontendBridge` / remote iframe postMessage bridge 向游玩前端暴露受控能力。
- 通过 OpenAI 兼容 chat API 记录 AI debug。
- 调度 MVP Agent Runtime：`master-agent` → `narrative-agent`。

## 当前目录

```text
src/
  agent-runtime/        MVP Agent Runtime turn flow
  bridge/               PlayFrontendBridge factory, debug bridge, and remote iframe adapter
  config/               browser AI config
  package-loader/       packaged frontend virtual URL loader
  platform-host/        local platform orchestrator
  runtime-host/         LocalRuntimeEngine and AI client
  storage/              Dexie schema, save/checkpoint helpers, and workspace files
  views/                Lobby / Play / Settings / Debug
```

Removed old active surfaces: workflow host/editor, resource library, prompt presets, world books, builtin mods, events/archives storage, retrieval debug.

## Bridge Surface

Same-realm `PlayFrontendBridge` remains the internal platform object shape. Game frontends should use the remote/packaged iframe bridge surface:

- `runtime.getRuntimeSnapshot()`
- `interaction.sendMessage({ content })`
- `query.query({ resource })`
- `platform.getPlatformContext()`
- `platform.runAction({ action: "restore-checkpoint", params })`
Remote iframe frontends use the `tsian.play-bridge.v1` postMessage protocol over a sandboxed iframe. The default remote bridge exposes runtime snapshot, player input, query, platform context, and platform action methods; it does not expose the `debug` namespace and rejects `ai-debug` queries. Packaged frontends are built static files stored with a Game Card and served to an iframe through the local Service Worker virtual URL path. Game Cards may temporarily omit `frontend`; `/play` then shows a not-configured error.

Current query resources:

- `history`
- `checkpoints`
- `workspace-list`
- `workspace-read`
- `workspace-search`
- `agent-registry`
- `agent-context`
- `skill-registry`
- `skill-detail`
- `runtime-diagnostics`
- `ai-debug`

## Storage

Dexie database name: `tsian-agent-runtime-v5`.

Tables:

- `meta`
- `gameCards`
- `gameCardFrontendFiles`
- `saves`
- `saveSnapshots`
- `saveHistory`
- `checkpoints`
- `workspaceFiles`

Built-in blank game cards seed the default Runtime Workspace template, including master/narrative/memory Agents, `studio-assistant`, official default Skills, framework knowledge docs, and `.tsian` platform metadata. Refreshing a stale `source: "builtin"` game card is allowed, but save workspaces must use non-overwriting workspace-version upgrades.

No old local data migration is expected.

## Quality

Run after changes:

```bash
npm run build:contracts
npm run build:runtime-core
npm run build:web
```

For browser smoke, create a contentless session, send one message, confirm AI debug records, history update, workspace files, checkpoint creation, and checkpoint restore.
