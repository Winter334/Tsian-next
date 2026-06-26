# Implement：移除 RuntimeSnapshot 概念，turn 从 turn 文件取 max

## 执行顺序

自底向上：先改类型层（contracts）让编译器暴露所有引用点 → 再改实现层逐个消灭编译错误 →
最后改前端 + 文档。每 phase 结束跑一次 build 验证。

---

### Phase 1：contracts 类型层（源头）

- [ ] **P1.1** `packages/contracts/src/runtime.ts`：删 `RuntimeGlobalsMap`（:153-155）、
  `RuntimeStateShell`（:596-600）、`RuntimeSnapshotShell`（:602-605）。
  检查 `MessageInteractionResult` 等是否引用 snapshot 字段，有则一并清理。
- [ ] **P1.2** `packages/contracts/src/bridge.ts`：删 `RuntimeBridge` 接口（:19-21）；
  `RemotePlayBridgeMethod` 删 `"runtime.getRuntimeSnapshot"`（:53）；
  `RemotePlayBridgeResponseResult` 删 `RuntimeSnapshotShell` 分支（:76）；
  `RemotePlayBridgeEventPayload` 的 turn-completed 分支改为空 payload（:200-202）；
  `PlayFrontendBridge` 删 `runtime` 命名空间。
- [ ] **P1.3** rebuild contracts dist：`npm run build:contracts`。
- [ ] **验证门**：contracts dist 重建成功（下游会有编译错误，预期，后续 phase 消灭）。

### Phase 2：runtime-core 整包删除

- [ ] **P2.1** 删除 `packages/runtime-core/` 整个目录（`src/`、`package.json`、`tsconfig.json`、
  `CLAUDE.md`、`README.md`、`dist/`）。
- [ ] **P2.2** `package.json`（根）：workspace 列表删 `"packages/runtime-core"`；
  scripts 删 `"build:runtime-core": ...`。
- [ ] **P2.3** `apps/platform-web/vite.config.ts`：删 `@tsian/runtime-core` 路径别名（:15-18）。
- [ ] **P2.4** `apps/platform-web/tsconfig.app.json`：删 `@tsian/runtime-core` 路径别名（:19）。
- [ ] **验证门**：`runtime-core` 引用从构建配置中消失。

### Phase 3：runtime-host + bridge 层删除

- [ ] **P3.1** 删除 `apps/platform-web/src/runtime-host/engine.ts` 整个文件。
- [ ] **P3.2** `apps/platform-web/src/runtime-host/index.ts`：移除 `LocalRuntimeEngine` export
  及相关 import。
- [ ] **P3.3** 删除 `apps/platform-web/src/bridge/play-frontend-bridge.ts` 整个文件。
- [ ] **P3.4** `apps/platform-web/src/bridge/remote-iframe-bridge.ts`：
  `REMOTE_PLAY_BRIDGE_METHODS` 删 `"runtime.getRuntimeSnapshot"`（:24）；
  `dispatchRemoteMethod` 删 `runtime.getRuntimeSnapshot` 分支（:259-261）；
  turn-completed 事件转发检查是否提取 snapshot，有则改为透传空 payload。
- [ ] **P3.5** `apps/platform-web/src/bridge/index.ts`：移除 `createPlayFrontendBridge` export
  （如有）。
- [ ] **验证门**：bridge 层无 runtime-core import，无 `createPlayFrontendBridge` 残留。

### Phase 4：platform-host 层改造

- [ ] **P4.1** `apps/platform-web/src/platform-host/host-state.ts`：删 `runtimeEngine` 单例、
  `createPlayFrontendBridge` import、`baseBridge`、`getRuntimeEngine()`、`getBaseBridge()`。
  保留 ready 状态管理。删 `LocalRuntimeEngine` import。
