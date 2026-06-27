# Design — .tsian 分层重构

## 目标分层模型

```
.tsian/
  README.md            (platform 级说明：解释 .tsian/ 结构)
  manifest.json        (per-save 清单，进 checkpoint)
  save/                (per-save 文件，进 checkpoint，随回溯回滚)
    traces/turns/*.jsonl   (从 .tsian/traces/ 挪来)
  local/               (platform 级，不进 checkpoint，Dexie meta KV)
    assistant/...          (现有，不动)
    platform-config.json   (未来，platform-config 任务)
  # checkpoints/ indexes/ cache/ 删除——数据在 Dexie 表
```

## 改动面

### 1. traces 路径迁移（`.tsian/traces/` → `.tsian/save/traces/`）
- `trace.ts:155` `formatRuntimeTracePath`：前缀 `.tsian/traces/turns/` → `.tsian/save/traces/turns/`。
- 调用点（`index.ts:937,974`）自动跟随（引函数，不改）。
- workspace-templates 3 处 README 路径（`:1233,1266,1412`）：`.tsian/traces/README.md` → `.tsian/save/traces/README.md`。
- `assistantTracePath`（`local-assistant-files.ts:1561`，`.tsian/local/assistant/traces/`）**不动**——已在 local 层。
- 旧存档 trace 在旧路径，破坏性不迁移——新 turn 写新路径，旧 trace 读不到（接受）。

### 2. 删空壳目录
- workspace-templates：删 `.tsian/checkpoints/README.md`、`.tsian/indexes/README.md`、`.tsian/cache/README.md` 条目（game-card 模板 `:1216-1269` + save 模板 `:1396-1431` 两处）。
- 这些目录背后的数据（checkpoint 元数据、embedding 索引）在 Dexie 表，不受文件层删除影响。

### 3. workspace 路由规则规范化
- `isSaveRuntimePersistencePath`（`workspace-paths.ts:50-58`）：保留 `.tsian/local/` 排除（注释明确"local 前缀 = platform 级不进 checkpoint"）。`.tsian/save/` 自动放行（它不是 local，按现有 `.tsian/` 放行规则进 checkpoint）。无需新增特判——`.tsian/save/` 满足"`.tsian/` 但非 `.tsian/local/`"即进 checkpoint。
- `isPlatformMetadataPath`（`:42`）：`.tsian/` 整体对 agent 隐藏，不变。

### 4. 删卡级联清理
- `deleteLocalGameCard`（`game-cards.ts:412-440`）：事务前先 `listLocalSaves` 按 `gameCardId` 过滤 → 逐个 `await deleteLocalSave(save.id)`（复用完整清理链：saves/workspaceFiles/checkpoints/blobs/embeddingIndex）。
- 顺序：先删该卡所有 save（级联清 save 数据）→ 再删 gameCards + gameCardContentFiles + gameCardFrontendFiles。
- 注意 `deleteLocalSave` 是 async 且自身有事务，不能嵌套进 `deleteLocalGameCard` 的事务——在 `deleteLocalGameCard` 事务**外**先循环删 save，再开事务删卡数据。

## 契约兼容

- 无 contracts/bridge 改动——traces 路径是平台内部，不暴露给前端。
- 前端 checkpoint UI 零改动。

## 风险点

- **旧存档 trace 读不到**：破坏性，prototype 接受。新存档正常。
- **删卡级联事务边界**：`deleteLocalSave` 自带事务，不能嵌套进 `deleteLocalGameCard` 事务。先循环删 save（各自事务）→ 再删卡（单独事务）。若中途失败，可能 save 删了卡还在——但 `deleteLocalGameCard` 是用户显式删卡操作，失败可重试，且 save 已删不算数据丢失（用户本就要删卡）。
- **`isSaveRuntimePersistencePath` 无需新增特判**：`.tsian/save/` 天然满足"`.tsian/` 非 `.tsian/local/`"→ 进 checkpoint。但需确认现有逻辑确实是"排除 local，其余 .tsian/ 进"而非白名单。

## 风险文件

- `agent-runtime/trace.ts:155` — trace 路径前缀。
- `storage/workspace-templates.ts:1216-1269,1396-1431` — 模板删空壳 + 改 trace 路径。
- `storage/workspace-paths.ts:50-58` — 注释规范化（逻辑可能无需改）。
- `storage/game-cards.ts:412-440` — 删卡级联。
- `.trellis/spec/platform-web/storage/index.md` — spec 记真实分层语义。
