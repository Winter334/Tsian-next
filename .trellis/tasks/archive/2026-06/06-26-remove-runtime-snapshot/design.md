# Design：移除 RuntimeSnapshot 概念，turn 从 turn 文件取 max

## 1. 架构变更总览

### 1.1 移除前（现状）

```
RuntimeEngine 接口 (runtime-core)
  └─ LocalRuntimeEngine (platform-web/runtime-host)
       └─ snapshot: { version, state: { turn, messages, globals } }
            ├─ in-memory 持有
            ├─ saveSnapshots 表持久化（per-save 一条）
            └─ checkpoint.snapshot 字段（每条 checkpoint 一份）

createPlayFrontendBridge(engine) → baseBridge
  └─ runtime.getRuntimeSnapshot() → engine.getSnapshot()
  └─ interaction.sendMessage()    → engine.sendMessage() [throw 占位]
  └─ query.query()                → engine.query() [返空兜底]
  └─ platform.getPlatformContext()→ engine.getPlatformContext() [throw 占位]

playFrontendBridge (index.ts 增强版)
  └─ runtime: baseBridge.runtime [直接复用，未覆盖]
  └─ interaction: 完全覆盖（走 runAgentRuntimeTurn）
  └─ query: 部分覆盖（未命中 fallthrough 到 baseBridge.query）
  └─ platform: 完全覆盖
```

### 1.2 移除后（目标）

```
[删除] RuntimeEngine 接口 / runtime-core 包 / LocalRuntimeEngine / createPlayFrontendBridge / baseBridge

playFrontendBridge (index.ts 直接构造，不再有 base bridge 层)
  └─ [删除] runtime 命名空间
  └─ interaction.sendMessage() → runAgentRuntimeTurn（不变，但 turn 来源改为 maxTurn）
  └─ interaction.invokeAgent() → runAgentRuntimeTurn 旁路调用（不变，但 turn 来源改为 maxTurn）
  └─ query.query() → index.ts 处理已知 resource + 未命中 inline 返空
  └─ platform.getPlatformContext() → index.ts 直接返回（不变）

turn 号来源：
  workspaceFiles → filter turn 文件 → parse record.turn → max → nextTurn = max + 1
  （getMaxTurnFromTurnFiles helper，复用 parseRawAirpHistoryTurnRecord）

checkpoint:
  LocalCheckpointRecord { id, saveId, turn, label, reason, createdAt, workspaceFiles }
  turn 从 checkpoint.workspaceFiles 取 maxTurn
  （不再有 snapshot 字段）

saveSnapshots 表: [删除]
```

## 2. 核心数据流改造

### 2.1 sendMessage 主流程（index.ts:710-996）

**移除前**：
```
snapshotBefore = getSnapshotForSave(saveId)     ← 读 saveSnapshots 表
historyBefore  = getHistoryForSave(saveId)       ← 读 turn 文件
nextTurn       = snapshotBefore.state.turn + 1
...
snapshotAfter  = snapshotWithTurnAndMessages(snapshotBefore, nextTurn, nextHistory)
getRuntimeEngine().loadSnapshot(snapshotAfter)
commitSuccessfulRuntimeTurnForSave(saveId, { snapshot: snapshotAfter, history, ... })
return { snapshot: snapshotAfter }
```

**移除后**：
```
workspaceFiles = listEffectiveWorkspaceFilesForActiveSave(saveId)
maxTurn        = getMaxTurnFromTurnFiles(workspaceFiles)   ← 从 turn 文件取 max
historyBefore  = getHistoryFromTurnFiles(workspaceFiles)   ← 同源，复用已有 filter
nextTurn       = maxTurn + 1
...
[不再构造 snapshotAfter]
[不再 loadSnapshot]
stageRawAirpHistoryTurnFile(workspaceTransaction, { turn: nextTurn, ... })  ← turn 文件写入即携带 turn 号
commitSuccessfulRuntimeTurnForSave(saveId, { history, workspaceFiles, ... })  ← 不再传 snapshot
emit turn-completed（纯信号，无 payload）
return {}
```

关键点：
- `getHistoryForSave`（`saves.ts:354`）当前内部调 `listWorkspaceFilesForSave` 再
  `getHistoryFromTurnFiles`。主流程已经调了 `listEffectiveWorkspaceFilesForActiveSave` 拿到
  workspaceFiles，可直接 `getHistoryFromTurnFiles(workspaceFiles)` 复用，省一次 DB 查。
  但这属于优化，非必须——保持调 `getHistoryForSave` 也可，turn 取 max 额外从同一份
  workspaceFiles 取即可。
- `commitSuccessfulRuntimeTurnForSave` 改造：去掉 `input.snapshot`，只提交 workspace 文件 +
  checkpoint。checkpoint 的 `turn` 从 workspaceFiles 取 maxTurn。

