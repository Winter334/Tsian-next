# 移除 RuntimeSnapshot 概念，turn 从 turn 文件取 max

## Goal

彻底移除 `RuntimeSnapshotShell` / `RuntimeStateShell` 这套遗留的 runtime 快照概念。
它是早期"runtime engine 持有完整状态"设计的残留——随着 workspace 文件成为唯一状态真相源、
turn 文件成为唯一对话历史真相源，snapshot 已退化为只剩 `turn` 一个标量在用，
且被冗余存了三份（engine 内存、saveSnapshots 表、每条 checkpoint）。

turn 号改为**从 turn 文件 `record.turn` 字段取 max**——turn 文件名（`turn-000001.json`）
和文件内 `record.turn` 字段都已携带 turn 号，`createSessionHistory` 已在算 `maxTurn + 1`
（`session-history.ts:39`）。无需额外元数据文件，turn 号天然跟着 turn 文件走。

不采用"数文件数"推导（不可靠：坏文件会让 count ≠ turn）；采用"解析每个 turn 文件的
`record.turn` 取 max"——坏文件 parse 失败跳过、GC 裁剪只裁旧保留新，max 不受影响。
新档 0 个 turn 文件 → max 0 → 正确。

不采用 `save/state/turn.json` 元数据文件方案：调研确认当前没有其他存档级运行时元数据
值得与之合并（`.tsian/manifest.json` 是 workspace 结构元数据，语义不同层；`LocalSaveRecord`
是 DB 存档身份元数据，不该文件化）。turn 从 turn 文件取 max 足够，少一个活动部件。

本任务是 `06-26-checkpoint-storage-dedup` 的**前置任务**：dedup 要处理的 checkpoint 膨胀核心就是
snapshot.messages 全量拷贝；先砍掉 snapshot 概念，dedup 只需处理 workspace 文件的内容寻址去重，
不必再碰 snapshot schema。

## Confirmed Facts（代码调研确认）

### snapshot 各字段的实际状态

- **`state.turn`**：唯一活字段。主流程 `index.ts:719`、`frontend-inspector.ts:759`、
  `agent-runtime/index.ts:451` 用它算 `nextTurn = turn + 1`。
  前端 `main.ts:1003`、`DebugView.vue:243` 用它显示回合号。
- **`state.messages`**：冗余全量拷贝，无人真读。
  - 对话历史权威源是 turn 文件 `save/history/turns/turn-NNNNNN.json`（`history-turns.ts:19-36`）。
  - agent 注入的 `recentHistory` 来自 `getHistoryFromTurnFiles`（`saves.ts:358`），不来自 snapshot。
  - 前端重建视角来自 `getSessionHistoryFromTurnFiles`（`history-turns.ts:216`），不来自 snapshot。
  - snapshot.messages 唯二"读"用途：`checkpoints.ts:32` 算 messageCount 给 UI；
    `saveSnapshotForSave`（`saves.ts:315`）自我循环转存。
  - `commitSuccessfulRuntimeTurnForSave` 每轮把 `input.history` 整体拷一份进 snapshot.messages。
- **`state.globals`**：死字段。唯一写入入口 `applyRuntimeStatePatch`（`engine.ts:74`）零调用方；
  所有读取点纯透传 `?? {}`，初始恒空。职责已被 workspace 状态文件接管
  （`save/world/`、`save/state/`、`save/memory/` 由后处理 agent 维护）。
- **`version`**：恒 `"0.0.0"`，无任何版本分支逻辑读它。

### snapshot 被存三份

1. `LocalRuntimeEngine` in-memory 字段（`engine.ts:16`）
2. `localDb.saveSnapshots` 表，per-save 一条（`db.ts:56-62`、`saves.ts:190`）
3. 每条 `LocalCheckpointRecord.snapshot`（`db.ts:87`、`checkpoints.ts:55`）

### 死代码

- `LocalRuntimeEngine.replaceMessages`（`engine.ts:63`）：零调用方。
- `LocalRuntimeEngine.applyRuntimeStatePatch`（`engine.ts:74`）：零调用方。
- `RuntimeGlobalsMap`（`runtime.ts:153`）：仅被上述死方法 + 类型透传引用。

### LocalRuntimeEngine 连带清理（移除 snapshot 后的空壳问题）

移除 snapshot 后 `LocalRuntimeEngine` 上所有方法的状态：

