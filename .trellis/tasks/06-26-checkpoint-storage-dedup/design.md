# Design — 检查点存储优化

## 架构与边界

改动集中在 `apps/platform-web/src/storage/` 与 `apps/platform-web/src/platform-host/`，纯 host 侧存储层重构。桥协议层（`@tsian/play-bridge`、`@tsian/contracts` 的 bridge 方法）零改动——`listCheckpoints`/`restoreCheckpoint` 签名不变，前端检查点 UI 零改动。

### 数据模型变更

**新表 `blobs`**（`storage/db.ts`）
```ts
interface LocalBlobRecord {
  hash: string         // 内容哈希（SHA-256 hex）
  ownerSaveId: string  // 归属存档（本地 per-save；GC/删存档按此精准清理）
  content: string      // 文本内容（文本文件）；二进制文件为空
  data?: Blob          // 二进制内容（二进制文件）；文本文件无此字段
  size: number         // 字节数
  createdAt: number
}
```
- 主键复合：`(hash, ownerSaveId)`——同内容跨 save 各存一份（本地阶段可接受冗余，换 GC 简单可靠）。云阶段升 per-user 时加 `ownerUserId` 维度。
- DB schema：`blobs: "&[hash+ownerSaveId], ownerSaveId"`。Dexie `version(2).stores({...})`，DB 名 `tsian-agent-runtime-v12`（改名重置，弃旧库 v11）。

**`LocalCheckpointRecord` 改为 thin manifest**（`storage/db.ts:80-89`）
```ts
interface LocalCheckpointRecord {
  id: string
  saveId: string
  turn: number
  label: string
  reason: "initial" | "after-turn" | "manual"
  createdAt: number
  // snapshot 只保留 turn（messages 从 turn 文件重建；globals 已移除——死代码，见下「globals 移除」）。
  state: { turn: number }
  // thin manifest：状态文件引用（不含 turn 文件，turn 日志走存档级共享）
  manifest: Array<{ path: string; hash: string; createdAt: number; updatedAt: number }>
}
```
- 不再内嵌 `snapshot: RuntimeSnapshotShell`（去 messages）和 `workspaceFiles: [...内容]`（去内容，改 hash 引用）。
- turn 文件不进 manifest（见下「turn 文件处理」）。

### globals 移除（附带清理）

`RuntimeStateShell.globals` 是死代码，本任务附带移除（避免新存储代码继续给死字段留位）：
- 唯一写入入口 `RuntimeEngine.applyRuntimeStatePatch`（`runtime-host/engine.ts:74-92`）**零调用点**（全仓只定义无 caller）。
- 所有读取点（`index.ts:215`、`frontend-inspector.ts:934`、`saves.ts:122/181/222`）都是纯透传 `globals: snapshot.state.globals ?? {}`，无基于内容的分支。
- 初始值恒为 `{}`（`createEmptyRuntimeSnapshot` `saves.ts:60`、`engine.ts:21`），无写入 + 初始空 = 永远空。
- 职责已被 workspace 接管（`save/world/`、`save/state/`、`save/memory/` 由后处理 agent 维护）。
- 移除范围：`contracts/runtime.ts` `RuntimeStateShell.globals?` 字段 + `RuntimeGlobalsMap` 类型；`engine.ts` `applyRuntimeStatePatch` 方法 + 初始 `globals:{}`；4 处透传 `globals: ... ?? {}`；`createEmptyRuntimeSnapshot` 的 `globals:{}`。

### turn 文件处理（关键边界）

turn 文件 `save/history/turns/turn-NNNNNN.json` 是**追加型日志**，一回合一文件，只增不改。回溯到第 N 回 = workspace 保留 turn 1..N（删掉 turn N+1..最新）。所以：
- checkpoint manifest **不含 turn 文件条目**——turn 日志是存档级共享状态，不是每点快照内容。
- `restoreCheckpointForSave` 恢复 workspace 时，**先清空存档 workspace，写入 manifest 引用的状态文件，再裁剪 turn 文件到 1..N**（删 turn > N 的文件）。turn 1..N 本就在存档 workspace 里（追加型，回溯点之前已存在），无需从 checkpoint 拷贝。

> 注意：当前实现 checkpoint 的 workspaceFiles 含 turn 文件（全量拷贝），恢复时全量覆写。新设计把 turn 文件从 checkpoint manifest 移除，改"裁剪到 N"——这是与旧实现的行为差异，需在恢复逻辑显式处理。

### 数据流

**建检查点**（`commitSuccessfulRuntimeTurnForSave` / `createCheckpointForSave`）
```
状态文件(world/state/memory/agents/frontend) → 算 SHA-256 → blobs.putIfAbsent → manifest[{path,hash}]
turn 文件 → 不进 manifest
snapshot.state.messages → 丢弃；snapshot.state.turn → 存入 record.state（globals 已移除）
checkpoints.put(thin record)
```

**恢复检查点**（`restoreCheckpointForSave`）
```
读 checkpoint record → state.turn
重建 messages：从存档 workspace 读 turn 1..N 文件 → getSessionHistoryFromTurnFiles
重组 snapshot = { version, state: { turn, messages } }（无 globals）
覆写存档 workspace：删光当前 → 按 manifest 取 blob 写回状态文件 → 裁剪 turn 文件到 1..N（删 turn > N）
saveSnapshots.put(snapshot) → runtime.loadSnapshot(snapshot)
```

