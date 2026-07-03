# 优化创意工坊封面流量

## Goal

降低创意工坊列表与详情页展示封面时的图片流量，降低封面媒体资源的服务器存储占用，并移除当前列表最多只能取 50 条资源的发现上限。目标是避免用户上传高分辨率/大体积卡封面后，列表浏览触发大量原图下载，或服务端长期保存过大的封面文件，导致服务器带宽、存储、用户流量消耗和 Agent/Skill 资源发现能力超出预期。

## Background / Confirmed Facts

- 创意工坊列表卡片直接渲染 `pkg.coverUrl`：`apps/platform-web/src/components/market/MarketPackageGrid.vue:10-16`。
- 创意工坊详情页也直接渲染 `pkg.coverUrl`：`apps/platform-web/src/components/market/MarketPackageDetail.vue:3-9`。
- `MarketPackage.coverUrl` 目前只有单一 URL 字段，没有缩略图/多尺寸字段：`packages/contracts/src/market.ts:9-22`。
- 后端列表/详情响应只在存在 `CoverBlobKey` 时返回 `/api/v1/market/packages/{id}/cover`：`apps/platform-server/internal/market/handler.go:714-719`。
- 封面端点直接 `io.Copy` 原始 blob，并设置 `Cache-Control: public, max-age=3600`，没有缩放、压缩、转码：`apps/platform-server/internal/market/handler.go:311-345`。
- 上传时 `extractAndStoreCover` 从资源包里读取封面原始字节并直接存储，没有生成缩略图：`apps/platform-server/internal/market/handler.go:347-377`。
- 客户端导出卡包时把封面原始字节写进 zip：`apps/platform-web/src/storage/game-card-packages.ts:650-652`。
- 列表查询默认最多返回 50 条，没有分页 offset/cursor：`apps/platform-server/internal/market/sqlite_repo.go:49-55`。
- 前端 `marketApi.list` 没有分页参数且只返回 `MarketPackage[]`：`apps/platform-web/src/platform-host/api-client.ts:68-92`。
- 侧栏计数当前通过为每种资源类型额外调用一次 `marketApi.list` 实现：`apps/platform-web/src/views/AppMarketView.vue:308-318`。
- 当前后端 schema 只有 `cover_blob_key`，没有缩略图 blob key：`apps/platform-server/internal/storage/db.go:65-82`。
- 后端当前只有 `modernc.org/sqlite` 直接依赖，没有图片处理依赖：`apps/platform-server/go.mod:1-17`。
- 已发现本地真实样例封面约 8.07 MB；如果列表一次展示 50 张同级别原图，首次封面流量可达约 400 MB。

## Decisions

- D1. 本轮包含分页能力；原因是游戏卡可能短期不需要分页，但 Agent/Skill 很可能较快触及当前 50 条上限。
- D2. 分页形态采用后端 cursor 分页 + 前端手动“加载更多”，不做自动无限滚动。
- D3. 旧数据兼容/迁移不重要：目前没有真正用户数据，已有 market 数据都是可丢弃测试数据，因此不做旧数据回填或兼容保障。
- D4. 图片轻量化在上传时完成，不做访问时动态缩放，避免列表访问承担 CPU 密集图片处理。
- D5. 展示媒体使用 WebP，而不是 JPEG。
- D6. 详情/展示封面也要压缩，且可以稍微激进；当前展示方式有遮挡且焦点不在高清封面上，视觉差异可接受。
- D7. 为了真正节省服务器存储，服务端保存的可下载游戏卡 zip 中的封面也应规范化为压缩 WebP，不保留用户上传的超大封面原图。

## Requirements

- R1. 列表页必须使用 WebP 缩略图或等效低流量资源，不能为了小卡片展示下载完整展示封面/上传原图。
- R2. 详情页必须使用经过尺寸约束与 WebP 压缩的展示封面，不能直接保存/服务用户上传的超大原图作为 market 展示媒体。
- R3. 上传链路应生成至少两类派生媒体：列表 WebP 缩略图和详情/展示用 WebP 压缩图。
- R4. 服务端保存的下载 zip 应将封面规范化为 WebP，避免原始大图继续占用服务器存储；安装/下载的资源内容语义保持为“有封面”。
- R5. 本轮不要求兼容已有测试数据；允许通过重新上传/清空测试数据获得新封面能力。
- R6. 前端应避免不必要的封面请求，例如视口外图片提前下载、计数逻辑触发完整列表资源加载等。
- R7. 列表接口应支持 cursor + limit 分页，避免 50 条硬上限导致 Agent/Skill 资源无法继续发现。
- R8. 分页能力应和资源类型、搜索、Tag 过滤、排序共同工作；切换筛选条件时应重置到新结果集起点。
- R9. 前端列表 UX 采用手动“加载更多”增量加载；不要在用户未表达继续浏览意图时自动无限滚动。
- R10. 侧栏计数应使用轻量计数接口或等效机制，不再为每个资源类型拉取完整包列表。

## Acceptance Criteria

- [ ] 创意工坊网格卡片使用 `coverThumbUrl` 或同等 WebP 缩略图机制，而不是直接使用展示图 `coverUrl`。
- [ ] 网格图片具备浏览器级懒加载或等效的视口外请求抑制。
- [ ] 新上传游戏卡会生成 WebP 缩略图和 WebP 展示图。
- [ ] 新上传游戏卡保存的下载 zip 中不保留原 `cover/*` 大图，改为 `cover/cover.webp`，并同步 `game-card.json` 的 `coverFiles` 与内层 `manifest.cover.workspacePath`。
- [ ] `/cover` 与 `/cover-thumb` 端点返回 `image/webp`。
- [ ] 详情页仍能显示可接受质量的 WebP 封面。
- [ ] 侧栏计数不再依赖为每个资源类型拉取完整包列表。
- [ ] 用户可以通过“加载更多”访问超过首批结果之后的 Agent/Skill/游戏卡资源。
- [ ] 分页/增量加载在资源类型切换、搜索、Tag 过滤、排序切换后返回对应条件下的正确结果，并从首批结果重新开始。
- [ ] 相关后端测试、contracts 构建、web 构建通过。

## Out of Scope

- 不重新设计创意工坊上传流程的产品交互。
- 不做 CDN、对象存储迁移或外部图片服务接入。
- 不做已有测试 market 数据的缩略图回填、数据库迁移或展示兼容保障。
- 不做自动无限滚动；后端 cursor 可为未来升级保留基础。
- 不保证保留用户上传封面的原始无损/全分辨率版本作为 market 展示媒体或服务端 zip 内容。