| 方法 | 消费路径 | 移除 snapshot 后 |
|------|---------|-----------------|
| `getSnapshot` | base bridge → `playFrontendBridge.runtime`（`index.ts:491` 直接复用） | **删**（桥方法一并移除） |
| `loadSnapshot` | `game-cards.ts:118/124/266/452/597`、`index.ts:400/971/993` | **删**（snapshot 概念移除） |
| `replaceMessages` | 零调用方 | **删**（已是死代码） |
| `applyRuntimeStatePatch` | 零调用方 | **删**（已是死代码） |
| `sendMessage` | base bridge 包一层，但 `playFrontendBridge.interaction.sendMessage`（`index.ts:710`）完全覆盖走 `runAgentRuntimeTurn` | 从不被调到，**删** |
| `invokeAgent` | 同理被 `playFrontendBridge.interaction` 覆盖 | 从不被调到，**删** |
| `getPlatformContext` | `playFrontendBridge.platform.getPlatformContext`（`index.ts:493`）覆盖 | 从不被调到，**删** |
| `query` | `index.ts:706` fallthrough + `frontend-inspector.ts:137` 复用 | **唯一仍被调到的方法**——返回空 `{ items: [] }`，是未识别 resource 的兜底 |

移除 snapshot 后 `LocalRuntimeEngine` 变成纯空壳（只剩一个返回空结果的 `query` 兜底）。
连同 `RuntimeEngine` 接口、`runtime-core` 包、`createPlayFrontendBridge` + `getBaseBridge()` 一并清理：

- **`runtime-core` 包整包删除**：源码引用仅 3 处（`play-frontend-bridge.ts` import、`engine.ts` 实现、
  `vite.config.ts`/`tsconfig.app.json` 路径别名），其余全是 .trellis 归档/spec 文档。
  package.json workspace 列表 + `build:runtime-core` 脚本删除。
- **`createPlayFrontendBridge` + `getBaseBridge()` 删除**：base bridge 唯一未被 index.ts 覆盖的是
  `runtime.getRuntimeSnapshot`（随 snapshot 移除）和 `query` 兜底。query 兜底 inline 进 index.ts
  （未识别 resource 直接返空 `{ items: [] }`）。
- **`LocalRuntimeEngine` 删除**：`runtime-host/engine.ts` 整个文件删（`runtime-host/` 目录仍保留
  `ai.ts`/`index.ts`）。`host-state.ts` 的 `runtimeEngine` 单例 + `getRuntimeEngine()` 删除。
- **`PlayFrontendBridge.runtime` 字段移除**：`getRuntimeSnapshot` 桥方法移除后，`PlayFrontendBridge`
  的 `runtime` 命名空间整个删（它只含这一个方法）。

### turn 的替代方案

turn 文件 `save/history/turns/turn-NNNNNN.json` 的文件名和内部 `record.turn` 字段都已携带
turn 号。`createSessionHistory`（`session-history.ts:39`）已在算 `maxTurn + 1` 作为下一回合号。
`getHistoryFromTurnFiles`（`history-turns.ts:193`）已能解析全部 turn 文件。

**turn 从 turn 文件 `record.turn` 取 max**：
- 新档 0 个 turn 文件 → max 0 → turn 0，正确。
- 第 N 回完成后有 N 个 turn 文件 → max N → turn N，正确。
- 回溯到第 N 回：checkpoint 恢覆写 workspace，只含 turn 1..N → max N → turn N，正确。
- 坏文件 parse 失败 → 跳过，max 不受影响。
- 未来 GC 裁剪 turn 文件：策略是保留最近 M + 稀疏，最新 turn 文件必保留 → max 不回退。

需提供一个轻量 helper（从 workspaceFiles 取 maxTurn，不展平 messages）：
`getMaxTurnFromTurnFiles(workspaceFiles): number`——filter turn 文件 → parse → 取
`record.turn` max → 无文件/全坏返回 0。复用 `parseRawAirpHistoryTurnRecord`（已有，坏文件返 null）。

`save/state/` 目录保持现状（README 占位），不为本任务新增文件。

### 桥协议 `getRuntimeSnapshot` 的消费方

- `play-frontend-dev/src/main.ts`：已迁移到 `createSessionHistory`，`handleSnapshot` 只取 turn 号。
  移除后 turn 号从 `createSessionHistory` 返回的 `history.turn`（`maxTurn + 1`）获取。
- `default-frontend-files.ts`（builtin 卡 packaged 前端，777 行）：仍用 `getRuntimeSnapshot` +
  `snap.state.messages` 渲染。**按用户决策不再维护**——它是待替换的遗留，开发前端
  `play-frontend-dev` 是开发分支，成熟后替换它。移除桥方法后此处调用失效，不做迁移。
