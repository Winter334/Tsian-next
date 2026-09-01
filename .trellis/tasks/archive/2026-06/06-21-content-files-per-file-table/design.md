# Design: Game Card Content Files Per File Table

## Boundaries

纯 storage 层重构。改 `db.ts`（schema+类型）+ `game-cards.ts`（读写 API）+ 4 个消费文件的读写点（`game-card-packages.ts`/`workspace.ts`/`platform-host/index.ts`/`lib/game-card-display.ts`）。不碰 agent-runtime、scope、路由点。

## New Table Schema

`storage/db.ts`：

```ts
// 新记录类型
interface LocalGameCardContentFileRecord {
  id: string          // = `${gameCardId}::${path}`
  gameCardId: string
  path: string
  content: string
  mediaType?: string
  createdAt: number
  updatedAt: number
}

// LocalGameCardRecord 去掉 contentFiles 字段
interface LocalGameCardRecord {
  id: string
  manifest: GameCardManifest
  source: "builtin" | "local" | "imported"
  createdAt: number
  updatedAt: number
}
```

DB schema（**确定方案 A — DB 名 bump**）：

```ts
super("tsian-agent-runtime-v7")   // v6 → v7
this.version(1).stores({
  meta: "&key",
  gameCards: "&id, source, updatedAt",
  gameCardContentFiles: "&id, gameCardId, path, updatedAt",   // 新
  gameCardFrontendFiles: "&id, gameCardId, path, updatedAt",
  saves: "&id, updatedAt",
  saveSnapshots: "&saveId",
  saveHistory: "&saveId",
  checkpoints: "&id, saveId, createdAt, turn",
  workspaceFiles: "&id, saveId, path, updatedAt",
})
```

DB 名 bump 导致旧 v6 DB 孤立（开发数据丢弃）。`ensureBuiltinBlankGameCard` 重新 seed builtin；用户需重新创建测试卡（可接受，pre-release）。

不采用方案 B（保持 v6 + version(2).upgrade）：pre-release 阶段开发数据价值不足以抵消引入首个 upgrade 函数的维护面，且破坏现有 "Prototype reset: no migration" 惯例。

## New Per-File API (`storage/game-cards.ts`)

```ts
export const gameCardContentFileId = (gameCardId: string, path: string) =>
  `${gameCardId}::${path}`

export async function listLocalGameCardContentFiles(gameCardId: string): Promise<LocalGameCardContentFileRecord[]>
  // localDb.gameCardContentFiles.where("gameCardId").equals(gameCardId).toArray() → sort by path

export async function readLocalGameCardContentFile(gameCardId: string, path: string): Promise<LocalGameCardContentFileRecord | undefined>
  // localDb.gameCardContentFiles.get(gameCardContentFileId(gameCardId, path))

export async function writeLocalGameCardContentFile(gameCardId: string, input: { path, content, mediaType? }): Promise<LocalGameCardContentFileRecord>
  // existing = get(id); record = { id, gameCardId, path, content, mediaType, createdAt: existing?.createdAt ?? now, updatedAt: now }
  // localDb.gameCardContentFiles.put(record); return record
  // 注意：不再更新 gameCards.updatedAt（或单独更新，见下）

export async function deleteLocalGameCardContentFile(gameCardId: string, path: string): Promise<void>
  // localDb.gameCardContentFiles.delete(id)

export async function deleteLocalGameCardContentPathForCard(gameCardId: string, pathPrefix: string): Promise<string[]>
  // where("gameCardId").equals + filter path.startsWith(prefix) → delete each → return deleted paths
```

### `putLocalGameCard` 改造

`putLocalGameCard` 现在接收 `contentFiles: GameCardContentFile[]`（必填，`game-cards.ts:23`）。改造为**可选**：
- **`contentFiles: undefined`** = 不动 content 表（只改 manifest 行）。覆盖所有"只改 manifest"的调用点：`renameGameCard`(host:2213)、改前端绑定(host:2359)、`importGameCardFrontendPackage`(packages:889)。这些调用点现状传 `contentFiles: card.contentFiles` 原样回写——per-file 化后 `card.contentFiles` 已不存在，改传 `undefined`。
- **`contentFiles: 数组`** = 事务内整批替换（删该卡所有 content 行 + 逐个 put）。用于 import/copy/seed/cover 新增：`packages:609`、`host:2235/2275`(copy)、`host:2451`(setCover 新增)。
- **单文件写不经过 putLocalGameCard**：`writeCardContentFileForCard`（host）直接调 `writeLocalGameCardContentFile`，不调 `putLocalGameCard`（消除整卡重写）。

