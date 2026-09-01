# 前端包打包规范与平台内替换 Design

## Architecture

本任务跨越四个层，按自下而上依赖顺序：

```
contracts  →  storage  →  platform-host  →  views
 (类型)      (zip解包/打包)  (业务接口)      (UI)
```

外加两个独立修复点：Service Worker（public 静态文件）、`inferMediaType`（storage 工具函数）。

### 层职责划分

- **contracts**：新增 `FrontendPackageManifest` 类型与 schema 常量。不改动现有 `GameCardManifest`/`GameCardFrontendBinding`/`GameCardPackageManifest`。
- **storage**：新增 `importGameCardFrontendPackage` / `exportGameCardFrontendPackage` 两个纯函数，复用现有 fflate zip 工具、路径校验、`GameCardPackageError`。修复 `inferMediaType`。不新增表、不改 schema。
- **platform-host**：新增 `importPlatformGameCardFrontendPackage` / `exportPlatformGameCardFrontendPackage`，扩展前端清除连删文件。复用 `putLocalGameCard`。
- **views**：`GameCardDetailView` 前端标签页 UI 重构。
- **public/tsian-game-card-frontend-sw.js**：修 DB 名。

## Contracts 设计

在 `packages/contracts/src/game-card.ts` 新增（与卡包清单并列，命名避开已存在的 `PlayFrontendManifest`）：

```ts
export interface FrontendPackageFileEntry {
  path: string
  mediaType: string
  size: number
}

export interface FrontendPackageManifest {
  schema: "tsian.frontend-package.v1"
  /** 相对包根的入口路径，不含 frontend/ 前缀。必须存在于 files。 */
  entry: string
  bridgeVersion: "tsian.play-bridge.v1"
  files: FrontendPackageFileEntry[]
  exportedAt?: string
  exporter?: GameCardPackageExporter
}
```

**关键决策：清单内 path 不含 `frontend/` 前缀。** 前端包是"纯前端"的单位，包内文件就是构建产物的原始结构（`index.html`、`assets/app.js`），不需要 `frontend/` 前缀。平台写入 `gameCardFrontendFiles` 时统一加 `frontend/` 前缀，与现有卡包导入路径约定对齐（卡包内是 `frontend/index.html`，落地后 `gameCardFrontendFiles.path = "frontend/index.html"`）。这样前端包对作者更自然，平台侧转换集中在一处。

复用 `GameCardPackageExporter`（已存在），不重复定义。

## Storage 设计

在 `apps/platform-web/src/storage/game-card-packages.ts` 新增两个函数，与 `importGameCardPackage`/`exportGameCardPackage` 并列。

### 常量

```ts
const FRONTEND_PACKAGE_SCHEMA = "tsian.frontend-package.v1"
const FRONTEND_PACKAGE_MANIFEST_PATH = "frontend.json"
```

### importGameCardFrontendPackage

```ts
export async function importGameCardFrontendPackage(
  cardId: string,
  input: Blob | ArrayBuffer | Uint8Array,
): Promise<LocalGameCardRecord>
```

流程：
1. `zipEntries(toUint8Array(input))` 解包。
2. 读取 `frontend.json`，缺失则抛 `FRONTEND_PACKAGE_MANIFEST_MISSING`。解析 + 校验 schema（`FRONTEND_PACKAGE_SCHEMA_UNSUPPORTED`）。
3. 规范化清单：`normalizeFrontendPackageManifest` 校验 `entry` 非空、`bridgeVersion` 为 `tsian.play-bridge.v1`、`files` 非空。
4. 遍历 entries（跳过目录与 `frontend.json`），每个文件 `normalizePackagePath` + 校验为相对安全路径（复用现有 `normalizePackagePath` 与 `assertAllowedPackagePath`，但前端包内路径不带前缀，需放宽 `assertAllowedPackagePath` 或用更宽松的校验——见下方"路径校验"小节）。
5. 校验：清单 `files` 中每项 path 在 entries 中存在；entries 中每个文件在清单 `files` 中存在（双向一致，不一致抛 `FRONTEND_PACKAGE_FILE_MISMATCH`）。
6. 校验 `entry` 在清单 `files` 中存在（`FRONTEND_PACKAGE_ENTRY_MISSING`）。
7. **整体替换**：取当前卡 `getLocalGameCard(cardId)`，构造 `putLocalGameCard` 调用：
   - `manifest`: `{ ...card.manifest, frontend: { kind: "packaged", entry: "frontend/" + manifest.entry, bridgeVersion } }`（entry 加前缀落地）。
   - `contentFiles`: 保留 `card.contentFiles`（前端包不影响工作区/封面内容）。
   - `frontendFiles`: 新包全部文件，path 统一加 `frontend/` 前缀，data 为原始 bytes，mediaType 用清单声明值或 `inferMediaType` 兜底。
   - `putLocalGameCard` 的 frontendFiles 走的是"先删该卡全部旧 frontendFile 再写新"的事务（已由现有实现保证，见 game-cards.ts putLocalGameCard 的 rw 事务）。
