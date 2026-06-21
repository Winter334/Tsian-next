# Game Card Content Files Per File Table

## Parent

- `.trellis/tasks/06-20-content-generation-foundation`

## Goal

把 `gameCards.contentFiles`（内嵌在 `LocalGameCardRecord` 行里的 `GameCardContentFile[]` 字符串数组）迁移到独立的 per-file Dexie 表 `gameCardContentFiles`。消除"改一个文件 = 整卡 `putLocalGameCard` 重写全部 contentFiles"的整卡重写模式，改为 per-file 行级读写。这是存储形态重构，不改运行时层、不改用户可见行为。

## Background

当前 `writeCardContentFileForCard`（`platform-host:913-952`）改单文件时，把 `card.contentFiles` 整个数组 filter+concat 重建，再 `putLocalGameCard` → `localDb.gameCards.put(record)`（`game-cards.ts:358`）把整行（含全部 contentFiles）写回。问题：
- **性能**：单文件改重写全卡 content。当前量级（~26 文件、~30-40KB）无感；长期内容增长到 MB 级会显现延迟。save 数据已独立 per-file 存储（`workspaceFiles` 表），不受影响，故主要是"内容创作"路径。
- **并发语义**：`writeCardContentFileForCard` 是 read-then-write 非原子（921 行 getLocalGameCard → 939 行 putLocalGameCard，中间无锁）。UI 与助手并发编辑同一卡时，后写者基于旧快照重建数组，覆盖先写者的单文件改动（last-write-wins 丢失）。per-file 行级 put 天然缓解。

项目未上线、无实际用户，接受破坏性变更。

## Requirements

### 新增 `gameCardContentFiles` 表

- Dexie 新表 `gameCardContentFiles`：`&id, gameCardId, path, updatedAt`（id = `${gameCardId}::${path}`，同 `gameCardFrontendFiles` 的 keying 模式，`game-cards.ts:154-156`）。
- 记录形状 `LocalGameCardContentFileRecord`：`{ id, gameCardId, path, content: string, mediaType?, createdAt, updatedAt }`。content 是 string（与现有 `GameCardContentFile` 一致，非 Blob）。
- `LocalGameCardRecord` 去掉 `contentFiles` 字段（`db.ts:26`）。

### 数据迁移

- **DB schema 策略**：现有是单 version(1) + DB 名 `tsian-agent-runtime-v6`，无 upgrade 链（注释 "Prototype reset: no migration"）。
- **确定方案 A**：DB 名 bump 到 `tsian-agent-runtime-v7` + version(1) 重新 seed。开发环境数据丢失（仅测试卡，可接受），无 upgrade 代码，符合现有 "Prototype reset" 惯例。
- 不采用方案 B（保持 DB 名 + version(2).upgrade）：会引入项目首个 upgrade 函数，破坏现有无迁移惯例，pre-release 阶段开发数据价值不足以抵消维护面。

### 读写点改造（约 30 处，6 文件）

把所有 `card.contentFiles`（读数组）→ `listLocalGameCardContentFiles(cardId)`（查表）；写点按 `putLocalGameCard` 的调用形态分四类处理：

- **A 整批替换**（import/copy/seed/cover 新增）：`putLocalGameCard({contentFiles: 数组})` 保持传数组，事务内删该卡所有 content 行 + 逐个 put（`packages:609`、`host:2235/2275` copy、`host:2451` setCover 新增）。
- **B 只改 manifest**（content 原样传回）：`PutLocalGameCardInput.contentFiles` 从必填改**可选**，传 `undefined` = 不动 content 表（只改 manifest 行）。此类调用点 `host:2213`(renameGameCard)、`host:2359`(改前端绑定)、`packages:889`(importGameCardFrontendPackage) 现在传 `contentFiles: card.contentFiles` 原样回写——per-file 化后 `card.contentFiles` 已不存在，改传 `contentFiles: undefined`。
- **C 单文件写/删**：不经 `putLocalGameCard`，直接调 per-file API（`host:939/977` 写、`host:1014/1047` 删、`host:2133` 助手 commit 整批）。
- **D cover 删/换**（同时改 manifest cover + 删/加 cover content）：拆成 `putLocalGameCard(manifest, contentFiles: undefined)` 改 manifest + `deleteLocalGameCardContentFile`/`writeLocalGameCardContentFile` 操作 cover 行（`host:2420/2428` 删旧 cover、`host:2451` 换 cover）。`stripExistingCoverFiles` 从"数组 filter"改为"查表 filter"。

