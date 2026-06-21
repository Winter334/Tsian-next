# Implement: Game Card Content Files Per File Table

## Execution Checklist

### Step 1: DB schema + 类型
- [ ] `storage/db.ts`：加 `LocalGameCardContentFileRecord` 类型；`LocalGameCardRecord` 去掉 `contentFiles`；DB 名 bump `tsian-agent-runtime-v6` → `v7`（**确定方案 A**）；schema 加 `gameCardContentFiles: "&id, gameCardId, path, updatedAt"`。
- [ ] **SW DB 名同步**（关键，漏改会让所有 packaged frontend 404）：`public/tsian-game-card-frontend-sw.js:2` 的 `const DB_NAME = "tsian-agent-runtime-v6"` 同步改 `v7`。state-management.md 明确要求 SW DB 名必须与 db.ts 一致。
- [ ] **验证**：`build:web` 通过（db.ts 属 platform-web）；SW 文件 DB_NAME == v7。

### Step 2: per-file API
- [ ] `storage/game-cards.ts`：加 `gameCardContentFileId`/`listLocalGameCardContentFiles`/`readLocalGameCardContentFile`/`writeLocalGameCardContentFile`/`deleteLocalGameCardContentFile`/`deleteLocalGameCardContentPathForCard`。
- [ ] `putLocalGameCard` 改造：`PutLocalGameCardInput.contentFiles` 改**可选**（`undefined` 不动表 / 数组整批删全+逐个 put）。事务表列表加 `gameCardContentFiles`。
- [ ] `cloneLocalGameCardRecord` 去掉 contentFiles。
- [ ] `createBuiltinBlankGameCardRecord` seed 改 putLocalGameCard({contentFiles: createDefaultWorkspaceTemplateFiles()}) 写表。
- [ ] `isCurrentBuiltinBlankGameCard` staleness 检查改**查表比对** `listLocalGameCardContentFiles` + `hasTemplateFile`（保持 reset 保护）。
- [ ] `ensureBuiltinBlankGameCard` reset 路径：staleness 失败时 putLocalGameCard 整批写回模板 content。
- [ ] **验证**：`build:web` 通过（type 层）。

### Step 3: host 写点改造
- [ ] `platform-host/index.ts` `writeCardContentFileForCard` (913) → 调 `writeLocalGameCardContentFile` + `localDb.gameCards.update(id, {updatedAt: now})` bump 卡行。
- [ ] `writeCardContentFileForActiveCard` (954) → 同理。
- [ ] `deleteCardContentPathForCard` (992) → `deleteLocalGameCardContentPathForCard` + bump。
- [ ] `deleteCardContentPathForActiveCard` (1026) → 同理。
- [ ] `updateCardContentFilesForCard` (2114) → **per-file upsert（merge 语义）**：对 `files` 里每个文件调 `writeLocalGameCardContentFile`，未涉及的文件不动。（规划误判为整批替换，实现时查调用方修正——调用方传的是 turn 改动文件，非全卡内容。）
- [ ] **验证**：单文件写不再整卡 put（可加临时 log 确认只 put 一行）。

### Step 4: host 读点 + helper + B/D 类改造
- [ ] `cardContentFilesToWorkspaceFiles` (641) → 查表（async）。**过渡实现**：子3 会经 volume enumerate 重写（合并 content+frontend+manifest），本任务做最小查表即可。
- [ ] `runAssistantChat` 工作区组装 (1807) → 用 async helper。
- [ ] `contentFileCount` (3180) → 查表 length（或缓存）。
- [ ] `copyPlatformGameCardAsLocal` (2235) → 查源卡表 `listLocalGameCardContentFiles(sourceId)` + putLocalGameCard 整批写新卡。
- [ ] `createDefaultPlatformGameCard` (2275) → 同理（copy 已含，确认）。
- [ ] **B 类只改 manifest**：`renameGameCard`(2213)、改前端绑定(2359) → 传 `contentFiles: undefined`。
- [ ] **D 类 cover 拆分**：`stripPlatformGameCardCover`(2420)/clearCover(2428) → `putLocalGameCard(manifest, undefined)` + `deleteLocalGameCardContentFile`；`setPlatformGameCardCover`(2451) → `putLocalGameCard(manifest, undefined)` + 删旧 cover 行 + `writeLocalGameCardContentFile` 写新 cover。
- [ ] `stripExistingCoverFiles`(2462) 从"数组 filter"改为"查表 filter" `listLocalGameCardContentFiles`。
- [ ] **验证**：`build:web` 通过。

### Step 5: cover 预加载（LocalGameCardView 视图类型）
- [ ] `storage/db.ts`/`game-cards.ts`：加 `LocalGameCardView extends LocalGameCardRecord { coverContentFile?: { path, content, mediaType } }`。
- [ ] `getLocalGameCard`/`listLocalGameCards` 返回 `LocalGameCardView`：clone 后若 `manifest.cover.workspacePath` 存在，查 `readLocalGameCardContentFile` 注入 `coverContentFile`。
- [ ] `lib/game-card-display.ts:59` `getGameCardCoverUrl` → 读 `card.coverContentFile`（保持 sync，template/computed 调用不变）。
- [ ] **验证**：库列表封面 + 详情页封面正常显示（sync 路径无回归）。

### Step 6: import/export 改造
- [ ] `game-card-packages.ts` export (628-630) → `listLocalGameCardContentFiles` 查表打包。
- [ ] import (543-588/609) → putLocalGameCard 整批写表（contentFiles 传数组走整批分支）。
- [ ] **B 类** `importGameCardFrontendPackage` (889) → 传 `contentFiles: undefined`（只改前端绑定）。
- [ ] cover export/import (444-505, 590-605) → 查表/写表。
- [ ] **验证**：导出包含 `workspace/*`；导入恢复 content。

### Step 7: workspace.ts 读点
- [ ] `storage/workspace.ts:1365` `listEffectiveWorkspaceFilesForSave` → 查表（async）。
- [ ] **验证**：`build:web` 通过。

### Step 8: build + 冲烟
- [ ] `npm run build:contracts && build:runtime-core && build:web` 三绿。
- [ ] dev 冲烟（DB v7 重置后）：库创建卡 → 详情见内容文件 → Explorer 列文件 → 编辑单文件 → /play → cover 上传/删除 → 导出包含 content → 导入恢复 → 助手 workspace_read/write card-content → rename 卡 → 改前端绑定。
- [ ] 确认时间戳：per-file 真实 createdAt/updatedAt（不再借卡行）。
- [ ] **验证**：现有功能全不回归。

### Step 9: 收口
- [ ] spec 更新（state-management：contentFiles per-file 表 + DB v7 + 单文件写语义；type-safety：per-file 记录类型 + LocalGameCardView）。
- [ ] commit（用户确认后）。
- [ ] 移交子5（contentFiles 已 per-file，子5 ContentVolume 实现就绪）。

## Validation Commands

```bash
npm run build:contracts
npm run build:runtime-core
npm run build:web
npm run dev:web   # 冲烟（DB v7 重置）
```

## Rollback Points

- Step 1 后：DB 名回 v6 + 还原类型。
- Step 2-7 后：git checkout storage 层 + platform-host + game-card-display。
- 方案 A 无数据回滚（重 seed）。

## Review Gates

- Step 2 后 review per-file API 正确性 + putLocalGameCard 可选 contentFiles 语义（undefined 不动表 / 数组整批）。
- Step 3 后 review 单文件写确实只 put 一行（无整卡重写）+ bump updatedAt。
- Step 5 后 review cover 预加载不破坏 sync 渲染路径。
- Step 8 三绿 + 冲烟全过是硬 gate。
