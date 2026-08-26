# Tsian 此间

<p align="center">
  <strong>Agent-Orchestrated Runtime for AIRP</strong>
</p>

Tsian 是一个面向 AIRP（AI 角色扮演）的 Agent 编排运行时平台。

平台提供模型调用、运行时工作区、存档与 checkpoint、游戏前端沙箱、账号与资源分发等通用能力；具体玩法由游戏卡中的 Agent、Skill、Tool、世界资料和前端共同定义。事件、角色、记忆与状态等玩法语义以工作区文件约定存在，不由平台硬编码。

> 项目仍在快速迭代。浏览器本地数据结构可能随版本重置，当前不保证为早期原型数据提供迁移。

## 这是什么

Tsian 用一张“游戏卡”组织一套完整的 AIRP 体验。作者可以把 Agent 阵容、Skill 能力、原生 Tool、世界设定、运行时约定和游戏前端打包分发；玩家导入或从创意工坊安装后，即可基于这张卡创建独立存档。

### 当前能力

- **游玩**：运行由主控 Agent 与专业 Agent 协作驱动的叙事回合，支持流式输出、工具调用、存档和回滚
- **创作**：在工作室与资源管理器中编辑 Agent、Skill、Tool、卡内容和游戏前端源码，并由桌面助手协助维护
- **分发**：通过创意工坊上传、安装和更新游戏卡、Agent、Skill 与 Tool 资源
- **同步**：登录后可创建、恢复和自动更新云存档备份；本地数据仍以浏览器 IndexedDB 为主
- **运维**：Go 服务端提供 Discord OAuth、市场、云备份、公告、在线状态和管理端 API

### 核心概念

| 概念 | 说明 |
|---|---|
| **游戏卡（Game Card）** | 可复用的工作区内容模板与可选前端绑定。一张卡可以创建多个互相独立的存档。 |
| **存档（Save Instance）** | 一次游玩的运行时数据容器，主要挂载到工作区的 `save/` 下，并支持 checkpoint 回滚。 |
| **Agent** | AIRP 回合的执行者。玩家入口 Agent 负责组织回合，专业 Agent 可通过 `agent_call` 按需协作。 |
| **Skill** | 按需加载的能力包，可包含指导内容与受控浏览器脚本 action。 |
| **Tool** | 可分发的原生函数工具定义，为 Agent 提供结构化平台能力。 |
| **Runtime Workspace** | 游戏卡内容、当前存档和平台元数据组成的虚拟文件系统，也是玩法状态的主要承载层。 |
| **游戏前端** | 游戏卡绑定的远程或随卡静态前端，在 sandboxed iframe 中运行，并通过 Play Bridge 访问平台。 |
| **桌面助手** | 平台级管理 Agent，用于理解框架、检查工作区、创作内容和编辑前端。 |

## 快速开始

建议使用 Node.js 22。运行完整服务端还需要 Go 1.24；也可以使用 Docker 完成构建与部署。

```bash
npm ci
```

### 仅启动平台前端

适合开发 Agent Runtime、工作区、游戏卡和前端交互：

```bash
npm run dev:web
```

按 Vite 输出的地址访问平台，默认是 `http://localhost:5173`。本地游玩和创作数据保存在浏览器 IndexedDB；登录、创意工坊、云备份与公告等在线能力需要同时启动 Go 服务端。

首次游玩前，请在平台控制面板中配置 AI 服务商、API 地址、密钥和模型。本地开发也可以通过 `apps/platform-web/.env.local` 设置 `VITE_AI_BASE_URL`、`VITE_AI_API_KEY` 和 `VITE_AI_MODEL` 作为默认配置。

### 启动完整本地环境

先将 `apps/platform-server/.env.example` 复制为 `apps/platform-server/.env.local`。示例文件已按 Vite 默认地址配置 `TSIAN_BASE_URL=http://localhost:5173`；如需 Discord 登录，请补充 OAuth 凭据。只测试本地账号流程时，可设置 `TSIAN_MOCK_AUTH=true`。

