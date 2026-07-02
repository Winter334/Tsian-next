# Design — Account System (06-22-account-system)

技术设计。本任务与 06-22-app-market 共享 Go 后端，本设计只覆盖账号系统域（auth + 用户记录），但后端骨架（路由前缀、middleware、SQLite/存储 interface、前端静态 serve）按共享后端设计，市场域后续在 `/api/v1/market` 接入不返工。

## 1. 架构总览

```
┌─────────────────────── VPS (单实例，同源) ───────────────────────┐
│                                                                  │
│  Browser ──► Go platform-server (:8080)                          │
│               ├─ /            → serve platform-web/dist (SPA)    │
│               ├─ /assets/*    → serve 静态资源                    │
│               ├─ /api/v1/auth/*  → auth 域 (Discord OAuth)        │
│               ├─ /api/v1/market/* → 市场域 (本任务不实现，占位)    │
│               └─ /healthz      → ok                              │
│                                                                  │
│               SQLite (tsian.db) ── users 表                      │
│               data/              ── 卡包 zip (市场用，interface)  │
└──────────────────────────────────────────────────────────────────┘
```

**同源**是鉴权简化的前提：浏览器看 `https://tsian.example/`，API 与 SPA 同 origin，httpOnly cookie 天然同源，无 CORS、`SameSite=Lax` 即可。

## 2. 后端 Go 结构

延续零第三方依赖惯例，用 std lib `net/http`（Go 1.22+ ServeMux 方法匹配 + 路径通配符）。

```
apps/platform-server/
├── cmd/platform-server/main.go   # 入口，注册路由，serve SPA + API
├── internal/
│   ├── server/
│   │   └── server.go             # Server struct，路由注册，SPA fallback
│   ├── middleware/
│   │   ├── log.go                # 请求日志
│   │   ├── recover.go            # panic recover
│   │   └── auth.go               # cookie 校验 → 注入 user 到 ctx
│   ├── auth/
│   │   ├── discord.go            # OAuth 流程（authorize URL / token exchange / me）
│   │   ├── handler.go            # /login, /callback, /logout, /me handlers
│   │   ├── session.go            # session token 生成/校验（HMAC）
│   │   └── cookie.go             # httpOnly cookie 设置/清除
│   ├── user/
│   │   ├── user.go               # User domain type + repository interface
│   │   └── sqlite_repo.go        # SQLite 实现
│   ├── storage/
│   │   ├── db.go                 # SQLite 打开 + migration
│   │   └── blobstore.go          # 卡包 zip 存储 interface（本地磁盘实现，市场用）
│   └── config/
│       └── config.go             # env 读取（Discord creds, baseURL, dbPath, dataDir）
├── go.mod
└── data/                         # 运行时数据（tsian.db, market/packages/）
```

**注意 SQLite 驱动**：std lib `database/sql` 不含 SQLite 驱动，需要引入一个纯 Go 驱动（`modernc.org/sqlite`，无 cgo，跨平台编译简单）。这是本设计**唯一的第三方依赖**——属于"数据库驱动"而非"web 框架"，与"零 web 框架"决策不冲突。在 go.mod 记录理由。当前锁定 `v1.46.1` 以保持 `go 1.24.0`；`v1.46.2+` / 最新间接依赖会把模块 Go directive 抬到 1.25，更新前需先查 `GoVersion`。

## 3. Discord OAuth 流程

### 3.1 路由

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/auth/login` | 302 重定向到 Discord authorize URL |
| GET | `/api/v1/auth/callback` | Discord 回调，换 token + 拉 me + 建/更新用户 + 发 session cookie + 302 回前端 |
| POST | `/api/v1/auth/logout` | 清 session（DB 删 session 行）+ 清 cookie |
| GET | `/api/v1/auth/me` | 返回当前用户 `{id, discordId, username, avatarUrl}` 或 401 |

### 3.2 流程

```
1. 用户点"用 Discord 登录" → 前端 GET /api/v1/auth/login
2. 后端 302 → https://discord.com/oauth2/authorize?client_id=...&scope=identify&redirect_uri=<callback>&response_type=code&state=<random>
   scope=identify（只要 id+username+avatar，不要 email/guilds，最小权限）
3. Discord 登录确认 → 302 回 <callback>?code=...&state=...
4. 后端校验 state（防 CSRF）→ POST https://discord.com/api/oauth2/token 换 access_token
5. GET https://discord.com/api/users/@me（Bearer access_token）→ {id, username, avatar}
6. 查/建 users 表行（discord_id 唯一键）→ 生成 session token → 存 sessions 表 → set httpOnly cookie → 302 回前端 SPA
```

### 3.3 Session 机制

- 不用 JWT（同源单实例，server-side session 更简单更安全）。
- session token = 32 字节随机 + base64url，存 sessions 表 `(token, user_id, expires_at, created_at)`。
- `auth` middleware 读 cookie → 查 sessions 表 → 未过期则注入 `user` 到 `r.Context()`。
- cookie 属性：`HttpOnly; Secure(生产); SameSite=Lax; Path=/; MaxAge=30天`。

## 4. 数据模型（SQLite）

```sql
-- Tsian 内部账号。不要把 Discord 字段直接塞在 users 上，避免后续账密/邮箱登录重构。
CREATE TABLE users (
  id           TEXT PRIMARY KEY,           -- UUIDv4，内部用户 ID
  handle       TEXT NOT NULL UNIQUE,       -- Tsian 内部 handle，后续账号中心可编辑
  display_name TEXT NOT NULL,              -- 当前展示名；Discord 首登时取 Discord username
  avatar_url   TEXT,
  created_at   TEXT NOT NULL,              -- RFC3339
  updated_at   TEXT NOT NULL
);

