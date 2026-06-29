# 平台侧前端构建服务

## Goal

把游戏卡前端的运行模型从"卡带构建产物文件"升级为"卡带源码 + 平台统一构建"。平台官方部署，所有玩家同域名游玩，构建能力作为平台基础设施（非游戏卡携带）提供。使得：

- **助手能在线改前端**：助手通过 `workspace.write` 写 `frontend-src/` 源码，平台自动构建到 `frontend/`，重新加载即见效果——闭环天然，无需助手接触构建工具链。
- **普通玩家在默认前端上魔改**：默认前端用 Vue 3，生态成熟、中文资料丰富、SFC 单文件组件对新手友好。
- **高级玩家可上传其它框架源码包**：构建服务多框架插件式，不强制全家桶统一。

## Background

当前运行时链路：

- 玩家游玩时，Service Worker 从 IndexedDB `gameCardFrontendFiles` 表读 `frontend/**` 文件，经虚拟 URL 加载到 iframe。
- 内置默认游戏卡的前端来自 `apps/platform-web/src/storage/default-frontend-files.ts` 的三个内联字符串常量（`FRONTEND_INDEX_HTML` / `FRONTEND_STYLE_CSS` / `FRONTEND_APP_JS`），原生 JS，无构建。
- `apps/play-frontend-dev` 是把这些常量移植成的 vite + TS 开发版，`npm run build` 产出 `dist/`，但**无任何脚本把 dist 同步回常量或写入游戏卡**——开发预览态，未接入运行时。
- 助手自检设施（`frontend-inspector.ts`）能在隐藏 iframe 加载 packaged 前端并观测，但自检 bridge 的 workspace 只读，不写文件。
- 助手通过普通 workspace write 工具能写 `card-frontend` scope（`frontend/**` 路径），写入即落 IndexedDB，重载即生效——**但产物是 bundle，助手无法有意义地手改**。这是"在线改前端"的真正阻塞点。

平台是官方统一部署、所有玩家同域名、只内容（游戏卡）不同的部署模型，使得"平台自带构建能力"成立且优雅——构建器是平台级共享基础设施，零游戏卡体积代价。

## Requirements

- `R1` 源码形态游戏卡前端：游戏卡前端在 `frontend/` 根下分两层——`frontend/src/`（源码，助手可改）+ `frontend/dist/`（构建产物，平台构建输出，Service Worker 加载）。`frontend/` 仍是 SW 加载根 + `card-frontend` scope 路径前缀，现有运行时硬约束不动。`manifest.frontend.entry` 改指 `frontend/dist/index.html`。
- `R2` 平台侧构建引擎：在 platform-web 内集成 esbuild-wasm（浏览器内构建），把 TS/JSX 源码编译为浏览器可执行的 ESM。懒加载，首次加载后缓存到 IndexedDB（仅为性能，非离线生存——见部署假设文档）。
- `R3` 多框架插件式支持：根据游戏卡声明的框架加载对应编译器插件。首版至少支持 `vue`（+ @vue/compiler-sfc）与 `vanilla`（esbuild 原生 TS）；`react` / `preact`（esbuild 原生 JSX）/ `svelte`（svelte/compiler）作为插件扩展点预留，可首版部分实现。
- `R4` 框架声明：`game-card.json` 的 `packaged` frontend binding 新增 `framework` 字段（`"vue" | "react" | "preact" | "svelte" | "vanilla"`），构建服务读它选编译器。
- `R5` import 解析：源码间的 ESM 互引（`import { x } from "./Foo.ts"`）由构建服务解析为可加载的 blob URL 或重写路径；bare import（`vue`、`preact`、任意 npm 包如 `lodash`）走 esm.sh CDN（递归依赖解析 + CJS→ESM 转换）。产物路径用相对路径（Service Worker 虚拟 URL 下绝对路径会失效）。
- `R6` 助手在线改闭环：助手 `workspace.write("frontend/src/**")` 后，平台检测到源码变化，自动重新构建到 `frontend/dist/`（防抖避免连续写多次构建），前端重载即见效果。构建失败时保留旧产物并把错误反馈给助手（不破坏可运行的前端）。
- `R7` 默认前端源码种子：`default-frontend-files.ts` 的内联常量早已不维护，不迁移它。默认前端改为以 `apps/play-frontend-dev/src` 的源码为种子，同步进内置游戏卡的 `frontend/src/`，经平台构建产出 `frontend/dist/`。本任务需建立"play-frontend-dev 源码 → 内置卡 frontend/src 种子"的同步路径（构建期内联或脚本生成 `defaultFrontendFiles()` 的源码版）。
- `R8` `play-frontend-dev` 定位调整：保留为本地开发预览（vite dev server），与平台构建并行。开发者本地用 vite 迭代，确认后源码进游戏卡 `frontend/src/`，平台构建负责运行时。两者产物格式需对齐（相对路径、ESM）。
- `R9` 游戏卡导出：导出游戏卡带 `frontend/src/`（源码）。`frontend/dist/` 产物可由源码重建，导出时可选带（兜底，降低接收方首次构建延迟）。
- `R10` 隔离与安全：构建在浏览器沙箱内进行（esbuild-wasm），不触宿主文件系统。源码来自 workspace，构建产物写回 `frontend/dist/`（card-frontend scope）。构建服务不执行源码（编译只转译，不跑），执行仍由 iframe 沙箱负责。
- `R11` npm 包支持：支持任意 npm 包作为 bare import，走 esm.sh CDN 解析。非所有包可跑——依赖 Node 原生 API（fs/process 完整实现）、WASM 原生模块、原生 binary 的包受浏览器沙箱固有限制；构建/运行时给出清晰报错，不试图 polyfill 一切。这是浏览器沙箱的客观边界，非产品决策。

