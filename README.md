# Tsian 此间

Tsian 是一个面向 AIRP 的 Agent-Orchestrated Runtime 平台原型。

当前核心不再是可视 DAG 工作流或 SillyTavern 风格提示词预设，而是：

- 平台托管模型调用、桥 API、本地会话、通用存储和 checkpoint。
- Agent Runtime 组织 AIRP 回合，当前 MVP 使用 `master-agent` → `narrative-agent` 两步调用。
- 前端包负责游戏界面和渲染，通过受控 bridge 读取数据和发送玩家输入。
- 存档就是一次 AIRP 会话的数据容器，平台不理解事件、档案、任务或状态表等玩法语义。

## 当前仓库骨架

- `apps/platform-web` - Vue 平台壳、本地 Agent Runtime 宿主、Dexie 存储、桥接和默认会话 UI。
- `packages/contracts` - 平台、运行时和前端包共享的 TypeScript 契约。
- `packages/runtime-core` - 极薄的 `RuntimeEngine` 接口包。
- `docs` - 当前方向、接手文档和已退役方向说明。

## 常用命令

```bash
npm run dev:web
npm run build:contracts
npm run build:runtime-core
npm run build:web
```

原型期 IndexedDB schema 允许破坏性重置，不为旧本地数据补迁移。

## 文档入口

- [docs/README.md](docs/README.md)
- [docs/active/current-state-handoff.md](docs/active/current-state-handoff.md)
- [docs/active/airp-workflow-platform-direction.md](docs/active/airp-workflow-platform-direction.md)
- [docs/active/agent-framework-runtime-workspace-direction.md](docs/active/agent-framework-runtime-workspace-direction.md)
- [docs/active/deferred-work.md](docs/active/deferred-work.md)
