# 创建开发前端项目 apps/play-frontend-dev

## Goal

把 `default-frontend-files.ts` 的默认前端表现层移植为独立 vite + TS 开发项目 `apps/play-frontend-dev`，用远程前端模式连接平台进行开发，享受热加载。协议层 import `@tsian/play-bridge`（上一个任务已抽好）。为后续"替换默认前端"和"发 CDN"铺路。

## 决策摘要

- **位置**：`apps/play-frontend-dev`（monorepo app，与 platform-web 平级）
- **技术栈**：原生 TS + vite，`build.minify: false`（产出可读 ESM JS，助手 agent 在线编辑场景成立）
- **端口**：5174
- **marked**：`npm install marked`，不走 vendor 机制
- **协议层**：`import { createBridge } from "@tsian/play-bridge"`，vite alias → 本地源码
- **远程连接**：游戏卡详情页 → 前端 tab → Remote URL `http://localhost:5174/` → 平台 iframe 加载开发前端

## Requirements

### R1 新建 `apps/play-frontend-dev` 项目骨架
- package.json / tsconfig.json / vite.config.ts
- vite.config.ts：`@tsian/play-bridge` + `@tsian/contracts` alias、`server.port: 5174`、`build.minify: false`
- root package.json workspaces 加 `apps/play-frontend-dev`

### R2 移植 index.html + style.css
- index.html 从 `FRONTEND_INDEX_HTML`（L27-67）移植，入口指向 `/src/main.ts`
- style.css 从 `FRONTEND_STYLE_CSS`（L69-296）移植

### R3 移植表现层 main.ts
- 从 `FRONTEND_APP_JS` 表现层（L371-760）移植为 TS
- 协议层（L302-369）丢弃，替换为 `import { createBridge } from "@tsian/play-bridge"` + `const bridge = createBridge()`
- 耦合点转换：`call()` → `bridge.call()`、`setEventHandlers()` → `bridge.on()`、`sessionId`/`bridgeReady` → `bridge.sessionId`/`bridge.ready`
- TS 类型标注，类型从 `@tsian/play-bridge` re-export 拿

### R4 验证
- `npm run build --workspace play-frontend-dev` 通过，dist 产出可读 ESM JS
- dev server 起 5174
- 手动：平台填 remote URL → /play → 握手 + 发消息 + 工具事件走通

## Acceptance Criteria

- [ ] `apps/play-frontend-dev` 项目存在，vite dev 起 5174
- [ ] `npm run build --workspace play-frontend-dev` 通过，dist 产出可读 ESM JS
- [ ] 表现层逻辑与默认前端 `FRONTEND_APP_JS` L371-760 逐行对照一致
- [ ] 协议层代码不在 main.ts 里（全部由 @tsian/play-bridge 提供）
- [ ] 平台填 `http://localhost:5174/` 远程 URL 能加载开发前端，握手 + 发消息 + 工具事件走通
- [ ] `default-frontend-files.ts` / `packages/play-bridge` / platform-web 文件未改动

## Out of Scope

- 不动默认前端 `default-frontend-files.ts`（后续替换任务）
- 不做 build 产物替换默认前端（后续任务）
- 不发 CDN（后续任务）
- 不改 platform-web 任何文件
