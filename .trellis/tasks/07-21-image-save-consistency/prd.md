# 异步图片存档一致性

## Goal

保证长耗时、旁路的图片生成与正式剧情推进、checkpoint、restore 和重生成之间保持一致。图片可以在故事继续后完成，但 restore/branch rewrite 后的迟到结果必须失效；正式回合不能再用陈旧全量 snapshot 覆盖并发媒体写入。

本任务只负责 platform-host source binding 与 storage consistency，不实现 Provider/Tool、插图 schema、Agent 或 UI。

## Requirements

### R1. Formal turn merge

- `commitSuccessfulRuntimeTurnForSave` 改为消费 `RuntimeWorkspaceChanges`，把 written/deleted paths 合并到提交时的最新 workspace。
- 新 auto checkpoint 必须从合并后的 workspace 构建；若 hash 计算期间 workspace 改变，重取/重建/重试，而不是覆盖并发变化。
- 禁止正式成功 turn 删除并重写该 save 的全部 `workspaceFiles`。
- 同路径冲突由 formal transaction 的显式写入获胜；不相关 path 必须保留。

### R2. Invocation-start source binding

- `invokeAgent.generatedMediaTarget` 存在时，Host 在 Agent 执行前读取 exact turn file，定位 assistant `projections[projectionKey][index]`。
- source entry 必须存在且是 string；Host 不解析 illustration JSON，也不导入卡 validator。
- binding 捕获 `saveId`、target、source path、opaque source revision、当前 save branch epoch 和 stable asset path。
- revision 覆盖 source record 的内容与生命周期元数据，能够识别 prune/rewrite；storage 只消费 opaque expected revision。
- target 无效/来源缺失在 Agent/Provider 前失败，不降级成 unbound invocation。

### R3. Branch epoch

- save record 增加内部、非索引的 `branchEpoch`，新 save/缺失字段视为 0。
- checkpoint restore 在恢复 workspace、裁剪 turn 和删除未来 checkpoints 的同一事务内递增 epoch。
- 普通 formal turn、旁路 workspace commit 和图片 commit 不递增 epoch。
- 图片 commit 要求 current epoch 等于 invocation-start epoch。因此正常剧情前进不误杀图片，任何 restore/branch rewrite 都会使旧请求 stale。

### R4. Checkpoint history coverage

- checkpoint record 增加内部 `historyFileCount`，表示快照逻辑上包含的连续 turn 文件数。
- 新档 initial checkpoint 为 0；opening turn 0 发布后的 checkpoint 为 1；formal turn N 为 N+1。
- 所有新建/overwrite/current-turn-auto checkpoint 都写入准确 count；restore 继续使用 `turn` 作为 UI/裁剪编号。
- generated media 只补丁 `historyFileCount >= sourceTurn + 1` 的 retained manifests，明确排除 pre-opening initial checkpoint。
- legacy checkpoint 缺失 count 时保守视为不包含新 generated-media source；不做批量迁移。

### R5. Generated-media commit

- storage API 接收 verified Blob、asset path 和 exact-source metadata；不接收 target raw projection、brief、Provider 或 Agent result。
- 在同一 Dexie transaction 中重新读取 source record/epoch，CAS 成功后写 workspace asset，并 patch 所有 eligible checkpoint manifests 的同一路径 hash。
- Provider 调用和 Blob hash 在 transaction 外；Blob row、workspace row、checkpoint manifests 和 save timestamp 的 durable mutation原子提交。
- stale-source 返回结构化结果/错误，零 workspace/checkpoint write。
- regeneration 使用同一路径；成功替换 eligible manifests，失败或 stale 保留旧图。

### R6. Concurrency and GC

- 不同 asset path 的并发 commit 均保留；同 path 的并发 regeneration 使用 source binding + invocation ordering/CAS，最后一个合法 durable commit 获胜且 manifest/workspace 一致。
- restore、formal checkpoint build、generated-media patch 和 prune 使用现有 retry/transaction seam，避免 manifest lost update。
- transaction 失败不能遗留不可达 Blob；成功替换后，对 workspace 与剩余 checkpoint 全引用扫描，删除 orphan Blob。
- restore/prune/delete/save cleanup 继续执行 Blob GC；不新增 refcount。

### R7. Negative boundary

- 不重做 generic invokeAgent explicit-change commit/current-turn-auto retry，它们已存在。
- 不重复已经交付的通用 invocation、diagnostics 或卡打包工作。
- source binding 只理解 generic turn envelope/projection coordinates；storage 不出现 `illustrations`、brief fields、Agent id 或 UI 状态。

## Acceptance Criteria

- [ ] AC1: formal turn 与 concurrent image write 交错时，不相关图片 path 不丢失，新 checkpoint 基于 merged workspace。
- [ ] AC2: target 在 Provider 前解析为 exact source binding；缺失/畸形 source 不启动 Agent/Provider。
- [ ] AC3: story 从 turn N 前进到 N+K 不使图片失效；任意 restore 后旧 epoch 图片 commit 被拒绝。
- [ ] AC4: initial checkpoint `historyFileCount=0`，opening checkpoint 为 1，后续为 N+1。
- [ ] AC5: 图片只进入确实包含 source turn 的 retained manifests，source 之前和 pre-opening initial 不含。
- [ ] AC6: regeneration 成功后 workspace/eligible checkpoints 引用同一新 hash；失败/stale 保持旧 hash。
- [ ] AC7: different-target 并发、same-target 并发、formal/image/restore 三方竞态均无 lost update。
- [ ] AC8: CAS/retry failure 和 replacement/prune/restore 后无 orphan Blob。

## Out of Scope

- 图像 API、reference Blob request、Tool permission/schema。
- illustration marker/validator、entrypoint、Agent、frontend。
- 通用 checkpoint UI/retention 改版、历史分支树、多版本图片。
- legacy checkpoint/historyCount 批量迁移。
