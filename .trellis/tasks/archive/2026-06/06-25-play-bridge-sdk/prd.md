# 抽 play-bridge SDK 本地包（dev/prod path split）

## Goal

把 `default-frontend-files.ts` app.js 里的桥协议层（postMessage 握手 / RPC id 匹配 / 事件路由 / call()）抽成 `packages/play-bridge` 本地包，作为协议层的**唯一真相源**。开发前端项目 import 它进行表现层迭代开发（热加载），验证稳定后上传 CDN、再由开发前端替换默认前端。

**本任务只抽包 + vite alias，不动默认前端，不发 CDN。** 默认前端仍保留内联协议层，直到被验证通过的开发前端替换（后续任务）。

## User Value

- 用 remote 模式独立开发游戏前端时，`import { createBridge } from "@tsian/play-bridge"` 即可，不用手工复制协议层代码，改协议层即时热加载。
- 协议层单一真相源：`packages/play-bridge` 成为规范实现；默认前端里的内联拷贝在替换后退役，消除分叉风险。
- 默认前端行为不变（本任务根本不动它）。

## Confirmed Facts (调研已确认)

### 协议层范围（`default-frontend-files.ts:300-369`）
- `CHANNEL = "tsian.play-bridge.v1"` 常量。
- `sessionId` / `nextReqId` / `pending` Map / `bridgeReady` 状态。
- `handlers = { onReady, onEvent, onSnapshot }` + `setEventHandlers(h)`。
- `call(method, params) → Promise`：生成 RPC id，postMessage request，pending Map 匹配 response。
- message 路由（`addEventListener("message", ...)`）：按 kind 分发 `ready`/`response`/`event`。`turn-completed` 的 payload.snapshot 触发 onSnapshot。
- 启动握手：`window.parent.postMessage({channel, kind:"hello"}, "*")`。

### 协议层稳定性（本任务检验案例）
- 上一任务把 `turn-tool` 的 `output` 从 `string` 扩成 `TurnToolOutput`——协议层代码零改动，变更全落在表现层。
- 原因：协议层是**结构透传**，不解析 payload 内部语义。`onEvent(event, payload)` 原样交给表现层。
- 会动协议层的只有：握手协议变（channel 名 / hello-ready 结构，版本化契约几乎不动）、RPC 方法增减（`call()` 是通用 `call(method,params)`，不硬编码方法名）。

### 方向文档约束（`docs/active/play-frontend-sdk-direction.md`）
- **SDK 负责**（§3.1）：握手 / RPC 传输 / 事件订阅语法 / 错误归一与状态暴露 / 初始 snapshot 拉取 / 全部相关 TS 类型导出。
- **SDK 不负责**（§3.2）：delta 累加 / 消息渲染 / 工具节点呈现 / 布局主题样式 / 表现意图语义归一。
- **核心红线**（§3.1 L46）：助手生成的前端里不应出现 `addEventListener("message",...)`、不应自己管 postMessage 握手、不应自己拼 RPC id 匹配。
- **三合一**（§5）：默认前端 app.js 重构为 import SDK 后，同时是官方默认前端 + 助手起点 + 官方测试基准。单真相源，不分两份。（本任务先建包，三合一在后续替换默认前端时完成。）
- **落地路径**（§8）：第 2 步"抽 SDK"是纯重构，前后默认前端行为不变。

### dev/prod path split 的合理性
- vite proxy 拦截跨源 CDN URL 走不通：iframe 内 `import "https://cdn.tsian.dev/..."` 是浏览器对 cdn.tsian.dev 的真实请求，不经过 platform-web 的 vite dev server，middleware/proxy 拦不到。
- dev 用包名 `@tsian/play-bridge` + vite alias 指向本地源码，热加载；prod 用 CDN URL，浏览器直取。两阶段 import 字符串不同，代价仅此。
- 开发前端最终本就要替换默认前端，替换时顺手把 import 改成真实 CDN URL。发布后开发套件（开发前端项目 + vite alias）可丢弃，不影响线上默认前端。
- 离线不是问题：LLM API 必然在线，前端加载 play-bridge 和调 LLM 同样需要网络。

## Requirements

### R1 新建 `packages/play-bridge` 包
- 导出 `createBridge()`（框架无关函数，非 Vue composable——默认前端是原生 JS），返回 `Bridge` 实例，封装协议层全部职责：握手、call() RPC、事件订阅、状态暴露、初始 snapshot 拉取。
- 导出全部相关 TS 类型（`RuntimeSnapshotShell`、`ConversationMessageRecord`、`TurnToolOutput`、事件 payload 类型等，从 `@tsian/contracts` re-export）。
- 纯 ESM，无运行时依赖（协议层现有代码不依赖任何外部库）。
- workspace 内 `@tsian/play-bridge` 包名。

### R2 vite alias 使开发前端可消费
- `apps/platform-web/vite.config.ts` 加 `@tsian/play-bridge` alias → `packages/play-bridge/src/index.ts`（与 contracts / runtime-core 一致）。
- 开发前端项目（后续任务创建）用 `import { createBridge } from "@tsian/play-bridge"` 解析到本地源码、享受热加载。
- 不涉及 CDN URL 拦截（跨源请求 vite 拦不到，本方案不依赖它）。

### R3 类型安全
- `packages/play-bridge` 严格 TS，类型从 `@tsian/contracts` 导入，不 redefine。
- `call<T>()` 泛型支持（现有 `call(method, params)` 返回 Promise，加泛型标注返回类型）。

## Acceptance Criteria

- [ ] `packages/play-bridge` 包存在，导出 `createBridge` + `Bridge` + 全部桥类型。
- [ ] `packages/play-bridge` 自身 build 通过（tsc 产出 dist）。
- [ ] `apps/platform-web/vite.config.ts` 有 `@tsian/play-bridge` alias 指向源码。
- [ ] `npm run build:web` + `npm run build:contracts` 通过。
- [ ] 协议层逻辑与 `default-frontend-files.ts:300-369` 原内联版本逐行对照一致。
- [ ] 默认前端 `default-frontend-files.ts` 未改动（行为不变）。

## Out of Scope

- 不动默认前端 `default-frontend-files.ts`（后续替换任务做）。
- 不创建开发前端项目（后续任务）。
- 不发 CDN / 不上传产物（后续任务，等 SDK 稳定后）。
- 不写 skill（§8 第 4 步，后续任务）。
- 补爬虫工具 / inspect_frontend 迭代（§8 第 5 步，后续任务）。
- 表现层任何改动。
- 桥协议 `tsian.play-bridge.v1` 任何变更。
- Service Worker 任何改动。
- esbuild bundle / defaultFrontendFiles 加 vendor 条目。

## Notes

- **临时两份拷贝**：本任务期间默认前端仍有内联协议层，`packages/play-bridge` 是第二份。可接受——默认前端已冻结不再开发，将被开发前端替换后退役内联拷贝，届时达成单真相源。
- **运行时验证延后**：本任务无运行时消费方（开发前端项目是后续任务），协议层是现有可用代码的机械移植，逐行对照覆盖正确性；postMessage 握手 / RPC / 事件路由的端到端验证随开发前端项目进行。