## Non-Goals

- 不做完整 bundler（tree-shaking、代码分割优化等）——目标是"源码→浏览器可执行 ESM"，不是优化打包。
- 不做 HMR 热更新（重载 iframe 即可，无需细粒度热替换）。
- 不保证所有 npm 包可跑——依赖 Node 原生 API / WASM / 原生 binary 的包受浏览器沙箱固有限制，给清晰报错而非 polyfill 一切（R11）。
- 不在本任务重构 `play-frontend-dev` 的 UI 架构（Preact/Vue 化）——那是后续任务，依赖本任务的构建能力先就位。
- 不做构建产物缓存键/增量构建（首版每次全量构建，性能够用即可）。

## Acceptance Criteria

- [ ] `game-card.json` packaged binding 支持 `framework` 字段；contracts 类型 + 校验更新
- [ ] 前端源码在 `frontend/src/`，产物在 `frontend/dist/`；`manifest.frontend.entry` 指向 `frontend/dist/index.html`
- [ ] platform-web 集成 esbuild-wasm，懒加载 + IndexedDB 缓存（性能目的）
- [ ] 给定 `frontend/src/` 源码 + framework 声明，构建服务产出可被 Service Worker 加载的 `frontend/dist/`（相对路径 ESM）
- [ ] Vue 3 源码（SFC）能构建并通过 Service Worker 加载运行
- [ ] vanilla TS 源码能构建并运行
- [ ] 助手 `workspace.write("frontend/src/**")` 触发自动重新构建（防抖），重载后见新效果
- [ ] 构建失败时不破坏旧产物，错误信息可被助手读取
- [ ] 默认前端以 play-frontend-dev 源码为种子进 `frontend/src/`，平台构建产出 `frontend/dist/`，玩家游玩体验不退化（不迁移废弃的 default-frontend-files.ts 常量）
- [ ] bare import（`vue`）走 esm.sh CDN 正确解析
- [ ] 任意 npm 包（如 `lodash`）作为 bare import 走 esm.sh 能解析加载；跑不了的包给清晰报错
- [ ] `npm run build:web` + `npm run build:contracts` 通过

## Open Decisions

- 导出游戏卡是否带 `frontend/` 产物兜底。倾向带（降低接收方首次构建延迟）——但若所有平台都有构建能力，纯源码导出也可。待 design 阶段定。
- `frontend-src/` 与 `frontend/` 是否同卡共存，还是构建后 `frontend/` 由平台管理不进导出。倾向 `frontend-src/` 进导出，`frontend/` 可选。
- 构建产物格式：单 bundle 还是多 ESM chunk。倾向 esbuild 的默认 chunking（多文件 ESM，相对路径）。

## Decisions

- `D1` 部署模型确认：平台官方统一部署，构建能力是平台基础设施，非游戏卡携带。esbuild-wasm 体积（~2MB）可接受——懒加载、只一次、不如一张图。详见 `docs/active/platform-deployment-assumptions.md`。
- `D2` 多框架插件式：按 `framework` 字段加载对应编译器插件，懒加载。不绑死单一框架。
- `D3` 默认前端框架选 Vue 3：与 platform-web 技术栈一致、中文社区资源最丰、SFC 对新手最友好。
- `D4` 框架声明位置：`game-card.json` 的 `packaged` frontend binding 新增 `framework` 字段（与 `entry` / `bridgeVersion` 同层）。
- `D5` 构建引擎选 esbuild-wasm：浏览器内构建最成熟方案，原生支持 TS/JSX，已被 Sandpack 等验证。
- `D6` 构建触发：自动 + 防抖。助手 `workspace.write("frontend-src/**")` 后平台自动重新构建（防抖避免连续写多次构建），重载即见效果。无需显式 action。
- `D7` bare import 走 CDN：`vue` / `preact` 等框架模块及任意 npm 包从 esm.sh CDN 解析（递归依赖解析 + CJS→ESM）。平台不内嵌框架 build——平台运行本就需网络，离线是伪需求（见 `docs/active/platform-deployment-assumptions.md`）。IndexedDB 缓存仅为性能，非离线生存。
- `D8` 路径命名：`frontend/src/`（源码）+ `frontend/dist/`（产物），均在 `frontend/` 根下。`frontend/` 仍是 SW 加载根 + card-frontend scope 前缀，现有运行时硬约束不动；`manifest.frontend.entry` 改指 `frontend/dist/index.html`。改动集中在新路径 + entry 默认值，不破坏现有 SW/scope/卡包逻辑。
- `D9` npm 包支持范围：支持任意 npm 包作为 bare import（esm.sh 解析）。非所有包可跑——Node 原生 API/WASM/原生 binary 受浏览器沙箱固有限制，给清晰报错而非 polyfill。这是客观边界，非产品决策。
