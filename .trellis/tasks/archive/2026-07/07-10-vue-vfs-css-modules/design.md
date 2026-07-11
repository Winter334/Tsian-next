# Design: Vue VFS 加固与 CSS Modules

## Scope and Boundaries

本任务只修改 `apps/platform-web` 的浏览器内源码前端构建链，必要时增加仅供该链路使用的测试/fixture。输入仍是 IndexedDB 中 `frontend/src/**` 预加载后的内存 Map；输出仍由 `writeBackDist` 写入 `frontend/dist/**`，再由现有 Service Worker 在 packaged iframe 中加载。

不引入 Vite runtime、Node 文件系统 polyfill、存储 schema 或桥协议变更。

## Architecture

### 1. Shared VFS request model

将 workspace source resolution 保持为一个职责清晰的浏览器 VFS adapter：

1. 解析 import path、query、hash。
2. 将 `@/`、相对路径和 esbuild 传入的绝对/namespace 路径规范化为 `frontend/src/` 相对 key。
3. 在 `onResolve` 阶段确定真实文件 key，包括 extension-less 与目录 `index.*`。
4. 在 `onLoad` 阶段按 query/扩展选择 loader。

Vue style virtual requests仍使用同一 `workspace` namespace，但由 SFC plugin 的更具体 `onLoad` 先处理。

### 2. Vue SFC assembly

对每个 `.vue` 文件：

1. `parse(source, { filename })`。
2. `compileScript(descriptor, { id, isProd: true })`。
3. 通过 `rewriteDefault(script.content, "__sfc_main", parserPlugins)` 将默认导出安全改写为本地 binding；若 `compileScript` 支持并验证可用的 `genDefaultAs`，可采用该官方等价 API，但不得退回正则。
4. `compileTemplate` 接收 `bindingMetadata: script.bindings`，有 scoped style 时传 `scopeId`。
5. 为每个 style block 生成稳定的虚拟 style request。
6. 挂载 `render`、`__scopeId`、`__cssModules` 后导出 `__sfc_main`。

模板-only SFC 使用空组件 binding。plain `<script>`、`<script setup>` 及两者组合都走官方默认导出重写路径。

### 3. Virtual styles

SFC 主模块不直接注入 `<style>`，而是 import style virtual modules：

- 普通 `<style>`：side-effect import，virtual loader 返回 `css`。
- `<style module>`：namespace import，virtual loader 返回 `local-css`；主模块把 namespace export 放入 `__sfc_main.__cssModules.$style`。
- `<style module="name">`：同上，但 key 为 `name`。
- `<style scoped module>`：先由 `compileStyleAsync(scoped: true)` 重写 scope selector，再由 esbuild `local-css` 重写 local class；组件同时挂 `__scopeId` 与 `__cssModules`。

每个 virtual style request应保留源 `.vue` 所在目录的 resolve context。这样编译后 CSS 的 `url("../assets/x.png")` 仍从组件目录解析，而不是从虚拟根或输出目录解析。

### 4. Standalone CSS Modules

workspace loader 对 `.module.css` 使用 `local-css`，普通 `.css` 使用 `css`。不为 CSS Modules 自行生成 class 名，完全采用 esbuild exports。

### 5. Output materialization

`writeBackDist` 使用一个 normalize helper处理：

- `outputFiles[].path`
- metafile entry path
- CSS link paths
- stale cleanup path set

Sourcemap、CSS、dynamic chunk 和 file-loader asset 全部按 `frontend/dist/` 下同一相对路径写入。

## Error Model

构建期明确拒绝：

- `<style src>`；
- `lang` 不是 `css`（后续 Sass/Less 子任务处理）；
- 非字符串 `.vue`；
- 无效 style index/module 名；
- `?worker` / `?sharedworker`；
- 未被显式支持且会产生歧义的构建 query。

错误文本携带 source path 和能力名，由 esbuild build error 进入现有 frontend build status。

## Compatibility

- 保留源码包 entry 约定与 framework routing。
- 保留 import map/CDN external 行为；`@/` 必须在 CDN plugin 前被排除为本地 alias。
- 保留旧 dist-only 包。
- 不改变现有 iframe sandbox、Service Worker URL 或 DB 名。
- 当前未提交的兼容修复作为本任务起点；实现前通过 diff 审查其正确性，避免覆盖其他用户改动。

## Validation Strategy

### Static/type build

```bash
npm run build:web
```

### Browser build fixture

提供最小 Vue VFS fixture，触发真实 `esbuild-wasm`：

- root app + `<script setup>` child component；
- scoped/style module/named module；
- standalone `.module.css`；
- local image and CSS `url(...)`；
- alias、directory index、asset queries；
- failure fixtures for unsupported style/query。

断言构建输出包含 entry HTML/JS/CSS/assets，加载 iframe 后断言组件 DOM、CSS module class、scope attribute 和资源请求成功。

### Real-source regression

上传/重传 `apps/play-frontend-dev` 源码包，在 `/play` 中验证：

- iframe 无 console error；
- 不出现 unresolved `<atmospherelayer>` 等自定义标签；
- `STORY`/logo 等真实内容存在；
- CSS 与图片资源成功加载。

## Rollback

- 构建失败时继续保留旧 dist，不改变现有 R6 行为。
- 若 CSS Modules 适配影响普通 SFC style，可独立回退 module branch，保留官方 default rewrite 与普通 virtual CSS pipeline。
- 不涉及持久化 schema，因此代码回退无需数据迁移。
