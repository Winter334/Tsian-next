# Implement — .tsian 分层重构

## 执行顺序

T1（traces 迁移）→ T2（删空壳）→ T3（路由注释）→ T4（删卡级联）→ T5（spec）→ T6（验证）。每块独立。

### T1：traces 路径迁移

- [ ] T1.1. `agent-runtime/trace.ts:155` `formatRuntimeTracePath`：前缀 `.tsian/traces/turns/` → `.tsian/save/traces/turns/`。
- [ ] T1.2. `storage/workspace-templates.ts` 3 处 trace README 路径（`:1233,1266,1412`）：`.tsian/traces/README.md` → `.tsian/save/traces/README.md`。
- [ ] T1.3. `assistantTracePath`（`local-assistant-files.ts:1561`）不动——确认仍 `.tsian/local/assistant/traces/`。

### T2：删空壳目录

- [ ] T2.1. `storage/workspace-templates.ts` game-card 模板（`:1216-1269`）：删 `.tsian/checkpoints/README.md`、`.tsian/indexes/README.md`、`.tsian/cache/README.md` 条目。
- [ ] T2.2. `storage/workspace-templates.ts` save 模板（`:1396-1431`）：删同样三个空壳条目。
- [ ] T2.3. 确认无其他代码引用这三个空壳路径（grep `.tsian/checkpoints\|.tsian/indexes\|.tsian/cache` 排除模板/README）。

### T3：workspace 路由注释规范化

- [ ] T3.1. `storage/workspace-paths.ts:54-57`：注释更新——明确"`.tsian/local/` 前缀 = platform 级不进 checkpoint；其余 `.tsian/`（含 `.tsian/save/`）= per-save 进 checkpoint"。逻辑无需改（已是排除 local 其余进）。

### T4：删卡级联清理

- [ ] T4.1. `storage/game-cards.ts:412-440` `deleteLocalGameCard`：事务外先 `listLocalSaves` → 按 `existing.gameCardId` 过滤该卡 save → 逐个 `await deleteLocalSave(save.id)`（复用完整清理链）。再开原事务删 gameCards + gameCardContentFiles + gameCardFrontendFiles。
- [ ] T4.2. 确认 `LocalSaveRecord.gameCardId`（`db.ts:16`）可用于过滤；`listLocalSaves`（`saves.ts:37`）返回全量再过滤，或加 `listLocalSavesByCard(cardId)` helper。

### T5：spec 更新

- [ ] T5.1. `.trellis/spec/platform-web/storage/index.md`：更新 `.tsian/` 分层语义——`.tsian/save/`（per-save 文件，进 checkpoint）、`.tsian/local/`（platform 级，不进）、checkpoint 元数据/embedding 索引在 Dexie 表不在文件、删卡级联清理 save。

### T6：验证

- [ ] T6.1. 新存档玩回合 → trace 在 `.tsian/save/traces/turns/`；回溯第 N 回 → turn > N 的 trace 被裁。
- [ ] T6.2. `workspace_list .tsian/`（助手视角）无 checkpoints/indexes/cache 空壳。
- [ ] T6.3. 删卡 → 该卡 saves + checkpoints + blobs + embeddingIndex 全清（Dexie 行数验证，无 orphan）。
- [ ] T6.4. 助手 trace（`.tsian/local/assistant/traces/`）不受影响。
- [ ] T6.5. vue-tsc + vite build 通过。

## Validation Commands

```bash
npx vue-tsc -b
npx vite build apps/platform-web
# 运行时验证（手动）：
# 1. 新存档玩回合 → 调试查 workspaceFiles，trace path 含 .tsian/save/traces/
# 2. 删一张有存档的卡 → 查 localDb.saves/checkpoints/workspaceFiles/blobs/embeddingIndex 无该卡残留
```

## 风险点与回滚

- **旧存档 trace 读不到**：破坏性，prototype 接受。回滚 = git revert T1。
- **删卡级联事务边界**：`deleteLocalSave` 自带事务不能嵌套——先循环删 save（事务外）再删卡（事务内）。中途失败：save 删了卡还在，可重试删卡。
- **空壳删除无数据丢失**：空壳只有 README，背后数据在 Dexie 表不受影响。

## Follow-up before task.py start

- 无。模型、空壳处理、删卡级联、traces 迁移均已定。
