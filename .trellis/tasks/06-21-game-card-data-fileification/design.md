# Design: Game Card Data Fileification

## Boundaries

本任务在子5（WorkspaceVolume 抽象 + 单一 dispatch）产出上实现，**不再碰 host 路由点**（已统一收敛）。改 3 层：

1. **storage 层**（`game-cards.ts`）：新 `writeLocalGameCardFrontendFile`/`deleteLocalGameCardFrontendFile` 单文件前端 API（填补子5 CardFrontendVolume 的 write/delete 占位）；`normalizeTemplateFiles` reject `game-card.json`；manifest normalize 复用 `game-card-packages.ts:266-303`。
2. **volume 层**（子5 的 `workspace-volumes.ts`）：填 `CardFrontendVolume.write/delete` 实现（接 storage 单文件 API）；新 `ManifestVolume`（合成 game-card.json，write 回写 gameCards.manifest）。
3. **platform-host 层**（`index.ts`）：A 的 3 个 fallback 修点 + 库过滤；B 的 list 合并（前端+manifest 经 volume enumerate 注入）+ `resolveStudioWorkspacePath` 加 `frontend/`+`game-card.json` 解析；新 `writeGameCardManifestFileForCard`（manifest write 逻辑，被 ManifestVolume 调）。
4. **视图层**：`GameCardLibraryView` 过滤 builtin；详情路由可选守卫。

不动：运行时层（agent-runtime）、子5 的 dispatch/volume 框架（只填实现+加新 volume）、contracts（card-frontend scope 子5 已加）、导出/导入包格式、SW、bridge。

**关键变化（相对本任务早期 design）**：原计划在 `executeStudioWorkspaceOperation` 加 card-frontend/manifest 分支——现因子5 已统一 dispatch，本任务改为"实现 volume + 插 dispatch"，不碰路由点。这是子5 作为前置的价值。

## A. Builtin Invisible + Fallback Rework

### `ensureActiveGameCardId` rework（`platform-host:576-594`）

```
async function ensureActiveGameCardId(saves?) {
  // 1. stored id exists & found → return it（不变）
  // 2. save-bound card → return it（不变）
  // 3. NEW: no card anywhere → create editable default card, return its id
  //    内联 copy 逻辑（避免调 createDefaultPlatformGameCard→setPlatformActiveGameCard→ensureActiveGameCardId 递归）
  //    const copy = await copyPlatformGameCardAsLocal(BUILTIN_BLANK, {name:"我的游戏"})
  //    const record = await putLocalGameCard({manifest:{...copy,frontend:DEFAULT_FRONTEND_BINDING}, contentFiles, frontendFiles:defaultFrontendFiles(), source:"local"})
  //    await setActiveGameCardId(record.id); return record.id
  //    幂等保护：先检查是否已有任意 local 卡，有则用它，避免每次调用都新建
}
```

幂等关键：进入 fallback 前先 `listLocalGameCards()`，若已有 local 卡（非 builtin），选第一个作活跃（不新建）。只有**完全没有 local 卡**时才创建默认卡。这避免每次 `getPlatformActiveGameCard` 都新建。

### `ensureActiveSave` rework（`platform-host:603-605`）

```
// 旧: createLocalSave()（绑定 builtin）
// 新: const activeCard = await getPlatformActiveGameCard()
//     createLocalSaveFromGameCard(activeCard, ...)  // 绑定活跃卡
```

需确认 `createLocalSaveFromGameCard` 存在（`saves.ts`）或加一个绑定指定 cardId 的 save 创建。

### `deletePlatformGameCard` fallback（`platform-host:2311`）

```
// 旧: remainingCards[0]?.id ?? builtin.id
// 新: 若 remainingCards（含 builtin）有 local 卡 → 选第一个 local
//     若无 local 卡 → 自动创建默认卡 → 用它
//     不再返回 builtin.id 作为活跃
```

### 库过滤（`GameCardLibraryView.vue:252`）

```
cards.value = loadedCards.filter(c => c.source !== "builtin")
```

`listPlatformGameCards` 保持 `ensureBuiltinBlankGameCard`（模板源存在）。

### GUARD 保留清单（不动）

