# Design — 检查点存储优化

> 前置任务 `06-26-remove-runtime-snapshot`（commit `c7a024e`）已移除 RuntimeSnapshot/globals/engine 概念。本设计基于引擎移除后的实际存储模型。

## 架构与边界

改动集中在 `apps/platform-web/src/storage/` 与 `apps/platform-web/src/platform-host/`，纯 host 侧存储层重构。桥协议层（`@tsian/play-bridge`、`@tsian/contracts`）零改动——`listCheckpoints`/`restoreCheckpoint` 签名不变，前端检查点 UI 零改动。

### 当前数据模型（引擎移除后）

```ts
// storage/db.ts:74-82
interface LocalCheckpointRecord {
  id: string
  saveId: string
  turn: number
  label: string
  reason: "initial" | "after-turn" | "manual"
  createdAt: number
  workspaceFiles: Array<{ path, content, data?, createdAt, updatedAt }>  // 全量内容内嵌
}
```
checkpoint 不含 snapshot（引擎已移除），turn 号从 turn 文件 max 取。膨胀来源：`workspaceFiles` 全量深拷贝所有 save/ 文件，含 turn 文件（N 份拷贝）+ 状态文件（跨检查点重复）。

### 目标数据模型

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
- 复合主键 `(hash, ownerSaveId)`——同内容跨 save 各存一份（本地可接受冗余，换 GC 简单可靠）。云阶段升 per-user 时加 `ownerUserId` 维度。
- DB schema：`blobs: "&[hash+ownerSaveId], ownerSaveId"`。Dexie `version(2).stores({...})`，DB 名 `tsian-agent-runtime-v12`（改名重置，弃旧库）。

**`LocalCheckpointRecord` 改为 thin manifest**
```ts
interface LocalCheckpointRecord {
  id: string
  saveId: string
  turn: number
  label: string
  reason: "initial" | "after-turn" | "manual"
  createdAt: number
  manifest: Array<{ path: string; hash: string; createdAt: number; updatedAt: number }>
}
```
- `workspaceFiles`（全量内容）→ `manifest`（hash 引用）。
- manifest **不含 turn 文件条目**（turn 文件走存档级共享，见下）。

### turn 文件处理（关键边界）

turn 文件 `save/history/turns/turn-NNNNNN.json` 是**追加型日志**，一回合一文件，只增不改。回溯到第 N 回 = workspace 保留 turn 1..N（删 turn N+1..最新）。所以：
- checkpoint manifest **不含 turn 文件条目**——turn 日志是存档级共享状态，不是每点快照内容。
- `restoreCheckpointForSave` 恢复 workspace 时：先覆写状态文件（按 manifest），再**裁剪 turn 文件到 1..N**（删 turn > checkpoint.turn 的文件）。turn 1..N 本就在存档 workspace（追加型），无需从 checkpoint 拷贝。

> 与旧实现差异：旧实现 checkpoint 含全量 workspaceFiles（含 turn 文件），恢复时全量覆写。新设计 turn 文件从 checkpoint 移除，改"裁剪到 N"——恢复逻辑需显式处理 turn 文件裁剪。

### 数据流

**建检查点**（`commitSuccessfulRuntimeTurnForSave` / `createCheckpointForSave`）
```
状态文件(world/state/memory/agents/frontend，排除 save/history/turns/*) → 算 SHA-256 → blobs.putIfAbsent → manifest[{path,hash}]
turn 文件 → 不进 manifest
checkpointTurn = 当前存档 turn 文件 max（已有逻辑，不变）
checkpoints.put(thin record: {turn, manifest})
```

**恢复检查点**（`restoreCheckpointForSave`）
```
读 checkpoint record → turn + manifest
覆写存档 workspace：删光当前状态文件 → 按 manifest 取 blob 写回状态文件
裁剪 turn 文件：删 turn > checkpoint.turn 的文件（turn 1..N 保留）
删除未来 checkpoint：checkpoints.where(saveId).and(cp.turn > N).delete()
  （被回溯掉的"未来分支"作废，与 turn 文件裁剪语义一致；修复当前实现不清理幽灵 checkpoint 的缺陷）
更新 save.updatedAt
返回 { turn }
```

