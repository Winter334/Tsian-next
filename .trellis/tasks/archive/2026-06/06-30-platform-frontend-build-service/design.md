# 平台侧前端构建服务 — Design

## 1. 定位

游戏卡前端从"卡带构建产物"升级为"卡带源码（`frontend/src/`）+ 平台统一构建（产出 `frontend/dist/`）"。平台官方统一部署，构建能力是平台基础设施。助手写 `frontend/src/**` → 平台自动构建 → 重载即见，闭环天然。

技术引擎：**esbuild-wasm**（浏览器内构建）+ **esm.sh**（bare import/任意 npm 包 CDN 解析）+ **@vue/compiler-sfc**（Vue SFC 编译，按 framework 插件加载）。

## 2. 路径模型

```
游戏卡 workspace（card-frontend scope，路径前缀 frontend/）:
  frontend/
    src/                  ← 源码（助手 workspace.write 改这里）
      main.ts
      App.vue
      components/*.vue
      ...
    dist/                 ← 产物（平台构建输出，Service Worker 加载这里）
      index.html
      assets/*.js
      assets/*.css
```

不变量（现有运行时硬约束，本任务不动）：
- `frontend/` 仍是 Service Worker 加载根 + `card-frontend` scope 路径前缀（`scopeForPath` 的 `frontend/` 分支、`writeLocalGameCardFrontendFile` 的 `frontend/` 前缀校验都不动）。
- Service Worker 仍从 `gameCardFrontendFiles` 表按 `frontend/**` 路径读。
- 卡包导入/导出的 `frontend/` 前缀约定不动。

变化点：
- `manifest.frontend.entry` 从 `frontend/index.html` 改指 `frontend/dist/index.html`（新游戏卡默认值；导入旧卡时若 entry 仍指 `frontend/index.html` 则视为"无源码、直接产物"的旧形态，兼容兜底）。
- `defaultFrontendFiles()` 不再产出 `frontend/index.html` + `app.js` + `style.css` 三件套，改为产出 `frontend/src/**` 源码种子（从 `apps/play-frontend-dev/src` 同步）+ `frontend/dist/**`（首次构建产物或构建期预生成）。

兼容性：旧游戏卡（entry 指 `frontend/index.html`、无 `frontend/src/`）仍能跑——SW 直接加载产物，构建服务检测到无 `frontend/src/` 时不触发构建。

## 3. 构建引擎集成

### 3.1 esbuild-wasm 加载

- 包：`esbuild-wasm`（非 `esbuild`）。
- 初始化：`esbuild.initialize({ wasmURL, worker: true })`。`wasmURL` 指向 esbuild.wasm（从 `node_modules/esbuild-wasm/esbuild.wasm` 构建期拷到 platform-web 公共资源，或从 CDN 取）。
- 默认在 Web Worker 跑（不阻塞主线程）。`worker: false` 仅用于已在 worker 内的场景。
- 懒加载：首次需要构建时才 `initialize`；`initialize` 幂等（esbuild 内部守卫，重复调安全）。
- 缓存 wasm/compiler 二进制：首次加载后缓存，后续优先从缓存取（性能目的，非离线生存——见 `docs/active/platform-deployment-assumptions.md`）。**缓存存放位置**：用**独立的 IndexedDB**（如 `tsian-builder-cache`）或 **Cache API**，**绝不动主库 `tsian-agent-runtime-v13`**——按 storage spec，动主库 Dexie 表须 bump DB 名 `v13→v14` 并同步 SW（rename-and-reset，丢数据），代价过重且缓存数据本就不该进业务库。

### 3.2 构建调用

入口：`frontend/src/main.ts`（或 framework 默认入口）。

