# .tsian 分层重构：理清 per-save/platform 级 + 清空壳 + 删卡级联

## Goal

理清 `.tsian/` 的分层语义，消除"空壳目录假装数据在文件里"的误导，规范化 per-save 文件 vs platform 级数据的边界，并修复删卡不级联清理 save 数据的 orphan-leak。

不做 AppData 按卡分目录——per-save Dexie 表数据（checkpoint 元数据、embedding 索引）保持按 saveId 组织，引入卡维度是过度设计（牺牲 Dexie 索引查询效率换可视化分组，得不偿失）。data-fileification 原则只适用于 agent 需读写/可见的内容（叙事/世界状态/配置），不适用于平台内部高频索引数据。

## Confirmed Facts（代码调研确认）

### `.tsian/` 现状分层（三种语义混在一起）
- **per-save 文件**（traces）：`.tsian/traces/turns/*.jsonl`，`formatRuntimeTracePath`（`trace.ts:155`），经 `stageRuntimeTraceFile` 进 save 事务（`index.ts:435,935`）。作为 workspaceFiles 存在，**进 checkpoint，随回溯回滚**。
- **per-save Dexie 表**（checkpoints/indexes）：数据在 `localDb.checkpoints`（按 saveId）和 `localDb.embeddingIndex`（按 `[scope+ownerId]`=`(save-runtime, saveId)`）。`.tsian/checkpoints/`、`.tsian/indexes/` 目录**只有 README 占位，是空壳**，README 声称"preserved with save snapshots"但数据实际在 DB——文档撒谎。
- **per-save 空壳**：`.tsian/cache/` 只有 README，无任何写入路径，纯空壳。
- **platform 级**：`.tsian/local/assistant/`，Dexie `meta` 表单 KV（`local-assistant-files.ts`），`isSaveRuntimePersistencePath` 显式排除 `.tsian/local/`（`workspace-paths.ts:54-55`），不进 checkpoint。
- **两套 trace**：master/save trace = `.tsian/traces/`（per-save，进 checkpoint）；assistant trace = `.tsian/local/assistant/traces/`（platform 级，不进 checkpoint，`assistantTracePath`）。
- `.tsian/` 对普通 agent 隐藏（`isPlatformMetadataPath`，`workspace-paths.ts:42`）；`.tsian/local/` 特判排除出 checkpoint 是 ad-hoc 硬编码，非按子目录语义。

### 数据生命周期（删存档 vs 删卡）
- `deleteLocalSave(saveId)`（`saves.ts:236-248`）**完整级联**：删 saves + `deleteWorkspaceForSave`（含 traces，workspaceFiles 表）+ `deleteCheckpointsForSave` + `deleteBlobsForSave` + embeddingIndex 按 saveId 删。**删存档干净**。
- `deleteLocalGameCard(cardId)`（`game-cards.ts:412-440`）**不级联**：只删 gameCards + gameCardContentFiles + gameCardFrontendFiles。**不删该卡的 saves/workspaceFiles/checkpoints/blobs/embeddingIndex**——全成孤儿。删卡不移除 save 数据，是 orphan-leak。
- save 绑 `gameCardId`（`db.ts:16`），切卡不删旧卡 save（数据持久，和"当前激活卡"无关）。

### 空壳目录不该 fileify
- checkpoint 元数据：已是 thin manifest + blob 引用，是结构化索引数据，fileify 丢 Dexie 按 saveId 查询/删除/GC 能力。
- embedding 索引：高频查询（每次 RAG 搜都查 `[scope+ownerId]` 索引），fileify 成文件 + 目录扫描严重拖性能。
- cache：无数据，直接删。

## Decisions（已与用户确认）

1. **模型：按生命周期分顶层目录**（不做 AppData 按卡分目录）。
   - `.tsian/save/` = per-save 文件（进 checkpoint，随回溯回滚）。
   - `.tsian/local/` = platform 级（不进 checkpoint，Dexie meta KV）。
   - traces 从 `.tsian/traces/` 挪到 `.tsian/save/traces/`（语义=per-save，保留对 agent 隐藏）。
   - `.tsian/local/` 特判规范化为"`.tsian/local/` 前缀统一不进 checkpoint"规则。