> **为何恢复要删未来 checkpoint**：当前实现 `restoreCheckpointForSave` 只裁 turn 文件不删 checkpoint，导致回溯后列表里残留 turn > N 的"幽灵未来检查点"，继续对话后产生 turn 号重复（旧幽灵 + 新点都是 N+1），且幽灵 checkpoint 的 manifest 与裁剪后的 turn 文件不匹配。B 块的 thin manifest 会让这个不一致更危险（恢复幽灵点会写出错误状态）。恢复时一并清理是回溯正确性的必要部分。

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

- `CheckpointSummary`（`contracts/debug.ts:28-36`）字段不变。`toCheckpointSummary`（`checkpoints.ts:28-39`）调整：`messageCount` 从 checkpoint.turn 算（turn 文件不进 manifest，manifest 里没 turn 文件可数）；`workspaceFileCount` 从 manifest 长度算。
- `restoreCheckpointForSave` 返回 `{ turn }` 不变。
- `listCheckpointsForSave`（`checkpoints.ts:80-85`）签名不变，内部读 thin record 重组 summary。

## 二进制哈希与事务编排

`crypto.subtle.digest("SHA-256", data)` 是异步的。当前 checkpoint 写入是单事务（`saves.ts:143-167` 覆盖 saves+workspaceFiles+checkpoints）。重排为：
1. **事务外**：遍历状态文件，算每个文件哈希（文本 `crypto.subtle.digest` on `TextEncoder.encode(content)`；二进制 on `Blob.arrayBuffer()`）。
2. **小事务 1**（`blobs` 表）：`putBlobIfAbsent`——对每个 `(hash, ownerSaveId)` 先 get 不存在才 put。
3. **小事务 2**（`checkpoints` 表 + `workspaceFiles` + `saves`）：写 thin manifest checkpoint + 覆写存档 workspaceFiles + 更新 save.updatedAt（保留原有 workspaceFiles/saves 更新逻辑）。

> 权衡：拆成多小事务牺牲强一致。但 checkpoint 是回溯点，与存档当前态本就可不一致（回合中途崩溃最坏丢一个 checkpoint，不损存档当前态）。可接受。

## GC 全表扫成本评估（已确认简单版）

- 单 save blob 表行数：几十到低百量级（13 模板文件 + 动态 world/state/memory 实体）。
- 裁剪触发：每回合一次（挂 turn commit 末尾），回合本身含 LLM 调用（秒级），GC 开销被淹没。
- 全表扫：`checkpoints.where('saveId').equals(saveId).toArray()` → 遍历 manifest 收集 hash 集 → `blobs` 表按 ownerSaveId 删未命中项。O(checkpoint 数 × manifest 长度)，可忽略。
- 不做增量引用计数（避免建/删/恢复三处维护 refCount 的一致性风险）。

## 权衡与回滚

- **清库**：DB 名 v11→v12，旧存档弃用。prototype 阶段可接受。回滚 = 改回 v11（无迁移负担）。
- **turn 文件裁剪式恢复**：与旧"全量覆写"不同——若 manifest 漏了某状态文件，恢复后该文件丢失。缓解：manifest 由 `saveRuntimeFilesFromEffectiveWorkspace` 过滤后生成（排除 turn 文件），覆盖范围与旧实现的状态文件部分一致。
- **事务拆分**：见上，可接受弱一致。
- **blob 跨 save 不共享**：本地阶段 blob 带 `ownerSaveId`，同内容跨 save 各存一份（冗余可接受，换 GC 简单）。云阶段升 per-user 共享时加 `ownerUserId` 维度，平滑演进。

## 风险文件

- `storage/db.ts` — schema bump + DB 名改 + `LocalCheckpointRecord` 类型改，全局影响。
- `storage/checkpoints.ts` — `createCheckpointRecordForSave`/`restoreCheckpointForSave`/`toCheckpointSummary` 三处重写。
- `storage/saves.ts:114-168` — `commitSuccessfulRuntimeTurnForSave` 事务重排 + 挂 GC + workspaceFiles 剔除 turn 文件。
- `storage/workspace.ts` — `listCheckpointWorkspaceFilesForSave` 改为 manifest 生成（算哈希、排除 turn 文件）。
- 新建 `storage/blobs.ts` — blob 表读写 + 哈希 + GC 清理。
