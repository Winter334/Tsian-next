# App Market

## Goal

玩家以账号身份在应用商店上传/下载整卡包作品，实现玩家间的作品分享。

## Status

**方向性 PRD — 详细规划在附件上传 + 账号系统完成后展开。**

本任务依赖账号系统（06-22-account-system）提供身份，共享同一 Go 后端。当前先记录方向和已知约束。

## User Value

- 玩家可以上传自己的游戏卡包到市场，供其他玩家下载
- 玩家可以浏览、搜索、下载其他玩家的卡包并安装
- 降低玩家间分享的门槛（复用现有 zip 导入导出机制）

## Requirements（方向性）

- R1: 整卡包分享（.tsian-card.zip），复用现有 `exportGameCardPackage` / `importGameCardPackage` 机制
- R2: 市场目录：卡包列表、搜索、分类、详情页
- R3: 上传：玩家登录后可将本地卡包上传到市场（需账号）
- R4: 下载/安装：玩家可下载市场卡包并安装到本地
- R5: 作者标识：卡包绑定上传者 Discord 身份
- R6: 卡包 schema 规范：后续版本添加细粒度资源（预定义人物、世界设定等），本版只做整卡包

## Confirmed Facts

- `AppMarketView.vue` 是空壳：安装按钮可用（调 `importPlatformGameCardPackage`），上传/搜索 disabled
- `exportGameCardPackage(cardId): Promise<Blob>` + `importGameCardPackage(Blob)` 已存在（`storage/game-card-packages.ts`）
- `GameCardManifest` 有 `author?: GameCardAuthor` 字段（`packages/contracts/src/game-card.ts`）
- `GameCardPackageManifest` schema `tsian.game-card.package.v1` 已定义
- 桌面应用入口已注册（`desktop-apps.ts` appId "market"）

## Out of Scope

- 细粒度 schema 资源市场（预定义人物/世界设定单独分享）— 后续版本
- 评论/评分/社交功能 — 后续版本
- 付费/交易 — 不做
- 版本管理/更新推送 — 后续版本

## Open Questions（详细规划时解决）

- 市场卡包文件存储：Go 后端本地磁盘 / 对象存储（S3/R2）？
- 卡包元数据 schema：市场需要哪些字段（描述、标签、截图、分类）？现有 `GameCardManifest` 够不够？
- 搜索/分类的实现：数据库索引还是全文搜索？
- 上传大小限制和校验
- 市场审核机制？（MVP 可能不做）
- 与账号系统的后端架构统一设计