### 2.2 invokeAgent 旁路流程（index.ts:1021-1115）

`invokeAgent` 是 `06-26-text-protocol-and-agent-entry` 加入的**活功能**——游戏前端按 agentId
直接调用某个 agent（NPC 视角、UI 触发的单次修正），不推进 turn、不写历史。**不能删。**

它的 snapshot 改造与 sendMessage 同理：

**移除前**：
```
snapshotBefore = cloneSnapshot(getSnapshotForSave(saveId))
historyBefore  = getHistoryForSave(saveId)
...
runAgentRuntimeTurn({ snapshot: snapshotBefore, ... })
```

**移除后**：
```
workspaceFiles = listEffectiveWorkspaceFilesForActiveSave(saveId)
maxTurn        = getMaxTurnFromTurnFiles(workspaceFiles)
historyBefore  = getHistoryFromTurnFiles(workspaceFiles)
...
runAgentRuntimeTurn({ turn: maxTurn, ... })   ← 传 turn 替代 snapshot
```

注意：`invokeAgent` 本身不推进 turn（旁路调用），所以它只**读** maxTurn 传给 runtime，
不写 turn 文件、不建 checkpoint。

### 2.3 checkpoint 创建（saves.ts:206 + checkpoints.ts:37）

**移除前**：`createCheckpointRecordForSave(saveId, { snapshot, reason, workspaceFiles })`
→ `snapshotTurn(snapshot)` 取 turn → 存 `record.snapshot`（全量 messages 拷贝）。

**移除后**：`createCheckpointRecordForSave(saveId, { turn, reason, workspaceFiles })`
→ 直接传 `turn`（caller 已算好 maxTurn）→ 不存 snapshot 字段。
`LocalCheckpointRecord` schema：删 `snapshot: RuntimeSnapshotShell`，`turn` 已是顶层字段。

### 2.4 checkpoint 恢复（checkpoints.ts:84-126）

**移除前**：恢复时 `localDb.saveSnapshots.put({ saveId, snapshot: checkpoint.snapshot })`
+ 覆写 workspaceFiles + 返回 `checkpoint.snapshot`。

**移除后**：
- 不再写 saveSnapshots（表已删）。
- 覆写 workspaceFiles（含 turn 文件 1..N）→ turn 自然恢复（maxTurn = N）。
- 返回值改造：不再返回 `RuntimeSnapshotShell`。返回 `turn`（从 checkpoint.workspaceFiles
  取 maxTurn）或返回 void（前端自己 reloadHistory 取 turn）。
- `restoreCheckpoint`（play-bridge SDK）返回类型改造：从 `Promise<RuntimeSnapshotShell>`
  改为 `Promise<{ turn: number }>` 或 `Promise<void>`。前端回溯后调 `reloadHistory` 取 turn。

### 2.5 turn-completed 事件

**移除前**：`emitEvent("turn-completed", { snapshot: snapshotAfter })`
→ play-bridge `onSnapshot(snapshot)` handler → 前端 `handleSnapshot` 取 `snapshot.state.turn`。

**移除后**：`emitEvent("turn-completed", {})`（纯信号，空 payload）
→ play-bridge 不再有 `onSnapshot` handler → 前端 `turn-completed` 走 `onEvent` 通用通道，
  收到后 `finalizeTurn() + reloadHistory()`（turn 号从 `createSessionHistory` 取）。

## 3. 逐层改造细节

### 3.1 contracts 层

**`packages/contracts/src/runtime.ts`**：
- 删 `RuntimeGlobalsMap`（:153-155）
- 删 `RuntimeStateShell`（:596-600）
- 删 `RuntimeSnapshotShell`（:602-605）
- 检查其他类型是否引用上述（如 `MessageInteractionResult` 是否含 snapshot 字段）

**`packages/contracts/src/bridge.ts`**：
- 删 `RuntimeBridge` 接口（:19-21，只含 `getRuntimeSnapshot`）
- `RemotePlayBridgeMethod`：删 `"runtime.getRuntimeSnapshot"`（:53）
- `RemotePlayBridgeResponseResult`：删 `RuntimeSnapshotShell` 分支（:76）
- `RemotePlayBridgeEventPayload`：`turn-completed` 的 `{ snapshot: RuntimeSnapshotShell }`
  分支改为 `{}` 或删该分支（:200-202）
- `PlayFrontendBridge`：删 `runtime` 命名空间（只含 `getRuntimeSnapshot`）
- rebuild contracts dist

### 3.2 runtime-core 包

**整包删除**：`packages/runtime-core/` 目录整个移除。
- `src/engine.ts`（`RuntimeEngine` 接口）
- `src/index.ts`（re-export）
- `package.json`、`tsconfig.json`、`CLAUDE.md`、`README.md`、`dist/`

