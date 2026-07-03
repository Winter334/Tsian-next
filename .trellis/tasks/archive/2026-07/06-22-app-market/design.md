# App Market — Technical Design

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│ platform-web (Vue)                                      │
│  AppMarketView.vue                                      │
│   ├─ marketApi (api-client.ts)  ── HTTP ──┐             │
│   ├─ exportPlatformGameCardPackage (上传)  │             │
│   └─ importPlatformGameCardPackage (安装)  │             │
└───────────────────────────────────────────│─────────────┘
                                            │
┌───────────────────────────────────────────▼─────────────┐
│ platform-server (Go)                                    │
│  /api/v1/market/*  (RequireAuth for upload/download)    │
│   ├─ market.Handler                                     │
│   ├─ market.SQLiteRepository ── SQLite (market_packages)│
│   └─ storage.FileSystemBlobStore ── DataDir/market/     │
└─────────────────────────────────────────────────────────┘
```

## Backend Design

### 1. `internal/storage/blobstore.go` — FileSystemBlobStore

实现已有的 `BlobStore` 接口。

```go
type FileSystemBlobStore struct {
    root string // cfg.DataDir
}

func (s *FileSystemBlobStore) Put(ctx, key, content) error {
    // root + "/" + key, MkdirAll(filepath.Dir), os.Create, io.Copy
}
func (s *FileSystemBlobStore) Open(ctx, key) (io.ReadCloser, error) {
    // os.Open(root + "/" + key)
}
func (s *FileSystemBlobStore) Delete(ctx, key) error {
    // os.Remove(root + "/" + key)
}
```

key 约定：`market/<packageId>.zip`。封面单独存：`market/<packageId>/cover<ext>`。

### 2. `internal/market/` 包

仿 `internal/user/` 结构：

```
internal/market/
├── market.go         # 领域类型 + Repository 接口
├── sqlite_repo.go    # SQLite 实现
└── handler.go        # HTTP handler
```

#### 领域类型 (`market.go`)

```go
type ResourceType string
const (
    ResourceGameCard ResourceType = "game_card"
)

type Package struct {
    ID            string
    ResourceType  ResourceType
    CardID        string
    Name          string
    Summary       string
    CoverBlobKey  string  // empty = no cover
    UploaderID    string
    DownloadCount int
    CreatedAt     time.Time
    UpdatedAt     time.Time
}

type PackageWithUploader struct {
    Package
    UploaderDisplayName string
    UploaderAvatarURL   *string
}

type Repository interface {
    List(ctx, filter ListFilter) ([]PackageWithUploader, error)
    GetByID(ctx, id string) (*PackageWithUploader, error)
    Create(ctx, pkg Package) error
    IncrementDownloadCount(ctx, id string) error
}

type ListFilter struct {
    Query string // empty = no filter, else name/summary LIKE
    Sort  string // "newest" | "downloads"
    Limit int
}
```

#### SQLite 表 (`storage/db.go` 追加)

```sql
CREATE TABLE IF NOT EXISTS market_packages (
    id TEXT PRIMARY KEY,
    resource_type TEXT NOT NULL DEFAULT 'game_card',
    card_id TEXT NOT NULL,
    name TEXT NOT NULL,
    summary TEXT NOT NULL,
    cover_blob_key TEXT,
    uploader_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    download_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_market_packages_created ON market_packages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_packages_downloads ON market_packages(download_count DESC);
```

List 查询用 JOIN users 取上传者信息：
```sql
SELECT p.*, u.display_name, u.avatar_url
FROM market_packages p
JOIN users u ON p.uploader_id = u.id
WHERE (p.name LIKE ? OR p.summary LIKE ?)  -- only when query non-empty
ORDER BY p.created_at DESC | p.download_count DESC
LIMIT ?
```

#### HTTP Handler (`handler.go`)

| Method | Path | Auth | 说明 |
|--------|------|------|------|
| GET | `/api/v1/market/packages` | 无 | 列表，query: `q`(搜索), `sort`(newest/downloads), `limit`(默认50) |
| GET | `/api/v1/market/packages/:id` | 无 | 单条详情 |
| POST | `/api/v1/market/packages` | RequireAuth | multipart 上传，field `file`=zip, `title`?, `summary`? |
| GET | `/api/v1/market/packages/:id/download` | 无 | 返回 zip，increment download_count |

上传 handler 流程：
1. `r.ParseMultipartForm(50 << 20)` 限制 50MB
2. `r.FormFile("file")` 取 zip
3. 轻量校验：用 `archive/zip` 读 `game-card.json`，解析 JSON，检查 schema/id/name/version/summary
4. 从 manifest 提取 name/summary（`title`/`summary` form field 优先）
5. 提取封面：manifest.cover.url 是远程 URL 不下载；manifest.cover.workspacePath 需从 zip 内提取封面文件存 BlobStore
6. 生成 packageId（`user.NewID()`），`blobStore.Put(ctx, "market/"+id+".zip", fileContent)`
7. `repo.Create(ctx, Package{...})`
8. `writeJSON(w, 201, toPackageResponse(pkg))`

下载 handler 流程：
1. `repo.GetByID` 确认存在
2. `blobStore.Open(ctx, "market/"+id+".zip")`
3. `repo.IncrementDownloadCount(ctx, id)` (best-effort，不阻塞下载)
4. `w.Header Content-Type=application/zip`, `io.Copy(w, reader)`

### 3. 路由注册 (`server.go`)

```go
// 在 Handler() 内，auth 路由之后
blobStore := &storage.FileSystemBlobStore{Root: s.cfg.DataDir}
marketRepo := market.NewSQLiteRepository(s.db)
marketHandler := market.NewHandler(marketRepo, blobStore)

mux.HandleFunc("GET /api/v1/market/packages", marketHandler.HandleList)
mux.HandleFunc("GET /api/v1/market/packages/{id}", marketHandler.HandleGet)
mux.Handle("POST /api/v1/market/packages",
    middleware.RequireAuth(s.db, users, http.HandlerFunc(marketHandler.HandleUpload)))
mux.HandleFunc("GET /api/v1/market/packages/{id}/download", marketHandler.HandleDownload)
```

注意 Go 1.22+ 路径参数用 `{id}` 而非 `:id`。

### 4. 响应 JSON 契约

```typescript
// GET /api/v1/market/packages 响应
interface MarketPackageListResponse {
  packages: MarketPackage[]
}
interface MarketPackage {
  id: string
  resourceType: "game_card"
  cardId: string
  name: string
  summary: string
  coverUrl: string | null    // 后端拼 DataDir 或留空让前端用首字母占位
  uploader: {
    id: string
    displayName: string
    avatarUrl: string | null
  }
  downloadCount: number
  createdAt: string  // RFC3339
}
```

封面 URL 策略：后端新增 `GET /api/v1/market/packages/{id}/cover` 端点返回封面图 Blob，前端 `coverUrl` = `/api/v1/market/packages/{id}/cover`。无封面时返回 404，前端 fallback 到首字母/默认占位。

## Frontend Design

### 1. `marketApi` (`platform-host/api-client.ts`)

新增 marketApi 对象，复用现有 `apiFetch` 模式：

```typescript
export const marketApi = {
  async list(params?: { q?: string; sort?: "newest" | "downloads" }): Promise<MarketPackage[]> {
    const query = new URLSearchParams()
    if (params?.q) query.set("q", params.q)
    if (params?.sort) query.set("sort", params.sort)
    const res = await apiFetch<{ packages: MarketPackage[] }>(`/api/v1/market/packages?${query}`)
    return res.packages
  },
  async get(id: string): Promise<MarketPackage> { ... },
  async upload(file: Blob, title?: string, summary?: string): Promise<MarketPackage> {
    // FormData, fetch with credentials
  },
  async download(id: string): Promise<Blob> { ... },
}
```

`MarketPackage` 类型放 `@tsian/contracts`（前后端共享）。

### 2. `AppMarketView.vue` 改造

保留现有 RetroOS 工具栏 + 左侧分类 + 右侧内容区结构，替换内容：

- **工具栏**：搜索输入框（输入触发 `marketApi.list({q})`）+ 排序下拉（newest/downloads）+ "上传卡包"按钮（需登录）
- **左侧分类**：保持硬编码占位（不生效），MVP 不做分类过滤
- **右侧内容区**：
  - 列表态：卡包卡片网格（封面 + 标题 + 简介 + 作者 + 下载量），点击进详情
  - 详情态：大封面 + 标题 + 简介 + 作者信息 + 下载安装按钮 + 返回
  - 上传态：本地卡包列表（从 IndexedDB `listLocalGameCards` 读取）→ 选中 → 可选补充标题/简介 → 上传
  - 空状态/错误反馈

状态机：`screen: "list" | "detail" | "upload"`，类似 `SettingsView` 的 hub→子屏 模式。

### 3. 上传流程

```typescript
async function handleUploadSelected(cardId: string, title?: string, summary?: string) {
  const blob = await exportPlatformGameCardPackage(cardId)  // 生成 zip Blob
  const pkg = await marketApi.upload(blob, title, summary)
  toast.success(`已上传：${pkg.name}`)
  screen.value = "list"
  refresh()  // 刷新列表
}
```

### 4. 下载安装流程

```typescript
async function handleDownloadAndInstall(pkg: MarketPackage) {
  // 检查本地是否已有同 card_id
  const localCards = await listLocalGameCards()
  const existing = localCards.find(c => c.manifest.id === pkg.cardId)
  if (existing) {
    // 提示：覆盖 / 另存为副本 / 取消
    const choice = await confirmChoice({ ... })
    if (choice === "cancel") return
    if (choice === "copy") { /* TODO: 副本逻辑 */ }
    // overwrite: 先删本地卡再导入
  }
  const blob = await marketApi.download(pkg.id)
  await importPlatformGameCardPackage(blob)
  toast.success(`已安装：${pkg.name}`)
}
```

同 card_id 冲突处理：MVP 简化为"已安装，是否覆盖/取消"（副本逻辑后续再做，因为现有 `importGameCardPackage` 会直接覆盖）。

## Contract Changes

`packages/contracts/src/` 新增 `market.ts`：

```typescript
export type MarketResourceType = "game_card"