```ts
const result = await esbuild.build({
  stdin: {
    contents: entrySource,        // frontend/src/main.ts 内容
    resolveDir: "frontend/src",   // 相对 import 解析基准
    sourcefile: "main.ts",
    loader: "tsx",                // 按 framework 调整
  },
  bundle: true,
  format: "esm",
  splitting: true,                // 多 chunk ESM
  write: false,                   // 不写文件系统，返回 outputFiles
  outdir: "assets",               // 产物路径前缀（相对）
  plugins: [cdnExternalPlugin, sfcPlugin /* 按 framework */],
  loader: { ".css": "css", ".json": "json" },
})
```

`result.outputFiles` 是 `[{ path, contents, text }]` 数组，写回 `frontend/dist/`（见 §6）。

## 4. import 解析策略（关键设计）

### 4.1 相对 import（源码间互引）

esbuild 原生处理：`import { x } from "./Foo.ts"` 在 `resolveDir: "frontend/src"` 下解析。但 esbuild 默认不认 `.ts`/`.vue` 扩展名——需要：

- `.ts`/`.tsx`：esbuild 原生 loader 支持，`resolveExtensions` 补 `.ts`/`.tsx`。
- `.vue`：SFC 插件（§5.1）的 `onLoad` 拦截 `.vue`，编译为 JS 模块返回。
- `.css`：`loader: { ".css": "css" }`，esbuild 把 css import 转成 `<link>` 或内联（`css` loader 产出独立 css 文件 + JS 里注入样式）。

源码文件不在文件系统——esbuild 的 `onLoad` 插件从 workspace 内存读源码（§5.3 的 workspace-source-plugin）。

### 4.2 bare import（`vue` / `lodash` / 任意 npm 包）— 运行时 import map 方案

**采用 external + 运行时 import map，不采用 build 时 fetch。** 理由：
- 构建快（不在构建时拉网络）、产物小（bare import 不打进 bundle）。
- esm.sh 的嵌套依赖解析交给浏览器原生（esm.sh 返回的模块内部 import 已被它重写为 esm.sh URL）。
- 浏览器 import map 支持已成熟（Chrome/Edge/Firefox/Safari）。

实现：
1. esbuild plugin `cdnExternalPlugin`：`onResolve` 匹配 bare import（非 `.`、非 `/`、非 `http`），返回 `{ path: args.path, external: true }`。产物保留 `import { x } from "vue"`。
2. 产物的 `index.html` 注入 import map：

```html
<script type="importmap">
{
  "imports": {
    "vue": "https://esm.sh/vue@3",
    "preact": "https://esm.sh/preact@10",
    "lodash": "https://esm.sh/lodash@4"
  }
}
</script>
```

import map 的内容来源：**framework 声明决定核心包**（vue → vue@3、preact → preact@10）+ **`cdnExternalPlugin` 的 `onResolve` 收集到的 bare import 集合**（见 §5.3——`onResolve` 把每个 bare import 标记 `external: true` 时顺手记入集合，构建后 write-back 据此为每个生成 esm.sh URL）。

版本策略：**核心框架版本由平台固定**（保证一致性）；**源码带 `package.json` 时用其声明的版本**；**否则额外包取 esm.sh 固定 major**（如 `lodash@4`，避免 `@latest` 不可复现、随时漂移）。

### 4.3 浏览器沙箱固有限制（R11）

跑不了的包给清晰报错：
- 依赖 Node 原生 API（`fs`/`child_process`/完整 `buffer`）→ import map 不映射，运行时报 "Cannot resolve"；或构建时 esm.sh 返回的模块引用了未 polyfill 的 Node API，运行时报错。平台不 polyfill。
- WASM/原生模块 → 运行时报错。
- 这些报错经自检设施（`frontend-inspector.ts`）的 diagnostics 层捕获，反馈给助手。

## 5. 多框架插件

### 5.1 Vue 3 SFC 插件

`@vue/compiler-sfc`（通过 `vue/compiler-sfc` deep import 或 esm.sh 取 `https://esm.sh/@vue/compiler-sfc`）。

