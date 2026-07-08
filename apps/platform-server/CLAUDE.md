# platform-server — 模块 CLAUDE.md

[根目录](../../CLAUDE.md) > [apps](../) > **platform-server**

---

## 1. 模块职责

官方后端（Go），当前承担：

- 平台 Web 静态资源供给（同源部署）
- Discord OAuth 登录与 server-side session
- 用户身份记录（SQLite）
- 平台接口骨架（`/api/v1/*`）
- 工坊 / 应用市场 / 模组分发 / 游玩前端包分发的后续后端承载点

---

## 2. 入口与启动

| 入口 | 路径 |
|------|------|
| 主入口 | `cmd/platform-server/main.go` |
| Module | `go.mod` (`module tsian/platform-server`, `go 1.24.0`) |

启动命令（来自根 `package.json`）：

```bash
npm run dev:server
# 等价于：go -C ./apps/platform-server run ./cmd/platform-server
```

默认监听 `:8080`，可用 `TSIAN_ADDR` 覆盖。

---

## 3. 对外接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/` / 任意非 API 路径 | serve `platform-web/dist` SPA（无构建产物时返回 `tsian platform-server` 占位文本） |
| `GET` | `/healthz` | 返回 `ok` |
| `GET` | `/api/v1/auth/login` | Discord OAuth 登录入口，302 到 Discord authorize URL |
| `GET` | `/api/v1/auth/callback` | Discord OAuth callback，换 token、拉 identity、按配置检查新注册身份组、建/更新用户、发 session cookie |
| `GET` | `/api/v1/auth/me` | 登录态返回 `{ id, handle, displayName, avatarUrl, authProviders }`，未登录 401 |
| `POST` | `/api/v1/auth/logout` | 删除 session 并清 cookie |
| `GET` | `/api/v1/auth/mock-login` | 仅 `TSIAN_MOCK_AUTH=true` 时启用的本地开发登录 |

---

## 4. 配置

| 变量 | 用途 | 默认 |
|---|---|---|
| `TSIAN_ADDR` | HTTP 监听地址 | `:8080` |
| `TSIAN_BASE_URL` | OAuth 回调基准 URL | `http://localhost:8080` |
| `TSIAN_DISCORD_CLIENT_ID` | Discord OAuth client id | 空 |
| `TSIAN_DISCORD_CLIENT_SECRET` | Discord OAuth secret | 空 |
| `TSIAN_DISCORD_REGISTRATION_GUILD_ID` | 限制新 Discord 注册必须来自的服务器 ID | 空 |
| `TSIAN_DISCORD_REGISTRATION_ROLE_IDS` | 允许新 Discord 注册的身份组 ID，逗号分隔 | 空 |
| `TSIAN_DB_PATH` | SQLite 数据库路径 | `data/tsian.db` |
| `TSIAN_DATA_DIR` | 后续市场/云存档文件根目录 | `data` |
| `TSIAN_STATIC_DIR` | platform-web build 输出目录 | `../platform-web/dist` |
| `TSIAN_COOKIE_SECURE` | session cookie 是否 `Secure` | `TSIAN_BASE_URL` 为 https 时 true |
| `TSIAN_MOCK_AUTH` | 开启 mock-login | false |

`TSIAN_DISCORD_REGISTRATION_GUILD_ID` 与 `TSIAN_DISCORD_REGISTRATION_ROLE_IDS` 需同时配置才会启用 Discord 新注册门槛；只配置其中一个时 OAuth 登录会 fail closed。门槛只检查首次创建账号的 Discord 身份，已注册身份后续登录不再检查服务器身份组。

---

## 5. 关键依赖

- Web 路由：Go stdlib `net/http`（不引入 chi/gin/echo）
- SQLite：`modernc.org/sqlite`（纯 Go，无 cgo）
  - 当前锁定 `v1.46.1` 以保持 `go 1.24.0` 兼容
  - 更新到更高版本前先检查 `go list -m -json modernc.org/sqlite@<version>` 的 `GoVersion`，避免把模块 Go 版本抬到 1.25+

---

## 6. 数据模型

启动时自动建表（`CREATE TABLE IF NOT EXISTS`）：

- `users`：Tsian 内部账号（`handle` / `display_name` / `avatar_url`）
- `auth_identities`：登录身份（`provider` + `subject` + 可选 `credential_hash`）。当前只创建 `provider='discord'`；后续可增加 `password` / `email_magic_link`，不需要推翻用户核心表。
- `sessions`：server-side session token + user_id + expires_at
- `schema_migrations`：预留后续迁移版本记录

本地 Dexie 数据不绑定账号；账号只作为市场与未来云存档的身份凭证。

---

## 7. 测试与质量

常用命令：

```bash
go -C ./apps/platform-server test ./...
go -C ./apps/platform-server build ./cmd/platform-server
go -C ./apps/platform-server vet ./...
```

`go build ./cmd/platform-server` 会在 Windows 上覆盖仓库内既有 `platform-server.exe`；验证后若不想提交二进制变更，执行：

```bash
git checkout -- apps/platform-server/platform-server.exe
```

---

## 8. 相关文件清单

- `cmd/platform-server/main.go`
- `internal/config/config.go`
- `internal/storage/db.go`
- `internal/auth/*`
- `internal/middleware/*`
- `internal/server/*`
- `internal/user/*`
- `go.mod`
- `README.md`

---

## 9. 变更记录 (Changelog)

| 时间 | 变更 |
|------|------|
| 2026-07-02 | 添加账号系统后端骨架、Discord OAuth、SQLite users/sessions、SPA serve |
| 2026-05-05 17:52:53 | 初始化架构师首次生成模块文档 |