8. 返回更新后的 `LocalGameCardRecord`。

### exportGameCardFrontendPackage

```ts
export async function exportGameCardFrontendPackage(
  cardId: string,
): Promise<Blob>
```

流程：
1. `getLocalGameCard(cardId)`，不存在抛错。
2. `listLocalGameCardFrontendFiles(cardId)`。无文件抛 `FRONTEND_EXPORT_NO_FILES`。
3. 从 `card.manifest.frontend` 取 packaged entry（去掉 `frontend/` 前缀作为清单 entry）；非 packaged 抛 `FRONTEND_EXPORT_NOT_PACKAGED`。
4. 构造 `FrontendPackageManifest`：files 从 frontendFiles 映射（path 去掉 `frontend/` 前缀、mediaType、size）。
5. `zipSync`：`frontend.json` + 各文件（path 用去掉前缀的原始路径，data 从 Blob 转 Uint8Array）。
6. 返回 `new Blob([zipBytes], { type: "application/zip" })`。

### 路径校验

现有 `assertAllowedPackagePath` 强制路径必须以 `workspace/`、`frontend/`、`cover/` 之一开头。前端包内文件**不带这些前缀**（如 `index.html`、`assets/app.js`），不能复用该函数。

决策：新增 `assertSafeRelativePath(path)`，只做安全校验（无 `..`、无绝对路径、无 `\0`），不限制前缀。`normalizePackagePath` 仍复用（它本身只做规范化，不限制前缀）。

### mediaType 来源优先级

导入时：清单 `files[i].mediaType` 优先；缺失或为空则 `inferMediaType(path)` 兜底。导出时：直接用 `gameCardFrontendFiles` 存储的 mediaType。

## inferMediaType 修复

在 `inferMediaType` 函数补充映射（保持现有 fallback `application/octet-stream`）：

```ts
if (path.endsWith(".mp3")) return "audio/mpeg"
if (path.endsWith(".ogg")) return "audio/ogg"
if (path.endsWith(".wav")) return "audio/wav"
if (path.endsWith(".m4a")) return "audio/mp4"
if (path.endsWith(".flac")) return "audio/flac"
if (path.endsWith(".mp4")) return "video/mp4"
if (path.endsWith(".webm")) return "video/webm"
if (path.endsWith(".mov")) return "video/quicktime"
if (path.endsWith(".avif")) return "image/avif"
```

此修复同时让卡包导入（`indexedMediaType` 兜底）和前端包导入受益。

## Service Worker 修复

`public/tsian-game-card-frontend-sw.js` 第1行 `tsian-agent-runtime-v5` → `tsian-agent-runtime-v6`。

**关于"单一来源"**：SW 是 public 下的独立静态 JS，不参与 TS 编译，无法 import `db.ts` 的常量。强行抽取（如构建时注入）会引入构建复杂度，收益低。决策：在 SW 文件顶部加注释标注"须与 db.ts 的 DB 名保持一致"，保持人工同步。design 不做自动同步。同时记录到 spec 防止再次漏改（见 implement.md 的 spec 更新步骤）。

另需确认 SW 的 record key 构造与 `game-cards.ts` 的 `gameCardFrontendFileId` 一致。`gameCardFrontendFileId` 现为 `${gameCardId}::${normalizedPath}`，SW 第21行用 `${gameCardId}::${path}`——需确认 normalizedPath 与 SW 的 path decode 后是否一致（SW decode 后 path 不含前缀变化，应一致；implement 阶段验证）。

## Platform-Host 设计

在 `apps/platform-web/src/platform-host/index.ts` 新增：

```ts
export async function importPlatformGameCardFrontendPackage(
  cardId: string,
  input: Blob | ArrayBuffer | Uint8Array,
): Promise<LocalGameCardRecord> {
  await ensureBuiltinBlankGameCard()
  const card = await getLocalGameCard(cardId)
  if (!card) throw new Error(`游戏卡 "${cardId}" 不存在。`)
  if (card.source === "builtin") {
    throw new Error("内置游戏卡不能直接替换前端，请先另存为本地副本。")
  }
  return importGameCardFrontendPackage(cardId, input)
}

export async function exportPlatformGameCardFrontendPackage(cardId: string): Promise<Blob> {
  await ensureBuiltinBlankGameCard()
  return exportGameCardFrontendPackage(cardId)
}
```