- `DebugView.vue`：显示 `runtimeTurn` / `snapshotMessageCount`。改为从 `session-history` query
  取 turn 号 + 条数。
- `frontend-inspector.ts`：ephemeral save 的 `ephemeralSnapshot` 机制——ephemeral save 也走
  workspace 文件，turn.json 自然适用。

### 涉及范围（按层）

**类型层**：
- `packages/contracts/src/runtime.ts`：删 `RuntimeSnapshotShell`、`RuntimeStateShell`、`RuntimeGlobalsMap`
- `packages/contracts/src/bridge.ts`：删 `RuntimeBridge` 接口（`getRuntimeSnapshot`）、
  `RemotePlayBridgeMethod` 里的 `"runtime.getRuntimeSnapshot"`、
  `RemotePlayBridgeResponseResult` 里的 `RuntimeSnapshotShell`、
  `turn-completed` event payload 里的 `snapshot` 字段、`PlayFrontendBridge.runtime` 命名空间
- `packages/runtime-core/`：**整包删除**（`src/engine.ts`、`src/index.ts`、`package.json`、
  `CLAUDE.md`、`README.md`、`tsconfig.json`、`dist/`）

**runtime engine 层**：
- `apps/platform-web/src/runtime-host/engine.ts`：**整个文件删除**（`LocalRuntimeEngine` 类整体移除）
- `apps/platform-web/src/runtime-host/index.ts`：移除 `LocalRuntimeEngine` 的 re-export
- `apps/platform-web/src/platform-host/host-state.ts`：删 `runtimeEngine` 单例、`getRuntimeEngine()`、
  `getBaseBridge()`、`createPlayFrontendBridge` import；保留 ready 状态管理
- `apps/platform-web/src/bridge/play-frontend-bridge.ts`：**整个文件删除**（`createPlayFrontendBridge`）
- `apps/platform-web/vite.config.ts`：删 `@tsian/runtime-core` 路径别名
- `apps/platform-web/tsconfig.app.json`：删 `@tsian/runtime-core` 路径别名
- `package.json`：workspace 列表删 `packages/runtime-core`；删 `build:runtime-core` 脚本

**storage 层**：
- `apps/platform-web/src/storage/db.ts`：删 `LocalSaveSnapshotRecord`、`saveSnapshots` Dexie 表
- `apps/platform-web/src/storage/saves.ts`：删 `createEmptyRuntimeSnapshot`、`getSnapshotForSave`、
  `saveRuntimeForSave`、`saveSnapshotForSave`；`commitSuccessfulRuntimeTurnForSave` 去掉 snapshot 处理
- `apps/platform-web/src/storage/checkpoints.ts`：`LocalCheckpointRecord.snapshot` 字段移除；
  `snapshotTurn`/`toCheckpointSummary`/`createCheckpointRecordForSave`/`restoreCheckpointForSave` 改造
  （turn 从 checkpoint workspaceFiles 里读 turn 文件取 max）

**platform-host 层**：
- `index.ts`：`cloneSnapshot`/`snapshotWithTurnAndMessages` 删除；sendMessage 改为从 turn 文件取
  maxTurn（替代 `getSnapshotForSave`）；emit turn-completed 去掉 snapshot payload（纯信号）；
  `getRuntimeEngine().loadSnapshot` 调用全删；`getBaseBridge().query` fallthrough 改为 inline
  返空 `{ items: [] }`；`playFrontendBridge.runtime` 字段删（`index.ts:491`）
- `game-cards.ts`：`restoreActiveSnapshotFromStorage`/`loadSnapshot`/`createEmptyRuntimeSnapshot`
  调用全删；切存档时不再 loadSnapshot
- `frontend-inspector.ts`：ephemeral snapshot 机制移除（`ephemeralSnapshot`、
  `snapshotWithTurnAndMessages`、`createInspectionBridge` 里的 `getRuntimeSnapshot`）；
  `getBaseBridge().query` 复用改为 inline 返空或独立函数

**agent-runtime 层**：
- `turn-types.ts`：`AgentRuntimeTurnInput.snapshot` 字段改为 `turn: number`
- `index.ts`：`currentRuntimeTurnNumber` 改用传入的 turn 号（`input.turn`）

