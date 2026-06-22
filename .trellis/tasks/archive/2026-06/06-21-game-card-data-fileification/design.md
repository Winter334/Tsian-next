# Design: Game Card Data Fileification

> **重写于 2026-06-22**。原 design 写于子4/子5 刚完成时，此后 mediaType 移除 + binary Blob + DB v8 + platform-host split 三个任务使技术假设大面积过时。本次重写基于当前代码现状，PRD 需求不变（漂移修正见 prd.md 末尾）。

## Boundaries

本任务在子5（WorkspaceVolume 抽象 + 单一 dispatch）产出上实现，**不碰 host 路由点**（已统一收敛为 `executeWorkspaceMutation`）。改 4 处：

1. **storage 层**（`storage/game-cards.ts`）：新 `writeLocalGameCardFrontendFile`/`deleteLocalGameCardFrontendFile` 单文件 API（填补 `CardFrontendVolume.write/delete` 占位）；`normalizeTemplateFiles` reject `game-card.json`；导出 `normalizeGameCardManifest`（from `game-card-packages.ts`）。
2. **volume 层**（`platform-host/workspace-volumes.ts`）：填 `CardFrontendVolume.write/delete` 实现（接 storage 单文件 API）；新 `ManifestVolume`（合成 game-card.json，write 回写 `gameCards.manifest`）；`resolveVolumeForScope` 加 `game-card.json` 路径特殊路由。
3. **platform-host 层**（`internal.ts`/`game-cards.ts`/`workspace-ops.ts`）：A 的 4 个 fallback 修点 + 库过滤；B 的 list 合并 manifest（前端 enumerate 已由子5 完成，本任务只加 manifest 注入）+ `resolveStudioWorkspacePath` 加 `game-card.json` 解析。
4. **视图层**（`GameCardLibraryView.vue`）：过滤 builtin。

不动：运行时层（agent-runtime）、子5 的 dispatch/volume 框架（只填实现 + 加新 volume）、contracts（`card-frontend` scope 子5 已加）、导出/导入包格式、SW、bridge。

## A. Builtin Invisible + Fallback Rework

### A1. `ensureActiveGameCardId` rework（`internal.ts:63-81`）

当前逻辑（L63-81）：stored id → save-bound card → `getBuiltinBlankGameCard()` fallback。

改为：
```
1. stored id exists & found → return it（不变）
2. save-bound card → return it（不变）
3. NEW fallback:
   a. listLocalGameCards() → 若有 local 卡（非 builtin）→ 选第一个 → setActiveGameCardId → return
   b. 若无 local 卡 → 内联创建默认卡（不调 createDefaultPlatformGameCard 避免递归）→ return
```

内联创建（避免递归 `ensureActiveGameCardId` → `createDefaultPlatformGameCard` → `setPlatformActiveGameCard` → `ensureActiveGameCardId`）：
```
const builtin = await getBuiltinBlankGameCard()
const contentFiles = await listLocalGameCardContentFiles(builtin.id)  // 复制模板内容
const frontendFiles = (await listLocalGameCardFrontendFiles(builtin.id)).map(f => ({ path: f.path, data: f.data }))
const record = await putLocalGameCard({
  manifest: { ...builtin.manifest, id: generateCardId(), name: "我的游戏", source: "local" },
  contentFiles: contentFiles.map(toGameCardContentFile),
  frontendFiles,
  source: "local",
})
await setActiveGameCardId(record.id)
return record.id
```

**幂等关键**：进入 fallback 前先 `listLocalGameCards()`，若已有任意 local 卡，选第一个作活跃（不新建）。只有**完全没有 local 卡**时才创建默认卡。这避免每次 `getPlatformActiveGameCard` 都新建。

需确认 `generateCardId` 等价物——现状 `createDefaultPlatformGameCard`（`game-cards.ts:986` import 区附近）内部用什么生成 id。若它调 `putLocalGameCard` 时 id 由 manifest.id 决定，则需 `crypto.randomUUID()` 或现有 id 生成 helper。

### A2. `ensureActiveSave` rework（`game-cards.ts:92-104`）

当前 L99-101：`createLocalSave()`（builtin-bound）+ `setActiveGameCardId(created.gameCardId ?? (await getBuiltinBlankGameCard()).id)`。

