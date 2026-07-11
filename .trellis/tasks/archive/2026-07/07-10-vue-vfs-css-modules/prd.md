# Vue VFS 加固与 CSS Modules

## Goal

收敛当前浏览器内 Vue/VFS 构建修复，使用 `@vue/compiler-sfc` 官方能力替代脆弱的默认导出正则改写，并基于 esbuild `local-css` 增加普通 CSS Modules 与 Vue `<style module>` 支持，建立能发现“构建成功但 iframe 黑屏/样式或资源失效”的真实回归验证。

## Background

- 父任务：`07-10-browser-frontend-builder-official-adapters`。
- 本子任务是父任务第一阶段，也是 Sass/Less、`import.meta.glob`、Worker 后续子任务的基础。
- 当前工作区已有未提交修复，涉及：
  - `apps/platform-web/src/frontend-build/engine.ts`
  - `apps/platform-web/src/frontend-build/plugins/cdn-external-plugin.ts`
  - `apps/platform-web/src/frontend-build/plugins/sfc-plugin.ts`
  - `apps/platform-web/src/frontend-build/plugins/workspace-source-plugin.ts`
  - `apps/platform-web/src/frontend-build/write-back.ts`
- 这些修复已覆盖二进制资源、路径归一化、`@/` alias、目录入口、基础 asset query、Vue binding/render/scope 和 SFC style 虚拟 CSS import；本子任务必须先审查并吸收它们，而不是假定其全部正确。

## Requirements

### R1. VFS 和输出路径加固

- 源码继续从预加载的 `Map<string, string | Uint8Array>` 读取，不引入 Node 文件系统依赖。
- 相对 import、`@/` alias、extension-less module、目录 `index.*` 和已声明资源扩展按规范化后的 workspace 路径解析。
- `?raw`、`?url`、`?inline` 使用 esbuild 内置 loader 语义；不支持的 worker/custom query 明确失败。
- esbuild output file、metafile entry、CSS link 使用同一输出路径归一化，避免 SW 虚拟路径 404 或 stale cleanup 删除新产物。

### R2. Vue SFC 官方编译链

- 使用 `@vue/compiler-sfc` 的 `parse`、`compileScript`、`compileTemplate`、`compileStyleAsync`。
- 使用官方 `rewriteDefault` 或当前版本等价能力生成本地组件 binding，不再用正则替换 `export default`。
- template 编译必须接收 `compileScript().bindings`。
- render function、`__scopeId`、多 `<style>` block 均正确装配。
- 普通和 scoped SFC style 经虚拟 CSS module 进入 esbuild CSS pipeline，使相对 `url(...)` 资源被正确解析和输出。

### R3. CSS Modules

- 独立 `*.module.css` 使用 esbuild `local-css` loader，支持 JS/TS 中的 module exports。
- Vue `<style module>` 使用同一 `local-css` 能力，不重写 CSS Modules class 算法。
- 默认 `<style module>` 映射为 Vue 的 `$style`；`<style module="name">` 映射为命名 module。
- 组件的 `__cssModules` 正确关联虚拟 style module exports。
- `<style scoped module>` 同时保留 scoped selector 与 module class 映射。
- 外部 `<style src>`、非 CSS preprocessor 仍明确报错；Sass/Less 留给后续子任务。

### R4. 回归与诊断

- 使用可重复的最小构建 fixture 覆盖：
  - `<script setup>` 导入本地组件；
  - 普通与 scoped SFC styles；
  - Vue 默认/命名 CSS Modules；
  - 独立 `.module.css`；
  - `@/`、目录入口、extension-less import；
  - 图片 import、SFC style 相对 `url(...)`；
  - `?raw`、`?url`、`?inline`；
  - entry/metafile 前导 slash 归一化。
- 浏览器验收以真实源码包可构建、packaged iframe 可加载且无控制台错误的烟雾测试为本阶段门槛；暂未使用的能力不要求逐项人工 UI 验收，后续实际使用出现问题时补对应回归。
- 错误必须带文件和原因并进入现有 build status 路径。
- 真实 `apps/play-frontend-dev` 源码包在线构建与 packaged iframe 渲染必须保持正常。

## Acceptance Criteria

- [ ] `sfc-plugin.ts` 不再通过正则替换 `export default`。
- [ ] `<script setup>` 导入组件在 iframe 中渲染为真实 Vue 组件，不是 unresolved custom element。
- [ ] 普通/scoped SFC style 和 style 相对资源 URL 正常输出、加载。
- [ ] `*.module.css`、`<style module>`、`<style module="name">`、`<style scoped module>` 的映射与样式均生效。
- [ ] 最小构建 fixture 覆盖 alias、extension-less、目录入口、资源扩展、基础 asset query 及 CSS Modules 组合。
- [ ] 未支持的 SFC style/query 在构建期清晰失败。
- [ ] entry/output path 不产生双斜线或 fresh output 被 stale cleanup 删除的问题。
- [ ] `npm run build:web` 通过。
- [ ] 真实 `play-frontend-dev` 源码包可在线构建，packaged iframe 可加载且 Console 无构建器相关错误；详细视觉/交互组合留待能力实际使用时按需验证。

## Out of Scope

- Sass/SCSS、Less、Stylus。
- `import.meta.glob`。
- Worker 子构建。
- 完整 Vite 配置/插件兼容。
- play bridge、Game Card package contract、Dexie schema 或 Service Worker DB 名变更。
