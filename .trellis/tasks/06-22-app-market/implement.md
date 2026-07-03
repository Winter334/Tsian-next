# App Market — Implementation Plan

## Execution Order

### Phase A: Contract（前后端共享类型）

- [ ] A1: 新建 `packages/contracts/src/market.ts`：`MarketResourceType`、`MarketPackageUploader`、`MarketPackage`
- [ ] A2: 在 `packages/contracts/src/index.ts` re-export `market.ts`
- [ ] A3: `npm run build:contracts` 验证

### Phase B: Backend — Storage 层

- [ ] B1: `internal/storage/blobstore.go` 实现 `FileSystemBlobStore`（Put/Open/Delete）
- [ ] B2: `internal/storage/db.go` 追加 `market_packages` 建表 DDL + 索引
- [ ] B3: Go 编译验证：`go build ./...`（在 apps/platform-server）

### Phase C: Backend — Market 领域包

- [ ] C1: `internal/market/market.go`：领域类型（`Package`、`PackageWithUploader`、`ResourceType`、`Repository` 接口、`ListFilter`）
- [ ] C2: `internal/market/sqlite_repo.go`：`SQLiteRepository` 实现 `List`/`GetByID`/`Create`/`IncrementDownloadCount`（JOIN users 取上传者信息）
- [ ] C3: `internal/market/handler.go`：HTTP handler（`HandleList`/`HandleGet`/`HandleUpload`/`HandleDownload`）
  - 上传：multipart 50MB 限制 + `archive/zip` 读 `game-card.json` 轻量校验 + `blobStore.Put` + `repo.Create`
  - 下载：`blobStore.Open` + `io.Copy` + best-effort `IncrementDownloadCount`
- [ ] C4: `internal/server/server.go`：注册 `/api/v1/market/*` 路由，上传端点用 `middleware.RequireAuth` 包裹
- [ ] C5: Go 编译 + 测试：`go test ./...`

### Phase D: Backend — 测试

- [ ] D1: `internal/server/server_test.go` 追加市场 API 集成测试（参考现有 `TestAuthMockLoginMeLogout` 模式）：
  - mock-login 获取 session → 上传有效 zip → 列表含新条目 → 详情 → 下载 → download_count 递增
  - 未鉴权上传 → 401
  - 超大/无效文件 → 400
- [ ] D2: `go test ./...` 全部通过

### Phase E: Frontend — API 层

- [ ] E1: `apps/platform-web/src/platform-host/api-client.ts` 新增 `marketApi`（list/get/upload/download），复用 `apiFetch` + `API_BASE`
- [ ] E2: `apps/platform-web/src/platform-host/index.ts` re-export `marketApi`

### Phase F: Frontend — 视图改造

- [ ] F1: `AppMarketView.vue` 改造为状态机（list/detail/upload）：
  - 列表态：`marketApi.list()` 渲染卡包网格 + 搜索 + 排序
  - 详情态：`marketApi.get(id)` 渲染详情 + 下载安装按钮
  - 上传态：`listLocalGameCards()` 读本地卡 → 选中 → `exportPlatformGameCardPackage` → `marketApi.upload`
- [ ] F2: 下载安装流程：`marketApi.download` → `importPlatformGameCardPackage`；同 card_id 冲突提示
- [ ] F3: 未登录点击上传时引导登录（toast + 打开账号中心 或提示"请先登录"）

### Phase G: 质量验证

- [ ] G1: `npm run build:web` 通过
- [ ] G2: `npm run build:contracts` 通过（如有 contract 变更）
- [ ] G3: `go test ./...` 通过
- [ ] G4: 手动验证完整流程（dev server + mock-login）：上传 → 列表 → 搜索 → 详情 → 下载安装

## Validation Commands

```bash
# Contract
npm run build:contracts

# Backend
cd apps/platform-server && go build ./... && go test ./...

# Frontend
npm run build:web

# 全量
npm run build:contracts && cd apps/platform-server && go build ./... && go test ./... && cd ../.. && npm run build:web
```

## Risky Files / Rollback Points

- `internal/storage/db.go` — 追加 DDL，不改动现有表；回滚删除追加行
- `internal/server/server.go` — 追加路由注册，不改现有路由；回滚删除追加行
- `AppMarketView.vue` — 整体重写内容区，保留工具栏结构；回滚 git revert
- `api-client.ts` — 追加 `marketApi`，不改现有 `authApi`；回滚删除追加

## Review Gates

- Phase C 完成后：后端编译 + 单元测试通过，review handler 校验逻辑
- Phase D 完成后：集成测试通过，review API 契约符合 design.md
- Phase F 完成后：build:web 通过，手动验证上传/下载/安装完整流程