改为：
```
const activeCard = await getPlatformActiveGameCard()  // 经 A1 rework 后必返回 local 卡
const created = await createLocalSaveFromGameCard(activeCard)  // 绑定活跃卡
await setActiveSaveId(created.id)
await setActiveGameCardId(activeCard.id)
```

需确认 `createLocalSaveFromGameCard` 存在（`saves.ts`）或 `createLocalSave` 可接 cardId 参数。若不存在则加一个接 cardId 的重载或新函数。

### A3. `deletePlatformGameCard` fallback（`game-cards.ts:381-421`）

当前 L401-402：`remainingCards[0]?.id ?? (await getBuiltinBlankGameCard()).id`。

改为：
```
const remainingCards = await listLocalGameCards()  // 含 builtin
const remainingLocal = remainingCards.filter(c => c.source !== "builtin")
if (remainingLocal.length > 0) {
  await setActiveGameCardId(remainingLocal[0].id)
} else {
  // 无 local 卡 → 自动创建默认卡（复用 A1 的内联创建逻辑，抽成 createDefaultEditableCard helper）
  const newCard = await createDefaultEditableCard()
  await setActiveGameCardId(newCard.id)
}
```

抽 `createDefaultEditableCard()` helper（A1 和 A3 共用，避免重复内联 copy 逻辑）。

### A4. `getPlatformActiveGameCard` stale fallback（`internal.ts:178-196`）

当前 L187/L192：stale-save 兜底返回 `getBuiltinBlankGameCard()`。

改为：返回 `null`（让调用方处理"无活跃卡"）或调 `createDefaultEditableCard()`。选 **返回 null**（更诚实，调用方已有 null 处理；自动创建留给 `ensureActiveGameCardId` 显式调）。

### A5. 库过滤（`GameCardLibraryView.vue:246`）

当前：`cards.value = loadedCards`（L246，不过滤）。

改为：`cards.value = loadedCards.filter(c => c.source !== "builtin")`。

`listPlatformGameCards` 保持 `ensureBuiltinBlankGameCard`（模板源仍需在 DB 存在，只是库视图不显示）。

### A6. GUARD 保留清单（不动）

`game-cards.ts:388`（delete guard `card.source === "builtin"` throw）、`GameCardLibraryView.vue:290-292/398-400`（UI delete guard）、`game-card-packages.ts` import guard、`createDefaultPlatformGameCard` 的 TEMPLATE-SOURCE 引用——全部保留，保护模板。

## B1. game-card.json Manifest File

### B1.1 合成注入

`game-card.json` 是合成文件（不存表，list 时 JSON.stringify 注入）。注入点：

- **Explorer list**：`listStudioWorkspaceFilesForGameCard`（`workspace-ops.ts:120-143`）。当前 L122 合并 contentFiles + L125 合并 frontend enumerate。加一行：
  ```
  files.push({
    path: "game-card.json",
    content: JSON.stringify(normalizeGameCardManifest(card.manifest), null, 2),
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
  })
  ```
- **effective list**：`listEffectiveWorkspaceFilesForSave`（`workspace.ts:1338-1372`）。当前 L1343 合并 contentFiles + L1353 合并 frontend。加同款 manifest 合成注入。
- **助手工作区组装**：`runAssistantChat` 路径（`platform-host` 调 `listEffectiveWorkspaceFilesForActiveSave`，`internal.ts:83`）——经上一步 `listEffectiveWorkspaceFilesForSave` 自动获得 manifest，无需额外改。

**`normalizeGameCardManifest` 导出**：当前 `game-card-packages.ts:233` 是内部函数。加 `export`。注意它抛 `GameCardPackageError`——在 host 层调用时 catch 转 `workspaceStudioError` 或直接透传（manifest 文件化是用户编辑场景，JSON 语法错应清晰报错）。

### B1.2 写路由

manifest 写不进 `executeWorkspaceMutation`（它不是真实文件，写时拦截回写 `gameCards.manifest`）。两种实现路径：

**方案 1（推荐）：`ManifestVolume` + dispatch 特殊路由**
- 新 `ManifestVolume`（scope=card-content，但 path="game-card.json" 特殊路由）
- `resolveVolumeForScope` 加：若 path === "game-card.json" → ManifestVolume
- `ManifestVolume.write`：调 `writeGameCardManifestFileForCard(cardId, content)`
- `ManifestVolume.delete`：throw "manifest cannot be deleted"
- `ManifestVolume.enumerate`：返回合成 game-card.json

