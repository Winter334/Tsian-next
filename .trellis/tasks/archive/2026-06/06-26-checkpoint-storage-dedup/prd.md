# 检查点存储优化：内容寻址 + turn 去冗余 + GC

## Goal

压缩检查点（checkpoint）的存储成本，为未来云存档打好地基。当前每个 after-turn 检查点内嵌**全部 save/ runtime 文件的全量深拷贝**（含 turn 文件被复制 N 份 + 状态文件跨检查点重复），长流程存档单调膨胀，云同步时按用户数放大成本。

优化后：turn 文件走存档级共享（回溯到 N = 裁剪到 turn 1..N，不进 checkpoint），状态文件走内容寻址 blob 表（跨检查点未变更文件零重复），并配裁剪 GC 给成本封顶。**完整保留回溯能力**——回溯到第 N 回能拿到那时的完整世界状态文件 + 正确 turn 号。

## Confirmed Facts（代码调研确认，引擎移除后现状）

- **RuntimeSnapshot/globals/engine 已移除**（commit `c7a024e`，前置任务 `06-26-remove-runtime-snapshot` 完成）：`engine.ts` 已删，`RuntimeSnapshotShell`/`RuntimeGlobalsMap` 概念不再存在，`saveSnapshots` 表已移除。turn 号从 turn 文件 max 取（`getMaxTurnFromTurnFiles`）。
- `LocalCheckpointRecord`（`storage/db.ts:74-82`）当前结构：`{ id, saveId, turn, label, reason, createdAt, workspaceFiles }`。**无 snapshot 字段**。`workspaceFiles: Array<Omit<LocalWorkspaceFileRecord,"id"|"saveId">>` = `{ path, content, data?, createdAt, updatedAt }` 全量内容内嵌。
- 检查点创建 `commitSuccessfulRuntimeTurnForSave`（`saves.ts:114-168`）：从 `saveRuntimeFilesFromEffectiveWorkspace(input.workspaceFiles)` 全量生成 `checkpointWorkspaceFiles`（**含 turn 文件**），`createCheckpointRecordForSave` 内嵌全量。事务覆盖 `saves`+`workspaceFiles`+`checkpoints`。
- 检查点恢复 `restoreCheckpointForSave`（`checkpoints.ts:87-127`）：删光当前存档 workspaceFiles → 写入 checkpoint 的全量 workspaceFiles → 更新 save.updatedAt。返回 `{ turn }`（从 turn 文件 max 取）。无 snapshot 重组。
- turn 文件 `save/history/turns/turn-NNNNNN.json` 一回合一文件，只增不改。回溯到第 N 回 = workspace 保留 turn 1..N。
- save/ 模板约 13 个固定文件 + 运行时动态 turn 文件 + world/state/memory/agents/frontend 实体文件（`workspace-templates.ts:1277-1381`）。单 save blob 表行数预期几十到低百量级。
- checkpoint 创建：`commitSuccessfulRuntimeTurnForSave`（每成功回合一条 after-turn）；`initial` 建存档时一次；无 `manual`。
- 当前无任何裁剪/GC：`deleteCheckpointsForSave`（`checkpoints.ts:129`）只在删存档时触发。
- DB 升级是"改名重置、旧库弃用"范式（`db.ts:170-176`，prototype 无迁移）。
- 桥签名 `listCheckpoints`/`restoreCheckpoint` 不变，前端检查点 UI（commit `0907e97`）零改动。
- `toCheckpointSummary`（`checkpoints.ts:28-39`）：`messageCount` 从 workspaceFiles 里 turn 文件数算，`workspaceFileCount` = workspaceFiles.length。

## Decisions（已与用户确认）

1. **A 块：turn 文件去冗余**——checkpoint 不再内嵌 turn 文件（turn 文件是存档级追加日志，回溯到 N = 裁剪到 turn 1..N）。checkpoint 只存状态文件（world/state/memory/agents/frontend 等）。
2. **B 块：内容寻址 blob 表（状态文件）**——新 Dexie `blobs` 表按内容哈希存一份文件内容（文本 + 二进制 Blob 都哈希），checkpoint 改存 thin manifest（`path→hash` 引用），跨检查点未变更状态文件零重复。
3. **D 块：简单全表扫 GC**——裁剪保留最近 50 + 每 20 回一稀疏 + initial + manual；回收时扫所有 manifest 算引用数删孤儿 blob，**不做增量引用计数**。
4. **C 块：跳过迁移**——接受升级清库（prototype DB 本就改名重置），旧 fat checkpoint 直接弃。
5. blob 表带 `ownerSaveId` 归属维度——GC/删存档按 save 精准清理，不跨 save 算引用。
6. M/K 裁剪参数走 `getCheckpointPruneConfig()` 接缝函数（本任务返硬编码默认 50/20），**不建配置文件/控制面板**——平台配置体系单开 `platform-config` 任务，届时把此函数接到 `.tsian/` 配置源。

