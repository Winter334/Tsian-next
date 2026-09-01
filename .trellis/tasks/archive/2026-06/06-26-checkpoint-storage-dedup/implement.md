# Implement — 检查点存储优化

## 执行顺序（按依赖排）

实现按 A → B → D 顺序。A（turn 文件去冗余）先做，让 checkpoint manifest 的"不含 turn 文件"边界先就位；B 在此基础上把状态文件转内容寻址；D 最后加裁剪 + GC。每块独立可验证。C（迁移）跳过。

> 前置任务 `06-26-remove-runtime-snapshot` 已完成，RuntimeSnapshot/globals/engine 已移除。本任务不再涉及 globals/Block G。

### Block A：turn 文件去冗余

- [ ] A1. `storage/saves.ts` `commitSuccessfulRuntimeTurnForSave`（:114-168）：建 checkpoint 时 `checkpointWorkspaceFiles` 剔除 turn 文件（过滤掉 `save/history/turns/*.json`）。checkpoint 只存状态文件。`checkpointTurn` 仍从当前存档 turn 文件 max 取（不变）。
- [ ] A2. `storage/checkpoints.ts` `createCheckpointForSave`（:63-78）：`listCheckpointWorkspaceFilesForSave` 也要排除 turn 文件（与 A1 一致）。
- [ ] A3. `storage/checkpoints.ts` `restoreCheckpointForSave`（:87-127）：恢复时①覆写状态文件 ②裁剪存档 turn 文件到 1..checkpoint.turn ③**删除 turn > checkpoint.turn 的 checkpoint**（`checkpoints.where('saveId').equals(saveId).and(cp => cp.turn > checkpoint.turn).delete()`）——修复当前不清理幽灵未来 checkpoint 的缺陷。turn 1..N 本就在存档 workspace，无需从 checkpoint 拷。B 块后此处删除的幽灵 checkpoint 独占 blob 由 D 块 GC 清理（A 阶段先删 checkpoint 记录，blob 清理随 D 落地）。
- [ ] A4. `storage/checkpoints.ts` `toCheckpointSummary`（:28-39）：`messageCount` 改从 `record.turn` 算（manifest/workspaceFiles 里没 turn 文件可数了），`workspaceFileCount` 从状态文件数算。
- [ ] A5. 验证：回溯第 N 回 → 存档 turn 文件裁到 1..N + 状态文件为 checkpoint 时的值；tsc 通过。

### Block B：内容寻址 blob 表（状态文件）

- [ ] B1. `storage/db.ts`：新增 `LocalBlobRecord` interface（含 `ownerSaveId`）+ `blobs: Table` + schema `blobs: "&[hash+ownerSaveId], ownerSaveId"`；`version(1)`→`version(2)`；DB 名 `tsian-agent-runtime-v11`→`-v12`（清库）。
- [ ] B2. 新建 `storage/blobs.ts`：`hashText(content): Promise<string>` / `hashBlob(blob): Promise<string>`（`crypto.subtle.digest("SHA-256")`，返回 hex）；`putBlobIfAbsent(hash, ownerSaveId, content/data/size)`；`getBlob(hash, ownerSaveId)`；`deleteOrphanBlobs(ownerSaveId, referencedHashes)`（GC 用，见 D）；`deleteBlobsForSave(ownerSaveId)`（删存档用）。
- [ ] B3. `storage/db.ts:74-82` `LocalCheckpointRecord`：`workspaceFiles` 字段 → `manifest: Array<{path, hash, createdAt, updatedAt}>`。
- [ ] B4. `storage/checkpoints.ts` `createCheckpointRecordForSave`（:41-61）：状态文件（排除 turn 文件）→ 逐个算哈希 → `putBlobIfAbsent` → 生成 manifest。事务编排：哈希计算事务外，blob put 小事务，checkpoint put 小事务。
- [ ] B5. `storage/checkpoints.ts` `restoreCheckpointForSave`：读 manifest → 按 hash `getBlob` → 重建 workspace 状态文件（content 或 data Blob）→ 覆写存档 workspace（删光当前状态文件再写）→ 裁剪 turn 文件到 1..N。
- [ ] B6. `storage/workspace.ts` `listCheckpointWorkspaceFilesForSave`（:400）：改为 manifest 生成入口（算哈希、排除 turn 文件），或由 B4 直接内联取代。
- [ ] B7. 验证：同状态文件跨 checkpoint 共享 blob（blobs 行数 < manifest 总条目）；tsc + vite build 通过；DB v12 启动无迁移错误。

