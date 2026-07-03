# platform-server

官方后端。

当前负责：

- 平台 Web 静态资源供给（同源部署）
- Discord OAuth 登录与 server-side session
- 用户身份记录（SQLite，`users + auth_identities`，当前只启用 Discord identity）
- 平台接口骨架（`/api/v1/*`）
- 工坊 / 应用市场 / 模组分发 / 游玩前端包分发的后续后端承载点

## 启动

```bash
npm run dev:server
# 等价于：go -C ./apps/platform-server run ./cmd/platform-server
```

默认监听 `:8080`。

## 关键环境变量

| 变量 | 用途 | 默认 |
|---|---|---|
| `TSIAN_ADDR` | HTTP 监听地址 | `:8080` |
| `TSIAN_BASE_URL` | OAuth 回调基准 URL | `http://localhost:8080` |
| `TSIAN_DISCORD_CLIENT_ID` | Discord OAuth client id | 空 |
| `TSIAN_DISCORD_CLIENT_SECRET` | Discord OAuth secret | 空 |
| `TSIAN_DB_PATH` | SQLite 数据库路径 | `data/tsian.db` |
| `TSIAN_DATA_DIR` | 后续市场/云存档文件根目录 | `data` |
| `TSIAN_STATIC_DIR` | platform-web build 输出目录 | `../platform-web/dist` |
| `TSIAN_COOKIE_SECURE` | session cookie 是否 `Secure` | `TSIAN_BASE_URL` 为 https 时 true |
| `TSIAN_MOCK_AUTH` | 开启 `/api/v1/auth/mock-login` 开发登录 | false |

## 数据模型

账号核心使用可扩展 identity 模型：

- `users`：Tsian 内部账号（`handle` / `display_name` / `avatar_url`）
- `auth_identities`：登录身份（`provider` + `subject` + 可选 `credential_hash`）。当前只创建 `provider='discord'`，后续可增加 `password` / `email_magic_link`。
- `sessions`：server-side session token

## 依赖说明

Web 路由继续使用 Go stdlib `net/http`。SQLite 驱动使用 `modernc.org/sqlite`（纯 Go，无 cgo），当前锁定 `v1.46.1` 以保持 `go 1.24.0` 兼容；更新到更高版本前需确认不会把模块 Go 版本抬到 1.25+。
