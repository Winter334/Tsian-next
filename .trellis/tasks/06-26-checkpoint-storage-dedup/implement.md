# Implement — 检查点存储优化

## 执行顺序（按依赖排）

实现按 G → A → B → D 顺序。G（globals 移除）先做，让 A/B 拿到的 `RuntimeStateShell` 已经是简化后的 `{ turn, messages }`，避免 A/B 先按旧类型写再回头改。每块独立可验证。C（迁移）跳过。

### Block A：消息去冗余（B 类历史）

- [ ] A1. `storage/saves.ts` `commitSuccessfulRuntimeTurnForSave`（:206-272）：建 checkpoint 时 `nextSnapshot.state.messages` 不再全量写入 record——record 只存 `{ turn }`（globals 由 Block G 移除）。注意 `saveSnapshots.put` 仍存完整 snapshot（存档当前态需要 messages，那是 saveSnapshots 不是 checkpoint）。
- [ ] A2. `storage/checkpoints.ts` `LocalCheckpointRecord` 类型（db.ts:80-89 同步改）：`snapshot` 字段改为 `state: { turn }`（去掉 messages + globals）。
- [ ] A3. `storage/checkpoints.ts` `restoreCheckpointForSave`（:84-126）：返回前重组完整 `RuntimeSnapshotShell`——读存档 workspace 的 turn 文件，`getHistoryFromTurnFiles` 重建 messages，拼 `{ version, state: { turn, messages } }` 返回（无 globals）。`platform-host/index.ts:391-400` 无需改（拿到的已是完整 snapshot）。
- [ ] A4. checkpoint manifest 暂不含 turn 文件条目（A 块只去 messages 冗余，workspaceFiles 暂仍全量存——B 块才转 manifest）。即 A 块产物：record.state 无 messages，record.workspaceFiles 仍全量但**剔除 turn 文件**（turn 文件改由恢复时裁剪，见 A5）。
- [ ] A5. `restoreCheckpointForSave` 恢复 workspace 时：覆写状态文件后，**裁剪 turn 文件到 1..N**（删 turn > checkpoint.turn 的文件）。turn 1..N 本就在存档 workspace（追加型），无需从 checkpoint 拷。
- [ ] A6. 验证：回溯第 N 回 → reloadHistory 显示 turn 1..N 历史 + 正确 globals；tsc 通过。

### Block B：内容寻址 blob 表（A 类状态）

- [ ] B1. `storage/db.ts`：新增 `LocalBlobRecord` interface（含 `ownerSaveId`）+ `blobs: Table` + schema `blobs: "&[hash+ownerSaveId], ownerSaveId"`；`version(1)`→`version(2)`；DB 名 `tsian-agent-runtime-v11`→`-v12`（清库）。
- [ ] B2. 新建 `storage/blobs.ts`：`hashText(content): Promise<string>` / `hashBlob(blob): Promise<string>`（`crypto.subtle.digest("SHA-256")`，返回 hex）；`putBlobIfAbsent(hash, ownerSaveId, content/data/size)`；`getBlob(hash, ownerSaveId)`；`deleteOrphanBlobs(ownerSaveId, referencedHashes)`（GC 用，见 D）；`deleteBlobsForSave(ownerSaveId)`（删存档用）。
- [ ] B3. `storage/checkpoints.ts` `LocalCheckpointRecord` 终态：`workspaceFiles` 字段 → `manifest: Array<{path, hash, createdAt, updatedAt}>`。
- [ ] B4. `storage/checkpoints.ts` `createCheckpointRecordForSave`（:37-58）：状态文件（`saveRuntimeFilesFromEffectiveWorkspace` 过滤后，**排除 turn 文件**）→ 逐个算哈希 → `putBlobIfAbsent` → 生成 manifest。事务编排：哈希计算事务外，blob put 小事务，checkpoint put 小事务。
- [ ] B5. `storage/checkpoints.ts` `restoreCheckpointForSave`：读 manifest → 按 hash `getBlob` → 重建 workspace 状态文件（content 或 data Blob）→ 覆写存档 workspace → 裁剪 turn 文件到 1..N → 重组 snapshot（messages 从 turn 文件重建）。
- [ ] B6. `storage/workspace.ts` `listCheckpointWorkspaceFilesForSave`（:400-404）：改为 manifest 生成入口（算哈希、排除 turn 文件），或由 B4 直接内联取代。
- [ ] B7. `storage/checkpoints.ts` `toCheckpointSummary`（:24-35）：`messageCount` 从 turn 文件数算（或 checkpoint.turn），`workspaceFileCount` 从 manifest 长度算。
- [ ] B8. 验证：同文件跨 checkpoint 共享 blob（blobs 行数 < manifest 总条目）；tsc + vite build 通过；DB v12 启动无迁移错误。

### Block D：简单全表扫 GC