**下游引用清理**：
- `apps/platform-web/vite.config.ts:15-18`：删 `@tsian/runtime-core` 路径别名
- `apps/platform-web/tsconfig.app.json:19`：删 `@tsian/runtime-core` 路径别名
- `package.json`：workspace 列表删 `packages/runtime-core`；scripts 删 `build:runtime-core`

### 3.3 runtime-host 层

**`apps/platform-web/src/runtime-host/engine.ts`**：整个文件删除。
**`apps/platform-web/src/runtime-host/index.ts`**：移除 `LocalRuntimeEngine` 的 export。
（`runtime-host/` 目录保留 `ai.ts` + `index.ts`）

### 3.4 bridge 层

**`apps/platform-web/src/bridge/play-frontend-bridge.ts`**：整个文件删除。
**`apps/platform-web/src/bridge/remote-iframe-bridge.ts`**：
- `REMOTE_PLAY_BRIDGE_METHODS` 数组删 `"runtime.getRuntimeSnapshot"`（:24）
- `dispatchRemoteMethod` 删 `runtime.getRuntimeSnapshot` 分支（:259-261）
- 检查 turn-completed 事件转发是否提取 snapshot（如有则改为透传空 payload）

### 3.5 platform-host 层

**`host-state.ts`**：
- 删 `runtimeEngine` 单例 + `createPlayFrontendBridge` import + `baseBridge`
- 删 `getRuntimeEngine()` + `getBaseBridge()`
- 保留 `platformHostReady` / `markPlatformHostReady` / `waitForPlatformHostReady`

**`index.ts`**：
- 删 `cloneSnapshot`（:200）+ `snapshotWithTurnAndMessages`（:204-218）
- `playFrontendBridge` 构造：删 `runtime: getBaseBridge().runtime`（:491）
- `playFrontendBridge.query.query`：`getBaseBridge().query.query(request)` fallthrough
  （:706）改为 inline `return { items: [] }`
- `interaction.sendMessage`：改为从 workspaceFiles 取 maxTurn（替代 getSnapshotForSave）
- 删所有 `getRuntimeEngine().loadSnapshot(...)` 调用（:400/971/993）
- `commitSuccessfulRuntimeTurnForSave` 调用去掉 `snapshot` 参数
- `emitTurnDebugReady(snapshotAfter.state.turn)` 改为 `emitTurnDebugReady(nextTurn)`
- return `{ snapshot: snapshotAfter }` 改为 `return {}`（或去掉 return 值的 snapshot 字段）

**`game-cards.ts`**：
- 删 `restoreActiveSnapshotFromStorage` 函数（:122-126）
- 删所有 `getRuntimeEngine().loadSnapshot(...)` 调用（:118/266/452/597）
- 删 `getSnapshotForSave`/`createEmptyRuntimeSnapshot` import
- 切存档/删存档时不再操作 snapshot

**`frontend-inspector.ts`**：
- 删 `ephemeralSnapshot` 模块级变量 + `createEmptyRuntimeSnapshot` import
- `createInspectionBridge`：删 `runtime.getRuntimeSnapshot`（:121-124）
- `runEphemeralTurn`：ephemeral save 的 turn 走 turn 文件取 max（同主流程）
- `snapshotAfter`/`snapshotWithTurnAndMessages`/`emit turn-completed { snapshot }` 改造
  → turn 文件 stage + emit 纯信号
- `getBaseBridge().query` 复用（:137）改为 inline 返空或独立 helper

### 3.6 storage 层

**`db.ts`**：
- 删 `LocalSaveSnapshotRecord` 接口（:56-62）
- 删 `saveSnapshots` Dexie 表定义
- DB version bump + 改名重置（`tsian-agent-runtime-v11` → `v12`，prototype 范式清库）
- `LocalCheckpointRecord`：删 `snapshot: RuntimeSnapshotShell` 字段（:87）

**`saves.ts`**：
- 删 `createEmptyRuntimeSnapshot`（:54-63）
- 删 `getSnapshotForSave`（:162-167）
- 删 `saveRuntimeForSave`（:169-204）
- 删 `saveSnapshotForSave`（:311-316）
- `createLocalSaveFromGameCard`：去掉 snapshot 处理（:103-125），checkpoint 创建改传 turn
- `commitSuccessfulRuntimeTurnForSave`：去掉 `input.snapshot`，checkpoint 创建改传 maxTurn

**`checkpoints.ts`**：
- 删 `snapshotTurn`（:20-22）
- `toCheckpointSummary`：`messageCount` 从 `record.snapshot.state.messages.length` 改为
  从 workspaceFiles 数 turn 文件数（或从 maxTurn 推）