- [ ] **P4.2** `apps/platform-web/src/platform-host/index.ts`：
  - 删 `cloneSnapshot`（:200）+ `snapshotWithTurnAndMessages`（:204-218）。
  - 删 `getRuntimeEngine`/`getBaseBridge` import（从 host-state）。
  - `playFrontendBridge` 构造删 `runtime: getBaseBridge().runtime`（:491）。
  - `query.query` fallthrough（:706 `getBaseBridge().query.query(request)`）改为
    `return { items: [] } as DeepQueryResult<T>`。
  - `interaction.sendMessage`：去掉 `getSnapshotForSave` 调用，改为从
    `listEffectiveWorkspaceFilesForActiveSave` 结果取 `getMaxTurnFromTurnFiles`；
    `nextTurn = maxTurn + 1`。
  - `interaction.invokeAgent`（:1021-1115）：同样去掉 `getSnapshotForSave`/`cloneSnapshot`，
    改为从 workspaceFiles 取 `getMaxTurnFromTurnFiles`；传 `turn: maxTurn` 给
    `runAgentRuntimeTurn`（替代 `snapshot: snapshotBefore`）。invokeAgent 是活功能（旁路
    agent 调用），不推进 turn，只读 maxTurn。
  - 删 `getRuntimeEngine().loadSnapshot(snapshotAfter)`（:971）和
    `getRuntimeEngine().loadSnapshot(snapshotBefore)`（:993）。
  - `commitSuccessfulRuntimeTurnForSave` 调用去掉 `snapshot` 参数。
  - `emitTurnDebugReady(snapshotAfter.state.turn)` 改为 `emitTurnDebugReady(nextTurn)`。
  - `return { snapshot: snapshotAfter }` 改为 `return {}`。
  - 删 `RuntimeSnapshotShell` import。
- [ ] **P4.3** `apps/platform-web/src/platform-host/game-cards.ts`：
  - 删 `restoreActiveSnapshotFromStorage` 函数（:122-126）。
  - 删所有 `getRuntimeEngine().loadSnapshot(...)`（:118/266/452/597）。
  - 删 `getSnapshotForSave`/`createEmptyRuntimeSnapshot` import。
  - 切存档/删存档时不再操作 snapshot（turn 号由 workspace 文件自然恢复）。
- [ ] **P4.4** `apps/platform-web/src/platform-host/frontend-inspector.ts`：
  - 删 `ephemeralSnapshot` 模块级变量 + `createEmptyRuntimeSnapshot` import。
  - `createInspectionBridge`：删 `runtime` 命名空间（:121-124）。
  - `runEphemeralTurn`：turn 走 turn 文件取 max（同主流程）；`snapshotAfter`/
    `snapshotWithTurnAndMessages` 删除；`stageRawAirpHistoryTurnFile` 已在写 turn 文件；
    `emit turn-completed { snapshot }` 改为纯信号。
  - `getBaseBridge().query` 复用（:137）改为 inline 返空 `{ items: [] }`。
  - 删 `RuntimeSnapshotShell` import。
- [ ] **验证门**：platform-host 层无 `getRuntimeEngine`/`loadSnapshot`/`snapshotAfter`/
  `getBaseBridge` 残留。

### Phase 5：storage 层改造

- [ ] **P5.1** `apps/platform-web/src/storage/db.ts`：
  - 删 `LocalSaveSnapshotRecord` 接口（:56-62）。
  - 删 `saveSnapshots` 表定义（Dexie schema）。
  - `LocalCheckpointRecord`：删 `snapshot: RuntimeSnapshotShell` 字段（:87）。
  - DB version bump + 改名重置（`v11` → `v12`）。
  - 删 `RuntimeSnapshotShell` import。
- [ ] **P5.2** `apps/platform-web/src/storage/saves.ts`：
  - 删 `createEmptyRuntimeSnapshot`（:54-63）、`getSnapshotForSave`（:162-167）、
    `saveRuntimeForSave`（:169-204）、`saveSnapshotForSave`（:311-316）。
  - `createLocalSaveFromGameCard`：去掉 snapshot 处理（:103-125），checkpoint 创建
    改传 `turn: 0`（新档无 turn 文件，maxTurn = 0）。
  - `commitSuccessfulRuntimeTurnForSave`：去掉 `input.snapshot` 参数；checkpoint 创建
    改传 `turn: maxTurn`（从 workspaceFiles 取）；不再写 saveSnapshots 表。
  - 删 `RuntimeSnapshotShell` import。
