# Design: 抽 play-bridge SDK 本地包（dev/prod path split）

## 1. 架构边界

```
┌─ packages/play-bridge (新建) ──────────────────────────────┐
│  src/index.ts          → createBridge() + 类型 re-export    │
│  src/bridge.ts         → 协议层实现（从 app.js 移植）         │
│  dist/index.js/.d.ts   → tsc 产物（类型解析用）              │
└───────────────┬────────────────────────────────────────────┘
                │
    开发态：import { createBridge } from "@tsian/play-bridge"
    （vite alias 指向 packages/play-bridge/src，热加载）
                │
        ┌───────▼────────┐
        │ 开发前端项目     │   ← 后续任务创建，本任务不涉及
        │ (remote 模式)   │
        └────────────────┘

    生产态（后续替换默认前端时）：
    import { createBridge } from "https://cdn.tsian.dev/@tsian/play-bridge@1.js"
    （浏览器直取 CDN，CDN 上传是后续任务）
```

**本任务不触碰默认前端**：`default-frontend-files.ts` 的内联协议层原样保留，直到后续"开发前端替换默认前端"任务时退役。

**不触碰的边界**：
- 桥协议 `tsian.play-bridge.v1` 不变。
- 表现层代码不动。
- Service Worker 不改。
- 不需要 esbuild bundle、不需要 defaultFrontendFiles 加 vendor 条目。

## 2. createBridge API 形态

### 约束
默认前端是原生 JS（非 Vue），不能用 Vue composable。dev 项目可能用 Vue 也可能不用。API 必须框架无关。

### 方案：函数式 `createBridge()`

```typescript
// packages/play-bridge/src/index.ts

export interface Bridge {
  /** RPC: call(method, params) → Promise<T>。表现层唯一的能力出口。 */
  call<T = unknown>(method: RemotePlayBridgeMethod, params?: unknown): Promise<T>
  /** 注册事件处理器。onSnapshot 是 turn-completed.snapshot 的快捷通道。 */
  on(handler: {
    onReady?: (sessionId: string) => void
    onEvent?: (event: RemotePlayBridgeEventName, payload: RemotePlayBridgeEventPayload) => void
    onSnapshot?: (snapshot: RuntimeSnapshotShell) => void
  }): void
  /** 桥握手是否完成。 */
  readonly ready: boolean
  /** 当前 sessionId（握手后可用）。 */
  readonly sessionId: string | null
}

export function createBridge(): Bridge
```

**设计要点**：
- `createBridge()` 返回 `Bridge` 实例，封装全部协议层状态（sessionId / pending Map / handlers）。
- `call<T>()` 加泛型。
- `on(handler)` 替代现有 `setEventHandlers`。
- `ready` / `sessionId` 只读暴露。
- `createBridge()` 内部自动完成 hello 握手 + message 路由。表现层不碰这些。

### 与现有协议层的映射
| 现有（app.js inline） | 抽包后 |
|---|---|
| `setEventHandlers({onReady, onEvent, onSnapshot})` | `bridge.on({onReady, onEvent, onSnapshot})` |
| `call(method, params)` | `bridge.call<T>(method, params)` |
| `sessionId` / `bridgeReady` 变量 | `bridge.sessionId` / `bridge.ready` |
| `addEventListener("message", ...)` | `createBridge()` 内部，不暴露 |
| `window.parent.postMessage({kind:"hello"}, "*")` | `createBridge()` 内部自动发 |

## 3. Dev/prod path split 方案

### 为什么不用 vite proxy 拦 CDN URL
iframe 内 `import "https://cdn.tsian.dev/..."` 是浏览器对 cdn.tsian.dev 的真实请求，**不经过 platform-web 的 vite dev server**。vite 的 `server.proxy` / middleware 都挂在它自己的 server 上，对"压根不发到 vite"的跨源请求无效。这条主路走不通，不采用。

### Dev 环境：包名 import + vite alias
开发前端项目用：
```javascript
import { createBridge } from "@tsian/play-bridge"
```
`vite.config.ts` 加 alias（与 `@tsian/contracts`、`@tsian/runtime-core` 一致）：
```typescript
"@tsian/play-bridge": resolve(__dirname, "../../packages/play-bridge/src/index.ts"),
```
改协议层源码即时热加载。**本任务只加这一条 alias。** 开发前端项目本身是后续任务，本任务不创建。

### Prod 环境（后续任务）：CDN URL
```javascript
import { createBridge } from "https://cdn.tsian.dev/@tsian/play-bridge@1.js"
```
浏览器直取 CDN。CDN 上传、替换默认前端都是后续任务。本任务不涉及。

### 切 CDN 的时机
开发前端验证通过 → 上传 `packages/play-bridge` build 产物到 `cdn.tsian.dev` → 开发前端那行 import 改为 CDN URL → 开发前端替换默认前端。发布后开发套件（开发前端项目 + vite alias）可丢弃，线上默认前端是 CDN URL 自包含形态。

## 4. 涉及文件

| 文件 | 改动 | 类型 |
|---|---|---|
| `packages/play-bridge/package.json` | 新建 | 新包 |
| `packages/play-bridge/tsconfig.json` | 新建（参照 contracts） | 新包 |
| `packages/play-bridge/src/index.ts` | 新建：createBridge + 类型 re-export | 新包 |
| `packages/play-bridge/src/bridge.ts` | 新建：协议层实现（从 app.js 抽出） | 新包 |
| `package.json`（root） | workspaces 加 `packages/play-bridge` | 配置 |
| `apps/platform-web/vite.config.ts` | 加 `@tsian/play-bridge` alias 指向源码 | 配置 |

**不改 `default-frontend-files.ts`**——本任务不动默认前端。

## 5. 权衡与风险

### 风险：临时两份拷贝
本任务期间默认前端仍有内联协议层，`packages/play-bridge` 是第二份。分叉风险存在但可控——默认前端已冻结不再开发，将被开发前端替换后退役内联拷贝，届时达成单真相源。
- **缓解**：协议层逻辑逐行对照移植，保证两份等价；后续替换时直接删内联拷贝。

### 风险：类型导出完整性
`packages/play-bridge` 要 re-export 桥相关类型。漏了某个类型，消费方 TS 编译报错。
- **缓解**：从 `@tsian/contracts` re-export 全部桥相关类型（`RemotePlayBridgeMethod`, `RemotePlayBridgeEventName`, `RemotePlayBridgeEventPayload`, `RuntimeSnapshotShell`, `ConversationMessageRecord`, `TurnToolOutput`, `MessageInteractionRequest`, `MessageInteractionResult` 等）。

### 风险：无运行时消费方
本任务无运行时消费方（开发前端项目是后续任务），端到端验证延后。
- **缓解**：协议层是现有可用代码的机械移植，逐行对照覆盖正确性；postMessage 握手 / RPC / 事件路由的端到端验证随开发前端项目进行。

## 6. 不做的事（明确排除）

- 不动默认前端 `default-frontend-files.ts`（后续替换任务做）。
- 不创建开发前端项目（后续任务）。
- 发 CDN / 上传产物（后续任务，等 SDK 稳定后）。
- 写 skill（后续任务）。
- 表现层任何改动。
- 桥协议任何变更。
- Service Worker 任何改动。
- esbuild bundle / defaultFrontendFiles 加 vendor 条目。
- vite proxy / middleware 拦截跨源 CDN URL（走不通，不采用）。
- hosts 文件 / dev server 监听 443 / mkcert 证书（无意义的本机侵入，不采用）。
