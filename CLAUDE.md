# Tsian 此间 — 项目级接手说明

Tsian 当前是面向 AIRP 的 Agent-Orchestrated Runtime 平台原型。

当前主线：

1. 玩家通过前端包发送输入。
2. 平台 host 托管会话、模型调用、bridge、storage 和 checkpoint。
3. Agent Runtime 每轮先调用 `master-agent` 形成写作 brief，再调用 `narrative-agent` 生成玩家可读正文。
4. 平台把玩家消息和正文写入会话 history，并创建 checkpoint。
5. 前端包通过 bridge 重读 history、snapshot、checkpoint 和 workspace 数据。

## 模块索引

| 路径 | 职责 |
|------|------|
| `apps/platform-web` | Vue 平台壳、本地平台 host、Agent Runtime 宿主、Dexie 存储、bridge、默认会话 UI |
| `packages/contracts` | 跨包 TypeScript 类型契约 |
| `packages/runtime-core` | 极薄 `RuntimeEngine` 接口 |
| `docs/active` | 当前方向、接手和已退役方向说明 |

已退役旧主线：workflow-as-system、可视 DAG workflow editor、SillyTavern prompt-engine、workflow preset、默认事件/档案记忆模型。历史原因查 Trellis archived tasks 或 git history。

## 常用命令

```bash
npm run dev:web
npm run build:contracts
npm run build:runtime-core
npm run build:web
```

## 当前关键入口

- `apps/platform-web/src/platform-host/index.ts`
- `apps/platform-web/src/agent-runtime/index.ts`
- `apps/platform-web/src/runtime-host/ai.ts`
- `apps/platform-web/src/storage/db.ts`
- `apps/platform-web/src/bridge/play-frontend-bridge.ts`
- `packages/contracts/src/runtime.ts`
- `packages/contracts/src/bridge.ts`

## 项目原则

- 原型期允许 IndexedDB 破坏性 schema reset，不补旧本地数据迁移。
- 平台不硬编码玩法语义：事件、档案、任务、地图、关系、MVU 状态都应由 runtime/content/frontend 约定。
- 前端包只通过 `PlayFrontendBridge` 访问平台能力。
- 模型 API key、模型调用、存储和 checkpoint 由平台 host 托管。
- 新能力优先思考属于 Platform、Agent Runtime、Frontend Package、Content，还是 Save Instance。

## 当前验证口径

- `npm run build:contracts`
- `npm run build:runtime-core`
- `npm run build:web`
- 浏览器 smoke：创建内容为空会话后，`/play` 在未配置 Game Card frontend 时显示明确错误；导入 remote/packaged 前端后再验证玩家输入、history、checkpoint 和 bridge 行为。