**方案 2：`executeStudioWorkspaceOperation` 写分支前置拦截**
- 在 `workspace-ops.ts` 的 card-content/card-frontend 共用分支（L494-527）前加：若 `resolvedPath.displayPath === "game-card.json"` → 调 `writeGameCardManifestFileForCard`，不走 `executeWorkspaceMutation`

选**方案 1**（与子5 的 volume 抽象一致，dispatch 单一入口）。但 `executeStudioWorkspaceOperation` 的 card 分支 L496-499 构造 `cardScopedFiles` 需加 manifest 合成文件（让 read/validate 能找到它），且 mutations.write 分支 L505-513 经 `executeWorkspaceMutation` 自然路由到 ManifestVolume。

### B1.3 `writeGameCardManifestFileForCard`（新 helper，platform-host 层）

```
async function writeGameCardManifestFileForCard(cardId: string, content: string): Promise<WorkspaceFile> {
  const card = await getLocalGameCard(cardId)
  if (!card) throw workspaceStudioError("WORKSPACE_CARD_REQUIRED", ...)
  if (card.source === "builtin") throw workspaceStudioError("WORKSPACE_BUILTIN_MANIFEST_READONLY", "内置卡 manifest 不可编辑")

  let parsed: GameCardManifest
  try {
    parsed = normalizeGameCardManifest(JSON.parse(content))  // 复用 game-card-packages.ts:233
  } catch (error) {
    throw workspaceStudioError("WORKSPACE_MANIFEST_INVALID", manifestParseErrorMessage(error))
  }

  // 强制受保护字段
  parsed.id = card.manifest.id  // DB 主键，强制回原
  parsed.schema = GAME_CARD_MANIFEST_SCHEMA  // 强制 "tsian.game-card.v1"
  if (parsed.frontend) parsed.frontend.bridgeVersion = "tsian.play-bridge.v1"

  await putLocalGameCard({
    manifest: parsed,
    contentFiles: undefined,  // undefined = 不动 content 表
    source: card.source,
  })

  return {
    path: "game-card.json",
    content: JSON.stringify(parsed, null, 2),
    createdAt: card.createdAt,
    updatedAt: Date.now(),
  }
}
```

位置：`workspace-ops.ts`（与 `executeStudioWorkspaceOperation` 同文件，被 ManifestVolume.write 调）。需 import `normalizeGameCardManifest` + `GAME_CARD_MANIFEST_SCHEMA` from `game-card-packages.ts`，`getLocalGameCard`/`putLocalGameCard` from storage。

### B1.4 `normalizeTemplateFiles` reject（`game-cards.ts:158-173`）

当前 reject `save/` + `.tsian/`。加 `game-card.json`：
```
if (normalized.path === "game-card.json") {
  throw new Error("Game card content cannot use reserved game-card.json path (manifest is synthesized).")
}
```
位置：L165-169 的 if 链里加一条。

### B1.5 `resolveStudioWorkspacePath` 加解析（`workspace-ops.ts:145-207`）

当前 L194-200 处理 `frontend/`。在 `frontend/` 分支前加：
```
if (displayPath === "game-card.json") {
  return {
    scope: "card-content",  // manifest 用 card-content scope（editLevel 2）
    displayPath,
    storagePath: "game-card.json",  // ManifestVolume 按 path 特殊路由
    isManifest: true,
  }
}
```
`StudioResolvedPath` 类型加 `isManifest?: boolean`（可选，默认 false）。

### B1.6 `resolveVolumeForScope` 加 manifest 路由（`workspace-volumes.ts:261-273`）

当前 L269 `if (scope === "card-content") return cardContentVolume`。改为：
```
if (scope === "card-content") {
  if (path === "game-card.json") return manifestVolume
  return cardContentVolume
}
```

## B2. card-frontend Volume write/delete 填实现

### B2.1 storage 单文件前端 API（`game-cards.ts` 新增）

