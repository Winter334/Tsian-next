# Sass / Less 虚拟文件适配

## Goal

在浏览器内 `esbuild-wasm + Map VFS` 构建链中，以懒加载的官方浏览器编译内核支持 Sass/SCSS 和 Less，使独立样式文件和 Vue SFC `<style lang>` 都能从 `frontend/src/**` 虚拟文件系统解析相对 import，并继续复用既有 scoped CSS、CSS Modules、资源 URL 和 packaged iframe 输出链。

## Background

- 父任务：`07-10-browser-frontend-builder-official-adapters`。
- 前置子任务 `07-10-vue-vfs-css-modules` 已完成并归档（实现 commit `b07a204`；archive commit `9d9e8ce`）。当前基线已提供：
  - canonical workspace VFS path/query/hash 解析；
  - `@/` alias、extension-less 和目录 `index.*` resolution；
  - query/hash 通过 esbuild `OnResolveResult.suffix` 传递；
  - Vue virtual style modules；
  - Vue scoped CSS 和 esbuild `local-css` CSS Modules；
  - 输出路径归一化与 SW-backed `frontend/dist/**` 加载。
- `@vitejs/plugin-vue`、常见 Sass/Less esbuild 插件和 Node package importer 依赖 Node/Vite/真实文件系统，不能直接用于浏览器内 Map VFS。
- 官方 `sass` 包提供浏览器 `compileStringAsync()` 和 custom importer；Less 提供浏览器 `render()` 和 custom FileManager/plugin，但两者需要平台自写 VFS 胶水。
- 新会话实施前必须先检查 git status：当前仓库可能存在其它并行任务的未提交改动；不得覆盖与本任务无关的 `engine.ts` 文本/二进制投影重构或其它 storage/workspace 编辑。

## Requirements

### R1. 浏览器依赖与懒加载

- 使用官方 `sass` 浏览器构建；规划版本基线为 `sass@1.101.0`，实现时以 lockfile 实际解析版本为准并记录。该版本要求 Node `>=20.19.0` 进行安装/平台构建；新会话先确认执行环境满足要求，项目本身不在本任务中新增全局 Node engine 约束。
- Sass browser bundle 必须关闭 identifier/function renaming；Vite production build需配置并验证等价于 esbuild `keepNames` 的 name preservation，不能只验证开发模式。
- 使用固定 `less@4.6.7` 的已导出 core factory subpath `less/lib/less/index.js`，传入 Map-backed FileManager 创建隔离的 Less API；不使用 package root的 browser bootstrap artifact，不调用 `lib/less-browser/bootstrap.js`，不读取或修改 `window.less` / `window.LESS_PLUGINS`，也不扫描 DOM stylesheets。该 exported subpath属于版本锁定的低层 API，升级 Less前必须重跑 factory与安全回归。
- Less imports采用异步 FileManager和 core API的 `less.render()` Promise路径；不走 Vue compiler-sfc 内置 Less preprocessor bridge，因此不把 `loadFileSync` / `syncImport` 作为必要条件。
- 两个编译器必须用独立、缓存 Promise 的 literal dynamic import 懒加载。
- 注册构建插件和编译普通 CSS/Vue 时不得加载 Sass/Less chunk；SCSS/Sass 构建不得加载 Less，Less 构建不得加载 Sass。
- 新依赖不得把 Node `fs/path/process`、native subprocess 或 Node-only entry 打入 platform browser chunk。

### R2. 共享预处理器边界

- 新增一个聚焦的 style-preprocessor 层，由 standalone workspace styles 和 Vue SFC styles 共用；不得在两个插件里复制 Sass/Less import resolution。
- 输入至少包含：语言、源码文本、拥有该样式的 canonical source path、预加载 sources Map。
- 输出至少包含：plain CSS、可诊断的 loaded dependency paths；Sass source map 可作为可选输出供后续组合。
- 预处理顺序固定为：
  1. Sass/Less → plain CSS；
  2. Vue SFC 情况下由 `compileStyleAsync` 应用 scoped rewrite；
  3. esbuild `css` 或 `local-css` 处理资源 URL、CSS Modules 和最终输出。
- 所有预处理器源码必须是字符串；二进制输入清晰失败。

### R3. Standalone 样式入口

- TS/JS/Vue script可导入显式 `.scss/.sass/.less`、extension-less同名样式和目录 `index.*`；解析顺序必须确定且发生歧义时清晰失败。
- `.module.scss`、`.module.sass`、`.module.less` 编译后使用 esbuild `local-css`；普通文件使用 `css`。
- `?raw` 返回原始预处理器源码，不加载编译器。
- `?url` / `?inline` 保持现有 file/dataurl 语义，不执行预处理。
- 样式文件不是应用 entry；不新增 `main.scss` 等 entry candidate。

### R4. Vue SFC styles

- 支持：
  - `<style lang="scss">`
  - `<style lang="sass">`
  - `<style lang="less">`
  - 与 `scoped`、默认/命名 `module` 的组合。
- 保留当前 virtual style request、`args.suffix`、`__scopeId`、`__cssModules` 和相对 CSS asset resolution。
- `<style src>`、Stylus 和未知 `lang` 继续明确失败。

### R5. Sass VFS 语义