esbuild plugin `sfcPlugin`：
- `onLoad({ filter: /\.vue$/ })`：
  1. `parse(source)` → descriptor（template/script/style 块）
  2. `compileScript(descriptor, { id })` → script 编译（含 `<script setup>`）
  3. `compileTemplate({ source: descriptor.template.content, id })` → render function 代码
  4. `compileStyle({ source, id, scoped })` → 编译 scoped CSS（含 `data-v-xxxx` 属性重写）
  5. 拼成 JS 模块：`import { render } from ...; script.render = render; export default script;` + **scoped CSS 以 JS 运行时注入**（编译时把 CSS 字符串拼进模块，模块执行时 `document.head.appendChild(document.createElement('style')).textContent = css`）
- 返回 `{ contents: compiledJs, loader: "js" }`

**scoped CSS 输出策略**：JS 运行时注入，**不抽独立 CSS 文件**。理由：与 vite dev 模式一致、无需 index.html 维护 CSS 清单、scoped CSS 随组件模块生命周期。源码里 `import './x.css'`（非 SFC 内 `<style>`）仍由 esbuild `loader: { ".css": "css" }` 处理，产出独立 CSS 文件由 index.html `<link>` 引用（见 §6）。

JSX/TSX（react/preact）无需 SFC 插件，esbuild 原生 `loader: "tsx"` + `jsx` 配置。

### 5.2 framework 路由

构建服务入口按 `manifest.frontend.framework` 选插件组合：

| framework | SFC 插件 | jsx 配置 | 核心 import map |
|---|---|---|---|
| vue | sfcPlugin | — | vue@3 |
| react | — | `jsx: "automatic"` | react@18, react-dom@18 |
| preact | — | `jsx: "automatic"` + preact/compat 别名 | preact@10 |
| svelte | sveltePlugin（svelte/compiler） | — | svelte@4 |
| vanilla | — | — | — |

首版范围：**vanilla + vue + react + preact**；**svelte 留接口**（sveltePlugin 模式待 vue 的 SFC 插件接口稳定后再加第二个 SFC 编译器）。理由：react/preact 是 esbuild 原生 TSX/JSX，**零插件、纯 framework 路由配置分支 + import map 条目**（`jsx: "automatic"` 自动注入的 `react/jsx-runtime` 也是 bare import，被 `cdnExternalPlugin` 自动覆盖）；svelte 需写第二个 SFC 编译器插件（与 vue 同量级），且无默认卡驱动其必须现在冒烟通过 esm.sh 浏览器兼容。

### 5.3 workspace-source-plugin（从内存读源码）

**源码存储位置**（已核实代码）：源码与产物**同表 `gameCardFrontendFiles`**，靠路径前缀 `frontend/src/` vs `frontend/dist/` 区分——**不是 `gameCardContentFiles`**。`card-frontend` scope 的 `cardFrontendVolume` → `writeLocalGameCardFrontendFile` / `listLocalGameCardFrontendFiles`（`game-cards.ts`，`normalizeFrontendFile` 强制 path 以 `frontend/` 开头）。源码文件存 `data: Blob`，读时 `await r.data.text()` 取文本。

esbuild-wasm 在浏览器内**无文件系统**，必须用插件拦截解析与加载两步，且**用自定义 namespace（如 `"workspace"`）而非 `"file"`**——`"file"` namespace 会触发 esbuild 对不存在的 FS 回退解析直接报错。

```ts
// 1. onResolve：相对 import（./ ../）映射到 workspace 虚拟路径，标记 namespace
onResolve({ filter: /^\.\.?\// }, (args) => {
  const resolved = resolveRelative(args.path, args.importer)  // 相对 importer 解析
  return { path: resolved, namespace: "workspace" }
})

// 2. onLoad：从 gameCardFrontendFiles 读源码
onLoad({ filter: /.*/, namespace: "workspace" }, async (args) => {
  const file = await readLocalGameCardFrontendFile(cardId, `frontend/src/${args.path}`)
  if (!file) return { errors: [{ text: "源码文件未找到: " + args.path }] }
  const content = await file.data.text()
  return { contents: content, loader: loaderFor(args.path) }
})
```