**前端清除连删文件**：现有 `updatePlatformGameCardFrontend(cardId, null)` 只改 manifest。扩展为：当传 `null`/`undefined` 时，同时清空 `gameCardFrontendFiles`。实现方式——`putLocalGameCard` 传 `frontendFiles: []`（空数组走事务会删该卡全部 frontendFile）。需确认 `putLocalGameCard` 对空数组 vs 不传的处理差异（不传=保留现有，空数组=清空）。implement 阶段验证 `putLocalGameCard` 的 frontendFiles 语义。

## Views 设计

`GameCardDetailView.vue` 前端标签页（`activeTab === 'frontend'`）重构。

### 保留不变
- 顶部前端绑定状态标签 + "打开游玩窗口"按钮。
- Remote URL 模式选择 + URL 输入 + 保存/清除。
- `frontendMode` 三选一按钮组。

### Packaged 模式改造

当 `frontendMode === 'packaged'` 时，替换现有"入口文件输入框 + datalist + 文件列表点击设入口"为：

```
┌─────────────────────────────────────────┐
│ 前端包                                    │
│  [上传前端包]  [导出前端包]  [清除前端包]    │
│                                          │
│ 入口：frontend/index.html                 │
│ 文件 (12 个)                              │
│  ┌──────────────────────────────────┐    │
│  │ frontend/index.html  text/html   │    │
│  │ frontend/assets/app.js  text/js  │    │
│  │ frontend/assets/logo.png  image/ │    │
│  │ ...                              │    │
│  └──────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

- **上传前端包**：`<input type="file" accept=".tsian-frontend.zip,application/zip">` → `importPlatformGameCardFrontendPackage` → `refreshData()` 刷新。
- **导出前端包**：`exportPlatformGameCardFrontendPackage` → `URL.createObjectURL` + `<a download>` 下载。
- **清除前端包**：确认后 `updatePlatformGameCardFrontend(cardId, null)`（host 层已扩展连删文件）→ `refreshData()`。
- **入口显示**：只读展示 `manifest.frontend.entry`。
- **文件列表**：只读预览 `frontendFiles`，点击无操作（移除原"点击设为 entry"）。
- 无 packaged 文件时：上传按钮可用，导出/清除禁用，文件列表显示空提示。

### 内置卡保护
上传/导出/清除按钮对 `card.source === 'builtin'` 禁用（与名称/简介/封面一致）。

### 状态与反馈
- 复用现有 `feedback` / `errorMessage`。
- 新增 `frontendPackageSaving` ref 控制上传中状态。
- 上传/导出失败显示错误反馈。

## 数据流

```
用户选 .tsian-frontend.zip
  → GameCardDetailView.handleFrontendPackageSelected(file)
  → importPlatformGameCardFrontendPackage(cardId, file)
  → [builtin 校验]
  → storage.importGameCardFrontendPackage(cardId, file)
    → fflate unzipSync
    → 读 frontend.json + 校验
    → 校验 files/entries 双向一致 + entry 存在
    → getLocalGameCard(cardId)
    → putLocalGameCard({ manifest(+frontend packaged), contentFiles(保留), frontendFiles(新包+前缀) })
      → IndexedDB 事务：删旧 frontendFile + 写新 + 更新 gameCard
  → 返回 LocalGameCardRecord
  → refreshData() 重拉 card + frontendFiles
  → UI 刷新
```

## 兼容性

- 卡包整卡导入（`importGameCardPackage`）完全不动，仍能带入 frontend。
- Remote URL 模式不动。
- `GameCardFrontendBinding` 类型不动（packaged 仍是 `{ kind, entry, bridgeVersion }`，entry 仍带 `frontend/` 前缀落地，与现有 SW 路由解析一致）。
- 现有已导入卡的 packaged 前端不受影响（存储格式不变）。
- contracts 新增类型为纯增量，不影响现有导出。

## 风险

- **SW record key 不一致**：若 SW 的 `${gameCardId}::${path}` 与 `gameCardFrontendFileId` 的 normalizedPath 规则不一致，serve 会 404。Mitigation：implement 阶段先修 DB 名，用一个最简前端包端到端验证 serve，再继续其余工作。
- **putLocalGameCard 空数组语义**：若空 frontendFiles 不触发删除而是保留，清除功能会失效。Mitigation：implement 阶段先读 `putLocalGameCard` 源码确认，必要时 host 层显式调用 `localDb.gameCardFrontendFiles.where('gameCardId').equals(cardId).delete()`。
- **前端包清单与实际文件不一致**：作者手改 zip 可能导致清单与文件不匹配。Mitigation：双向校验 + 明确错误码。
- **大前端包内存**：fflate 全量解包到内存。当前原型期可接受；超大包（数百 MB）是后续优化项，本轮 out of scope。
