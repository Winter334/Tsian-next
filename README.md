# Tsian 此间

<p align="center">
  <strong>Agent-Orchestrated Runtime for AIRP</strong>
</p>

Tsian 是一个面向 AIRP（AI 角色扮演）的 Agent 编排运行时平台。

平台托管模型调用、本地存储和存档生命周期；Agent 协作组织每一回合的叙事；游戏前端包负责界面呈现。玩法语义——事件、角色、记忆、状态——以工作区文件约定存在，平台不硬编码玩法模型。

## 这是什么

Tsian 让你用一个"游戏卡"定义一整套 AIRP 体验：Agent 阵容、Skill 能力包、世界设定、游戏前端，全部是可编辑的文件。玩家导入卡包即可开始游玩，平台负责运行 Agent 回合、管理存档和回滚、在沙箱中渲染前端。

### 你能做什么

- **玩**：导入游戏卡，通过卡自带的前端界面与 AI 角色互动，体验由多 Agent 协作产出的叙事
- **创作**：用桌面助手引导你创建 Agent、Skill、世界设定和游戏前端——全是工作区文件，可手编也可助手辅助生成
- **分享**：导出整卡包分享给其他玩家（应用市场规划中）

### 核心概念

| 概念 | 说明 |
|------|------|
| **游戏卡（Game Card）** | 可复用的内容定义 + 可选前端绑定。一张卡可创建无数存档。 |
| **存档（Save Instance）** | 一次游玩的数据容器，挂载到工作区的 `save/` 下。 |
| **Agent** | AIRP 回合的执行者。主控 Agent 是入口，专业 Agent 经委托协作。 |
| **Skill** | 按需加载的能力包。激活后注入指导内容，可执行浏览器脚本。 |
| **游戏前端** | 卡自带的界面（3 文件），在沙箱 iframe 中运行，通过 bridge 与平台通信。 |
| **桌面助手** | 平台管理 Agent，帮玩家理解框架、创作内容、编辑前端。 |

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev:web
```

打开浏览器访问开发服务器地址。你需要配置一个 LLM provider（在控制面板中填入 API key）才能开始游玩。

> 开发环境数据存储在浏览器 IndexedDB。原型期 schema 可能随版本重置，不为旧本地数据补迁移。

## 架构

```
┌─────────────────────────────────────────────────┐
│                  Platform Shell                  │
│        RetroOS 多窗口桌面 · 资源管理器 · 工作室     │
├─────────────────────────────────────────────────┤
│              Agent Runtime                       │
│   主控 Agent ──委托──▶ 专业 Agent · Skill 按需加载 │
│        │ workspace 读写 · agent_call 协作          │
├─────────────────────────────────────────────────┤
│            Runtime Workspace                     │
│   游戏卡内容 + 活跃存档 → 有效虚拟文件系统           │
│   4 scope 权限：card-content / card-frontend      │
│              / save-runtime / platform-meta       │
├─────────────────────────────────────────────────┤
│          本地存储 (IndexedDB) · Go 后端 (规划中)    │
└─────────────────────────────────────────────────┘
         ▲ postMessage bridge
┌────────┴────────────────────────────────────────┐
│           游戏前端 (沙箱 iframe)                  │
│    卡自带的 HTML/CSS/JS · 流式渲染 · 工具调用展示    │
└─────────────────────────────────────────────────┘
```

### 一回合 AIRP 的运作方式

1. 玩家通过游戏前端发送输入
2. 主控 Agent 接收，按需委托专业 Agent（叙事、记忆等）
3. Agent 通过 `workspace_read` 读取世界设定和记忆，通过 `workspace_write` 维护记忆
4. 主控 Agent 产出玩家面向的回复，流式推送到前端
5. 平台自动创建 checkpoint，回合数据持久化到存档

### 工作区权限模型

| Scope | 可读 | 可写 | 路径 |
|-------|------|------|------|
| card-content | 所有人 | level ≥ 2 | agents/、skills/、world/、docs/、... |
| card-frontend | 所有人 | level ≥ 2 | frontend/ |
| save-runtime | 所有人 | level ≥ 1 | save/ |
| platform-meta | level ≥ 4 | level ≥ 4 | .tsian/ |

运行时游戏 Agent 默认 level 1（只能写存档数据）；桌面助手 level 4（可管理全部内容）。

## 仓库结构

```
apps/
  platform-web/      Vue 平台壳 + Agent Runtime 宿主 + 本地存储 + bridge
  platform-server/   Go 后端（为账号系统和应用市场预留）
packages/
  contracts/         共享 TypeScript 契约
  runtime-core/      RuntimeEngine 接口包
```

## 构建

```bash
# 构建共享包
npm run build:contracts
npm run build:runtime-core

# 构建平台前端
npm run build:web
```

## 路线图

### MVP 基座（已完成）

- ✅ Agent Runtime：主控 + 专业 Agent 委托、Skill 按需加载、浏览器脚本 action
- ✅ Runtime Workspace：4 scope 虚拟文件系统 + 读写权限 + 搜索
- ✅ 游戏卡 / 存档 / Checkpoint：导入导出、存档槽、回滚
- ✅ 游戏前端 bridge：postMessage RPC + 流式事件
- ✅ 桌面助手：出厂 Skill 集 + 框架知识参考文档
- ✅ 平台 UI：多窗口桌面壳 + 工作室 + 资源管理器

### 进行中

- 🚧 **账号系统**：Discord OAuth 登录，Go 后端提供身份服务
- 🚧 **应用市场**：以账号身份上传/下载游戏卡包，玩家间分享作品

### 远期

- 细粒度资源分享（预定义人物、世界设定单独发布）
- 原生向量检索（当前可通过 Skill + 脚本扩展实现）
- 跨设备存档同步

## 技术栈

**前端**：Vue 3 · TypeScript · Vite · Dexie (IndexedDB) · Vue Router
**后端**：Go（规划中）
**共享契约**：TypeScript

## 文档

- [docs/](docs/) — 项目方向与设计文档
- 桌面助手内置框架知识参考：平台架构、前端开发指南、记忆系统设计指南