export interface MarketPackageUploader {
  id: string
  displayName: string
  avatarUrl: string | null
}

export interface MarketPackage {
  id: string
  resourceType: MarketResourceType
  cardId: string
  name: string
  summary: string
  coverUrl: string | null
  uploader: MarketPackageUploader
  downloadCount: number
  createdAt: string
}
```

在 `packages/contracts/src/index.ts` re-export。

## Compatibility & Rollback

- 新增表 `market_packages` 不影响现有 `users`/`auth_identities`/`sessions`
- 新增 `/api/v1/market/*` 路由不影响现有 `/api/v1/auth/*`
- 前端 `AppMarketView` 改造不涉及路由变更（`/market` 路由不变）
- 回滚：删除 `market_packages` 表 + `DataDir/market/` 目录 + 还原前端文件

## Tradeoffs

- **后端轻量 manifest 校验** vs 全量解压校验：选择轻量（只读 `game-card.json`），因为完整 zip 校验逻辑在前端 `importGameCardPackage` 已有，下载安装时前端会再校验一次。后端只防明显垃圾数据。
- **封面端点 vs base64 内嵌**：选择独立 `/cover` 端点，避免列表响应膨胀（封面图可能几百 KB）。
- **LIKE 搜索 vs FTS5**：MVP 用 LIKE，原型期数据量小，后续可加 FTS5 虚拟表。