```
export async function writeLocalGameCardFrontendFile(
  cardId: string,
  input: { path: string; data: Blob | ArrayBuffer | Uint8Array | string },
): Promise<LocalGameCardFrontendFileRecord>
  // 复用现有 normalizeFrontendFile（L198-218，校验 frontend/ 前缀 + toBlob）
  // 单文件 put（不整批重写），bump card updatedAt
  // const now = Date.now()
  // const rec = normalizeFrontendFile(cardId, input, now)
  // await localDb.gameCardFrontendFiles.put(rec)
  // await bumpGameCardUpdatedAt(cardId)  // 同 writeLocalGameCardContentFile 模式
  // return rec

export async function deleteLocalGameCardFrontendFile(cardId: string, path: string): Promise<void>
  // normalizePackageFilePath + gameCardFrontendFileId + localDb.gameCardFrontendFiles.delete
  // bump card updatedAt

export async function deleteLocalGameCardFrontendPathForCard(cardId: string, pathPrefix: string): Promise<string[]>
  // 仿 deleteLocalGameCardContentPathForCard（L525）模式：列前缀下所有 → 逐个 delete → 返回已删 path
```

参照 `writeLocalGameCardContentFile`（L467）/`deleteLocalGameCardContentFile`（L504）/`deleteLocalGameCardContentPathForCard`（L525）的模式——它们已是单文件 API，bump card updatedAt 在同一事务里。

### B2.2 `CardFrontendVolume.write/delete` 填实现（`workspace-volumes.ts:91-128`）

当前 L118-127 是占位 throw。改为：
```
async write(cardId, { path, content, data }) {
  // content (text) 或 data (Blob) 二选一；前端文件存 data: Blob
  const payload = data instanceof Blob ? data : (content ?? "")
  const rec = await writeLocalGameCardFrontendFile(cardId, { path, data: payload })
  // 返回 WorkspaceFile：text 类 → content; 媒体类 → binary + placeholder
  const mediaType = inferMediaTypeFromPath(rec.path)
  if (isTextMediaType(mediaType) || mediaType === "image/svg+xml") {
    return { path: rec.path, content: await rec.data.text(), createdAt: rec.createdAt, updatedAt: rec.updatedAt }
  }
  return { path: rec.path, content: binaryPlaceholderText(rec.data, rec.path), binary: rec.data, createdAt: rec.createdAt, updatedAt: rec.updatedAt }
},
async delete(cardId, pathPrefix) {
  return deleteLocalGameCardFrontendPathForCard(cardId, pathPrefix)
},
```

### B2.3 list 合并（已完成，验证即可）

`listStudioWorkspaceFilesForGameCard`（L125）和 `listEffectiveWorkspaceFilesForSave`（L1353）已由子5 接入 `cardFrontendVolume.enumerate` / 原生 `listLocalGameCardFrontendFiles`。本任务**不改 list 路径**（只加 manifest 注入，B1.1）。

### B2.4 `executeStudioWorkspaceOperation` card 分支（`workspace-ops.ts:494-527`）

当前 L496-499 构造 `cardScopedFiles` = contentFiles + frontend enumerate。**加 manifest 合成文件**：
```
const cardScopedFiles = [
  ...await cardContentFilesToWorkspaceFiles(context.card),
  ...await cardFrontendVolume.enumerate(cardId),
  {  // manifest 合成
    path: "game-card.json",
    content: JSON.stringify(normalizeGameCardManifest(context.card.manifest), null, 2),
    createdAt: context.card.createdAt,
    updatedAt: context.card.updatedAt,
  },
]
```
mutations.write 分支 L505-513 经 `executeWorkspaceMutation` → `resolveVolumeForScope` 按 path 路由到 ManifestVolume（B1.6）或 CardFrontendVolume（已有）或 CardContentVolume（已有），无需在 `executeStudioWorkspaceOperation` 加 if/else。

## B3. Cover Boundary

封面 binding（`workspacePath`/`alt`/`url`）在 `game-card.json` 的 `manifest.cover` 可编辑（同其它 manifest 字段，经 B1.3 `writeGameCardManifestFileForCard` 写回）。

封面图片字节（`.cover/cover.<ext>` contentFile）**暂不支持文件编辑**——text-only 工作区不编辑 Blob。封面图仍走 `GameCardDetailView` 的上传 UI。登记为已知限制，后续若支持二进制 content 编辑再开。

## 助手工具面（确认）

