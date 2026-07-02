# Implement — Account System (06-22-account-system)

执行顺序按此 checklist 推进。🚦 = 验证点。

## 阶段 1：后端骨架 + SQLite + SPA serve

- [x] 1.1 引入 `modernc.org/sqlite` 驱动（`go get`），go.mod 注释说明"唯一第三方依赖=SQLite 驱动"
- [x] 1.2 `internal/config/config.go`：读 env（`TSIAN_DISCORD_CLIENT_ID/SECRET`、`TSIAN_BASE_URL`、`TSIAN_DB_PATH`、`TSIAN_DATA_DIR`），带默认值
- [x] 1.3 `internal/storage/db.go`：打开 SQLite + `CREATE TABLE IF NOT EXISTS` users/sessions + schema_migrations，`WAL` 模式
- [x] 1.4 `internal/server/server.go`：Server struct 持有 db/config，注册路由（`/api/v1/*` + SPA serve + `/healthz`），SPA fallback（非 API 路径返回 index.html）
- [x] 1.5 SPA serve：embed 或 disk 读 `apps/platform-web/dist`（dev 用 disk，生产用 disk 路径，暂不 embed 避免构建耦合）
- [x] 1.6 middleware：`log.go`（请求日志）、`recover.go`（panic→500）
- [x] 1.7 重写 `cmd/platform-server/main.go`：读 config → 开 db → 构造 Server → ListenAndServe
- [x] 1.8 🚦 `npm run dev:server` 启动，`curl localhost:8080/healthz` 返回 ok，`curl localhost:8080/` 返回 SPA（或占位）
- [x] 1.9 🚦 `curl localhost:8080/api/v1/auth/me` 返回 401（路由存在但未实现 auth）

## 阶段 2：Discord OAuth + session

- [x] 2.1 `internal/auth/discord.go`：`AuthorizeURL(state)` 生成 authorize URL（scope=identify）、`Exchange(code)` 换 token、`FetchMe(token)` 拉用户
- [x] 2.2 `internal/user/user.go`：User domain type + `Repository` interface（`FindByDiscordID`、`Upsert`、`FindByID`）
- [x] 2.3 `internal/user/sqlite_repo.go`：SQLite 实现 Repository
- [x] 2.4 `internal/auth/session.go`：`GenerateToken()`（crypto/rand 32 字节 base64url）、`CreateSession(db,userID)`、`ValidateSession(db,token)` → userID
- [x] 2.5 `internal/auth/cookie.go`：`SetSessionCookie(w,token)`、`ClearSessionCookie(w)`（HttpOnly; Secure; SameSite=Lax; Path=/; MaxAge=30d）
- [x] 2.6 `internal/auth/handler.go`：
  - `HandleLogin`：生成 state（存 cookie short-lived）→ 302 authorize URL
  - `HandleCallback`：校验 state → exchange → fetchMe → Upsert user → CreateSession → SetCookie → 302 回前端 `/`
  - `HandleLogout`：删 session 行 → ClearCookie → 204
  - `HandleMe`：从 ctx 取 user → JSON `{id, discordId, username, avatarUrl}`
- [x] 2.7 `internal/middleware/auth.go`：读 cookie → ValidateSession → 注入 user 到 ctx；未登录不阻断（可选 auth），handler 自行判断
- [x] 2.8 路由注册：`GET /api/v1/auth/login|callback|me`、`POST /api/v1/auth/logout`，`/me` 套 required-auth wrapper（未登录 401）
- [x] 2.9 🚦 mock 模式：未注册 Discord 应用前，加 `TSIAN_MOCK_AUTH=1` 时 `/api/v1/auth/mock-login` 直接建假用户发 session，走通前后端
- [x] 2.10 🚦 注册 Discord 应用（client_id/secret）后，手测全流程：login → Discord → callback → me 返回用户

## 阶段 3：contracts + 前端 API client

- [x] 3.1 `packages/contracts/src/user.ts`：`User` interface，`src/index.ts` re-export
- [x] 3.2 🚦 `npm run build:contracts` 通过
- [x] 3.3 `apps/platform-web/src/platform-host/api-client.ts`：`apiFetch<T>`（credentials:'include' + JSON + 错误归一化）+ `authApi`（login/logout/me）
- [x] 3.4 `apps/platform-web/src/composables/useAuth.ts`：`currentUser` ref、`loggedIn` computed、`initAuth()`（启动调 me）、`login()`/`logout()`
- [x] 3.5 `apps/platform-web/vite.config.ts`：加 `server.proxy["/api"] = "http://localhost:8080"`
- [x] 3.6 🚦 dev 模式：前端调 `/api/v1/auth/me` 经 proxy 到后端，mock-login 后 me 返回用户

## 阶段 4：前端 UI 接入

- [x] 4.1 找到桌面 shell / AppHeader 的用户区，加登录入口（未登录："用 Discord 登录"按钮 → `authApi.login()`；登录：头像 + username + 登出）
- [x] 4.2 App 启动调 `initAuth()`（main.ts 或 App.vue onMounted）
- [x] 4.3 登录/登出反馈（toast）
- [ ] 4.4 🚦 手测：未登录看到登录按钮 → mock-login → 显示用户 → 登出 → 回未登录

## 阶段 5：生产部署配置

- [ ] 5.1 HTTPS：VPS 用 Caddy 反代（自动 TLS）或 Go 直接 TLS，确保 Secure cookie 生效
- [ ] 5.2 前端构建：`npm run build:web` → `apps/platform-web/dist` → Go serve
- [ ] 5.3 Discord 应用 redirect_uri 配生产 URL
- [ ] 5.4 systemd / 进程管理让 platform-server 常驻
- [ ] 5.5 🚦 生产手测：登录 → callback → me → 登出

## 阶段 6：最终质量门

- [x] 6.1 🚦 `npm run build:contracts` + `npm run build:web` 通过
- [x] 6.2 🚦 `go -C ./apps/platform-server build ./cmd/platform-server` 通过
- [x] 6.3 🚦 `go -C ./apps/platform-server vet ./...` 无错
- [x] 6.4 🚦 端到端：未登录 → 登录 → me 显示用户 → 登出 → me 401
- [ ] 6.5 🚦 重载恢复：登录后刷新页面，initAuth() 从 me 恢复登录态
- [x] 6.6 触发 `/trellis-check` 跑质量验证

## 回滚点

- Discord OAuth 走不通 → 用 mock-login 走通前后端，OAuth 排查独立做
- SQLite 驱动编译问题 → 换 mattn/go-sqlite3（需 cgo），interface 下零业务改动
- SPA serve 路径冲突 → 回退不 serve SPA，前后端独立部署（接受跨源 + CORS 配置）
- session cookie 在 dev 不工作 → 检查 Vite proxy 是否转发 cookie + SameSite 设置

## 风险文件

- `apps/platform-server/cmd/platform-server/main.go`：从 24 行占位扩成完整入口
- `apps/platform-server/internal/*`：全新建，后端骨架核心
- `apps/platform-web/src/platform-host/api-client.ts`：首个调 Tsian 后端的 fetch client
- `apps/platform-web/src/composables/useAuth.ts`：全局登录态，影响 market 等
- `packages/contracts/src/user.ts`：新增 User 类型，跨包契约
- `apps/platform-web/vite.config.ts`：dev proxy 配置