```ts
export async function putLocalGameCard(input): Promise<LocalGameCardRecord> {
  const manifest = normalizeManifest(input.manifest)
  const existing = await localDb.gameCards.get(manifest.id)
  const record: LocalGameCardRecord = { id, manifest, source, createdAt, updatedAt: now }  // 无 contentFiles
  await localDb.transaction("rw", [gameCards, gameCardContentFiles, gameCardFrontendFiles], async () => {
    await localDb.gameCards.put(record)
    if (input.contentFiles) {   // 整批替换（import/copy/seed）；undefined = 不动表
      await localDb.gameCardContentFiles.where("gameCardId").equals(manifest.id).delete()
      for (const f of normalizeTemplateFiles(input.contentFiles)) {
        await localDb.gameCardContentFiles.put({ id: gameCardContentFileId(manifest.id, f.path), gameCardId: manifest.id, path: f.path, content: f.content, mediaType: f.mediaType, createdAt: now, updatedAt: now })
      }
    }
    if (frontendFileRecords) { ... 现有不变 ... }
  })
  return record
}
```

### `gameCards.updatedAt` 语义

**确定：单文件写后单独 bump 卡 `updatedAt`**（`localDb.gameCards.update(id, {updatedAt: Date.now()})`）。保持现有"卡 updatedAt 反映最近任何变更"的隐式约定，多一次轻量写可忽略。单文件写不再经 `putLocalGameCard`（后者本会设 updatedAt），故需显式 bump。

## Write-Site Changes (platform-host/index.ts)

### `writeCardContentFileForCard` (913-952) → per-file

```ts
async function writeCardContentFileForCard(cardId, input): Promise<WorkspaceFile> {
  const record = await writeLocalGameCardContentFile(cardId, input)
  await localDb.gameCards.update(cardId, { updatedAt: Date.now() })  // bump 卡行（可选）
  return { path: record.path, content: record.content, mediaType: record.mediaType ?? "text/plain", createdAt: record.createdAt, updatedAt: record.updatedAt }
}
```

不再 `getLocalGameCard` + 重建数组 + `putLocalGameCard`。单行 put。

### `writeCardContentFileForActiveCard` (954-990) → 同理调 `writeLocalGameCardContentFile` + bump。

### `deleteCardContentPathForCard` (992-1024) → `deleteLocalGameCardContentPathForCard` + bump。

### `cardContentFilesToWorkspaceFiles` (641-651) → 查表

```ts
async function cardContentFilesToWorkspaceFiles(card: LocalGameCardRecord): Promise<WorkspaceFile[]> {
  const files = await listLocalGameCardContentFiles(card.id)
  return files.map(f => ({ path: f.path, content: f.content, mediaType: f.mediaType ?? inferMediaType(f.path), createdAt: f.createdAt, updatedAt: f.updatedAt }))
}
```

注意：现有从 card 借时间戳（`createdAt: card.createdAt`）→ 现在用 per-file 真实时间戳。**这是行为微调**（时间戳更准确），需冲烟确认无依赖卡行时间戳的逻辑。

### `updateCardContentFilesForCard` (2114-2138, 批量同步)

助手 commit 路径用。**实现修正：保持 merge 语义**（per-file upsert，非整批替换）。

> 规划时判断为"整批替换"，实现时查调用方发现错误：调用方传的 `files` 是"助手这次 turn 涉及的改动文件"（`nonLocalFiles.filter(...)`），不是全卡内容。整批替换会把助手没碰的文件全删掉——破坏性语义。故改为 per-file upsert：对 `files` 里每个文件调 `writeLocalGameCardContentFile`（per-file upsert，内部 bump 卡 updatedAt），未涉及的文件不动。这与现状的 merge 行为等价，只是底层从"读数组+合并+整卡 put"变成"per-file upsert"。

### cover 操作 (2420-2451) — D 类拆分

cover 存在 `.cover/cover.<ext>` contentFile。cover 操作同时改 manifest.cover 和 cover content 文件，per-file 化后拆成两步：
- **删旧 cover**（`host:2420/2428`，`stripPlatformGameCardCover`/clearCover）：`putLocalGameCard({manifest: {..., cover: ...}, contentFiles: undefined})` 改 manifest + `deleteLocalGameCardContentFile(cardId, coverPath)` 删 cover 行。现状 `stripExistingCoverFiles(card.contentFiles, cover)` 从数组 filter 改为**查表** `listLocalGameCardContentFiles` filter。
- **换 cover**（`host:2451`，`setPlatformGameCardCover` 新增）：`putLocalGameCard({manifest: {..., cover: nextCover}, contentFiles: undefined})` 改 manifest + 先 `deleteLocalGameCardContentFile` 删旧 cover 行 + `writeLocalGameCardContentFile(cardId, {path: coverPath, content: dataUri, mediaType})` 写新 cover 行。
- `game-card-display.ts:59` cover 查找：`card.contentFiles.find` → `readLocalGameCardContentFile(card.id, coverPath)`。

### `copyPlatformGameCardAsLocal` (2223-2249) / `createDefaultPlatformGameCard` (2260-2288)

