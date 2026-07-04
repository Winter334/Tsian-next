# invokeAgent workspace-with-checkpoint 提交语义 — 技术设计

## Scope

实现 `invokeAgent` 的 `commitMode: "workspace-with-checkpoint"`：agent 运行 → workspace 写入落盘 → 创建 checkpoint，保证 restore 到该回合时正文与维护后状态一致。本任务只补平台层 checkpoint 存储语义，不触及前端编排（`useSyncAfterTurn` 切换 commitMode 是一行改动，留给本任务验收或场记任务复验）。

## Architecture · 当前路径与缺口

### invokeAgent 提交链（现状）

`apps/platform-web/src/platform-host/index.ts:1111-1417`

```
invokeAgent(input)
  └─ executeInvokeAgentBody()  (闭包)
       ├─ runAgentRuntimeTurn(...)         # agent 运行，写入经 workspaceTransaction 暂存
       ├─ workspaceTransaction.writePlatformFile(trace)  # 旁路 trace
       └─ commitWorkspaceFilesForSave(saveId, finalWorkspaceFiles())  # ← 仅写 workspace，无 checkpoint
            └─ emitAgentInvocation({ type: "completed" })
```

缺口：`index.ts:1123-1127` 对 `workspace-with-checkpoint` 直接 throw；`commitWorkspaceFilesForSave`（`saves.ts:189-218`）只写 workspace 文件，不建 checkpoint。

### sendMessage 提交链（参考）

`commitSuccessfulRuntimeTurnForSave`（`saves.ts:119-181`）是主回合提交路径，已在一次 Dexie 事务内完成：workspace 写入 + checkpoint 创建 + save.updatedAt。checkpoint reason 固定 `"after-turn"`，turn 号从 workspaceFiles 的 turn 文件取 max。事务结束后调 `pruneCheckpointsForSave`。

### Checkpoint 存储模型

`apps/platform-web/src/storage/db.ts:74-84` — `LocalCheckpointRecord`：

```ts
reason: "initial" | "after-turn" | "manual"   // ← 闭合枚举，需扩展
manifest: Array<{ path, hash, createdAt, updatedAt }>  // thin manifest，内容寻址去重
```

`apps/platform-web/src/storage/checkpoints.ts`:
- `buildCheckpointRecordForSave`（44-72）：事务外算哈希 + 写 blob → 产出 record（不写表）。
- `pruneCheckpointsForSave`（207-255）：保留 initial/manual + 最近 keepRecent 条 after-turn + 每 sparseEvery 回稀疏点 + 当前回合点；删其余；GC 孤儿 blob。

## Design Decisions

### D1: 扩展 checkpoint reason 枚举

`db.ts:79` 的 `reason` 闭合枚举新增 `"post-turn-maintenance"`：

```ts
reason: "initial" | "after-turn" | "manual" | "post-turn-maintenance"
```

理由：
- 契约层 `checkpointReason?: string`（`runtime.ts:697`）是自由 string，但存储层用闭合枚举保留类型安全与 DebugView 分类能力。
- 新增一个枚举成员比改成 `string` 更可控；未来若需更多维护类 reason（如 `setup`）再追加。
- 平台层把调用方传入的 `checkpointReason` 映射到枚举：`"post-turn-maintenance"` → 存储枚举同值；未知值在 platform-host 校验阶段拒绝（fail loud），不静默落库。

### D2: checkpoint turn 归属 = 当前 invokeMaxTurn（不推进 turn）

`invokeAgent` 是旁路调用，不推进 turn（`index.ts:1153` 注释明确）。checkpoint 的 `turn` 字段取 `invokeMaxTurn`（`index.ts:1174` 已计算），与同一回合 `sendMessage` 的 after-turn checkpoint 同 turn、不同 reason、不同 createdAt。

### D3: replace-on-create — 维护 checkpoint 成功时替换同 turn 的 after-turn checkpoint

PRD R4 明确两个可选语义（coexist / replace），委托实施时确认。本设计选 **replace-on-create**：