- [ ] **P5.3** `apps/platform-web/src/storage/checkpoints.ts`：
  - 删 `snapshotTurn`（:20-22）。
  - `toCheckpointSummary`：`messageCount` 从 `record.snapshot.state.messages.length` 改为
    从 `record.workspaceFiles` 数 turn 文件（filter `save/history/turns/` + `.json`）。
  - `createCheckpointRecordForSave`：参数 `{ snapshot, ... }` → `{ turn, ... }`；
    不再存 `record.snapshot`。
  - `restoreCheckpointForSave`：不写 saveSnapshots；返回值改为 `{ turn }`（从
    checkpoint.workspaceFiles 取 maxTurn）或 void。
  - 删 `RuntimeSnapshotShell` import。
- [ ] **验证门**：storage 层无 `RuntimeSnapshotShell`/`saveSnapshots`/`snapshot` 字段残留。

### Phase 6：agent-runtime 层改造

- [ ] **P6.1** `apps/platform-web/src/agent-runtime/turn-types.ts`：
  `AgentRuntimeTurnInput.snapshot: RuntimeSnapshotShell` → `turn: number`。
  删 `RuntimeSnapshotShell` import。
- [ ] **P6.2** `apps/platform-web/src/agent-runtime/index.ts`：
  `currentRuntimeTurnNumber(input)` 从 `input.snapshot.state.turn + 1` 改为 `input.turn`。
  删 `RuntimeSnapshotShell` import（如有）。
- [ ] **验证门**：agent-runtime 层无 snapshot 引用。

### Phase 7：play-bridge SDK 层

- [ ] **P7.1** `packages/play-bridge/src/bridge.ts`：
  - `BridgeHandlers` 删 `onSnapshot`（:27）。
  - turn-completed 事件处理删 snapshot 提取（:138-141），改为纯信号透传。
  - `on()` 方法删 `handlers.onSnapshot = h.onSnapshot`（:180）。
  - 删 `RuntimeSnapshotShell` import。
- [ ] **P7.2** `packages/play-bridge/src/checkpoints.ts`：
  `restoreCheckpoint` 返回类型从 `Promise<RuntimeSnapshotShell>` 改为 `Promise<{ turn: number }>`
  或 `Promise<void>`。删 `RuntimeSnapshotShell` import。
- [ ] **P7.3** `packages/play-bridge/src/index.ts`：删 `RuntimeSnapshotShell` 导出（:36）。
- [ ] **验证门**：play-bridge 无 snapshot 引用。

### Phase 8：前端层

- [ ] **P8.1** `apps/play-frontend-dev/src/main.ts`：
  - 删 `RuntimeSnapshotShell` import（:21）。
  - 删 `handleSnapshot` 函数（:1000-1007）。
  - `bridge.on({ onSnapshot: handleSnapshot, ... })`：删 `onSnapshot` 注册。
  - `turn-completed` 事件走 `onEvent` → `finalizeTurn() + reloadHistory()`。
  - 确认 turn 号从 `createSessionHistory` 的 `history.turn` 取（`reloadHistory` 已在做）。
- [ ] **P8.2** `apps/platform-web/src/views/DebugView.vue`：
  - 删 `RuntimeSnapshotShell` import + `runtimeSnapshot` ref + `refreshRuntimeSnapshot`。
  - `runtimeTurn`：改为从 session-history query 取 maxTurn。
  - `snapshotMessageCount`：改为从 session-history query 取 entries messages 总数。
  - `refreshRuntimeSnapshot()` 调用点（:539）替换为 session-history query。
- [ ] **验证门**：前端无 `getRuntimeSnapshot`/`onSnapshot`/`RuntimeSnapshotShell` 引用。

### Phase 9：maxTurn helper