-- 登录身份。当前只实现 provider='discord'；后续可加 password/email_magic_link。
CREATE TABLE auth_identities (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,            -- discord | password | email_magic_link
  subject         TEXT NOT NULL,            -- Discord user id / username / email
  credential_hash TEXT,                     -- password provider 才写；Discord 为空
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE(provider, subject)
);
CREATE INDEX idx_auth_identities_user ON auth_identities(user_id);

-- Session（server-side）
CREATE TABLE sessions (
  token       TEXT PRIMARY KEY,           -- 32 字节随机 base64url
  user_id     TEXT NOT NULL REFERENCES users(id),
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
```

migration：启动时 `CREATE TABLE IF NOT EXISTS`，version 0 起步，未来在 schema_migrations 表记版本。

## 5. 前端集成

### 5.1 API client（platform-web 新增）

新建 `apps/platform-web/src/platform-host/api-client.ts`：

```ts
// 配置：baseURL 默认空 = 同源相对路径，未来拆分可设环境变量
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ""

// 统一 fetch wrapper：带 credentials:'include'（cookie），JSON 处理，错误归一化
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> { ... }

// 领域方法
export const authApi = {
  login: () => { window.location.href = `${API_BASE}/api/v1/auth/login` },
  logout: () => apiFetch<void>("/api/v1/auth/logout", { method: "POST" }),
  me: () => apiFetch<User | null>("/api/v1/auth/me"),
}
```

### 5.2 auth 状态（composable）

新建 `apps/platform-web/src/composables/useAuth.ts`：
- `currentUser = ref<User | null>(null)`
- `loggedIn = computed(() => currentUser.value !== null)`
- `initAuth()`：app 启动调 `authApi.me()` 填充（未登录静默 401→null）
- `login()`/`logout()`：调 api，logout 后清 ref

### 5.3 contracts 新增 User 类型

`packages/contracts/src/user.ts`（新文件，re-export 到 index.ts）：

```ts
export type AuthProvider = "discord" | "password" | "email_magic_link"

export interface User {
  id: string
  handle: string
  displayName: string
  avatarUrl: string | null
  authProviders: AuthProvider[]
}
```

### 5.4 UI 接入点

- AppHeader / 桌面 shell 加"用 Discord 登录"按钮（未登录）/ 用户头像+用户名+登出（登录）。
- 登录态是 market 上传的前提（market 任务用），account-system 只提供状态 + 入口，不强迫全站 gating。

## 6. 配置（env）

| 变量 | 用途 | dev 默认 |
|---|---|---|
| `TSIAN_DISCORD_CLIENT_ID` | OAuth client ID | 必填 |
| `TSIAN_DISCORD_CLIENT_SECRET` | OAuth secret | 必填 |
| `TSIAN_BASE_URL` | 回调绝对 URL（`https://tsian.example/api/v1/auth/callback`） | `http://localhost:8080` |
| `TSIAN_DB_PATH` | SQLite 路径 | `data/tsian.db` |
| `TSIAN_DATA_DIR` | 卡包 zip 根（市场用） | `data/` |

**前端**：`VITE_API_BASE_URL`（默认空=同源），仅未来拆分时设。

## 7. 开发模式（Vite proxy）

生产同源无需 proxy。开发模式前端 `:5173`，后端 `:8080` 跨源——`vite.config.ts` 加：

```ts
server: {
  proxy: {
    "/api": "http://localhost:8080",   // API 转发，cookie 同源生效
  },
},
```

OAuth 回调在 dev 下需 `TSIAN_BASE_URL=http://localhost:5173`（回调走 Vite，proxy 转到后端）。

## 8. 安全要点

- httpOnly + SameSite=Lax + Secure(生产)：JS 读不到 token，CSRF 靠 Lax 限制跨站 GET 之外的方法。
- OAuth `state` 随机值防 CSRF（存 cookie 或内存，callback 校验）。
- Discord access_token 不存 DB（只用于一次性拉 me），session 用自生成 token。
- `identify` scope 最小权限（不要 email/guilds）。
- logout 删 sessions 行 + 清 cookie。

## 9. 与云存档哲学的兼容性

本设计**不阻绝**未来云存档（Philosophy B）：
- `/api/v1/saves` 域可同构接入（同 auth middleware + 同 SQLite + 同 blobstore interface）。
- 前端 API client 的 `apiFetch` 可直接复用。
- 本地 Dexie 零改动，云存档是"存档包 zip 的账号级上/下载"，与本地存储层无关。

## 10. 关键权衡

| 决策 | 选择 | 替代 | 理由 |
|---|---|---|---|
| web 框架 | std lib ServeMux | chi | 路由量小，1.22+ ServeMux 够用，延续零依赖 |
| session | server-side (DB) | JWT | 同源单实例，server session 更简单更安全，可吊销 |
| token 存储 | httpOnly cookie | localStorage Bearer | 同源，防 XSS 偷 token |
| SQLite 驱动 | modernc.org/sqlite (纯 Go) | mattn/go-sqlite3 (cgo) | 无 cgo，跨平台编译简单 |
| 本地数据 | 完全隔离 | userId 绑定 | 云存档走存档包上云，无需本地账号化 |
| OAuth scope | identify | identify+email | 最小权限，不要 email |

## 11. 风险与回滚

- Discord 应用未注册 → 本地无法测 OAuth；mit：先写 mock `/api/v1/auth/mock-login` 走通前后端，Discord 应用注册后再切真流程。
- VPS HTTPS 未配 → Secure cookie 不生效；mit：生产用 Caddy/nginx 终止 TLS，或 Go 直接 ListenAndServeTLS（证书用 Caddy 自动签）。
- modernc.org/sqlite 性能 → hobby 规模无压力；若未来成瓶颈，interface 抽象下换 mattn/go-sqlite3 或 Postgres。