**桥/前端层**：
- `packages/play-bridge/src/bridge.ts`：删 `onSnapshot` handler、turn-completed snapshot 提取
- `packages/play-bridge/src/checkpoints.ts`：`restoreCheckpoint` 返回类型改造（不再返回 snapshot）
- `packages/play-bridge/src/index.ts`：删 `RuntimeSnapshotShell` 导出
- `apps/play-frontend-dev/src/main.ts`：`handleSnapshot` 改为从 `createSessionHistory` 取 turn
- `apps/platform-web/src/storage/default-frontend-files.ts`：不维护，`getRuntimeSnapshot` 调用失效
- `apps/platform-web/src/views/DebugView.vue`：改为从 session-history query 取数据

**文档/spec**：
- `apps/platform-web/CLAUDE.md`：移除 `getRuntimeSnapshot` / `runtime-core` 引用
- `.trellis/spec/runtime-core/`：**整目录删除**（包已删，spec 无对应实体）
- `.trellis/spec/platform-web/frontend/`：移除 `RuntimeEngine`/`getRuntimeSnapshot`/`runtime-core` 引用
  （`type-safety.md`、`directory-structure.md`、`quality-guidelines.md`、`index.md`、`state-management.md`）
- `.trellis/spec/contracts/`：移除相关引用
- `.trellis/spec/guides/module-structure-guide.md`：移除 `getRuntimeEngine()` 引用
- `CLAUDE.md`（根）：移除 `runtime-core` 引用

## Requirements

- **R1 maxTurn helper**：提供 `getMaxTurnFromTurnFiles(workspaceFiles): number`——
  filter turn 文件 → `parseRawAirpHistoryTurnRecord`（坏文件返 null 跳过）→ 取 `record.turn` max
  → 无文件/全坏返回 0。放在 `history-turns.ts`（与 `getHistoryFromTurnFiles` 同源）。
- **R2 turn 读写接入主流程**：`sendMessage` 起始从当前 workspaceFiles 取 maxTurn（替代
  `getSnapshotForSave` 的 `snapshot.state.turn`）；`nextTurn = maxTurn + 1`。turn 收尾不再需要
  写 turn 号（turn 文件本身携带 turn 号，写入 turn 文件即写入 turn 号）。去掉 snapshot 写入。
- **R3 checkpoint 改造**：`LocalCheckpointRecord` 去掉 `snapshot` 字段；`turn` 从
  checkpoint 的 workspaceFiles 里读 turn 文件取 max（复用 R1 helper）；`restoreCheckpointForSave`
  恢复后不再写 saveSnapshots（表已删），workspace 恢复含 turn 文件即恢复 turn 号。
- **R4 saveSnapshots 表移除**：DB schema 删 `saveSnapshots` 表 + `LocalSaveSnapshotRecord` 类型。
  DB version bump + 改名重置（prototype 范式，清库不迁移）。
- **R5 runtime-core 整包删除 + LocalRuntimeEngine 清理**：
  - 删 `packages/runtime-core/` 整包（`RuntimeEngine` 接口 + `src/` + `package.json` + 文档 + dist）。
  - 删 `apps/platform-web/src/runtime-host/engine.ts` 整个文件（`LocalRuntimeEngine` 类）。
  - 删 `apps/platform-web/src/bridge/play-frontend-bridge.ts` 整个文件（`createPlayFrontendBridge`）。
  - 删 `host-state.ts` 的 `runtimeEngine` 单例 + `getRuntimeEngine()` + `getBaseBridge()`。
  - 删 `vite.config.ts`/`tsconfig.app.json` 的 `@tsian/runtime-core` 路径别名。
  - 删 `package.json` workspace 列表 + `build:runtime-core` 脚本。
  - `index.ts` 的 `getBaseBridge().query` fallthrough 改为 inline 返空 `{ items: [] }`。
  - `game-cards.ts`/`index.ts` 所有 `getRuntimeEngine().loadSnapshot` 调用删除。
  - `PlayFrontendBridge.runtime` 命名空间整个删（只含 `getRuntimeSnapshot`）。
- **R6 桥协议移除 getRuntimeSnapshot + runtime 命名空间**：`RemotePlayBridgeMethod` 删
  `runtime.getRuntimeSnapshot`；`turn-completed` event payload 去掉 `snapshot` 字段（纯信号，
  已定决策 A）；`RemotePlayBridgeResponseResult` 去 `RuntimeSnapshotShell`；`RuntimeBridge` 接口删；
  `PlayFrontendBridge` 的 `runtime` 命名空间整个删（只含 `getRuntimeSnapshot`）；
  `remote-iframe-bridge.ts` 的 `runtime.getRuntimeSnapshot` method 分发删。
- **R7 contracts 类型清理**：删 `RuntimeSnapshotShell`、`RuntimeStateShell`、`RuntimeGlobalsMap`。
  rebuild contracts dist。
