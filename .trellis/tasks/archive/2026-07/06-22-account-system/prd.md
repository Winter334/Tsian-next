# Account System

## Goal

每位玩家一个账号，以账号身份在应用商店上传/下载作品。自建 Go 后端，对接 Discord OAuth 登录。

## Parent

- `.trellis/tasks/06-22-mvp-completion`

## Status

详细规划完成（2026-07-02 brainstorm）。附件上传已完成解锁本任务规划。本任务与 06-22-app-market 共享 Go 后端，后端骨架按共享后端设计，市场域后续在 `/api/v1/market` 接入不返工。

## User Value

- 玩家拥有跨设备的身份（Discord 登录）
- 上传作品时绑定作者身份
- 下载作品时能识别作者

## Confirmed Facts（仓库证据）

- 当前无 user/account/auth 概念（packages/contracts 无 User 类型；bridge.ts 的 Session 是 play-bridge 用，不相关）
- Go platform-server 是 24 行占位（`apps/platform-server/cmd/platform-server/main.go`），仅 std lib `net/http`+`log`，零第三方依赖，无 DB
- 前端无 HTTP client 库，fetch 只调 LLM provider，不调 Tsian 后端
- 平台配置存 `.tsian/local/platform-config.json`（`local-platform-config.ts`），API key 在其中，与账号无关
- Dexie v13（`db.ts`）13 张表无 user/account 表；prototype schema 变更用破坏性重置（rename-and-reset，v12→v13 已做过）
- `AppMarketView.vue` 上传按钮 disabled，等待后端；`GameCardManifest.author` 仅 `{name, url?}`
- 前端无 OPFS / File System Access API，本地文件存 Dexie + `.tsian/local/*.json`
- 代码库无任何 Discord/OAuth 痕迹
- `.env` 仅 AI provider 配置（`VITE_AI_BASE_URL/API_KEY`），无后端 URL；前端 build 产物在 `apps/platform-web/dist`，vite.config.ts 当前无 proxy

## Requirements

- R1: Discord OAuth 登录（scope=identify，最小权限；不自建用户名/密码体系）
- R2: Go 后端提供 auth + 用户记录服务，API 前缀 `/api/v1`，路由 `/api/v1/auth/*`。账号核心采用 `users + auth_identities`，当前只落地 `provider="discord"`，为后续 `password` / `email_magic_link` 登录预留。
- R3: 前端新增 API client（fetch wrapper，`credentials:'include'`，configurable base URL 默认同源）
- R4: 账号身份与本地数据**完全隔离**——本地 Dexie 永远匿名，零 schema 改动，现有数据保留。账号仅作市场（及未来云存档）的身份凭证，不渗入本地存储层
- R5: 账号是应用商店的前置依赖（上传/下载需要身份）；account-system 提供登录态 + 入口，不强迫全站 gating

## Technical Notes（已决策）

- **部署形态**：自托管单实例 VPS，前后端**同源共置**——生产环境 Go 后端 serve 构建好的前端静态资源（`apps/platform-web/dist`），API 与前端同源同端口。当前不规划分布式拆分，但保留三个低成本习惯使未来拆分是局部改动而非重写：① API client 用 configurable base URL（默认空=同源相对路径）；② DB/存储藏 interface 后面；③ auth 逻辑收拢在单一 middleware。
- **鉴权**：httpOnly cookie（后端 set-cookie，前端 fetch 带 `credentials:'include'`）。同源 → 无 CORS、`SameSite=Lax` 即可、JS 读不到 token 防 XSS。开发模式唯一跨源场景（Vite `:5173` vs Go `:8080`）用 Vite dev server `proxy` 转发 `/api`，不污染生产架构。
- **Session**：server-side（SQLite 存 sessions 表），不用 JWT——同源单实例下 server session 更简单更安全且可吊销。
- **账号模型**：`users` 只表示 Tsian 内部账号（`handle` / `display_name` / `avatar_url`）；登录方式存在 `auth_identities`（`provider` + `subject` + 可选 `credential_hash`）。当前只实现 Discord OAuth：`provider="discord"`、`subject=Discord user id`。后续增加账密登录时新增 `provider="password"` identity；邮箱邀请 / magic link 可新增 `provider="email_magic_link"`，不需要推翻用户核心表。
- **Go web 框架**：std lib `net/http`（Go 1.22+ ServeMux 方法匹配+路径通配符够用），延续零 web 框架依赖。
- **SQLite 驱动**：`modernc.org/sqlite`（纯 Go，无 cgo），是本任务唯一第三方依赖——属数据库驱动而非 web 框架，与零 web 框架决策不冲突。当前锁定 `v1.46.1`，因为 `v1.46.2+` / 最新间接依赖会把模块 Go directive 抬到 1.25；本项目保持 `go 1.24.0`。
- **数据库**：SQLite 单文件，repository interface 抽象，保留迁移 Postgres 的路径。
- **对象存储**：卡包 zip 存本地磁盘（市场任务用），blobstore interface 抽象，保留迁移 S3/R2 的路径。
- **云存档哲学（未来独立任务，本任务不实现但须不阻绝）**：跨设备续玩走"显式存档包上云/下载"路径——存档 = save+checkpoints+workspaceFiles 的 zip，用账号身份上传/下载，复用现有 `exportGameCardPackage`/`importGameCardPackage` 同款 pattern。后端加 `/api/v1/saves` 域（与 `/api/v1/market` 同构）。不采用"本地 DB 账号化复制同步"（需 userId+syncState+冲突解决，过度设计）。故 account-system 只做 auth + 最小用户记录，零 Dexie 改动即可为云存档铺好地基。
- 账号 + 市场共享同一 Go 后端，API 统一前缀（`/api/v1`），路由按领域分组（`/api/v1/auth`、`/api/v1/market`、未来 `/api/v1/saves`）。

## Acceptance Criteria

- [ ] AC1: Go 后端启动，serve 前端 SPA + `/api/v1/auth/*` 路由 + `/healthz`
- [ ] AC2: Discord OAuth 全流程：login → Discord 授权 → callback → 建用户 + 发 session cookie → 302 回前端
- [ ] AC3: `GET /api/v1/auth/me` 登录态返回 `{id, handle, displayName, avatarUrl, authProviders}`，未登录返回 401
- [ ] AC4: `POST /api/v1/auth/logout` 删 session + 清 cookie，之后 me 返回 401
- [ ] AC5: 前端 API client + useAuth composable：app 启动 initAuth 从 me 恢复登录态
- [ ] AC6: 前端 UI 登录入口：未登录显示"用 Discord 登录"，登录显示用户信息 + 登出
- [ ] AC7: cookie 属性正确（HttpOnly; Secure 生产; SameSite=Lax; Path=/）
- [ ] AC8: 本地 Dexie 零改动（完全隔离），现有本地数据保留
- [ ] AC9: `npm run build:contracts` + `npm run build:web` 通过
- [ ] AC10: `go build ./cmd/platform-server` + `go vet ./...` 通过
- [ ] AC11: dev 模式 Vite proxy 转发 `/api` 到 `:8080`，cookie 同源生效
- [ ] AC12: 重载恢复：登录后刷新页面，initAuth() 从 me 恢复登录态

## Out of Scope

- 自建用户名/密码登录（只走 Discord OAuth）
- 账号系统的跨设备存档同步（云存档是独立未来任务，本任务不实现但须不阻绝）
- 邮箱/手机绑定
- 06-22-app-market 的市场域实现（共享后端骨架，市场路由占位，市场逻辑后续任务）
- 全站登录 gating（account-system 只提供登录态 + 入口，是否强制登录由各功能自定）
