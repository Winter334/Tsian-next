# App Market (创意工坊)

## Goal

玩家以账号身份在创意工坊上传/下载整卡包作品，实现玩家间的作品分享。当前 MVP 只做整卡包分享，但 schema 预留 `resource_type`，未来可扩展为支持 Agent、Skill 等多种资源类型的创意工坊。

## Parent

- `.trellis/tasks/06-22-mvp-completion`

## Background

账号系统任务 `06-22-account-system` 已完成并归档：Go 后端支持 Discord OAuth + server-side session，`users + auth_identities + sessions` 表就绪，`middleware.RequireAuth` 注入 `*User` 到 ctx。本任务与账号系统共享同一 Go 后端。

## User Value

- 玩家可以上传自己的游戏卡包到市场，供其他玩家下载
- 玩家可以浏览、搜索、下载其他玩家的卡包并一键安装到本地
- 降低玩家间分享的门槛（复用现有 zip 导入导出机制）

## Confirmed Facts

- `AppMarketView.vue` 是空壳：本地安装按钮可用（调 `importPlatformGameCardPackage`），上传/搜索 disabled
- `exportPlatformGameCardPackage(cardId): Promise<Blob>` + `importPlatformGameCardPackage(Blob)` 已存在（`platform-host/game-cards.ts` → `storage/game-card-packages.ts`），完整 zip 校验/路径清洗/schema 验证就绪
- `GameCardManifest = { schema, id, name, version, summary, author?, cover?, frontend? }`（`packages/contracts/src/game-card.ts`）
- `GameCardAuthor = { name: string, url?: string }` — 极简，只有显示名和可选链接，没有 userId/handle/avatar。市场作者标识由后端关联 `users` 表提供，不依赖此字段
- `GameCardPackageManifest` schema `tsian.game-card.package.v1` = `{ schema, manifest, workspaceFiles[], frontendFiles[], coverFiles[], exportedAt, exporter }`
- 桌面应用入口已注册（`desktop-apps.ts` appId "market"，980×620，fullscreenable）
- Go 后端：stdlib net/http 无框架，`/api/v1/*` 路由，SQLite 单连接 WAL，`middleware.RequireAuth` 复用模式，`writeJSON` 响应模式
- `BlobStore` 接口已定义（`internal/storage/blobstore.go`：`Put(ctx,key,io.Reader)`/`Open(ctx,key)`/`Delete(ctx,key)`，流式）**未实现**
- `DataDir` 配置存在（默认 `data`）但运行时未消费；`schema_migrations` 表已建但未写入版本
- 后端约定：主键 TEXT UUID（`user.NewID()`），时间列 TEXT 存 RFC3339 UTC，外键 `ON DELETE CASCADE`，`SetMaxOpenConns(1)`
- Agent/Skill 当前是卡内工作区文件（`agents/<id>/agent.json`+`AGENT.md`+`SOUL.md`；`skills/<id>/SKILL.md`），不是独立可分享包

## Requirements

- R1: 整卡包分享（.tsian-card.zip），前端复用 `exportPlatformGameCardPackage` 生成 Blob 上传，下载后复用 `importPlatformGameCardPackage` 安装
- R2: 市场目录：卡包列表（封面 + 标题 + 简介 + 作者 + 下载量）、搜索（name+summary SQL LIKE）、排序（最新/下载量）。分类侧边栏硬编码占位，本期不生效
- R3: 上传：市场窗口内点"上传"按钮 → 弹出本地已安装卡包列表（从 IndexedDB 读取）→ 选中卡包 → `exportPlatformGameCardPackage` 生成 zip → multipart 上传到后端。需登录。上传时可选补充标题/简介（默认用 manifest 值）
- R4: 下载/安装：市场列表/详情点"下载安装" → 后端返回 zip Blob → 前端自动调 `importPlatformGameCardPackage` 安装。本地已有同 card_id 时提示"已安装，是否覆盖/另存为副本/取消"
- R5: 作者标识：市场列表/详情显示上传者 `displayName` + `avatarUrl`（后端 JOIN `users` 表），不依赖 `GameCardManifest.author`
- R6: 后端实现 `BlobStore` 接口的 `FileSystemBlobStore`（根目录 `cfg.DataDir`），所有文件操作走接口，不直接碰文件系统
- R7: 后端新增 `internal/market/` 包（domain types + Repository 接口 + SQLite 实现 + HTTP handler），路由注册到 `/api/v1/market/*`，上传/下载端点用 `middleware.RequireAuth` 包裹，列表/详情端点公开
- R8: 上传校验：最大 50MB；必须是有效 zip；含 `game-card.json` manifest；schema = `tsian.game-card.package.v1`；`name`/`version`/`summary` 非空。后端用 Go 实现轻量校验（不全量解压，只读 manifest）
- R9: 不做审核：上传后直接公开可见