- **R8 play-frontend-dev 适配**：`handleSnapshot`（onSnapshot 回调）移除；turn 号从
  `createSessionHistory` 的 `history.turn`（`maxTurn + 1`）取。`turn-completed` 事件变为纯信号
  （无 payload，见已定决策 A），前端 finalizeTurn + reloadHistory。
- **R9 DebugView 适配**：`runtimeTurn`/`snapshotMessageCount` 改为从 `session-history` query
  取（turn = maxTurn，messageCount = entries 总 messages 数）。
- **R10 default-frontend-files.ts 不迁移**：按用户决策不维护此文件。桥方法移除后其
  `getRuntimeSnapshot` 调用会失败——可保留失效代码或简单清理，不做功能迁移。
- **R11 ephemeral save 适配**：`frontend-inspector.ts` 的 ephemeral snapshot 机制移除；
  ephemeral save 也写 turn 文件（`stageRawAirpHistoryTurnFile` 已经在写），turn 从 turn 文件取 max
  走同一路径。
- **R12 文档/spec 同步**：移除 snapshot/getRuntimeSnapshot 引用。

## Acceptance Criteria

- [ ] `RuntimeSnapshotShell`/`RuntimeStateShell`/`RuntimeGlobalsMap` 从 contracts 源码 + dist
  完全移除，全仓 grep 无残留引用（排除 .trellis 归档）。
- [ ] `packages/runtime-core/` 整包删除；全仓 grep `runtime-core` 源码无残留引用
  （vite.config/tsconfig 路径别名删、package.json workspace + 脚本删）；`.trellis/spec/runtime-core/`
  目录删。
- [ ] `LocalRuntimeEngine` 类删除（`runtime-host/engine.ts` 文件删）；`createPlayFrontendBridge` 删除
  （`bridge/play-frontend-bridge.ts` 文件删）；`getRuntimeEngine()`/`getBaseBridge()` 删除；
  `host-state.ts` 仍保留 ready 状态管理且不破。
- [ ] `PlayFrontendBridge.runtime` 命名空间移除；`RuntimeBridge` 接口移除；
  `RemotePlayBridgeMethod` 不含 `runtime.getRuntimeSnapshot`；
  `turn-completed` event 无 snapshot payload（纯信号）。
- [ ] `saveSnapshots` Dexie 表 + `LocalSaveSnapshotRecord` 类型移除；DB version bump 后旧库
  按改名重置范式弃用，无迁移错误。
- [ ] turn 号从 turn 文件 `record.turn` 取 max 正确工作：新档 turn 0；每轮完成后 turn 号
  正确递增（turn 文件写入即携带）；重载后读出的 turn 号与实际回合数一致；坏文件不影响 max。
- [ ] 回溯到第 N 回后，workspace 恢复为只含 turn 1..N 的文件集，maxTurn = N，前端显示正确的
  回合号，历史正确重建为 turn 1..N。
- [ ] 桥协议不再暴露 `runtime.getRuntimeSnapshot`；`turn-completed` event 不再携带 snapshot
  payload；`RemotePlayBridgeMethod`/`RemotePlayBridgeResponseResult`/`RuntimeBridge` 类型清理干净。
- [ ] `play-frontend-dev` 端到端可用：发送消息→流式渲染→回合结束→turn 号正确更新→
  重载后历史完整；检查点回溯→历史 + turn 号正确。
- [ ] `DebugView` 的 runtime 状态显示从 session-history query 取，不再调 getRuntimeSnapshot。
- [ ] `frontend-inspector` ephemeral turn 跑通（inspect send 驱动一回合，turn 文件正确写入，
  turn 号从 maxTurn 正确推导）。
- [ ] tsc + vite build 通过；contracts dist 重建后下游包类型一致。

## Out of Scope

- **`default-frontend-files.ts` 的功能迁移**——它是待替换遗留，不维护（用户决策）。
- **`06-26-checkpoint-storage-dedup` 的 blob 表 + GC**——那是后继任务，本任务只做 snapshot
  移除 + turn.json 落地，为 dedup 扫清 snapshot 障碍。
- **旧存档数据迁移**——接受清库（prototype DB 改名重置范式）。
- **平台配置体系**——turn 从 turn 文件取 max 是纯约定，不需要配置化。

## Open Questions

- 无。turn 从 turn 文件取 max 已定（不引入 turn.json 元数据文件）；
  `turn-completed` 事件改为纯信号已定（决策 A）；default-frontend-files 不维护已定；
  彻底移除（含桥方法）已定。