- [ ] D1. 新增 `storage/checkpoints.ts` `pruneCheckpointsForSave(saveId)`：M/K 从 `getCheckpointPruneConfig()` 读取（**接缝函数，暂返硬编码默认 { keepRecent: 50, sparseEvery: 20 }**——配置体系任务来时把此函数接到 `.tsian/` 平台配置源，本任务不建配置文件）。列该 save 全部 checkpoint（降序）→ 保留最近 keepRecent + 每 sparseEvery 回一稀疏 + 所有 initial/manual + 当前回合点 → 删其余。
- [ ] D2. GC：删 checkpoint 后，扫该 save 剩余 checkpoint 的所有 manifest → 收集 referenced hash 集 → `blobs` 表按 `ownerSaveId` 过滤删该 save 内未引用的 `(hash, ownerSaveId)` 行（ownerSaveId 维度让 GC 只扫单 save 范围，不跨 save 算引用）。
- [ ] D3. `storage/saves.ts` `commitSuccessfulRuntimeTurnForSave` 末尾调 `pruneCheckpointsForSave`（fire-and-forget 或 await——回合末尾，await 可接受）。
- [ ] D4. `storage/saves.ts` `deleteSave`（删存档路径，:335-352）：补 `deleteBlobsForSave(saveId)`——按 `ownerSaveId` 索引直接清该 save 全部 blob（删 save 后其 checkpoint 全没，blob 全成孤儿，按 ownerSaveId 精准清）。
- [ ] D5. `getCheckpointPruneConfig()` 接缝：加注释标明"配置体系任务（platform-config）将把此函数接到 `.tsian/` 平台配置源"，留 TODO 锚点便于后续任务检索。
- [ ] D6. 验证：连续 >M+稀疏数 回合后 checkpoint 数不超上限；被删 checkpoint 独占 blob 从 blobs 表清除（无泄漏）。

### Block G：globals 移除（附带死代码清理）

- [ ] G1. `packages/contracts/src/runtime.ts`：`RuntimeStateShell` 删 `globals?` 字段（:599）；删 `RuntimeGlobalsMap` interface（:153-155）。rebuild contracts dist。
- [ ] G2. `apps/platform-web/src/runtime-host/engine.ts`：删 `applyRuntimeStatePatch` 方法（:74-92）；初始 snapshot 的 `globals: {}`（:21）去掉；`loadSnapshot`/`replaceMessages` 等不再带 globals。
- [ ] G3. 4 处透传清理：`platform-host/index.ts:215`、`platform-host/frontend-inspector.ts:934`、`storage/saves.ts:122/181/222` 的 `globals: snapshot.state.globals ?? {}` 删除。
- [ ] G4. `storage/saves.ts:60` `createEmptyRuntimeSnapshot` 的 `globals: {}` 删除。
- [ ] G5. 验证：tsc 全绿，全仓 grep `globals` 无源码残留（dist 重建后也无）。

## Validation Commands

```bash
# 类型检查
npx tsc --noEmit -p apps/platform-web/tsconfig.json
# 构建
npx vite build apps/play-frontend-dev   # 确认前端未受影响
# 运行时验证（手动，play-frontend dev server）
# 1. 玩若干回合 → 回溯视图列点 → 恢复第 N 回 → 剧情视图显示 turn 1..N 历史
# 2. 调试控制台检查 localDb.blobs.count() < checkpoint manifest 总条目（去重生效）
# 3. 玩 >M 回合后 checkpoint 数受裁剪限制
```

## 风险点与回滚

- **DB 名改 v12 = 清库**：旧存档弃。回滚 = 改回 v11（无迁移）。
- **turn 文件裁剪式恢复**（A5）：若 manifest/裁剪漏文件 → 恢复后丢状态。缓解：`saveRuntimeFilesFromEffectiveWorkspace` 过滤范围与旧实现一致；恢复后可加断言（workspace 文件数 == manifest 长度 + turn 1..N 数）。
- **二进制哈希异步**（B2）：事务不能含 await crypto.subtle → 拆成「事务外算哈希 + 小事务写」。
- **GC 删孤儿 blob 误删**：blob 带 `ownerSaveId`，GC 按 ownerSaveId 过滤只扫单 save 范围的 manifest 算引用，不跨 save，误删风险消除。删存档时 `deleteBlobsForSave(saveId)` 按 ownerSaveId 精准清。
- **globals 移除**（G）：已证死代码（`applyRuntimeStatePatch` 零调用 + 4 处纯透传 + 初始恒空），移除风险低。回滚 = git revert Block G（与存储改动解耦，独立提交）。注意 contracts dist 要 rebuild，否则消费方（platform-web）拿到的还是旧类型。

## Follow-up before task.py start

- 无。M=50/K=20 已定；blob 带 ownerSaveId 已定。
