# import meta glob VFS 子集

## Goal

为源码型 Game Card 前端定义并实现一个可诊断的 `import.meta.glob` Vite 兼容子集，通过枚举内存 VFS key 生成静态或懒加载 imports，而不依赖 Node 文件系统 glob 插件。

## Background

- 构建器会在构建前把 `frontend/src/**` 预加载为规范化、排序后的 `Map<string, string | Uint8Array>`；glob 只枚举该 Map，不重新读取 IndexedDB。
- 主构建已启用 ESM、splitting 和 `write: false`；lazy glob 生成的动态 import 可直接复用现有 esbuild 分包与 dist write-back。
- 动态 chunks 和 assets 已能写入 `frontend/dist/**` 并由现有 Service Worker 提供，因此本任务不修改存储或 Service Worker 协议。
- glob 转换需要覆盖入口源码、普通 JS/TS/JSX 模块及 Vue SFC 编译后的脚本模块，不能依赖一个会被现有 `onLoad` 链短路的后置插件。
- 依赖 `07-10-vue-vfs-css-modules` 已完成的 canonical VFS resolution；glob 的路径越界检查必须比普通 import 更严格。

## Requirements

### R1. 浏览器安全边界

- 所有解析、转换和匹配逻辑必须可在浏览器中的 `esbuild-wasm` 下运行。
- 不使用 Node `fs/path`、`fast-glob`、`tinyglobby` 或扫描真实文件系统的插件。
- 普通源码不含 `import.meta.glob` 时，不应无条件加载 glob parser/transform/matcher 实现。

### R2. 支持的调用形式

- 识别直接调用 `import.meta.glob(pattern)` 及 `import.meta.glob(pattern, options)`。
- 首版只接受单个静态 pattern：单双引号字符串或无插值 template literal；变量、插值模板、pattern 数组和动态表达式清晰失败。
- 支持相对 pattern 和 `@/` source-root pattern。
- options 只支持省略、空对象及静态布尔值 `eager`；`import`、`query`、`as`、`exhaustive`、spread、computed key 和其他未知 options 清晰失败。
- 默认及 `{ eager: false }` 为 lazy，`{ eager: true }` 为 eager。

### R3. VFS 匹配与路径语义

- pattern 只能匹配当前源码 Map 中的规范化 key，不扫描 npm/CDN package 或其他卡片文件。
- importer 相对 pattern 在嵌套目录中正确解析；`@/` 从 VFS source root 解析，结果对象 key 使用展开后的 VFS 根路径（例如 `@/views/*.ts` 产生 `/views/a.ts`）。
- 越出 VFS source root、绝对路径、bare pattern、URL/scheme、反斜杠、query/hash 和非法编码路径必须在构建期失败。
- 匹配语法使用浏览器安全 matcher 支持的 globstar、braces、extglob 和字符类；这是 pattern grammar 的兼容面，不扩展宏参数或 options 范围。
- 匹配区分大小写，默认不包含隐藏路径段，结果按规范化 VFS key 确定性排序，并排除 importer 自身。
- 无匹配项时返回空对象，不报错。

### R4. 生成代码与构建产物

- lazy glob 生成 `() => import(...)` 映射，并继续使用主 esbuild 构建的 ESM splitting。
- eager glob 生成静态 namespace imports 和确定性对象映射。
- 内部生成的 import specifier 必须继续经过现有 workspace source resolution。
- 所有动态 chunks、CSS 和 assets 复用现有 `frontend/dist/**` write-back；不新增持久化协议。
- 修正入口产物识别，使新增 dynamic entry chunks 不会被误选为 HTML 主入口。

### R5. 诊断与兼容

- 对变量、computed access、提取引用等非直接调用式的 `import.meta.glob` 用法主动报构建错误，不保留到运行时。
- 诊断至少包含能力名、importer、行列和失败原因，并能进入现有 frontend build status 链路。
- 现有无 glob 源码、Vue SFC、CSS Modules、Sass/Less、资源加载和 dist write-back 行为不得回归。
- 首版不承诺 Vite 的 lazy CSS 注入时机；现有 write-back 可能把动态 chunk 的 CSS 统一链接进 HTML，此限制需记录但不阻塞 glob JS 分包。

## Acceptance Criteria

- [x] lazy glob 从 VFS 匹配文件并生成可执行动态 import map，产出可加载的 split chunks（Map VFS + esbuild-wasm probe）。
- [x] eager glob 生成静态 imports 并返回确定性映射。
- [x] 相对与 `@/` pattern 在嵌套 importer 中正确解析，映射 key 符合已确定的兼容语义。
- [x] 空匹配返回 `{}`；结果区分大小写、排除 importer 且顺序稳定。
- [x] 动态 pattern、越界路径、未知 options 和非调用式引用均给出可定位构建错误。
- [x] glob 可用于入口、普通 JS/TS/JSX 和 Vue SFC 脚本（pure + production plugin probes）。
- [x] 主 HTML 入口不会被 dynamic glob chunks 干扰（精确匹配 `frontend/src/${entryPath}`）。
- [ ] `npm run build:web` 和浏览器内真实 glob fixture 通过（build:web 与 focused esbuild-wasm fixture 已通过；完整浏览器产品回路由父任务统一执行）。
- [ ] 真实 `play-frontend-dev` 源码包无回归（平台 production build 已通过；真实源码包 browser rebuild 由父任务统一执行）。

## Completion Notes

- 已实现依赖懒加载、严格 VFS path/matcher、lazy/eager 代码生成、entry/workspace/Vue 三处接入、结构化诊断与精确根 entry 输出选择。
- 聚焦 pure fixture 和 Map VFS + esbuild-wasm fixture 证据记录在 `research/validation.md`。
- 本子任务不执行完整上传、IndexedDB、Service Worker、packaged iframe 回路，也不声称复刻 Vite lazy CSS 注入时机；这些按父任务边界保留给最终综合 fixture。

## Out of Scope

- 完整复刻所有 Vite `import.meta.glob` options。
- pattern 数组、negative patterns、`import`、`query`、`as` 和 `exhaustive`。
- 扫描 IndexedDB 之外的磁盘/npm package 文件。
- 任意第三方 glob 宏。
- 精确复刻 Vite 的按需 CSS 注入时机。