**裁剪 + GC**（`pruneCheckpointsForSave`，挂 `commitSuccessfulRuntimeTurnForSave` 末尾）
```
M/K 从 getCheckpointPruneConfig() 读取（接缝函数，本任务返硬编码默认 {keepRecent:50, sparseEvery:20}；
  配置体系任务 platform-config 将把此函数接到 .tsian/ 平台配置源——本任务不建配置文件/控制面板）
列该 save 全部 checkpoint（按 createdAt 降序）
保留：最近 keepRecent 条 + 每 sparseEvery 回一稀疏点 + 所有 initial/manual + 当前回合点
删除：其余 after-turn 点
GC：删 checkpoint 后，扫该 save 剩余所有 checkpoint 的 manifest → 收集引用 hash 集
     → blobs 表按 ownerSaveId 过滤，删该 save 内未被引用的 (hash, ownerSaveId) 行
     （ownerSaveId 维度让 GC 只扫单 save 范围，不跨 save 算引用，简单可靠）
```

## 契约兼容

- `CheckpointSummary`（`contracts/debug.ts:28-36`）字段不变：`messageCount` 改从 turn 文件数算（max turn 或 turn 文件计数），`workspaceFileCount` 从 manifest 长度算。`toCheckpointSummary`（`checkpoints.ts:24-35`）相应调整。
- `restoreCheckpointForSave` 返回 `RuntimeSnapshotShell` 不变（恢复时重组完整 snapshot）。
- `listCheckpointsForSave`（`checkpoints.ts:77-82`）签名不变，内部读 thin record 重组 summary。

## 二进制哈希与事务编排

`crypto.subtle.digest("SHA-256", data)` 是异步的。当前 checkpoint 写入是单大事务（`saves.ts:241-248` 覆盖 4 表）。重排为：
1. **事务外**：遍历状态文件，算每个文件哈希（文本 `crypto.subtle.digest` on `TextEncoder.encode(content)`；二进制 on `Blob.arrayBuffer()`）。哈希计算不碰 DB，纯 CPU。
2. **小事务 1**（`blobs` 表）：`putIfAbsent`——对每个哈希先 `blobs.get(hash)`，不存在才 `put`。或用 `bulkPut` 幂等（同哈希覆写无副作用）。
3. **小事务 2**（`checkpoints` 表）：`checkpoints.put(thin record)`。
4. `commitSuccessfulRuntimeTurnForSave` 原有的 `saveSnapshots`/`workspaceFiles`/`saves` 更新保留（那部分是存档当前态，与 checkpoint manifest 分离）。

> 权衡：拆成多小事务牺牲了"checkpoint 与存档态原子提交"的强一致。但 checkpoint 是回溯点，与存档当前态本就可不一致（回合中途崩溃最坏丢一个 checkpoint，不损存档当前态）。可接受。

## GC 全表扫成本评估（已确认简单版）

- 单 save blob 表行数：几十到低百量级（13 模板文件 + 动态 world/state/memory 实体）。
- 裁剪触发：每回合一次（挂 turn commit 末尾），回合本身含 LLM 调用（秒级），GC 开销被淹没。
- 全表扫：`checkpoints.where('saveId').equals(saveId).toArray()` → 遍历 manifest 收集 hash 集 → `blobs` 表删未命中项。O(checkpoint 数 × manifest 长度)，几十×几十，可忽略。
- 不做增量引用计数（避免建/删/恢复三处维护 refCount 的一致性风险）。

## 权衡与回滚

- **清库**：DB 名 v11→v12，旧存档弃用。prototype 阶段可接受。回滚 = 改回 v11（无迁移负担）。
- **turn 文件裁剪式恢复**：与旧"全量覆写"行为不同——若 manifest 漏了某状态文件，恢复后该文件丢失。缓解：manifest 由 `saveRuntimeFilesFromEffectiveWorkspace` 生成（现有过滤逻辑），覆盖范围与旧实现一致。
- **事务拆分**：见上，可接受弱一致。
- **blob 跨 save 不共享**：本地阶段 blob 带 `ownerSaveId`，同内容跨 save 各存一份（冗余可接受，换 GC 简单）。云阶段升 per-user 共享时，blob 表加 `ownerUserId` 维度改为主键 `(hash, ownerUserId)`，跨 save 同用户共享一份——本地 ownerSaveId 逻辑平滑演进。

## 风险文件

- `storage/db.ts` — schema bump + DB 名改，全局影响。
- `storage/checkpoints.ts` — `createCheckpointRecordForSave`/`restoreCheckpointForSave`/`toCheckpointSummary` 三处重写。
- `storage/saves.ts:206-272` — `commitSuccessfulRuntimeTurnForSave` 事务重排 + 挂 GC + 停 messages 全量写入。
- `storage/workspace.ts:400-404` — `listCheckpointWorkspaceFilesForSave` 改为 manifest 生成（算哈希）。
- `platform-host/index.ts:374-405` — `restore-checkpoint` action 恢复路径（若 restoreCheckpointForSave 内部已重组 snapshot，此处无需改；需核实）。