- 使用 `compileStringAsync()`；`.scss` 使用 `syntax: "scss"`，`.sass` 使用 `syntax: "indented"`。
- 使用稳定、root-bound 的 canonical URL（建议 `tsian-vfs:///frontend/src/...`）和 Map-backed `Importer`。
- importer 支持 Sass 常用相对解析：显式文件、extension-less `.scss/.sass`、`_partial`、目录 `_index/index`；遇到同层多个候选时报告歧义，不静默按顺序选择。
- 支持现代 `@use` / `@forward`；兼容常规相对 `@import`，但不实现 `pkg:`、node_modules package importer 或磁盘 load paths。
- 越出 `frontend/src/`、非法 scheme/query/hash/encoded slash、缺失或歧义 import 必须清晰失败。
- Sass source map 若启用，使用浏览器安全方式交给 Vue/esbuild 继续组合；不得使用 Node `Buffer`。

### R6. Less VFS 语义与安全

- 使用浏览器 Less `render()`，通过 per-build plugin 注册 Map-backed FileManager；不得回退到 XHR/network 文件加载。
- FileManager使用异步 `loadFile` 从 Map VFS 解析，成功结果返回 canonical slash-separated filename；不得依赖 Vue compiler-sfc 内置 Less bridge或同步 callback行为。
- 支持显式及 extension-less 相对 `.less` import；不额外发明 Sass partial/index 语义。
- 使用 URL rewrite 使 imported Less 中的相对资源在输出 plain CSS 后仍能由 esbuild 从 entry/SFC 所在目录解析。
- 必须设置 `javascriptEnabled: false` 并禁用源码 `@plugin` 执行；游戏卡源码不得在平台 realm 中执行 Less JavaScript/plugin。
- `(optional)` import 不得吞掉 root escape 或其它安全策略违规；缺失 optional 文件可非致命，越界/非法路径必须在 render 后仍失败。
- 本阶段不承诺 Less source map chaining；记录该限制。

### R7. 诊断、兼容与性能

- 编译错误必须包含源文件和语言；若错误由 import触发，还必须包含请求的 import path。
- 构建失败继续沿用旧 dist 保留和 `frontend-build-status` 失败语义。
- 不修改 play bridge、Game Card package contract、Dexie schema、SW DB 名或 iframe sandbox。
- 子任务内记录依赖版本、无预处理器 platform build 产物变化和 Sass/Less lazy chunk 压缩大小。
- 冷加载首次编译时间、缓存后的热编译时间和完整网络懒加载证据延后到父任务最终综合前端包集成测试统一记录。
- 真实 `apps/play-frontend-dev` 源码包不使用 Sass/Less；其无回归 smoke 延后到父任务最终综合前端包集成测试统一执行。

## Child Acceptance Criteria

- [x] `.scss`、indented `.sass`、`.less` 的官方浏览器编译器 adapter 可从 Map VFS 编译，且 Sass/Less 两条能力均通过聚焦 fixture/probe。
- [x] standalone 与 Vue SFC 接入代码支持普通样式、CSS Modules、scoped 和默认/命名 module 组合，并通过类型检查与 production build。
- [x] Sass `@use/@forward`、常规相对 import、partial/index/import-only 与歧义规则通过 adapter fixture。
- [x] Less 相对 import、nested imported-file asset URL rewrite、missing optional 与安全策略通过 adapter fixture。
- [x] 缺失、二进制、非法 scheme、root escape、歧义、Less JavaScript/`@plugin` 均清晰失败，诊断包含语言、入口文件、import 请求和可用位置。
- [x] `?raw/?url/?inline` 的接入分支保持不执行预处理器，完整 esbuild 行为移交父任务综合 fixture。
- [x] `npm run build:web` 和 `git diff --check` 通过；production 产物包含独立 Sass/Less lazy chunks且无已知 Node-only/bootstrap 标记。
- [x] 实施记录包含依赖版本、lazy chunk raw/gzip 大小、已执行 probe、已知限制和父任务用例移交矩阵。

## Parent Integration Handoff

以下项目由父任务在所有能力子任务完成后，通过一个综合测试前端包统一验收，不阻塞本子任务归档：

- standalone `.scss/.sass/.less`、`.module.*` 与 extension-less/目录入口的 browser esbuild-wasm 输出；
- Vue `lang` + scoped/default module/named module 组合及相对资源；
- `?raw/?url/?inline` 完整 loader 语义；
- plain/Sass/Less compiler chunk 网络隔离与重复构建缓存；
- 上传、IndexedDB、dist write-back、SW、packaged iframe 和旧 dist 保留；
- 真实 `play-frontend-dev` 无回归；
- 冷加载首次编译和缓存后热编译耗时。

## Completion Semantics

- 本子任务只有 Sass/SCSS 和 Less 两条能力均满足验收后才可标记完成并归档。
- 若任一官方 browser compiler 经验证无法满足安全、浏览器兼容或可接受的 bundle要求，停止激活后的实现并回到规划：更新 PRD、将不可交付部分拆为独立后续任务或明确取消；不得以“只完成一个编译器”直接归档本子任务。

## Out of Scope

- Stylus。
- Node `sass-embedded`、LibSass/sass.js、Node package importer、`pkg:`、node_modules import 或磁盘 include/load paths。
- 任意 Sass/Less 第三方插件和 Less `@plugin`/JavaScript evaluation。
- 完整复刻 Vite 的 preprocessorOptions、additionalData、全局注入或插件配置。
- Less source-map generator/environment 适配和完整 source map chaining。
- 对 Less `(inline)` 内容中的 URL 做逐来源文件重写。
- 修改前端包、bridge、storage 或 Service Worker contract。