涉及文件：
- `storage/game-cards.ts`：`putLocalGameCard`（contentFiles 入参改可选：undefined 不动表 / 数组整批替换）、`cloneLocalGameCardRecord`（去掉 contentFiles）、`createBuiltinBlankGameCardRecord`（seed 改写表）、`isCurrentBuiltinBlankGameCard`（staleness 检查改**查表比对** `listLocalGameCardContentFiles` + `hasTemplateFile`，保持现有 reset 保护语义）、`ensureBuiltinBlankGameCard`（431，seed 落库改 `putLocalGameCard({contentFiles: createDefaultWorkspaceTemplateFiles()})` 写表）、新 `listLocalGameCardContentFiles`/`readLocalGameCardContentFile`/`writeLocalGameCardContentFile`/`deleteLocalGameCardContentFile`/`deleteLocalGameCardContentPathForCard`。
- `storage/game-card-packages.ts`：export(628) 查表打包；import(543-588/609) 写表（contentFiles 整批）；`importGameCardFrontendPackage`(812-897) 只改前端绑定 → 传 `contentFiles: undefined`；cover export/import(444-505) 查表/写表。
- `storage/workspace.ts`：`listEffectiveWorkspaceFilesForSave`（card.contentFiles → 查表）。
- `platform-host/index.ts`：`writeCardContentFileForCard`(913)/`writeCardContentFileForActiveCard`(954)/`deleteCardContentPathForCard`(992)/`deleteCardContentPathForActiveCard`(1026) → per-file API；`cardContentFilesToWorkspaceFiles`(641)/`contentFileCount`(3180)/`runAssistantChat`(1807) → 查表；`updateCardContentFilesForCard`(2114) → 整批替换；`renameGameCard`(2213)/改前端绑定(2359)/`importGameCardFrontendPackage` 对应点 → 传 `contentFiles: undefined`；cover 操作(2420/2428/2451) → 拆 manifest + per-file；`copyPlatformGameCardAsLocal`(2235)/`createDefaultPlatformGameCard`(2275) → 查源卡表整批写新卡。
- `lib/game-card-display.ts`：cover 查 contentFile 改查表。
- `storage/db.ts`：schema + 类型。

### 保持不变

- 运行时层（agent-runtime）不改——它操作 `WorkspaceFile[]` 抽象，与存储形态无关。
- `gameCardFrontendFiles` 表不动（那是子3 范围）。
- `workspaceFiles`（save-runtime）表不动。
- 工作区 scope 系统、路由点不动（那是子5 范围）。
- 导出/导入包格式（`game-card.json` + `workspace/*`）不变——只是 import/export 时读写从数组改 per-file 表。

## Acceptance Criteria

- [ ] `gameCardContentFiles` 表存在，keyed `${cardId}::${path}`，content 为 string。
- [ ] `LocalGameCardRecord` 不再含 `contentFiles` 字段。
- [ ] 单文件写不再触发整卡 put（`writeLocalGameCardContentFile` 只 put 一行）。
- [ ] 删除文件只删一行（不重写整卡）。
- [ ] builtin 卡内容正确 seed 到新表。
- [ ] 创建/复制卡时 content 写入新表（`createDefaultPlatformGameCard`/`copyPlatformGameCardAsLocal`）。
- [ ] 导出包仍含 `workspace/*` 文件（per-file 查表打包）；导入包仍能恢复 content（写表）。
- [ ] cover 查找（`.cover/cover.<ext>`）改查新表，封面显示正常。
- [ ] 工作区 Explorer 列卡内容文件正常（per-file 查表）。
- [ ] 助手 `workspace_read`/`workspace_write` card-content 正常（经 host 路由，底层已改表）。
- [ ] `npm run build:web` 通过。
- [ ] dev server 冲烟：现有功能不回归（库/详情/前端/play/助手/cover/导出导入）。

## Constraints

- 不改运行时层（agent-runtime）、不改 scope 系统、不碰路由点（子5 范围）。
- 不改 `gameCardFrontendFiles`（子3 范围）。
- 不改导出/导入包格式（只改底层存储）。
- content 仍是 string（非 Blob）；mediaType 存表里。
- timestamp：per-file 表有真实 createdAt/updatedAt（解决现有 card-content 借卡行时间戳的妥协）。
- **单文件写后 bump 卡 `updatedAt`**（`localDb.gameCards.update(id, {updatedAt: now})`）：保持现有"卡 updatedAt 反映最近任何变更"的隐式约定，多一次轻量写可忽略。
- **助手 commit 路径 `updateCardContentFilesForCard` 用整批替换**（删全 + 重写）：commit 本就是批量操作，per-file diff 复杂度不值。
- **`putLocalGameCard` contentFiles 入参可选语义**：`undefined` = 不动 content 表（只改 manifest）；传数组 = 事务内整批替换（删全 + 逐个 put）。所有"只改 manifest"的调用点改传 `undefined`。

## Out Of Scope

- volume 抽象 / 路由收敛（子5）。
- 全数据文件化 / card-frontend / manifest 文件化（子3）。
- 二进制 content 支持（仍是 text-only）。
- 真实 LLM 往返验证（需 provider + key）。

## Dependencies

- 是子5 的强前置：子5 的 `CardContentVolume` 实现取决于 contentFiles 存储形态。子4 先把存储改成 per-file 表，子5 在干净存储上包 volume。
- 子1（已完成）的 `createDefaultPlatformGameCard`/`defaultFrontendFiles` 是子4 改造的测试对象（创建卡时 content 写表）。
- 执行顺序：子1（完成）→ **子4** → 子5 → 子3 → 子2。