**行为**：`workspace-with-checkpoint` 提交成功时，在同一 Dexie 事务内删除该 save 下同 turn 的 `after-turn` checkpoint（若存在），再写入 `post-turn-maintenance` checkpoint。

**理由**：
- 维护 checkpoint 是该回合的**规范状态**（正文 + 维护后 runtime/entity/scene）。保留 pre-maintenance 的 after-turn checkpoint 会误导 restore：回溯到该回合得到的是"有正文、无维护"的不一致状态，正是本任务要消除的缺口。
- 失败时（agent 运行失败 / workspace 写入失败）不建 checkpoint、不删 after-turn —— after-turn 仍是该回合规范状态，符合"失败回退"直觉。
- 内容寻址去重使两个 checkpoint 共享未变更文件的 blob，但 manifest 记录本身仍占行；replace 减少冗余记录。
- restore 对话框（`listCheckpointsForSave` 按 createdAt 降序）不会出现同 turn 两条让人困惑的记录。
- 无需改 prune 逻辑：`post-turn-maintenance` 不属于 `initial`/`manual` 自动保留类，靠"当前回合点"规则（`checkpoints.ts:237`）存活；当回合变旧时，replace 已保证该 turn 只剩 maintenance 点，prune 的稀疏/最近规则会正常处理它（见 D4）。

**边界**：replace 只删 `reason === "after-turn"` 且 `turn === invokeMaxTurn` 的记录；不删 `manual`/`initial`/其它 turn 的记录。

### D4: prune 对 post-turn-maintenance 的处理

现有 prune 逻辑按 `reason === "after-turn"` 筛选最近 N 条（`checkpoints.ts:225`）。`post-turn-maintenance` 不进该筛选，靠以下规则存活：
- **当前回合点**（`checkpoints.ts:237` `cp.turn === currentTurn`）：刚建的维护点必然存活。
- **稀疏点**（`cp.turn % sparseEvery === 0`）：若该 turn 恰好是稀疏间隔点，存活。

当回合变旧且不命中稀疏点时，维护点会被 prune 删除——这与 after-turn 点的生命周期一致，符合"旧回合 checkpoint 逐步回收"的现有设计。由于 D3 的 replace 已保证同 turn 不会同时存在 after-turn + maintenance，不存在"维护点被删但 pre-maintenance after-turn 残留"的问题。

**不改 prune 逻辑**。新增的 `post-turn-maintenance` reason 在 prune 中按 `after-turn` 之外的路径处理即可，不需要额外保留规则。

### D5: 原子性 — 单 Dexie 事务 + 尽力创建语义

仿 `commitSuccessfulRuntimeTurnForSave` 模式：

1. **事务外**：`buildCheckpointRecordForSave` 算哈希 + 写 blob（crypto.subtle.digest 异步，不能进 Dexie 事务）。
2. **单 Dexie 事务**（`localDb.transaction("rw", [saves, workspaceFiles, checkpoints], ...)`）：
   - 删旧 workspace records → 写新 workspace records
   - 删同 turn 的 after-turn checkpoint（D3）
   - put `post-turn-maintenance` checkpoint
   - put save.updatedAt
3. **事务后**：`pruneCheckpointsForSave(saveId)`

**已知限制（MVP 接受）**：步骤 1 的 blob 写入成功后，若步骤 2 事务失败，blob 成为孤儿。现有 `commitSuccessfulRuntimeTurnForSave` 也有相同特性（blob 先写，事务后 GC 清孤儿）。不引入新风险。PRD R5 / Notes 明确 MVP 接受"写入成功 + checkpoint 尽力创建"语义。

### D6: completed 事件在 checkpoint 创建后发出

PRD R7 要求 completed 事件在 checkpoint 创建后发出。当前 `index.ts:1385` 在 `commitWorkspaceFilesForSave` 后立即 emit。新路径改为：`commitWorkspaceFilesWithCheckpointForSave` 返回后 → emit completed。确保前端收到 completed 时状态已可 restore。

### D7: workspace 模式行为不变（向后兼容）

