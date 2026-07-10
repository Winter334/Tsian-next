# 浏览器内前端构建器官方能力适配

## Goal

在保留 `esbuild-wasm + IndexedDB/Map VFS` 浏览器架构的前提下，让源码型 Game Card 前端构建器优先复用官方、浏览器可运行的编译能力，减少自写 Vue/Vite 语义与脆弱字符串重写，并按可独立验证的阶段补齐常用能力。

## Background

- 构建发生在浏览器内，源码来自 IndexedDB 预加载后的 `Map<string, string | Uint8Array>`，没有 Node `fs/path` 和真实文件系统。
- `@vitejs/plugin-vue`、`unplugin-vue/esbuild` 及常见 Vue/esbuild、Sass、Less、glob、worker 插件大多依赖 Node/Vite，不能直接挂到当前 `esbuild-wasm` 构建中。
- Vue SFC 复用官方 `@vue/compiler-sfc`；普通 CSS、CSS Modules、资源输出优先复用 esbuild 内置 loader。
- 现有任务 `07-09-source-frontend-package-build` 已打通源码包上传与在线构建；本任务聚焦构建器能力和可靠性，不重复设计上传协议。
- 第一阶段 `07-10-vue-vfs-css-modules` 已完成并归档（commit `b07a204`，archive commit `9d9e8ce`）：当前基线已包含 canonical VFS 解析、`@/` alias、extension-less/目录入口、query/hash `suffix` 处理、二进制资源、输出路径归一化、Vue `<script setup>` binding/render/scope、虚拟 SFC styles 和 CSS Modules。
- 第二阶段 `07-10-sass-less-vfs-adapters` 已完成并归档（implementation commit `27af439`，archive commit `4de7468`）；其完整浏览器产品回路已纳入父任务最终综合 fixture。
- 第三阶段 `07-10-import-meta-glob-vfs` 已完成实现、聚焦验证并归档；完整浏览器产品回路继续由父任务最终综合 fixture 覆盖。当前下一交付项为 Worker 子构建与物化，父任务本身不作为代码实施目标。

## Requirements

### R1. 浏览器/VFS 边界

- 所有新增构建能力必须可在浏览器中的 `esbuild-wasm` 下运行。
- 源文件解析必须通过现有内存 VFS，不得依赖 Node `fs/path/process.cwd()` 或临时磁盘文件。
- 新增第三方库必须有浏览器可用构建，并按实际使用场景懒加载，避免无条件扩大平台首屏包。

### R2. 官方能力优先

- Vue SFC 复用 `@vue/compiler-sfc` 的官方编译与默认导出重写能力。
- 普通 CSS、CSS Modules、资源 URL、text/data URL/file 输出优先复用 esbuild 内置 loader。
- Sass/SCSS、Less 复用各自浏览器可运行的编译内核，只自写 Map-backed importer/file manager。
- `import.meta.glob` 复用浏览器安全的 parser/transform/glob matcher，只自写 VFS 枚举和 Vite 子集语义。
- Worker 复用同一 `esbuild-wasm` 构建内核，只自写子构建编排和输出物化。

### R3. 分阶段可交付

- 本请求作为父任务管理，不直接承载大范围实现。
- 每个能力子任务必须可独立规划、实现、完成静态检查与聚焦能力验证并归档；完整上传、IndexedDB、browser esbuild-wasm、SW 与 packaged iframe 回路集中在父任务最终集成阶段执行。
- 第一阶段先收敛现有兼容修复、Vue 官方 API、CSS Modules 和自动化回归，再推进预处理器、glob 和 Worker。
- 后续子任务不得要求前置阶段之外的隐式未提交状态；依赖和顺序写入各自设计/实施计划。

### R4. 兼容与诊断

- 现有真实 `apps/play-frontend-dev/src` 源码包必须继续可构建、可加载，不得回归之前已修复的黑屏、资源 404 或 SFC scoped style 问题。
- 对不支持或尚未进入对应阶段的 SFC/Vite 能力，必须在构建期给出明确错误，不允许构建成功后静默失效。
- 构建失败必须进入现有 frontend build status 诊断链路，并指出文件、能力和原因。
- 不修改 play bridge 协议、Game Card package contract、Dexie schema 或 Service Worker DB 名。

