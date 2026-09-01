# invokeAgent workspace-with-checkpoint 实施计划

## Validation Commands

```bash
npm run build:contracts   # 契约层（本任务不改 contracts，但保持绿）
npm run build:web         # platform-web 构建 + vue-tsc 类型检查
```

端到端验收（可选，依赖前端切换 commitMode）：

- 手动在 `useSyncAfterTurn.ts:85` 临时改 `commitMode: "workspace-with-checkpoint"`，跑一轮正文 + 场记，用 DebugView 确认出现 `post-turn-maintenance` checkpoint，且同 turn 的 `after-turn` 被替换；restore 到该 checkpoint 状态一致。
- 验收后改回 `workspace`（前端正式切换留给场记任务复验）或保留（若场记任务已就绪）。

## Implementation Steps

### 1. 扩展 checkpoint reason 枚举

**文件**：`apps/platform-web/src/storage/db.ts:79`

```ts
reason: "initial" | "after-turn" | "manual" | "post-turn-maintenance"
```

**验证**：`npm run build:web`（vue-tsc 会检查所有 reason 赋值点是否兼容新枚举）。

### 2. 新增 `commitWorkspaceFilesWithCheckpointForSave`

**文件**：`apps/platform-web/src/storage/saves.ts`（在 `commitWorkspaceFilesForSave` 后追加）

仿 `commitSuccessfulRuntimeTurnForSave`（119-181）结构，差异：

- 接受 `{ turn, checkpointReason }: { turn: number; checkpointReason: "post-turn-maintenance" }`。
- checkpoint turn = 传入 `turn`（不重新从 workspaceFiles 取 max，因为 invokeAgent 不推进 turn）。
- label = `回合 ${turn} · 维护`。
- reason = `"post-turn-maintenance"`。
- **事务内额外步骤**：删除该 save 下 `turn === input.turn && reason === "after-turn"` 的 checkpoint（D3 replace-on-create）。
- 不写 history、不更新 runtimeSnapshot。
- 事务后调 `pruneCheckpointsForSave(saveId)`。

实现要点：
- 复用 `saveRuntimeFilesFromEffectiveWorkspace` + `createLocalWorkspaceFileRecord` + `buildCheckpointRecordForSave` + `isAppendOnlyLogPath`。
- checkpointWorkspaceFiles 过滤 append-only log（与现有路径一致）。
- Dexie 事务表：`[localDb.saves, localDb.workspaceFiles, localDb.checkpoints]`。
- 删 after-turn：`await localDb.checkpoints.where("saveId").equals(saveId).toArray()` → filter `turn === input.turn && reason === "after-turn"` → `localDb.checkpoints.delete(id)`。

### 3. 移除 throw，接入新提交路径

**文件**：`apps/platform-web/src/platform-host/index.ts:1111-1132` + `1384`

3a. 移除 `1123-1127` 的 `workspace-with-checkpoint` throw。

3b. 校验 `checkpointReason`（替换 `1128-1131` 现有校验块）：
- `commitMode === "workspace"` 且 `checkpointReason !== undefined` → throw（保留现有规则）。
- `commitMode === "workspace-with-checkpoint"` 且 `checkpointReason` 提供 → 必须是非空字符串且 `=== "post-turn-maintenance"`（MVP）；未知值 throw fail loud。未提供 → 默认 `"post-turn-maintenance"`。

3c. `executeInvokeAgentBody` 末尾（`1384` 处）按 commitMode 分支：
```ts
if (commitMode === "workspace-with-checkpoint") {
  await commitWorkspaceFilesWithCheckpointForSave(
    currentActiveSaveId,
    workspaceTransaction!.finalWorkspaceFiles(),
    { turn: invokeMaxTurn, checkpointReason: "post-turn-maintenance" },
  )
} else {
  await commitWorkspaceFilesForSave(
    currentActiveSaveId,
    workspaceTransaction!.finalWorkspaceFiles(),
  )
}
emitAgentInvocation({ type: "completed", invocationId, agentId })
```

**注意**：`invokeMaxTurn`（`index.ts:1174`）已在作用域内，直接复用。import `commitWorkspaceFilesWithCheckpointForSave`。

### 4. 类型与 import 收尾

- `saves.ts` 新函数需要 import `pruneCheckpointsForSave`、`buildCheckpointRecordForSave`、`isAppendOnlyLogPath`、`getMaxTurnFromTurnFiles`（部分已在文件内 import，确认）。
- `index.ts` import 新函数。
- 确认 `commitSuccessfulRuntimeTurnForSave` 的 `checkpointReason: "after-turn"` 字面量类型仍兼容扩展后的枚举（应兼容，`"after-turn"` 仍是成员）。

**验证**：`npm run build:web`。

### 5. 构建验证

```bash
npm run build:contracts
npm run build:web
```

两者全通过即满足 PRD 验收的构建要求。

### 6. （可选）端到端验收

若需端到端验证 restore 一致性：
- 临时改 `useSyncAfterTurn.ts:85` `commitMode` 为 `"workspace-with-checkpoint"`。
- 跑一轮：send 正文 → 场记维护 → DebugView 检查 checkpoint 列表。
- 确认同 turn 出现 `post-turn-maintenance`，`after-turn` 已被替换。
- restore 到该 checkpoint，确认 workspace 状态 = 正文 + 维护后 runtime/entity。
- 验收后决定是否保留切换或改回（见 PRD 验收：可留给场记任务 G3 复验）。

## Risky Files & Rollback Points

| 文件 | 风险 | 回滚 |
|---|---|---|
| `storage/db.ts` | 枚举扩展，类型联动 | 删新增枚举成员 |
| `storage/saves.ts` | 新函数，事务逻辑 | 删新函数（旧路径不受影响） |
| `platform-host/index.ts` | 改 invokeAgent 提交分支 | 恢复 throw + 旧 commitWorkspaceFilesForSave 调用 |

**回滚锚点**：新函数是纯新增，旧路径（`workspace` 模式）完全不变。若新路径出问题，前端改回 `commitMode: "workspace"` 即退回旧行为；平台层恢复 throw 即可。

## Review Gates

- [ ] `db.ts` 枚举扩展不破坏现有 reason 赋值（`"initial"`/`"after-turn"`/`"manual"` 仍合法）。
- [ ] `commitWorkspaceFilesWithCheckpointForSave` 事务内删 after-turn 的 filter 条件正确（同 turn + after-turn，不动 manual/initial/其它 turn）。
- [ ] `index.ts` 分支判断用 `commitMode` 字符串，不引入新状态。
- [ ] `completed` 事件在新路径 checkpoint 落盘后发出。
- [ ] `build:contracts` + `build:web` 通过。
