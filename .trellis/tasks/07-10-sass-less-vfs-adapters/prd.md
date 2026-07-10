# Sass Less 虚拟文件适配

## Goal

在浏览器内 `esbuild-wasm + Map VFS` 构建链中，以懒加载的官方浏览器编译内核支持 Sass/SCSS 和 Less，并让其相对 import 从 `frontend/src/**` 虚拟文件系统解析。

## Requirements

- 依赖父任务 `07-10-browser-frontend-builder-official-adapters` 及子任务 `07-10-vue-vfs-css-modules` 完成的 canonical VFS/style virtual module 基础。
- Sass/SCSS 使用浏览器可运行的 `sass` 字符串编译 API和 Map-backed importer。
- Less 使用浏览器可运行的 Less API 和 Map-backed file manager/解析层。
- 编译器仅在实际遇到对应扩展或 `<style lang>` 时动态加载。
- 支持 SFC style 和独立 `.scss/.sass/.less` 中的相对 import；禁止逃出 `frontend/src/`。
- 编译错误携带源文件、语言和 import 路径。
- 记录新增依赖对 platform build 产物和首次在线构建耗时的影响。

## Acceptance Criteria

- [ ] `.scss/.sass/.less` 独立文件可从 TS/Vue 源码导入并生成 CSS。
- [ ] `<style lang="scss|sass|less">` 可编译，scoped/module 组合按第一阶段语义工作。
- [ ] Sass/Less 相对 import 从 Map VFS 解析，缺失或越界路径清晰失败。
- [ ] 未使用预处理器的构建不加载相应 compiler chunk。
- [ ] `npm run build:web` 与浏览器内真实构建 fixture 通过。
- [ ] 真实 `play-frontend-dev` 源码包无回归。

## Out of Scope

- Stylus。
- Node package importer、任意 npm Sass/Less plugin。
- 读取本地磁盘 includePaths。