`game-cards.ts:383`（delete guard）、`platform-host:2208/2297/2407/2491`（metadata/delete/cover/frontend guards）、`game-card-packages.ts:536`（import guard）、两视图的 UI guards——全部保留，保护模板。

## B1. game-card.json Manifest File

### 合成注入

`cardContentFilesToWorkspaceFiles`（`platform-host:641-651`）或上游 `listStudioWorkspaceFilesForGameCard`/`listEffectiveWorkspaceFilesForSave`：在 contentFiles 之外合成一个 `WorkspaceFile`：

```
{
  path: "game-card.json",
  content: JSON.stringify(normalizeGameCardManifest(card.manifest), null, 2),
  mediaType: "application/json",
  ...timestamps
}
```

`normalizeGameCardManifest` 从 `game-card-packages.ts` 导出复用（目前是内部函数，需导出）。

### 写路由

`executeStudioWorkspaceOperation` mutations.write（`platform-host:3319`）：

```
if (resolvedPath is "game-card.json") {
  → writeGameCardManifestFileForCard(cardId, input.content)
    parse JSON → normalizeGameCardManifest → 强制覆盖受保护字段(id/source/schema/bridgeVersion)
    → putLocalGameCard({manifest: parsed, contentFiles: card.contentFiles, source: card.source})
}
```

### 受保护字段强制（同 serializeWorkspaceManifest 模式）

```
parsed.id = card.id            // 强制
parsed.schema = "tsian.game-card.v1"  // 强制
if (parsed.frontend) parsed.frontend.bridgeVersion = "tsian.play-bridge.v1"  // 强制
// source 不在 manifest 里，putLocalGameCard 从 card.source 取
```

### `normalizeTemplateFiles` reject（`game-cards.ts:142-148`）

加 `game-card.json` 到 reject 列表（和 `save/`/`.tsian/` 并列），避免它被当 contentFile 存储。

## B2. card-frontend Volume 实现 + Manifest Volume

子5 已定义 `card-frontend` scope（`DEFAULT_SCOPE_ACCESS` read 0/edit 2）+ `CardFrontendVolume` 框架（enumerate 可用，write/delete 占位）。本任务填补实现 + 加 ManifestVolume。

### 单文件前端 API（`game-cards.ts` 新增，填补子5 占位）

```
export async function writeLocalGameCardFrontendFile(cardId, path, content: string, mediaType): Promise<LocalGameCardFrontendFileRecord>
  // normalizeFrontendFile 校验 frontend/ 前缀；toBlob(content) 转 Blob 存
  // localDb.gameCardFrontendFiles.put({ id, gameCardId, path, data: Blob, mediaType, size, updatedAt })
export async function deleteLocalGameCardFrontendFile(cardId, path): Promise<void>
  // localDb.gameCardFrontendFiles.delete(id)
```

`readLocalGameCardFrontendFile` 已存在（game-cards.ts），确认导出。

### CardFrontendVolume.write/delete 填实现（子5 workspace-volumes.ts）

```
write: async (cardId, {path, content, mediaType}) => {
  const rec = await writeLocalGameCardFrontendFile(cardId, path, content, mediaType ?? inferMediaType(path))
  return { path: rec.path, content: await rec.data.text(), mediaType: rec.mediaType, createdAt: rec.updatedAt, updatedAt: rec.updatedAt }
},
delete: async (cardId, prefix) => { /* 删前缀下所有 */ ... return deleted }
```

### ManifestVolume（新 volume，子5 框架上新增）

```
{
  scope: "card-content",   // manifest 用 card-content scope（editLevel 2），但路径是 game-card.json 特殊处理
  enumerate: async (cardId) => [{ path: "game-card.json", content: JSON.stringify(normalizeGameCardManifest(card.manifest), null, 2), mediaType: "application/json", createdAt: card.createdAt, updatedAt: card.updatedAt }],
  write: async (cardId, {path, content}) => {
    // path 必须是 "game-card.json"
    return await writeGameCardManifestFileForCard(cardId, content)
  },
  delete: async () => { throw "manifest cannot be deleted" },
}
```