## Decided

- **D1 文件存储**：本地磁盘（`DataDir/market/<packageId>.zip`）+ SQLite 元数据，通过 `BlobStore` 接口隔离。后续迁移对象存储只需换实现 + 一次性数据搬运。
- **D2 元数据 schema**：最小集字段 + `resource_type` 预留。表 `market_packages`：`id`（UUID）、`resource_type`（默认 `'game_card'`）、`card_id`、`name`、`summary`、`cover_blob_key`、`uploader_id`（FK users）、`download_count`、`created_at`、`updated_at`。后续扩展用 `ALTER TABLE ADD COLUMN`（O(1)）或关联表。
- **D3 产品定位**：创意工坊，未来支持卡包/Agent/Skill 多资源类型。`resource_type` 字段预留，MVP 只实现 `game_card`。
- **D4 上传入口**：市场窗口内选本地已安装卡包上传，不在"我的应用"做入口。
- **D5 下载安装**：下载后自动调 `importPlatformGameCardPackage`，同 card_id 冲突时提示覆盖/副本/取消。
- **D6 审核**：不做，上传后直接公开。

## Acceptance Criteria

- [ ] AC1: 后端 `FileSystemBlobStore` 实现 `BlobStore` 接口，文件存到 `DataDir/market/`，key 为 `market/<packageId>.zip`
- [ ] AC2: 后端 `market_packages` 表建表（含 `resource_type` 字段），`internal/market/` 包实现 Repository + HTTP handler
- [ ] AC3: `GET /api/v1/market/packages` 返回公开卡包列表（含上传者 displayName/avatarUrl），支持 `q` 搜索参数（name+summary LIKE）和 `sort` 参数（newest/downloads）
- [ ] AC4: `GET /api/v1/market/packages/:id` 返回单个卡包详情
- [ ] AC5: `POST /api/v1/market/packages`（RequireAuth）接收 multipart zip 上传，校验 50MB + manifest，存文件 + 写元数据，返回创建的条目
- [ ] AC6: `GET /api/v1/market/packages/:id/download` 返回 zip Blob，并 increment download_count
- [ ] AC7: 前端 `AppMarketView` 接入市场 API：列表渲染、搜索、排序、详情查看
- [ ] AC8: 前端上传流程：市场内点上传 → 选本地卡 → export 生成 zip → 上传 → 列表刷新
- [ ] AC9: 前端下载安装流程：点下载安装 → fetch zip → `importPlatformGameCardPackage` → 成功 toast；同 card_id 冲突时提示覆盖/副本/取消
- [ ] AC10: 前端市场列表显示上传者 displayName + avatarUrl（来自后端 JOIN users）
- [ ] AC11: 未登录用户可浏览/下载，点击上传时引导登录
- [ ] AC12: `npm run build:web` + `npm run build:contracts`（如有 contract 变更）通过
- [ ] AC13: Go 后端测试：上传/列表/详情/下载 API 集成测试通过（参考 `server_test.go` 模式）

## Out of Scope

- 细粒度资源市场（Agent/Skill 独立打包分享）— 后续版本（`resource_type` 已预留）
- 标签/分类/长描述/截图 — 后续 `ALTER TABLE ADD COLUMN`
- 评论/评分/社交功能 — 后续版本
- 付费/交易 — 不做
- 版本管理/更新推送 — 后续版本
- 审核机制 — 不做，上传直接公开
