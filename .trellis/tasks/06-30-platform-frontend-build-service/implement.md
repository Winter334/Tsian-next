# 平台侧前端构建服务 — Implementation Plan

## 总览

按"最小可验证闭环优先"排阶段：先打通 vanilla TS 的"源码→构建→SW 加载"全链路，再叠加 Vue SFC、触发闭环、默认前端种子、兼容/导出。每阶段后跑 build + 手动验证该阶段闭环。

---

## Phase 1: contracts 类型 + framework 声明

**改动：**
- `packages/contracts/src/game-card.ts`：`GameCardFrontendBinding` 的 `packaged` 分支加 `framework?: "vue" | "react" | "preact" | "svelte" | "vanilla"`（可选，缺省视为旧卡兼容态 `"vanilla"` 或无源码）。
- 校验：manifest normalize 接受 `framework`，非法值报错。
- 不动 `remote` 分支。

**验证：**
- `npm run build:contracts` 通过。
- 旧 manifest（无 framework）仍能 normalize（兼容）。

---

## Phase 2: esbuild-wasm 集成 + vanilla 闭环（最小可用）

目标：一个 vanilla TS 源码卡能经平台构建产出 `frontend/dist/` 并被 SW 加载运行。

**改动：**
- 新增 `apps/platform-web/src/frontend-build/engine.ts`：
  - `ensureEsbuildInitialized()`：懒加载 `esbuild-wasm`，`initialize({ wasmURL, worker: true })`，IndexedDB 缓存 wasm。
  - `buildFrontend({ cardId, framework, sources })`：调 `esbuild.build`（§3.2），返回 `outputFiles` 或抛构建错误。
- 新增 `apps/platform-web/src/frontend-build/plugins/workspace-source-plugin.ts`：`onLoad` 从传入的 `sources`（Map<path, content>）读源码。
- 新增 `apps/platform-web/src/frontend-build/plugins/cdn-external-plugin.ts`：bare import → `external: true`。
- 新增 `apps/platform-web/src/frontend-build/write-back.ts`：`outputFiles` → `writeLocalGameCardFrontendFile` 写 `frontend/dist/**` + 生成 `index.html`（含 import map）+ 清理旧产物。
- `esbuild-wasm` wasm 文件：构建期拷到 `apps/platform-web/public/`（或从 CDN 取 wasmURL）。

**手动验证（vanilla）：**
- 手动造一个测试卡：`frontend/src/main.ts`（vanilla，`document.body.textContent = "hello"`）+ manifest `framework: "vanilla"`。
- 调 `buildFrontend` → 产出 `frontend/dist/index.html` + `assets/*.js`。
- /play 加载该卡 → SW 从 `frontend/dist/` 加载 → 渲染 "hello"。
- bare import（`import _ from "lodash"`）→ import map 映射 esm.sh → 运行时加载成功。

**验证：** `npm run build:web` 通过。

---

## Phase 3: Vue 3 SFC 支持

**改动：**
- 新增 `apps/platform-web/src/frontend-build/plugins/sfc-plugin.ts`：`onLoad(/\.vue$/)` 用 `@vue/compiler-sfc`（从 `https://esm.sh/@vue/compiler-sfc` 或内嵌）编译 SFC。
  - `parse` → `compileScript` + `compileTemplate` + `compileStyle` → 拼 JS 模块。
- `engine.ts` 的 framework 路由：`framework === "vue"` 时挂 sfcPlugin + import map 加 `vue@3`。
- `@vue/compiler-sfc` 获取：懒加载从 esm.sh（或构建期内联），缓存 IndexedDB。

**手动验证：**
- 测试卡 `frontend/src/App.vue`（`<template>{{ msg }}</template><script setup>const msg = ref("hi")</script>`）+ `main.ts` mount。
- 构建 → /play 渲染 "hi"。
- scoped CSS 生效。

**验证：** `npm run build:web` 通过。

---

## Phase 4: 触发闭环（助手在线改）

**改动：**
- `apps/platform-web/src/platform-host/`：workspace write/delete 成功路径检查路径是否 `frontend/src/**` 前缀，若是则防抖（800ms）触发 `rebuildFrontend(cardId)`。
- `rebuildFrontend`：读 manifest.framework + frontend/src 源码 → `buildFrontend` → 成功写回 / 失败记状态。
- 构建状态 `frontend-build-status` query resource：暴露 `{ status, lastBuiltAt, error }` 供助手读。
- 构建完成事件：若该卡正在 /play，通知前端重载。

**手动验证：**
- 助手 `workspace.write("frontend/src/App.vue", 新模板)` → 防抖后重建 → /play 重载见新效果。
- 故意写错语法 → 旧产物保留 + `frontend-build-status` 返回错误（file/line/message）。
- 连续写 3 次 → 只触发 1 次构建（防抖）。

**验证：** `npm run build:web` 通过。

---

## Phase 5: 默认前端种子（R7）

**改动：**
- `apps/play-frontend-dev`：vite 配置 `base: "./"`（产物相对路径，与平台构建对齐）。
- `apps/platform-web/src/storage/default-frontend-files.ts`：退休旧 3 件套常量。改为从 `play-frontend-dev/src` 同步源码，产出 `frontend/src/**` 种子 + `frontend/dist/**`（构建期预跑构建或首次加载构建）。
- 内置卡 manifest：`framework: "vue"`，`entry: "frontend/dist/index.html"`。

**手动验证：**
- 全新本地环境 → 内置卡加载 → 默认前端正常渲染（小说开局向导等）。
- 首次加载延迟可接受（预构建产物直接加载 vs 现场构建）。

**验证：** `npm run build:web` + `npm run build --workspace play-frontend-dev` 通过。

---

## Phase 6: 兼容 + 导出 + 收尾

**改动：**
- 兼容旧卡：entry 指 `frontend/index.html` 且无 `frontend/src/` → 不触发构建，SW 直接加载旧产物。
- 导出（`game-card-packages.ts`）：导出带 `frontend/src/`（源码）+ `frontend/dist/`（产物兜底）。
- 清理 `default-frontend-files.ts` 旧常量（确认无引用后删）。
- react/preact/svelte 插件：预留接口（若首版不做实现，留 TODO + 接口签名）。

**手动验证：**
- 旧卡（无 frontend/src）仍能 /play 加载。
- 导出卡 → 重新导入 → 正常加载。
- `frontend-build-status` 在构建成功/失败/进行中三态都正确。

**验证：** `npm run build:web` + `npm run build:contracts` 通过。

---

## 风险与回退

- **esbuild-wasm 浏览器兼容**：wasm 加载/worker 在某些环境受限。回退：`worker: false` 主线程跑（性能差但可用）。
- **esm.sh 可用性**：依赖外网 + esm.sh 稳定性。回退：核心框架内嵌一份 ESM build（仅框架，非全部 npm 包）。
- **@vue/compiler-sfc 体积/浏览器兼容**：若 esm.sh 版不可用，构建期内联一份。验证compiler-sfc 浏览器 build 是否可直接用。
- **构建延迟**：首次构建可能数秒。缓解：异步构建 + 加载态 UI；预构建默认前端产物。
- 每阶段独立可 git revert，Phase 1（contracts）最小且独立。
