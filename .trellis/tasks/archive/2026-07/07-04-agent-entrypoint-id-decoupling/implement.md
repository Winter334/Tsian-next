# Agent 入口与内部 id 解耦实施计划

## Scope

本任务只实现“玩家正式回合入口可配置”，不重写默认 Agent 阵容。当前默认卡可继续配置 `playerTurn: "master"`，后续模板重写任务再迁移到 `storyteller`。

## Implementation Steps

### 1. 更新 contracts

- 修改 `packages/contracts/src/game-card.ts`：
  - 添加 `GameCardRuntimeConfig`。
  - 添加 `GameCardRuntimeEntrypoints`。
  - `GameCardManifest` 增加 `runtime?: GameCardRuntimeConfig`。
- 确认 `packages/contracts/src/index.ts` 已通过 `export * from "./game-card"` 导出。

### 2. 更新 manifest normalization

- 修改 `apps/platform-web/src/storage/game-cards.ts`：
  - 添加 `normalizeRuntimeConfig` / `normalizeRuntimeEntrypoints`。
  - 校验 `runtime.entrypoints.playerTurn` 为非空字符串。
  - `normalizeManifest` 保留 runtime 字段。
- 修改 `apps/platform-web/src/platform-host/workspace-volumes.ts` 如有必要，确保 `game-card.json` synthesized/write path 保留 runtime 字段。

### 3. 默认模板显式配置当前入口

- 修改默认内置卡 manifest 创建处（搜索默认 manifest 常量/创建函数）。
- 写入：

```json
"runtime": {
  "entrypoints": {
    "playerTurn": "master"
  }
}
```

- 本任务不改默认 Agent 阵容。

### 4. 添加入口解析 helper

- 在 `apps/platform-web/src/platform-host` 下创建 focused helper 或加入现有 internal 模块，避免继续膨胀 `index.ts`。
- helper 功能：
  - 从 active save 对应 game card manifest 解析 `runtime.entrypoints.playerTurn`。
  - 缺失/空值时 fail loud。
  - 错误信息指向 `game-card.json` 的 runtime entrypoints 配置。

注意：save runtime 必须使用 save 绑定的 card，而不是全局 active card。

### 5. 替换 sendMessage 硬编码

在 `apps/platform-web/src/platform-host/index.ts` 的 `interaction.sendMessage` 中：

- 解析 `playerTurnAgentId`。
- `readAgentContextFromWorkspace(..., playerTurnAgentId)`。
- `resolveAgentModelConfig(playerTurnAgentId, providerPresetMap)`。
- `runAgentRuntimeTurn({ agentId: playerTurnAgentId, ... })`。
- `toolCallMode` 使用 playerTurnAgentId。
- `stageRawAirpHistoryTurnFile({ entryAgentId: playerTurnAgentId })`。
- `stageAgentContextFile(..., agentId: playerTurnAgentId)`。
- 更新注释，不再称 narrative path 为 master path。

### 6. 替换 frontend-inspector 硬编码

在 `apps/platform-web/src/platform-host/frontend-inspector.ts`：

- ephemeral save/card 自检回合同样解析 playerTurnAgentId。
- 替换 `agentId: "master"`、`resolveAgentModelConfig("master")`、默认 context 读取。

### 7. 文档与 AI-facing 文本更新

- 更新 `docs/sdk/play-frontend-api.md` 中 send/master 表述。
- 更新当前任务相关的 spec / docs，如有必要说明 `GameCardManifest.runtime.entrypoints.playerTurn`。
- 不做全仓库历史文档大清理；只清理当前会进入模型/SDK/默认模板的有效说明。

### 8. 验证

必跑：

```bash
npm run build:contracts
npm run build:web
```

搜索检查：

```bash
rg -n 'agentId: "master"|resolveAgentModelConfig\("master"|entryAgentId: "master"|send 走 master|当前平台默认入口为 master' apps packages docs -S
```

允许存在：

- 历史 archive/research 文档；
- 默认模板中显式配置 `playerTurn: "master"`；
- 尚未重写的默认 Agent 文件内容，若不属于本任务范围。

但正式回合和自检路径不应再硬编码 master。

## Non-goals

- 不把默认入口改成 storyteller。
- 不重写 Agent 阵容或 Skill 组织。
- 不实现 postTurn/director/setup 等更多 entrypoints。
- 不设计复杂 per-mode routing。
- 不保留缺失配置时静默 fallback 到 master。