复制卡时 contentFiles 从"读源卡数组"改成"查源卡表 → 写新卡表"。`putLocalGameCard({contentFiles: copy.contentFiles})` → `listLocalGameCardContentFiles(sourceId)` 然后传 contentFiles 数组（putLocalGameCard 整批写新卡表）。

## Read-Site Changes

> **过渡实现注明**：`cardContentFilesToWorkspaceFiles`(641)/`runAssistantChat`(1807) 工作区组装/`listEffectiveWorkspaceFilesForSave`(workspace.ts:1365) 改"直接查表"是**过渡态**——子3（全数据文件化）会把它们重写为经 volume enumerate 合并 content+frontend+manifest。本任务做最小查表实现让编译/运行通过即可，不必追求最终形态。`contentFileCount`(3180) 是终态（子3 不碰）。

- `game-card-packages.ts` export (628-630)：`card.contentFiles` → `listLocalGameCardContentFiles(card.id)`；import (543-588) 写 contentFiles → putLocalGameCard 整批（不变）。
- `workspace.ts:1365` `listEffectiveWorkspaceFilesForSave`：`card.contentFiles` → 查表。
- `platform-host:1807` `runAssistantChat` 工作区组装：`activeCard.contentFiles.map` → `cardContentFilesToWorkspaceFiles(activeCard)`（已改 async）。
- `platform-host:3180` `contentFileCount`：`activeCard.contentFiles.length` → `listLocalGameCardContentFiles(activeCard.id).length`（或缓存）。
- `game-cards.ts:244` `cloneLocalGameCardRecord`：去掉 contentFiles（克隆不含，需时查表）。
- `game-cards.ts:272` `isCurrentBuiltinBlankGameCard` staleness：`record.contentFiles` 比对 → **查表比对** `listLocalGameCardContentFiles(record.id)` + `hasTemplateFile`，保持现有 reset 保护语义（builtin 卡 content 被改后启动时自动 reset 回模板）。多一次 per-file 表读（~26 文件，无性能问题）。
- `game-cards.ts:296` `createBuiltinBlankGameCardRecord`：seed 改 putLocalGameCard({contentFiles: createDefaultWorkspaceTemplateFiles()}) 写表。`ensureBuiltinBlankGameCard`(431) staleness 失败 reset 时，先 `putLocalGameCard({contentFiles: createDefaultWorkspaceTemplateFiles()})` 整批写回模板 content。

## Async Propagation

`cardContentFilesToWorkspaceFiles` 等 helper 从 sync 变 async。调用链已 async（`listStudioWorkspaceFilesForGameCard` 等），确认无 sync 调用点。`runAssistantChat:1807` 已在 async 函数内。

**唯一 sync 风险点：`lib/game-card-display.ts:59` `getGameCardCoverUrl`**。它在 sync 渲染路径上被直接调（`GameCardLibraryView:85-86` 在 `v-if`/`:src`、`GameCardDetailView:554` 在 `computed`），不能改 async。

**确定方案：预加载 cover 文件到 card 返回对象**。在 `getLocalGameCard`/`listLocalGameCards` 返回时，额外查表把 cover contentFile 注入到非持久化字段。引入一个"读视图"类型区分 DB 行和返回对象：

```ts
// DB 行（storage 层内部）— 无 contentFiles
interface LocalGameCardRecord { id, manifest, source, createdAt, updatedAt }

// 返回给消费方的视图 — 多一个非持久化 cover 字段
interface LocalGameCardView extends LocalGameCardRecord {
  coverContentFile?: { path, content, mediaType }   // 仅当 manifest.cover.workspacePath 存在时预加载
}
```

`getGameCardCoverUrl(card: LocalGameCardView)` 改读 `card.coverContentFile`（sync），保持现有 template/computed 调用不变。`getLocalGameCard`/`listLocalGameCards` 返回 `LocalGameCardView`，在 clone 后查 cover contentFile 注入。其他读点（`cardContentFilesToWorkspaceFiles` 等）仍走 async 查表。

## Tradeoffs

- **方案 A (DB bump) — 已定**：简单符合惯例，丢开发数据（pre-release 可接受）。
- **单文件写 bump 卡 updatedAt — 已定 bump**：保持"卡 updatedAt 反映最近任何变更"约定。
- **助手 commit 整批替换 — 已定整批**：commit 本就批量，diff 复杂度不值。
- **cover 预加载 vs async 改造 — 已定预加载**：避免侵入 Vue template sync 调用，代价是引入 LocalGameCardView 视图类型 + getLocalGameCard/listLocalGameCards 多一次 cover 查表。

## Compatibility / Rollback

- 方案 A：旧 v6 DB 孤立，无回滚（重 seed）。
- 改动纯 storage，运行时不受影响。回滚 = git checkout storage 层 + DB 名回 v6。
