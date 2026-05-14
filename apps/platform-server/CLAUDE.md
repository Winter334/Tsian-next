# platform-server — 模块 CLAUDE.md

[根目录](../../CLAUDE.md) > [apps](../) > **platform-server**

---

## 1. 模块职责

官方后端骨架（Go）。规划职责：

- 平台接口
- 工坊
- 模组分发
- 游玩前端包分发
- 平台级元信息管理

当前实现状态：**仅占位**。只有两个 HTTP 端点 (`/`、`/healthz`) 用于验证部署链路。

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

默认监听 `:8080`。

---

## 3. 对外接口

| 路径 | 说明 |
|------|------|
| `GET /` | 返回 `tsian platform-server` |
| `GET /healthz` | 返回 `ok` |

---

## 4. 关键依赖与配置

- 仅使用 Go 标准库 `net/http` / `log`
- 无第三方依赖、无配置文件、无数据库

---

## 5. 数据模型

**N/A** — 当前未引入持久化层。

---

## 6. 测试与质量

**N/A** — 当前无测试。

---

## 7. 常见问题 (FAQ)

**Q：为什么这么简陋？**
A：原型期重心在平台 WebUI 本地运行时；后端等主链稳定后再展开。

---

## 8. 相关文件清单

- `cmd/platform-server/main.go`
- `go.mod`
- `README.md`

---

## 9. 变更记录 (Changelog)

| 时间 | 变更 |
|------|------|
| 2026-05-05 17:52:53 | 初始化架构师首次生成模块文档 |

---

_文档生成时间：2026-05-05 17:52:53_
