# Account System

## Goal

每位玩家一个账号，以账号身份在应用商店上传/下载作品。自建 Go 后端，对接 Discord OAuth 登录。

## Status

**方向性 PRD — 详细规划在附件上传完成后展开。**

本任务与 06-22-app-market 共享 Go 后端，架构需统一设计。当前先记录方向和已知约束，避免在后端架构未定型时过度设计。

## User Value

- 玩家拥有跨设备的身份（Discord 登录）
- 上传作品时绑定作者身份
- 下载作品时能识别作者

## Requirements（方向性）

- R1: Discord OAuth 登录（不自建用户名/密码体系）
- R2: Go 后端提供 auth + 用户数据 + 市场目录服务
- R3: 前端对接后端 API（当前纯本地，无任何 API client）
- R4: 账号身份与本地数据的关系：登录后本地数据是否绑定账号？跨设备同步范围？（待定）
- R5: 账号是应用商店的前置依赖（上传/下载需要身份）

## Confirmed Facts

- 当前无 user/account/auth 概念（packages/contracts 无 User 类型）
- Go platform-server 是只有 `/healthz` 的占位（`apps/platform-server/cmd/platform-server/main.go` 24 行）
- 前端无 HTTP client 库，只用浏览器原生 fetch（且只调 LLM provider，不调 Tsian 后端）
- API key 存 localStorage（`tsian-platform-config`），与账号无关
- `AppMarketView.vue` 上传按钮 disabled，等待后端

## Out of Scope

- 自建用户名/密码登录（只走 Discord OAuth）
- 账号系统的跨设备存档同步（后续版本）
- 邮箱/手机绑定

## Open Questions（详细规划时解决）

- Go 后端技术栈：用什么 web 框架？数据库选什么（SQLite/Postgres）？对象存储（市场卡包文件）用什么？
- Discord OAuth 的具体 scope 和回调流程
- 账号 token 存哪（localStorage / cookie / Dexie）
- 本地数据（Dexie）与账号身份的关系
- 后端部署形态（自托管 / 云平台）
- 06-22-app-market 的 PRD 需要和本任务一起细化，因为共享后端
