# 检查点存储优化：内容寻址 + turn 去冗余 + GC

## Goal

压缩检查点（checkpoint）的存储成本，为未来云存档打好地基。当前每个 after-turn 检查点内嵌「全量消息历史（O(N²) 膨胀）」+「全量工作区文件深拷贝（O(N×W) 跨点重复）」，长流程存档会单调膨胀，云同步时按用户数放大成本。

优化后：消息走增量 turn 日志（O(N)），状态文件走内容寻址 blob 表（跨检查点未变更文件零重复），并配裁剪 GC 给成本封顶。**完整保留回溯能力**——回溯到第 N 回能拿到那时的完整世界状态（world/state/memory/agents/frontend 文件）+ 完整对话历史。

## Confirmed Facts（代码调研确认）

- 检查点存储 = `LocalCheckpointRecord`（`storage/db.ts:80-89`）：`snapshot: RuntimeSnapshotShell` + `workspaceFiles: 全量文件深拷贝`。
- `RuntimeStateShell = { turn, messages, globals? }`（`contracts/runtime.ts:596-600`）。**globals 是死代码**——唯一写入入口 `RuntimeEngine.applyRuntimeStatePatch`（`engine.ts:74-92`）零调用点，所有读取点（`index.ts:215`、`frontend-inspector.ts:934`、`saves.ts:122/181/222`）纯透传 `?? {}`，初始恒空（`saves.ts:60`/`engine.ts:21`）；职责已被 workspace 接管（`save/world/`、`save/state/`、`save/memory/` 由后处理 agent 维护）。本任务附带移除，移除后 `RuntimeStateShell = { turn, messages }`。`messages` 属可从 turn 文件重建的历史（B 类）。
- turn 文件 `save/history/turns/turn-NNNNNN.json`（`history-turns.ts:19-36`）含 `messages`(user+assistant)+`processNodes`+`stats`，一回合一文件，只增不改。`getSessionHistoryFromTurnFiles`（`history-turns.ts:216-238`）/`getHistoryFromTurnFiles`（`:193-208`）已能从 turn 文件重建完整对话——前端 `createSessionHistory` 走的就是这条路径。
- checkpoint 工作区快照含整个 `save/` 树（`isSaveRuntimePersistencePath` 放行 `save/...`，`workspace-paths.ts:46-53`），包括 turn 文件本身——所以 turn 文件当前被复制进每个检查点 N 份。
- save/ 模板约 13 个固定文件 + 运行时动态 turn 文件 + world/state/memory 实体文件（`workspace-templates.ts:1277-1381`）。单 save blob 表行数预期几十到低百量级。
- checkpoint 创建：`commitSuccessfulRuntimeTurnForSave`（`saves.ts:206-272`）每成功回合建一条 after-turn；`initial` 建存档时一次（`saves.ts:133`）；无 `manual`（前端未接）。
- 当前无任何裁剪/GC：全仓搜 prune/trim/compact 无命中；`deleteCheckpointsForSave`（`checkpoints.ts:128`）只在删存档时触发。
- DB 升级是"改名重置、旧库弃用"范式（`db.ts:170-176`，prototype 无迁移），当前 `version(1)` + DB 名 `tsian-agent-runtime-v11`。
- 桥签名 `listCheckpoints`/`restoreCheckpoint`（`platform.runAction restore-checkpoint` + `query.query checkpoints`）不变，前端检查点 UI 零改动。

## Decisions（已与用户确认）

1. **A 块：消息去冗余（B 类历史）**——checkpoint 的 `snapshot.state.messages` 不再内嵌全量，恢复时从 turn 文件 1..N 重建。`snapshot` 只保留 `turn`（globals 移除后无需快照状态字段）。复用现有 `getSessionHistoryFromTurnFiles`/`getHistoryFromTurnFiles`。
2. **B 块：内容寻址 blob 表（A 类状态）**——新 Dexie `blobs` 表按内容哈希存一份文件内容（文本 + 二进制 Blob 都哈希），checkpoint 改存 thin manifest（`path→hash` 引用），跨检查点未变更文件零重复。
3. **D 块：简单全表扫 GC**——裁剪保留最近 M + 每 K 稀疏 + initial + manual；回收时扫所有 manifest 算引用数删孤儿 blob，**不做增量引用计数**。
4. **C 块：跳过迁移**——接受升级清库（prototype DB 本就改名重置），旧 fat checkpoint 直接弃。
5. turn 文件本身不进 blob 表（它们是追加日志，B 类去冗余后跨检查点共享一份独立存储，不走内容寻址）。
6. M/K 裁剪参数走 `getCheckpointPruneConfig()` 接缝函数（本任务返硬编码默认 50/20），**不建配置文件/控制面板**——平台配置体系单开 `platform-config` 任务，届时把此函数接到 `.tsian/` 配置源。