dispatch 的 `resolveVolumeForScope`：`game-card.json` 路径 → `ManifestVolume`（即使 scope 是 card-content，按 path 特殊路由）；`frontend/` → `CardFrontendVolume`。

### `resolveStudioWorkspacePath` 加解析

```
if (path === "game-card.json") → { scope: "card-content", displayPath: "game-card.json", isManifest: true }
else if (path.startsWith("frontend/")) → { scope: "card-frontend", displayPath: path }
```

### list 合并（经 volume enumerate）

`listStudioWorkspaceFilesForGameCard` 等：调各 volume 的 enumerate 合并：
```
const content = await cardContentVolume.enumerate(cardId)
const frontend = await cardFrontendVolume.enumerate(cardId)   // 子5 已接入或本任务接入
const manifest = await manifestVolume.enumerate(cardId)
return [...content, ...frontend, ...manifest].sort by path
```
`listEffectiveWorkspaceFilesForSave`（workspace.ts）+ `runAssistantChat` 工作区组装同理（经 volume enumerate）。

### `writeGameCardManifestFileForCard`（platform-host，被 ManifestVolume.write 调）

```
async function writeGameCardManifestFileForCard(cardId, content): Promise<WorkspaceFile> {
  const parsed = normalizeGameCardManifest(JSON.parse(content))   // 复用 game-card-packages.ts:266-303
  // 强制受保护字段
  const card = await getLocalGameCard(cardId)
  parsed.id = card.id            // 强制
  parsed.schema = "tsian.game-card.v1"  // 强制
  if (parsed.frontend) parsed.frontend.bridgeVersion = "tsian.play-bridge.v1"
  await putLocalGameCard({ manifest: parsed, contentFiles: undefined, source: card.source })  // contentFiles undefined = 不动 content
  return { path: "game-card.json", content: JSON.stringify(parsed, null, 2), mediaType: "application/json", createdAt: card.createdAt, updatedAt: Date.now() }
}
```

### split-brain 防护

前端写落 `gameCardFrontendFiles`（经 CardFrontendVolume → writeLocalGameCardFrontendFile），SW serve 该表 → `/play` 立即反映。manifest 写落 `gameCards.manifest`（经 ManifestVolume → putLocalGameCard）。都不经 CardContentVolume，无 contentFiles 副本。

## B3. Cover Boundary

封面 binding 在 `game-card.json` 的 `manifest.cover` 可编辑（同其它 manifest 字段）。封面图片字节（`.cover/cover.<ext>` contentFile，base64 data-URI）不在本次支持文件编辑——text-only 工作区 + data-URI 编辑不实际。封面图仍走 `GameCardDetailView` 的上传 UI。登记为已知限制，后续若支持二进制 content 再开。

## 助手工具面（确认）

- 不加新工具。助手 level 4 现有 `workspace_read`/`workspace_write` 经 `executeWorkspaceOperation`（agent-runtime）→ `exposedWorkspaceOperations` 校验 scope edit level → platform-host `executeStudioWorkspaceOperation` 路由。
- 子3 让前端+manifest 进助手工作区文件集 + 写路由正确，现有工具即可管理。
- run_script 的 `tsian.workspace.*` SDK 同理（workspace_write 经同一路径）。

## Tradeoffs

- **manifest 合成文件 vs 真存储**：选合成（list 时 JSON.stringify 注入，写时拦截回写 manifest），避免 manifest 双写（contentFiles 副本 + manifest 字段）。同 `.tsian/manifest.json` 模式。
- **card-frontend scope vs 复用 card-content**：选新 scope，因前端是独立 Blob 表 + 独立 edit 语义（运行时 agent 不应改），和 card-content（字符串 contentFiles）存储不同。
- **fallback 自动创建 vs 保留 builtin 兜底**：选自动创建，彻底兑现"不可见"，但需幂等保护避免重复创建。

## Compatibility / Rollback

- 遗留 builtin-bound saves 仍存在，`gameCardForSave`/workspace list 对它们操作 builtin content——可接受，builtin 记录保留。
- 回滚：A 还原 fallback + 取消库过滤；B 还原 list 合并 + scope + 写路由。已创建的默认卡是用户数据保留。