2. **删空壳目录**：`.tsian/checkpoints/`、`.tsian/indexes/`、`.tsian/cache/` 的 README + 模板条目删除。数据在 Dexie 表不在文件，不 fileify、不假装。
3. **删卡级联清理**：`deleteLocalGameCard` 级联删该卡的所有 save（经 `deleteLocalSave` 清掉 save 全部数据：workspace/checkpoint/blob/embedding），消除 orphan-leak。
4. **不引入卡维度**：per-save Dexie 数据保持按 saveId 组织。
5. **spec 记真实语义**：在 storage spec 记录"checkpoint 元数据/embedding 索引在 Dexie 表不在 `.tsian/` 文件系统"，避免未来再被空壳误导。

## Requirements

- traces 路径迁移：`formatRuntimeTracePath`（`trace.ts:152-155`）前缀 `.tsian/traces/` → `.tsian/save/traces/`；`assistantTracePath`（`local-assistant-files.ts:1561`）不动（已在 `.tsian/local/`）。stage/write 路径（`index.ts:422-435,935-974`）跟随。
- workspace 模板（`workspace-templates.ts`）：per-save 模板（`DEFAULT_SAVE_RUNTIME_FILES` `:1396-1431`）的 `.tsian/traces/` README 改路径到 `.tsian/save/traces/`；删 `.tsian/checkpoints/`、`.tsian/indexes/`、`.tsian/cache/` 的 README 条目。game-card 模板（`DEFAULT_WORKSPACE_FILES` `:1216-1269`）的对应空壳同样删。
- `isSaveRuntimePersistencePath`（`workspace-paths.ts:50-58`）：`.tsian/local/` 排除规则保留并规范化（注释明确"local 前缀 = platform 级不进 checkpoint"）；`.tsian/save/` 放行进 checkpoint（替代旧 `.tsian/traces/` 放行）。
- `deleteLocalGameCard`（`game-cards.ts:412-440`）：级联删该卡所有 save——`listLocalSaves` 按 gameCardId 过滤 → 逐个 `deleteLocalSave`（复用现有完整清理链）。
- 旧存档（traces 在 `.tsian/traces/`）的兼容：prototype 破坏性，不迁移——旧 save 的 trace 文件路径变了，旧 trace 读不到但新 trace 正常（接受，无用户数据）。

## Acceptance Criteria

- [ ] 新存档的 trace 文件在 `.tsian/save/traces/turns/*.jsonl`；回溯到第 N 回时 trace 随 checkpoint 回滚（turn > N 的 trace 被裁）。
- [ ] `.tsian/checkpoints/`、`.tsian/indexes/`、`.tsian/cache/` 目录不再存在于 workspace 模板；workspace_list `.tsian/` 看不到这三个空壳。
- [ ] `.tsian/local/` 下内容不进 checkpoint（回溯不回滚 local 数据）；`.tsian/save/` 下内容进 checkpoint。
- [ ] 删卡（`deleteLocalGameCard`）后，该卡的 saves + workspaceFiles + checkpoints + blobs + embeddingIndex 全部清除（无 orphan）；删卡前后 Dexie 表行数验证。
- [ ] 助手 trace（`.tsian/local/assistant/traces/`）不受影响（仍在 local，不进 checkpoint）。
- [ ] vue-tsc + vite build 通过。
- [ ] storage spec 更新：记录 `.tsian/` 真实分层语义 + checkpoint/embedding 数据在 Dexie 表不在文件。

## Out of Scope

- AppData 按卡分目录（per-save Dexie 数据不引入卡维度）。
- checkpoint 元数据 / embedding 索引 fileify（保持 Dexie 表）。
- 旧存档 trace 路径迁移（破坏性，旧 trace 读不到）。
- platform-config（后续任务 `06-27-platform-config`，本任务只理清 `.tsian/local/` 供其使用）。
- 云同步。

## Open Questions

- 无。模型（按生命周期分顶层）、空壳处理（删）、删卡级联（纳入）、卡维度（不引入）均已定。