`loaderFor` 按扩展名：`.ts`→ts、`.tsx`→tsx、`.vue`→（交给 sfcPlugin，其 `onLoad` 在 `workspace` namespace 上拦截 `.vue`）、`.css`→css、`.json`→json。bare import 不走本插件，由 `cdnExternalPlugin` 标记 external（§4.2）。

## 6. 构建产物写回

`esbuild.build` 返回 `outputFiles: [{ path, contents, text, hash }]`。

写回流程：
1. 对每个 outputFile，路径拼成 `frontend/dist/${path}`（`path` 已是相对，如 `assets/index-abc.js`）。
2. 调 `writeLocalGameCardFrontendFile(cardId, { path: "frontend/dist/" + path, data: contents })`。
3. 生成 `frontend/dist/index.html`：按产物扩展名分流引用——`.js` → `<script type="module" src="./assets/...">`，`.css` → `<link rel="stylesheet" href="./assets/...">`（SFC 内 scoped CSS 已由 JS 运行时注入，不在此列）+ 注入 import map（§4.2）。
4. 清理旧的 `frontend/dist/**`（删除不在新产物列表里的文件，避免残留）。
5. 更新 `manifest.frontend.entry = "frontend/dist/index.html"`（若未已是）。

原子性：构建成功才写回；构建失败保留旧 `frontend/dist/`（R6）。写回用现有 `writeLocalGameCardFrontendFile`（per-row put + bump card updatedAt）。

## 7. 触发闭环（R6）

### 7.1 检测源码变化

监听 `workspace.write`/`workspace.delete` 对 `frontend/src/**` 路径的写入（card-frontend scope）。实现位置：`platform-host` 的 workspace 操作成功路径，检查写入路径是否在 `frontend/src/` 前缀下。

### 7.2 防抖 + 构建

检测到 `frontend/src/**` 变化后，防抖（如 800ms）触发 `rebuildFrontend(cardId)`：
1. 读 `manifest.frontend.framework` + `frontend/src/**` 全部源码。
2. §3.2 构建调用。
3. 成功 → §6 写回。失败 → 记错误到构建状态（§8），不写回。
4. 构建完成事件通知前端重载（若该卡正在 /play 加载）。

### 7.3 助手如何看结果

助手改完 `frontend/src/` 后：
- 构建成功：调 `inspect_frontend` 自检（重新加载 iframe，见新前端）。
- 构建失败：读构建状态（§8）拿错误，修正源码重试。

## 8. 构建状态（错误反馈）

模块级或 card 级构建状态记录：

```ts
interface FrontendBuildStatus {
  cardId: string
  status: "idle" | "building" | "ok" | "failed"
  lastBuiltAt: string | null
  error?: { message: string; file?: string; line?: number }  // esbuild errors/warnings
}
```

通过 query resource（如 `frontend-build-status`）暴露给助手自检/读取。失败时 `error` 来自 esbuild 的 `result.errors`（含 file/line/text）。

## 9. 默认前端种子（R7）

`default-frontend-files.ts` 退休。新流程：
- `apps/play-frontend-dev/src` 是默认前端源码（开发期用 vite 迭代）。
- 构建期脚本（或 platform-web 种子逻辑）把 `play-frontend-dev/src/**` 内容内联为 `defaultFrontendFiles()` 的源码版：产出 `frontend/src/**`（源码）。
- 首次加载内置卡时，平台对 `frontend/src/` 跑一次构建，产出 `frontend/dist/`。
- 或：构建期预跑构建，`defaultFrontendFiles()` 同时带 `frontend/src/` + `frontend/dist/`（避免首次加载等待构建）。

种子同步方式（实现时定）：构建期内联源码字符串 vs 脚本从 play-frontend-dev 拷贝。倾向构建期内联（与现有 `default-frontend-files.ts` 内联常量模式一致，只是内容从"3 个产物文件"变成"源码文件集 + 预构建产物"）。