- 不加新工具。助手 level 4 现有 `workspace_read`/`workspace_write` 经 `executeWorkspaceOperation`（agent-runtime）→ `exposedWorkspaceOperations` 校验 scope edit level → platform-host `executeStudioWorkspaceOperation`（card 分支）→ `executeWorkspaceMutation` → volume。
- manifest + 前端进 cardScopedFiles 后，助手 read 能读到；write 经 dispatch 路由到 ManifestVolume/CardFrontendVolume，现有工具即可管理。
- run_script 的 `tsian.workspace.*` SDK 同理（workspace_write 经同一路径）。

## 数据流

```
Explorer list:
  listStudioWorkspaceFilesForGameCard(cardId)
  → cardContentFilesToWorkspaceFiles (contentFiles)
  + cardFrontendVolume.enumerate (前端 text/media 分流)
  + manifest 合成 (game-card.json)
  → sort by path → Explorer 显示

Explorer 写 game-card.json:
  executeStudioWorkspaceOperation({op:"write", path:"game-card.json", content})
  → resolveStudioWorkspacePath → {scope:"card-content", isManifest:true, storagePath:"game-card.json"}
  → executeWorkspaceOperation(... mutations.write)
  → executeWorkspaceMutation({scope:"card-content", path:"game-card.json", ...})
  → resolveVolumeForScope → manifestVolume
  → writeGameCardManifestFileForCard(cardId, content)
  → normalizeGameCardManifest + 强制受保护字段 + putLocalGameCard({manifest})
  → 返回合成 WorkspaceFile

Explorer 写 frontend/index.html:
  executeStudioWorkspaceOperation({op:"write", path:"frontend/index.html", content})
  → resolveStudioWorkspacePath → {scope:"card-frontend", storagePath:"frontend/index.html"}
  → executeWorkspaceMutation → resolveVolumeForScope → cardFrontendVolume
  → writeLocalGameCardFrontendFile(cardId, {path, data: content string})
  → SW serve gameCardFrontendFiles → /play 立即反映

助手 workspace_write(game-card.json):
  agent-runtime executeWorkspaceOperation → platform-host executeStudioWorkspaceOperation
  → 同 Explorer 写路径（经 mutations 分支）

A 阶段 fallback:
  getPlatformActiveGameCard → ensureActiveGameCardId → 无 local 卡 → createDefaultEditableCard
  → 内联复制 builtin 内容+前端 → putLocalGameCard({source:"local"}) → setActiveGameCardId
```

## Tradeoffs

- **manifest 合成文件 vs 真存储**：选合成（list 时 JSON.stringify 注入，写时拦截回写 manifest），避免 manifest 双写（contentFiles 副本 + manifest 字段）。同 `.tsian/manifest.json` 模式。
- **ManifestVolume vs executeStudioWorkspaceOperation 前置拦截**：选 ManifestVolume（与子5 volume 抽象一致，dispatch 单一入口）。代价是 `resolveVolumeForScope` 按 path 特殊路由（`game-card.json` 是唯一特例，可接受）。
- **fallback 自动创建 vs 保留 builtin 兜底**：选自动创建，彻底兑现"不可见"，但抽 `createDefaultEditableCard` helper 避免重复 + 幂等保护。
- **stale-save 兜底返回 null vs 自动创建**：选 null（诚实，自动创建留给 `ensureActiveGameCardId` 显式调，避免 `getPlatformActiveGameCard` 副作用）。

## Compatibility / Rollback

- 遗留 builtin-bound saves 仍存在，`gameCardForSave`/workspace list 对它们操作 builtin content——可接受，builtin 记录保留。
- 回滚：A 还原 fallback + 取消库过滤；B 还原 manifest 注入 + scope 路由 + volume 实现 + storage API。已创建的默认卡是用户数据保留。
- 纯增量改动（新 volume + 新 storage API + fallback 逻辑改），无 DB schema 变化，回滚无风险。

## 与其他任务的协调

- 本任务改 `workspace-volumes.ts`（填 CardFrontendVolume write/delete + 加 ManifestVolume）、`workspace-ops.ts`（manifest 注入 + 路径解析）、`game-cards.ts`（storage API + fallback + normalizeTemplateFiles）、`game-card-packages.ts`（导出 normalizeGameCardManifest）、`GameCardLibraryView.vue`（库过滤）。
- 不与当前任何 in_progress 任务冲突（workspace-readonly-tool-strengthen 已归档）。
- 不改 contracts（`card-frontend` scope 子5 已加）。