分别在两个终端运行：

```bash
# 终端 1：Go API，默认 http://localhost:8080
npm run dev:server

# 终端 2：平台 Web，自动代理 /api 到 8080
npm run dev:web
```

管理端可单独启动：

```bash
npm run dev --workspace admin-web
```

管理权限由服务端的 `TSIAN_ADMIN_DISCORD_IDS` 配置控制。

## Docker 部署

将 `deploy/.env.example` 复制为 `deploy/.env`，至少设置真实的 `TSIAN_BASE_URL`，并按需配置 Discord OAuth、管理员账号和宿主机数据目录。然后在仓库根目录运行：

```bash
docker compose --env-file deploy/.env -f deploy/compose.yml up -d --build
```

默认绑定 `127.0.0.1:18080`。平台位于 `/`，管理端位于 `/admin/`，SQLite 数据库、市场资源和云备份文件保存在挂载的数据目录中。

生产环境应通过 HTTPS 反向代理暴露服务，并保持 `TSIAN_COOKIE_SECURE=true`。

## 架构

```text
+------------------------------- Browser --------------------------------+
|                                                                        |
|  Platform Web                                                          |
|  - desktop shell / studio / resource manager / market                  |
|  - Agent Runtime / model providers / runtime diagnostics               |
|  - Game Card / Save / Checkpoint / Runtime Workspace                   |
|  - IndexedDB local storage                                             |
|                                                                        |
|          postMessage Play Bridge                                       |
|                    |                                                   |
|                    v                                                   |
|       sandboxed iframe: packaged or remote game frontend               |
+-----------------------------+------------------------------------------+
                              |
                              | /api/v1
                              v
+--------------------------- Go Server ----------------------------------+
| Discord OAuth / session / market / cloud backup / announcements        |
| presence / admin API / static hosting                                  |
| SQLite metadata + filesystem blob storage                              |
+------------------------------------------------------------------------+
```

### 一回合 AIRP 如何运行

1. 游戏前端通过 Play Bridge 发送玩家输入
2. 平台加载当前游戏卡配置的玩家入口 Agent，并组装 Agent 上下文与可见 Skill 索引
3. Agent 可使用 `read`、`list`、`search`、`write`、`edit`、`use_skill`、`run_script`、`agent_call` 等受控工具
4. 专业 Agent 使用自己的上下文、Skill 和联系人继续协作，并把结果作为 observation 返回调用方
5. 成功回合原子提交 `save-runtime` 变更、历史、Agent session、trace 和 checkpoint；失败或中止时丢弃本轮普通存档写入
6. 最终正文与运行事件流式推送给游戏前端

### 工作区权限模型

| Scope | 典型路径 | 编辑级别 | 用途 |
|---|---|---:|---|
| `card-content` | `agents/`、`skills/`、`tools/`、`world/`、`docs/`、`game-card.json` | 2 | 可分发的游戏卡内容与定义 |
| `card-frontend` | `frontend/` | 2 | 随卡打包的前端静态文件 |
| `save-runtime` | `save/` | 1 | 当前存档的历史、世界状态、记忆与 Agent session |
| `platform-meta` | `.tsian/` | 4 | 平台配置、诊断 trace 与本地助手数据 |

运行时游戏 Agent 通常使用 level 1，只能维护存档数据；受信任的桌面助手使用更高权限管理游戏卡内容和平台元数据。

## 仓库结构

