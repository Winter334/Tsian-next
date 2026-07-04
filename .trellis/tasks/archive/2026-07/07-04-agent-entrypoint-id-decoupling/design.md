# Agent 入口与内部 id 解耦设计

## 1. 范围决策

本任务采用方案 A：只做入口机制解耦，不在本任务重写默认 Agent 阵容。

也就是说：

- 平台正式玩家回合不再硬编码 `master`。
- 游戏卡 manifest 可声明玩家回合入口 Agent。
- 当前默认卡可以暂时显式声明入口仍为 `master`。
- 后续 `07-04-default-airp-agent-skill-template-rewrite` 再把默认入口迁移到 `storyteller` / 说书人，并重写 Agent 阵容。

这样避免本任务和默认模板重写任务互相踩范围。

## 2. 新契约：GameCardManifest.runtime.entrypoints

在 `GameCardManifest` 增加可选 runtime 配置：

```ts
interface GameCardManifest {
  schema: "tsian.game-card.v1"
  id: string
  name: string
  version: string
  summary: string
  author?: GameCardAuthor
  cover?: GameCardCover
  frontend?: GameCardFrontendBinding
  runtime?: GameCardRuntimeConfig
}

interface GameCardRuntimeConfig {
  entrypoints?: GameCardRuntimeEntrypoints
}

interface GameCardRuntimeEntrypoints {
  playerTurn?: string
}
```

第一版只加入 `playerTurn`，不提前加 `postTurn` / `director` / `worldArchitect` 等未来字段，避免把默认 novel AIRP 编排下沉到 manifest。后续确实需要时再扩展。

`playerTurn` 含义：`tsian.send()` / `interaction.sendMessage` 的正式玩家回合入口 Agent id。

## 3. 默认值与无旧卡兼容

项目未上线，不需要复杂旧卡兼容。但为了当前默认模板还未重写，本任务会让内置默认卡 manifest 显式写入：

```json
"runtime": {
  "entrypoints": {
    "playerTurn": "master"
  }
}
```

运行时解析规则：

1. 读取当前 active save 对应 game card manifest。
2. 取 `manifest.runtime.entrypoints.playerTurn`。
3. 该字段必须是非空字符串。
4. 如果缺失或为空，fail loud，提示卡 manifest 缺少玩家回合入口。
5. 不静默 fallback 到 `master`。

第 4 点符合“不做旧卡 fallback”。当前默认模板会补齐该字段，因此正常内置卡不会失败。

## 4. 平台实现路径

### 4.1 manifest 类型与 normalize

涉及：

- `packages/contracts/src/game-card.ts`
- `apps/platform-web/src/storage/game-cards.ts`
- `apps/platform-web/src/platform-host/workspace-volumes.ts`
- `apps/platform-web/src/storage/workspace-templates.ts`

需要：

- 在 contracts 中添加 runtime 类型。
- `normalizeManifest` 保留并校验 `runtime.entrypoints.playerTurn`。
- manifest volume 读写 `game-card.json` 时保留 runtime 配置。
- 默认 card manifest 写入 `runtime.entrypoints.playerTurn = "master"`。

### 4.2 入口解析 helper

建议在 `platform-host` focused module 中添加 helper，避免 `index.ts` 继续膨胀：

```ts
function resolvePlayerTurnAgentIdFromManifest(manifest: GameCardManifest): string
```

或结合 save/card：

```ts
async function resolvePlayerTurnAgentIdForSave(saveId: string): Promise<string>
```

不过 `sendMessage` 已经装配了 effective workspace 和 provider map，最小实现可以从 active save 的 game card manifest 取 id。

注意：save-scoped runtime work 必须使用 active save 自己的 `gameCardId`，不是当前全局 active card。

### 4.3 sendMessage 替换点

`apps/platform-web/src/platform-host/index.ts` 当前硬编码：

- `readAgentContextFromWorkspace(..., activeSaveId)` 默认 master。
- `resolveAgentModelConfig("master", providerPresetMap)`。
- `runAgentRuntimeTurn({ agentId: "master" })`。
- `toolCallMode: resolveAgentModelConfig("master", providerPresetMap)`。
- `stageRawAirpHistoryTurnFile({ entryAgentId: "master" })`。
- `stageAgentContextFile(...)` 未传 agentId，默认 master。

改为：

```ts
const playerTurnAgentId = resolvePlayerTurnAgentId(...)
```

并显式传入该 id。

### 4.4 frontend-inspector ephemeral turn 同步

`apps/platform-web/src/platform-host/frontend-inspector.ts` 镜像真实 sendMessage 路径，也硬编码 master。它应使用同一入口解析逻辑，确保自检真实反映默认卡入口。

### 4.5 context helpers 默认值

`history-turns.ts` 中 `readAgentContextFromWorkspace` / `stageAgentContextFile` 当前默认 `master`。本任务可以保留默认值以降低调用面风险，但正式回合和自检回合必须显式传 entry agent id。

如果实现时发现默认值继续诱导错误，可以改为要求调用方显式传入 `agentId`；这是更大改动，需先评估。

## 5. 文档更新

- `docs/sdk/play-frontend-api.md`：`send` 描述改为“走卡 manifest 的 `runtime.entrypoints.playerTurn`”。
- `docs/active` 或相关默认 schema 指南中如提到 master 是唯一主入口，应改为入口 Agent。
- 默认模板文档若提到 master，可保留为“当前默认 playerTurn 为 master，后续模板重写会迁移”，但不能再说平台硬编码 master。

## 6. 非目标

- 不重命名默认 Agent。
- 不新增说书人/场记/导演模板。
- 不迁移 `save/agents/master` 默认 notes。
- 不改 post-turn / setup / director 等未来入口。
- 不删除所有历史 docs 中的 master 词，只处理当前 AI-facing / SDK / runtime 相关表述。

## 7. 风险

- `GameCardManifest` 是跨包契约，改动后必须跑 `npm run build:contracts` 和 `npm run build:web`。
- manifest normalization 会影响 `game-card.json` 编辑/导入/默认卡创建，必须保持 frontend/cover/summary 等既有字段不回退。
- 不允许静默 fallback 到 master，否则任务目标“解除硬绑定”失败。