## 10. play-frontend-dev 定位（R8）

保留为本地开发预览（vite dev server）。开发者本地用 vite 迭代，确认后源码进游戏卡 `frontend/src/`。两者产物格式对齐：
- vite 产物用绝对路径 `/assets/...`，平台构建产物需用相对路径 `./assets/...`（SW 虚拟 URL 下绝对路径失效）。
- 两者都 ESM。
- vite 的 `@vitejs/plugin-vue` vs 平台的 sfcPlugin：编译结果应一致（都用 @vue/compiler-sfc）。

## 11. 游戏卡导出（R9）

导出带 `frontend/src/`（源码，必带）。`frontend/dist/` 可选带：
- 带产物：接收方首次加载无需等待构建（直接 SW 加载产物）。
- 不带产物：接收方平台首次自动构建（官方部署下所有平台都有构建能力）。
- **决定带产物兜底**（首次体验好，接收方无需等待构建），源码更新时平台自动重建覆盖产物。

## 12. 安全与隔离（R10）

- esbuild-wasm 在浏览器 Web Worker 跑，不触宿主文件系统。
- 源码来自 workspace（`gameCardContentFiles`），构建产物写回 `gameCardFrontendFiles`（都 IndexedDB）。
- 构建只转译，不执行源码。执行仍由 /play 的 iframe 沙箱（`allow-scripts allow-same-origin allow-forms`）负责。
- esm.sh 拉取的第三方包在 iframe 沙箱内执行，与平台同源隔离。

## 13. 文件改动面（预估）

- `packages/contracts/src/game-card.ts`：`GameCardFrontendBinding` packaged 分支加 `framework` 字段 + 类型。
- `apps/platform-web/src/storage/default-frontend-files.ts`：退休内联常量，改为源码种子。
- 新增 `apps/platform-web/src/frontend-build/`：构建服务模块（esbuild 集成、plugin、framework 路由、产物写回、状态）。
- `apps/platform-web/src/platform-host/`：workspace 写入检测 `frontend/src/` + 触发防抖构建；构建状态 query resource。
- `apps/platform-web/src/storage/game-cards.ts`：`defaultFrontendFiles()` 改源码种子；entry 默认值改 `frontend/dist/index.html`。
- `apps/play-frontend-dev`：产物路径相对化（vite 配置 `base: "./"`），与平台构建对齐。

## 14. Validation

- `npm run build:contracts`（contracts 类型改后）。
- `npm run build:web`（platform-web 改后）。
- 手动：
  - 内置卡加载 → 平台构建 frontend/src → /play 正常渲染。
  - 助手 workspace.write("frontend/src/App.vue", 新内容) → 防抖后重建 → 重载见新效果。
  - bare import（vue、lodash）经 esm.sh 加载成功。
  - 构建故意写错语法 → 旧产物保留 + 助手能读错误。
  - vanilla TS 源码卡能构建运行。
  - 旧卡（entry 指 frontend/index.html、无 src）仍能加载（兼容）。

## 15. Resolved Decisions（已落定）

- **import map 版本**：核心框架平台固定；源码带 `package.json` 用其声明版本；否则额外包取 esm.sh 固定 major（避免 `@latest` 漂移）。见 §4.2。
- **写回原子性**：per-file put（复用 `writeLocalGameCardFrontendFile`）+ 构建失败保留旧产物。见 §6。
- **首次加载内置卡**：异步构建 + 加载态 UI；默认前端预构建产物兜底，避免首屏白等。见 §9。
- **首版框架范围**：vanilla + vue + react + preact 实现，svelte 留接口。见 §5.2。
- **wasm/compiler 缓存位置**：独立 IndexedDB 或 Cache API，不动主库。见 §3.1。
- **导出产物兜底**：带 `frontend/dist/`。见 §11。