`commitMode === "workspace"`（默认）继续走 `commitWorkspaceFilesForSave`，不建 checkpoint、不删任何 checkpoint。`checkpointReason` 与 `workspace` 模式互斥的校验（`index.ts:1128-1131`）保留。

## Data Flow · 新提交路径

```
invokeAgent(input)
  ├─ commitMode === "workspace-with-checkpoint" → 走新路径（不再 throw）
  ├─ commitMode === "workspace"                 → 走旧路径（不变）
  └─ executeInvokeAgentBody()
       ├─ runAgentRuntimeTurn(...)                         # agent 运行
       ├─ stageAgentContextFile(...)                        # persist 时写 context
       ├─ workspaceTransaction.writePlatformFile(trace)
       ├─ if commitMode === "workspace-with-checkpoint":
       │     commitWorkspaceFilesWithCheckpointForSave(saveId, finalWorkspaceFiles(), {
       │       turn: invokeMaxTurn,
       │       checkpointReason: input.checkpointReason ?? "post-turn-maintenance",
       │     })
       │   else:
       │     commitWorkspaceFilesForSave(saveId, finalWorkspaceFiles())   # 旧路径
       └─ emitAgentInvocation({ type: "completed", ... })  # checkpoint 落盘后
```

## Contracts · 改动点

### 1. `apps/platform-web/src/storage/db.ts:79`
扩展 `LocalCheckpointRecord.reason` 枚举，追加 `"post-turn-maintenance"`。

### 2. `apps/platform-web/src/storage/saves.ts` — 新函数
新增 `commitWorkspaceFilesWithCheckpointForSave(saveId, workspaceFiles, { turn, checkpointReason })`：
- 仿 `commitSuccessfulRuntimeTurnForSave` 的事务结构。
- checkpoint turn = 传入 `turn`（调用方提供 `invokeMaxTurn`）。
- reason = 映射后的枚举值（`"post-turn-maintenance"`）。
- 事务内额外删除同 turn 的 `after-turn` checkpoint（D3）。
- 不写 history、不更新 runtimeSnapshot（invokeAgent 不推进 turn）。
- 事务后调 `pruneCheckpointsForSave`。
- label 用 `回合 ${turn} · 维护`（DebugView 可读）。

### 3. `apps/platform-web/src/platform-host/index.ts:1111-1132`
- 移除 `workspace-with-checkpoint` 的 throw（`1123-1127`）。
- 校验 `checkpointReason`：传则必须是非空字符串且为已知值（MVP 只认 `"post-turn-maintenance"`；未知值 fail loud）。未传时默认 `"post-turn-maintenance"`。
- `executeInvokeAgentBody` 末尾按 commitMode 分支调用新/旧提交函数。

### 4. 不改 contracts
`AgentInvocationCommitMode` / `InvokeAgentRequest.checkpointReason` 已就绪（`runtime.ts:680,697`），无需改动。

## Compatibility & Rollback

- **向后兼容**：`workspace` 模式行为完全不变；现有 `invokeAgent` 调用方默认 `workspace`，无回归。
- **前端切换**：`useSyncAfterTurn.ts:85` 把 `commitMode: "workspace"` 改为 `commitMode: "workspace-with-checkpoint"`（+ 可选 `checkpointReason: "post-turn-maintenance"`）即获得 checkpoint 一致性。该切换留给本任务端到端验收或场记任务复验。
- **回滚**：若新路径出问题，前端改回 `commitMode: "workspace"` 即退回旧行为；平台层新函数是新增，不影响旧路径。
- **数据迁移**：无需迁移。旧存档没有 `post-turn-maintenance` checkpoint，不影响。

## Out of Scope

- 不改 `invokeAgent` 流式事件协议（started/delta/round-end/tool/completed/failed）。
- 不实现前端 `useSyncAfterTurn` 的 commitMode 切换（留给验收或场记复验）。
- 不改 `sendMessage` 的 after-turn checkpoint 行为。
- 不设计 checkpoint 审批/命名/手动管理 UI。
- 不改 `workspace` 模式行为。