### R5. 父任务综合集成测试

- Sass/Less、`import.meta.glob` 和 Worker 子任务完成后，构造一个综合测试前端源码包，一次覆盖新增能力与既有 Vue/CSS/VFS 能力的组合。
- 综合测试走真实上传 → IndexedDB → browser esbuild-wasm → dist write-back → Service Worker → packaged iframe 链路，并覆盖成功输出、资源加载、Console/Network、失败诊断和旧 dist 保留。
- 子任务负责维护可移交的用例矩阵和聚焦验证证据；完整浏览器回路、网络懒加载证据及冷/热性能测量由父任务最终集成阶段统一完成。
- 综合 fixture 的源码应可重复生成；二进制 zip 只放未跟踪 `tmp/`，是否保留长期 fixture 源码在父任务集成设计中决定。

## Task Map

1. **Vue/VFS 加固与 CSS Modules — 已完成**
   - 任务：`07-10-vue-vfs-css-modules`（已归档）。
   - 已使用 `@vue/compiler-sfc` 官方 `genDefaultAs`，并以 esbuild `local-css` 支持独立及 Vue CSS Modules。
   - 已加固 alias、目录入口、asset query/suffix、图片、scoped style、style `url(...)` 和输出路径。
2. **Sass/Less 虚拟文件适配 — 已完成**
   - 任务：`07-10-sass-less-vfs-adapters`（已归档）。
   - 已实现官方浏览器编译器懒加载、共享 strict Map VFS adapter、standalone/Vue style接入及结构化诊断。
   - 子任务已记录 production chunk体积与聚焦 probe；网络冷/热成本和完整产品回路由父任务最终综合 fixture统一验证。
3. **`import.meta.glob` VFS 子集 — 已完成**
   - 任务：`07-10-import-meta-glob-vfs`（已归档）。
   - 已实现单静态 pattern、relative/`@/`、lazy/eager、浏览器 matcher 语法与 fail-loud 边界，并完成聚焦 transform / esbuild-wasm 验证。
   - 完整上传、IndexedDB、Service Worker 与 packaged iframe 回路仍由父任务最终综合 fixture 统一验证。
4. **Worker 子构建与物化 — 最后**
   - 任务：`07-10-worker-subbuild-materialization`（planning）。
   - 支持明确的 worker import 形式，使用同一 VFS 独立构建 worker，并将产物写入 SW-backed `frontend/dist/**`。

## Cross-Child Acceptance Criteria

- [ ] 各子任务均有独立、可执行的验收场景和错误矩阵。
- [x] Vue SFC 默认导出组装不再依赖正则替换 `export default`。
- [x] `<script setup>` 本地组件、render function、scoped style 和 CSS Modules 已完成构建验证，并通过真实 packaged iframe 无控制台错误的烟雾验证。
- [ ] 父任务最终综合测试前端包通过真实浏览器回路验证 Sass/Less、`import.meta.glob`、Worker 的已声明兼容子集。
- [ ] 未支持的语法或模式在构建期产生明确、可定位错误。
- [ ] 真实 `play-frontend-dev` 源码包在线构建成功并在 packaged iframe 中渲染。
- [ ] 每个修改 `apps/platform-web` 的子任务均通过 `npm run build:web`。
- [ ] 父任务最终集成阶段对所有 `src/frontend-build/` 修改运行一次完整真实浏览器回路；各能力子任务不得只做 `build:web`，还需提供聚焦 fixture/probe 和可移交用例矩阵。

## Out of Scope

- 在浏览器中运行完整 Vite、读取/执行任意 `vite.config.ts` 或安装任意 Vite 插件。
- 引入 Node 文件系统 polyfill 来运行 Node-only 构建插件。
- 支持任意第三方自定义 query/plugin 语义。
- 修改前端包上传协议、桥协议、存储 schema 或 iframe权限模型。