```text
apps/
  platform-web/       Vue 平台壳、Agent Runtime、Runtime Workspace 与本地存储
  platform-server/    Go API、SQLite、资源文件存储与同源静态托管
  admin-web/          创意工坊与公告管理端
  play-frontend-dev/  沉浸阅读器游戏前端源码与开发入口
packages/
  contracts/          跨前端、服务端和 SDK 使用的 TypeScript 契约
  play-bridge/        游戏前端访问平台能力的 Bridge SDK
  web-utils/          平台 Web 与管理端共享的 Web 工具
cards/
  沉浸阅读器.tsian-card/  默认整卡的清单、工作区内容与封面源文件
deploy/               Docker Compose 与部署环境变量示例
docs/                 当前方向、实现状态、SDK 与维护边界
scripts/              前端资源和整卡打包、浏览器验证脚本
```

## 构建与验证

```bash
# 构建所有前端、共享包和 Go 服务端
npm run build:all

# 运行 Web 与服务端 smoke tests
npm test

# 完整构建、smoke tests 和生产浏览器预检
npm run verify
```

也可以按模块构建：

```bash
npm run build:web
npm run build:admin
npm run build:play-frontend
npm run build:server
npm run build:contracts
npm run build:play-bridge
npm run build:web-utils
```

### 游戏前端与整卡打包

`apps/play-frontend-dev` 是沉浸阅读器的前端源码。开发时可以单独启动：

```bash
npm run dev:frontend
```

将前端源码打包为可导入资源：

```bash
npm run package:frontend
```

生成沉浸阅读器整卡时，打包脚本会调用平台真实的浏览器端 frontend build、write-back 与 export 链，并验证最终卡包：

```bash
# 默认输出到 tmp/card-packages/
npm run package:card

# 显式指定输出路径
npm run package:card -- --out tmp/card-packages/immersive-reader.tsian-card.zip
```

同日重复打包会使用递增序号，不覆盖已有默认产物。卡元数据来自 `cards/沉浸阅读器.tsian-card/card-manifest.json`，卡内容、封面和前端分别来自该卡的 `workspace/`、`cover/` 与 `apps/play-frontend-dev/src/`。

## 当前状态

已经落地的主干能力包括：

- Agent Runtime 工具循环、contacts-gated `agent_call`、Skill 按需加载与浏览器脚本 action
- Game Card、Save Instance、checkpoint、导入导出以及 packaged / remote 游戏前端
- Runtime Workspace 四 scope 权限模型、事务式回合写入、历史、Agent session 和诊断 trace
- 桌面助手、工作室、资源管理器、系统监视器与游戏前端检查能力
- Discord OAuth、创意工坊、云存档备份、公告、在线状态与管理端

仍在持续演进的部分包括默认创作流程、上下文与 session 生命周期、记忆维护策略、运行时可观察性，以及账号与分发体验的完善。

## 技术栈

- **平台与管理端**：Vue 3、TypeScript、Vite、Tailwind CSS
- **本地存储**：Dexie / IndexedDB
- **后端**：Go 1.24、`net/http`、SQLite（`modernc.org/sqlite`）、文件系统 blob storage
- **游戏前端通信**：sandboxed iframe、`postMessage`、`@tsian/play-bridge`
- **部署**：Docker、Docker Compose

## 文档

- [docs/README.md](docs/README.md) - 文档阅读顺序与当前可信入口
- [docs/active/current-state-handoff.md](docs/active/current-state-handoff.md) - 当前实现状态与关键代码入口
- [docs/active/airp-workflow-platform-direction.md](docs/active/airp-workflow-platform-direction.md) - 平台产品与架构方向
- [docs/active/agent-framework-runtime-workspace-direction.md](docs/active/agent-framework-runtime-workspace-direction.md) - Agent、Skill 与 Runtime Workspace 方向
- [docs/active/play-frontend-sdk-direction.md](docs/active/play-frontend-sdk-direction.md) - 游戏前端与 Bridge SDK 方向
- [docs/sdk/play-frontend-api.md](docs/sdk/play-frontend-api.md) - Play Bridge API 参考
- [docs/active/documentation-map.md](docs/active/documentation-map.md) - 仓库文档、平台助手知识与游戏卡文档的维护边界