## Requirements

- A：`commitSuccessfulRuntimeTurnForSave` 建 checkpoint 时 workspaceFiles 剔除 turn 文件（`save/history/turns/*`）。checkpoint 只存状态文件。
- A：`restoreCheckpointForSave` 恢复时：覆写状态文件后，**裁剪存档 turn 文件到 1..N**（删 turn > checkpoint.turn 的文件）。turn 1..N 本就在存档 workspace（追加型），无需从 checkpoint 拷贝。
- A：`restoreCheckpointForSave` 恢复时**同时删除 turn > N 的 checkpoint**（被回溯掉的"未来分支"作废）——语义与 turn 文件裁剪一致（turn 裁到 1..N，checkpoint 也只留 ≤ N）。修复当前实现的缺陷：恢复不清理未来检查点会导致列表污染（幽灵 checkpoint + turn 号重复）+ 数据不一致。删除的幽灵 checkpoint 独占 blob 由 GC 清理（复用 D 块逻辑）。
- B：新 `blobs` 表 schema（复合主键 `[hash+ownerSaveId]` + ownerSaveId 索引 + content/Blob + size + createdAt）。Dexie version bump + DB 名重置（清库）。
- B：`LocalCheckpointRecord.workspaceFiles` 字段 → `manifest: Array<{path, hash, createdAt, updatedAt}>`，不再内嵌内容。
- B：checkpoint 写入 = 算每个状态文件哈希 → blobs.putIfAbsent → 写 manifest；恢复 = 读 manifest → 按 hash 取 blob → 重建 workspaceFiles → 覆写存档 workspace + 裁剪 turn 文件。
- B：二进制 Blob 与文本都走内容寻址（`crypto.subtle` 异步哈希，事务编排重排为「先算哈希写 blob（事务外）→ 再小事务提交 manifest」）。
- D：新增 `pruneCheckpointsForSave`，挂在 `commitSuccessfulRuntimeTurnForSave` 末尾；策略最近 50 + 每 20 稀疏 + initial + manual；回收后全表扫 manifest 算 blob 引用集，按 ownerSaveId 删孤儿 blob。
- D：`deleteSave` 补 `deleteBlobsForSave(saveId)`，按 ownerSaveId 精准清。
- 桥层 `toCheckpointSummary` 的 `messageCount`/`workspaceFileCount` 语义保持（messageCount 从 turn 文件数算——但 turn 文件不进 manifest，需从 checkpoint.turn 或恢复后存档 turn 文件数算；workspaceFileCount 从 manifest 长度算）。

## Acceptance Criteria

- [ ] 100 回合存档的 checkpoint 表存储量较优化前显著下降（turn 文件从 N 份拷贝降到 0；状态文件跨点去重）；可写脚本/断言对比前后单 checkpoint 字节数。
- [ ] 回溯到第 N 回后，存档 workspace 状态文件为该 checkpoint 时的值 + turn 文件裁剪到 1..N + **checkpoints 表只留 turn ≤ N 的检查点**（无幽灵未来 checkpoint）——前端剧情视图 reloadHistory 显示 turn 1..N 历史 + 正确 turn 号；回溯视图列表无 turn > 当前进度的条目。
- [ ] 同一未变更状态文件在多个 checkpoint 间共享一份 blob（blobs 行数 < manifest 总条目）。
- [ ] 裁剪策略生效：连续回合后 checkpoint 数不超过 50 + 稀疏点数 + initial + manual；被删 checkpoint 独占 blob 从 blobs 表清除（无泄漏）。
- [ ] play-frontend 检查点 UI 端到端可用：列点、确认弹窗、恢复、切回剧情刷新——零前端改动。
- [ ] tsc + vite build 通过；DB version bump 后旧库按改名重置范式弃用，无迁移错误。

## Out of Scope

- **平台配置体系**（`.tsian/` 配置文件 + 控制面板 + 迁入提供商/RAG/上下文压缩等零散配置）——单开 `platform-config` 任务。本任务只留 `getCheckpointPruneConfig()` 接缝。
- 云同步本身（本任务只做本地存储地基，云层建在 blob 表之上，单独立 task）。
- manual checkpoint 创建 UI（前端未接，保留 reason 枚举位即可）。
- 旧存档数据迁移（接受清库）。
- blob 表跨 save/跨 user 共享（本地阶段 per-save，云阶段再升 per-user）。

## Open Questions

- 无。M=50/K=20 已定；blob 带 ownerSaveId 已定；引擎/globals 已移除无需 Block G。
