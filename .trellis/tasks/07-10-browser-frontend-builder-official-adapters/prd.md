# 浏览器内前端构建器官方能力适配

## Goal

在保留 `esbuild-wasm + IndexedDB/Map VFS` 浏览器架构的前提下，让源码型 Game Card 前端构建器优先复用官方、浏览器可运行的编译能力，减少自写 Vue/Vite 语义与脆弱字符串重写，并按可独立验证的阶段补齐常用能力。

## Background

- 构建发生在浏览器内，源码来自 IndexedDB 预加载后的 `Map<string, string | Uint8Array>`，没有 Node `fs/path` 和真实文件系统。
- `@vitejs/plugin-vue`、`unplugin-vue/esbuild` 及常见 Vue/esbuild、Sass、Less、glob、worker 插件大多依赖 Node/Vite，不能直接挂到当前 `esbuild-wasm` 构建中。
- Vue SFC 应继续复用官方 `@vue/compiler-sfc`；普通 CSS、CSS Modules、资源输出应优先复用 esbuild 内置 loader。
- 当前工作区已有未提交的 `frontend-build` 兼容修复：二进制资源、路径归一化、`@/` alias、基础 asset query、Vue `<script setup>` binding/render/scope、SFC style 虚拟 CSS import。这些改动是第一阶段的当前基线，需要纳入任务、审查和回归验证，不得被覆盖或重复实现。
- 现有任务 `07-09-source-frontend-package-build` 已打通源码包上传与在线构建；本任务聚焦构建器能力和可靠性，不重复设计上传协议。

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
- 每个子任务必须可独立规划、实现、验证和归档。
- 第一阶段先收敛现有兼容修复、Vue 官方 API、CSS Modules 和自动化回归，再推进预处理器、glob 和 Worker。
- 后续子任务不得要求前置阶段之外的隐式未提交状态；依赖和顺序写入各自设计/实施计划。

### R4. 兼容与诊断

- 现有真实 `apps/play-frontend-dev/src` 源码包必须继续可构建、可加载，不得回归之前已修复的黑屏、资源 404 或 SFC scoped style 问题。
- 对不支持或尚未进入对应阶段的 SFC/Vite 能力，必须在构建期给出明确错误，不允许构建成功后静默失效。
- 构建失败必须进入现有 frontend build status 诊断链路，并指出文件、能力和原因。
- 不修改 play bridge 协议、Game Card package contract、Dexie schema 或 Service Worker DB 名。

## Task Map

1. **Vue/VFS 加固与 CSS Modules**
   - 吸收和审查当前工作区兼容修复。
   - 使用 `@vue/compiler-sfc` 官方默认导出重写能力。
   - 使用 esbuild `local-css` 支持普通 CSS Modules 和 Vue `<style module>`。
   - 建立浏览器内构建回归样例，覆盖 alias、目录入口、asset query、图片、scoped style 和 style `url(...)`。
2. **Sass/Less 虚拟文件适配**
   - 动态加载浏览器编译器。
   - 支持 SFC style 与独立样式文件中的虚拟相对 import。
   - 监控并记录 bundle/首次构建成本。
3. **`import.meta.glob` VFS 子集**
   - 定义并实现明确的 Vite 兼容子集。
   - 从 VFS key 枚举生成 eager/lazy imports。
4. **Worker 子构建与物化**
   - 支持明确的 worker import 形式。
   - 使用同一 VFS 独立构建 worker，并将产物写入可由 SW 加载的 `frontend/dist/**`。

## Cross-Child Acceptance Criteria

- [ ] 各子任务均有独立、可执行的验收场景和错误矩阵。
- [ ] Vue SFC 默认导出组装不再依赖正则替换 `export default`。
- [ ] `<script setup>` 本地组件、render function、scoped style 和 CSS Modules 在 packaged iframe 中正常工作。
- [ ] Sass/Less、`import.meta.glob`、Worker 的已声明兼容子集均通过浏览器内真实构建验证。
- [ ] 未支持的语法或模式在构建期产生明确、可定位错误。
- [ ] 真实 `play-frontend-dev` 源码包在线构建成功并在 packaged iframe 中渲染。
- [ ] 每个修改 `apps/platform-web` 的子任务均通过 `npm run build:web`。
- [ ] 每个修改 `src/frontend-build/` 的子任务均完成真实浏览器回路验证；不能用 `build:web` 代替。

## Out of Scope

- 在浏览器中运行完整 Vite、读取/执行任意 `vite.config.ts` 或安装任意 Vite 插件。
- 引入 Node 文件系统 polyfill 来运行 Node-only 构建插件。
- 支持任意第三方自定义 query/plugin 语义。
- 修改前端包上传协议、桥协议、存储 schema 或 iframe权限模型。