- [ ] **P9.1** `apps/platform-web/src/platform-host/history-turns.ts`：
  新增 `getMaxTurnFromTurnFiles(workspaceFiles: WorkspaceFile[]): number`。
  实现：filter `AIRP_HISTORY_TURN_PATH_PREFIX` + `.json` → `parseRawAirpHistoryTurnRecord`
  → 取 `record.turn` max → 无文件/全坏返回 0。复用现有 filter + parse 逻辑。
- [ ] **P9.2** 确认所有需要 turn 号的调用点都改用 `getMaxTurnFromTurnFiles`：
  `index.ts` sendMessage 入口、`frontend-inspector.ts` runEphemeralTurn、
  `checkpoints.ts` checkpoint 创建/恢复。
- [ ] **验证门**：turn 号来源统一为 `getMaxTurnFromTurnFiles`。

### Phase 10：文档/spec 清理

- [ ] **P10.1** `apps/platform-web/CLAUDE.md`：删 `getRuntimeSnapshot` / `runtime-core` 引用。
- [ ] **P10.2** 删除 `.trellis/spec/runtime-core/` 整目录。
- [ ] **P10.3** `.trellis/spec/platform-web/frontend/`：更新 type-safety.md /
  directory-structure.md / quality-guidelines.md / index.md / state-management.md，
  移除 `RuntimeEngine`/`getRuntimeSnapshot`/`runtime-core`/`LocalRuntimeEngine` 引用。
- [ ] **P10.4** `.trellis/spec/contracts/`：移除 snapshot 相关引用。
- [ ] **P10.5** `.trellis/spec/guides/module-structure-guide.md`：移除 `getRuntimeEngine()` 引用。
- [ ] **P10.6** 根 `CLAUDE.md`：移除 `runtime-core` 引用。
- [ ] **验证门**：全仓 grep（排除 .trellis/tasks/archive）无 `RuntimeSnapshotShell`/
  `RuntimeStateShell`/`RuntimeGlobalsMap`/`getRuntimeSnapshot`/`runtime-core`/`LocalRuntimeEngine`
  残留。

### Phase 11：最终验证

- [ ] **P11.1** `npm run build:contracts` 通过。
- [ ] **P11.2** `npm run build:web`（tsc + vite）通过。
- [ ] **P11.3** 全仓 grep 验证（排除 .trellis/tasks/archive）：
  - `RuntimeSnapshotShell` / `RuntimeStateShell` / `RuntimeGlobalsMap` → 0
  - `getRuntimeSnapshot` / `getSnapshot` → 0
  - `runtime-core` / `LocalRuntimeEngine` / `RuntimeEngine` → 0
  - `saveSnapshots` / `LocalSaveSnapshotRecord` → 0
  - `applyRuntimeStatePatch` / `replaceMessages` → 0
  - `loadSnapshot` → 0
  - `globals` → 0（源码层）
- [ ] **P11.4** 手动验证（浏览器）：新档 turn 0 → 发消息 turn 1 → 重载历史完整 →
  回溯到初始 → turn 0 + 历史空 → 发消息 turn 1。
- [ ] **P11.5** DebugView runtime 状态显示正常（从 session-history 取）。
- [ ] **P11.6** frontend-inspector ephemeral turn 跑通（如可手动触发）。

---

## 风险文件 / 回滚点

| 文件 | 风险 | 回滚 |
|------|------|------|
| `db.ts` schema 改动 | DB 改名重置清库 | 可接受（prototype 范式） |
| `index.ts` sendMessage 主流程 | 核心路径，改错影响所有回合 | git revert |
| `bridge.ts` 桥协议 break | 前端兼容性 | play-frontend-dev 同任务适配 |
| `runtime-core` 整包删 | 构建配置多处引用 | git revert 恢复目录 |

## 验证命令

```bash
npm run build:contracts
npm run build:web
# grep 验证（在项目根）
rg -t ts -t vue "RuntimeSnapshotShell|RuntimeStateShell|RuntimeGlobalsMap|getRuntimeSnapshot|LocalRuntimeEngine|saveSnapshots|applyRuntimeStatePatch" --glob "!.trellis/**"
```