### Block D：简单全表扫 GC

- [ ] D1. 新增 `storage/checkpoints.ts` `pruneCheckpointsForSave(saveId)`：M/K 从 `getCheckpointPruneConfig()` 读取（**接缝函数，暂返硬编码默认 { keepRecent: 50, sparseEvery: 20 }**——配置体系任务来时把此函数接到 `.tsian/` 平台配置源，本任务不建配置文件）。列该 save 全部 checkpoint（降序）→ 保留最近 keepRecent + 每 sparseEvery 回一稀疏 + 所有 initial/manual + 当前回合点 → 删其余。
- [ ] D2. GC：删 checkpoint 后，扫该 save 剩余 checkpoint 的所有 manifest → 收集 referenced hash 集 → `blobs` 表按 `ownerSaveId` 过滤删该 save 内未引用的 `(hash, ownerSaveId)` 行（ownerSaveId 维度让 GC 只扫单 save 范围，不跨 save 算引用）。
- [ ] D3. `storage/saves.ts` `commitSuccessfulRuntimeTurnForSave` 末尾调 `pruneCheckpointsForSave`（fire-and-forget 或 await——回合末尾，await 可接受）。
- [ ] D4. `storage/saves.ts` `deleteLocalSave`（:223-227）：补 `deleteBlobsForSave(saveId)`——按 `ownerSaveId` 索引直接清该 save 全部 blob（删 save 后其 checkpoint 全没，blob 全成孤儿，按 ownerSaveId 精准清）。
- [ ] D5. `getCheckpointPruneConfig()` 接缝：加注释标明"配置体系任务（platform-config）将把此函数接到 `.tsian/` 平台配置源"，留 TODO 锚点便于后续任务检索。
- [ ] D6. 验证：连续 >50+稀疏数 回合后 checkpoint 数不超上限；被删 checkpoint 独占 blob 从 blobs 表清除（无泄漏）。

## Validation Commands

```bash
# 类型检查
npx tsc --noEmit -p apps/platform-web/tsconfig.json
# 构建
npx vite build apps/play-frontend-dev   # 确认前端未受影响
# 运行时验证（手动，play-frontend dev server）
# 1. 玩若干回合 → 回溯视图列点 → 恢复第 N 回 → 剧情视图显示 turn 1..N 历史
# 2. 调试控制台检查 localDb.blobs.count() < checkpoint manifest 总条目（去重生效）
# 3. 玩 >50 回合后 checkpoint 数受裁剪限制
```

## 风险点与回滚

- **DB 名改 v12 = 清库**：旧存档弃。回滚 = 改回 v11（无迁移）。
- **turn 文件裁剪式恢复**（A3）：若 manifest/裁剪漏文件 → 恢复后丢状态。缓解：`saveRuntimeFilesFromEffectiveWorkspace` 过滤范围与旧实现一致；恢复后可加断言（workspace 状态文件数 == manifest 长度 + turn 1..N 数）。
- **二进制哈希异步**（B2）：事务不能含 await crypto.subtle → 拆成「事务外算哈希 + 小事务写」。
- **GC 删孤儿 blob 误删**：blob 带 `ownerSaveId`，GC 按 ownerSaveId 过滤只扫单 save 范围的 manifest 算引用，不跨 save，误删风险消除。删存档时 `deleteBlobsForSave(saveId)` 按 ownerSaveId 精准清。

## Follow-up before task.py start

- 无。M=50/K=20 已定；blob 带 ownerSaveId 已定；引擎/globals 已移除无需 Block G。