## Requirements

- A：`commitSuccessfulRuntimeTurnForSave` 建检查点时 `snapshot.state.messages` 置空或省略；`restoreCheckpointForSave` 恢复时从当前存档 turn 文件重建 messages 拼回 snapshot（或恢复后 runtime loadSnapshot 时补）。
- A：turn 文件不再随 checkpoint 深拷贝——checkpoint manifest 不含 turn 文件条目（turn 日志是存档级共享、追加型，回溯到第 N 回 = 保留 turn 1..N 即可，不需要每点各自拷贝）。
- B：新 `blobs` 表 schema（哈希主键 + content/Blob + size + createdAt）。Dexie version bump + DB 名重置（清库）。
- B：`LocalCheckpointRecord` 结构改为 thin manifest：`state: { turn }`（messages 重建、globals 移除）+ `manifest: Array<{path, hash, createdAt, updatedAt}>`，不再内嵌 workspaceFiles 内容。
- B：checkpoint 写入 = 算每个状态文件哈希 → blob 表 put-if-absent → 写 manifest；恢复 = 读 manifest → 按 hash 取 blob → 重建 workspaceFiles → 覆写存档 workspace。
- B：二进制 Blob 与文本都走内容寻址（`crypto.subtle` 异步哈希，事务编排重排为「先算哈希写 blob（事务外或小事务）→ 再小事务提交 manifest」）。
- D：新增 `pruneCheckpointsForSave`，挂在 `commitSuccessfulRuntimeTurnForSave` 末尾；策略最近 M + 每 K 稀疏 + initial + manual；回收后全表扫 manifest 算 blob 引用集，删孤儿 blob。
- 桥层 `listCheckpoints` 返回的 `CheckpointSummary.messageCount/workspaceFileCount` 字段语义保持（messageCount 从 turn 文件数算，workspaceFileCount 从 manifest 长度算）。

## Acceptance Criteria

- [ ] 100 回合存档的 checkpoint 表存储量较优化前显著下降（消息部分从 O(N²) 降到 O(N)）；可写一个脚本/调试断言对比前后单 checkpoint 字节数。
- [ ] 回溯到第 N 回后，`snapshot.state.messages` 被正确重建为 turn 1..N 的完整对话，workspace 文件为该 checkpoint 时的状态——前端剧情视图 reloadHistory 显示与回溯前一致的历史 + 正确的 turn 号。
- [ ] globals 已移除：`RuntimeStateShell` 不再含 globals 字段，`applyRuntimeStatePatch` 删除，4 处透传清理，tsc 通过无 globals 残留引用。
- [ ] 同一未变更状态文件在多个 checkpoint 间共享一份 blob（哈希去重验证：blob 表行数 < manifest 条目总数）。
- [ ] 裁剪策略生效：连续回合后 checkpoint 数量不超过 M + 稀疏点数 + initial + manual；被删 checkpoint 独占的 blob 从 blobs 表清除（无泄漏）。
- [ ] play-frontend 检查点 UI（本会话刚实现）端到端可用：列点、确认弹窗、恢复、切回剧情刷新——零前端改动。
- [ ] tsc + vite build 通过；DB version bump 后旧库按改名重置范式弃用，无迁移错误。

## Out of Scope

- **平台配置体系**（`.tsian/` 配置文件 + 控制面板 + 迁入提供商/RAG/上下文压缩等零散配置）——单开 `platform-config` 任务。本任务只留 `getCheckpointPruneConfig()` 接缝。
- 云同步本身（本任务只做本地存储地基，云层建在 blob 表之上，单独立 task）。
- manual checkpoint 创建 UI（前端未接，保留 reason 枚举位即可）。
- 旧存档数据迁移（接受清库）。
- blob 表跨 save/跨 user 共享（本地阶段 per-save 即可，云阶段再升 per-user）。

## Open Questions

- 无。M=50 / K=20 已定；blob 带 ownerSaveId 已定。