- `createCheckpointRecordForSave`：参数从 `{ snapshot, ... }` 改为 `{ turn, ... }`，
  不再存 `record.snapshot`
- `restoreCheckpointForSave`：不写 saveSnapshots，返回值改为 `{ turn }` 或 void

### 3.7 agent-runtime 层

**`turn-types.ts`**：`AgentRuntimeTurnInput.snapshot: RuntimeSnapshotShell` → `turn: number`
**`index.ts`**：`currentRuntimeTurnNumber(input)` 从 `input.snapshot.state.turn + 1`
改为 `input.turn`（caller 直接传 maxTurn）

### 3.8 play-bridge SDK 层

**`packages/play-bridge/src/bridge.ts`**：
- 删 `onSnapshot` handler（BridgeHandlers:27）
- turn-completed 事件处理：删 snapshot 提取（:138-141），改为透传纯信号

**`packages/play-bridge/src/checkpoints.ts`**：
- `restoreCheckpoint` 返回类型从 `Promise<RuntimeSnapshotShell>` 改为 `Promise<{ turn: number }>`
  或 `Promise<void>`

**`packages/play-bridge/src/index.ts`**：删 `RuntimeSnapshotShell` 导出（:36）

### 3.9 前端层

**`apps/play-frontend-dev/src/main.ts`**：
- 删 `RuntimeSnapshotShell` import
- 删 `handleSnapshot` 函数（:1000-1007）
- `bridge.on({ onSnapshot: handleSnapshot, ... })`：删 `onSnapshot` 注册
- `turn-completed` 走 `onEvent` 通用通道 → `finalizeTurn() + reloadHistory()`
- turn 号从 `createSessionHistory` 的 `history.turn` 取（已在 `reloadHistory` 里做）

**`apps/platform-web/src/storage/default-frontend-files.ts`**：不维护。
`getRuntimeSnapshot` 调用随桥方法移除失效。可保留失效代码（反正不维护）或简单清理报错。

**`apps/platform-web/src/views/DebugView.vue`**：
- 删 `RuntimeSnapshotShell` import + `runtimeSnapshot` ref + `refreshRuntimeSnapshot`
- `runtimeTurn`：从 session-history query 取（`maxTurn`）
- `snapshotMessageCount`：从 session-history query 取（entries 的 messages 总数）

### 3.10 文档/spec 层

- `apps/platform-web/CLAUDE.md`：删 `getRuntimeSnapshot` / `runtime-core` 引用
- `.trellis/spec/runtime-core/`：整目录删除
- `.trellis/spec/platform-web/frontend/`：更新 type-safety / directory-structure /
  quality-guidelines / index / state-management，移除 RuntimeEngine/getRuntimeSnapshot/runtime-core
- `.trellis/spec/contracts/`：移除相关引用
- `.trellis/spec/guides/module-structure-guide.md`：移除 `getRuntimeEngine()` 引用
- 根 `CLAUDE.md`：移除 `runtime-core` 引用

## 4. 兼容性与回滚

- **DB 清库**：prototype 范式（改名重置 `v11` → `v12`），旧库弃用不迁移。旧 snapshot/saveSnapshots
  数据随旧库丢弃。符合项目既有约定（`db.ts:170-176`）。
- **桥协议 break**：`runtime.getRuntimeSnapshot` 移除是 break 性变更。但消费者只有
  `play-frontend-dev`（已迁移）和 `default-frontend-files.ts`（不维护）。`play-frontend-dev`
  同任务内适配。无外部第三方消费者（prototype 阶段）。
- **回滚**：git revert 单提交即可（无数据迁移不可逆操作）。

## 5. 关键 trade-off

| 决策 | 选择 | 理由 |
|------|------|------|
| turn 来源 | turn 文件取 max | 天然跟着 turn 文件走，零额外文件/写入；比 turn.json 少一个活动部件 |
| turn-completed payload | 纯信号（空） | 桥协议最干净，单一真相源；前端多一次 query 无感 |
| engine 清理 | runtime-core 整包删 | 移除 snapshot 后 engine 是纯空壳，不一起清就是留烂摊子 |
| query 兜底 | inline 进 index.ts | base bridge 删后兜底无附着点，inline 最简单 |
| default-frontend-files | 不迁移 | 待替换遗留，不维护（用户决策） |

## 6. 与后继任务的关系

本任务完成后，`06-26-checkpoint-storage-dedup` 的范围收窄：
- ~~Block G：globals 移除~~ → 已在本任务完成
- ~~snapshot.messages 去冗余~~ → snapshot 概念已删，checkpoint 不再有 messages 字段
- dedup 只需专注：blob 表内容寻址 + turn 文件不随 checkpoint 深拷贝 + GC 裁剪
- `LocalCheckpointRecord` 已不含 snapshot，dedup 直接改 workspaceFiles 存储为 manifest 即可
