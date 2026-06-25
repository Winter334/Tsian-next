# Implement: 抽 play-bridge SDK 本地包（dev/prod path split）

## 执行顺序

自底向上：新建包 → 协议层实现 → vite alias 配置 → 验证。

范围收窄说明：本任务**不动默认前端**，不涉及 CDN URL 拦截。原 Step 3（vite proxy 拦跨源 CDN URL）整段取消——跨源请求 vite 拦不到。改用包名 `@tsian/play-bridge` + vite alias 指向源码，开发前端项目（后续任务）消费。原 Step 4（默认前端重构）取消——默认前端内联协议层原样保留，到后续替换任务再退役。

### Step 1: 新建 `packages/play-bridge` 包骨架

**文件**:
- `packages/play-bridge/package.json`：
  ```json
  {
    "name": "@tsian/play-bridge",
    "private": true,
    "version": "0.0.0",
    "type": "module",
    "main": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "scripts": { "build": "tsc -p tsconfig.json" }
  }
  ```
  不需要 esbuild bundle 步骤（不复制进游戏卡）。tsc dist 仅供 workspace 类型解析；dev 时 vite alias 直接 transform 源码。
- `packages/play-bridge/tsconfig.json`：参照 `@tsian/contracts`（target ES2020, module ESNext, moduleResolution Bundler, strict, declaration, outDir dist, rootDir src）。
- `packages/play-bridge/src/index.ts`：export `createBridge` + `Bridge` + re-export 桥类型（初始为空占位，Step 2 填充）。

**root `package.json`**: workspaces 数组加 `"packages/play-bridge"`。

**验证**:
```bash
npm install
```

**review gate**: `@tsian/play-bridge` 在 workspace 里可解析（`npm ls @tsian/play-bridge` 不报错）。

### Step 2: 协议层实现

**文件**: `packages/play-bridge/src/bridge.ts` + `packages/play-bridge/src/index.ts`

- `bridge.ts`：从 `default-frontend-files.ts:300-369` 的协议层代码移植为 TS：
  - `createBridge(): Bridge` 函数。
  - 内部状态：`sessionId` / `nextReqId` / `pending` Map / `bridgeReady` / `handlers`。
  - `call<T>(method, params)`：RPC id 生成 + postMessage request + pending 匹配。
  - message 路由：`addEventListener("message", ...)`，按 kind 分发 ready/response/event。`turn-completed` 的 snapshot 提取。
  - 启动握手：`window.parent.postMessage({channel, kind:"hello"}, "*")`。
  - 错误归一：RPC reject 返回结构化 error。
- `index.ts`：`export { createBridge } from "./bridge"` + `export type { Bridge } from "./bridge"` + re-export 桥类型 from `@tsian/contracts`（`RemotePlayBridgeMethod`, `RemotePlayBridgeEventName`, `RemotePlayBridgeEventPayload`, `RuntimeSnapshotShell`, `ConversationMessageRecord`, `TurnToolOutput`, `MessageInteractionRequest`, `MessageInteractionResult` 等）。

**验证**:
```bash
npm run build --workspace @tsian/play-bridge
```
确认 `dist/index.js` + `dist/index.d.ts` 产出。

**review gate**: 协议层逻辑与原 app.js inline 版本逐行对照一致。特别是：
- `CHANNEL` 常量值 `"tsian.play-bridge.v1"`。
- hello 握手 postMessage 结构 `{channel, kind:"hello"}`。
- RPC request postMessage 结构、id 生成规则。
- message 路由三个 kind 分发逻辑、origin 校验（如有）。
- `turn-completed` 的 `payload.snapshot` → `onSnapshot` 提取路径。

### Step 3: vite alias 配置

**文件**: `apps/platform-web/vite.config.ts`

加 `@tsian/play-bridge` alias 到源码（和 contracts / runtime-core 一致）：
```typescript
"@tsian/play-bridge": resolve(__dirname, "../../packages/play-bridge/src/index.ts"),
```

**review gate**: vite dev server 启动无报错；platform-web 源码里 `import ... from "@tsian/play-bridge"` 可解析（即便本任务没有消费点，alias 本身要正确配置，为后续开发前端项目铺路）。

**注意**：本步骤**不涉及** CDN URL 拦截 / `configureServer` middleware / `server.proxy`。跨源 https 请求不走 vite server，拦不到，方案上已排除。

### Step 4: 全量验证

```bash
npm run build:contracts
npm run build --workspace @tsian/play-bridge
npm run build:web
```

- 全部 type-check 通过。
- `packages/play-bridge/dist` 产出 index.js + index.d.ts。
- `default-frontend-files.ts` 无改动（git diff 确认）。

**端到端验证延后**：本任务无运行时消费方（开发前端项目是后续任务）。postMessage 握手 / RPC / 事件路由的端到端跑通随开发前端项目进行。本任务以"逐行对照移植"覆盖正确性。

## 验证命令汇总

| 命令 | 覆盖 |
|---|---|
| `npm run build --workspace @tsian/play-bridge` | play-bridge tsc |
| `npm run build:contracts` | contracts type-check |
| `npm run build:web` | platform-web type-check + vite build |

## 回滚点

- Step 1 (新包)：删 `packages/play-bridge` + root package.json workspaces 移除。
- Step 2 (协议层)：删 `packages/play-bridge/src/`。
- Step 3 (vite alias)：移除 vite.config 的 alias。

无默认前端改动，无行为风险。回滚即删包移 alias。

## 关键验证点

- `packages/play-bridge/src/bridge.ts`：协议层从 JS 移植为 TS，逻辑逐行一致（与 `default-frontend-files.ts:300-369` 对照）。
- `default-frontend-files.ts`：git diff 应为空（本任务不动它）。
- 类型 re-export 完整：消费方 import 任何桥相关类型都能解析。
