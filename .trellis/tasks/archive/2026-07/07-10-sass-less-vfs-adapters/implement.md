# Implementation Plan: Sass / Less 虚拟文件适配

## 0. New-Session Preflight

- [x] 运行 `/trellis-start` 或 `python ./.trellis/scripts/get_context.py`，确认任务仍为 planning。
- [x] 阅读本任务 `prd.md`、`design.md`、`implement.md` 和父任务 `prd.md`。
- [x] 运行 `git status --short`，识别其它并行任务的 dirty files；`07-10-workspace-editable-text-reading` 已提交并归档，未在其 dirty diff上叠加实现。
- [x] 基线稳定后阅读 `engine.ts`、`media-type.ts`、`workspace-blob.ts`，确认唯一 text/binary classification接入点。
- [x] 验证 `implement.jsonl` / `check.jsonl` 并执行 `task.py start 07-10-sass-less-vfs-adapters`；未启动父任务。
- [x] 按 Phase 2.1 路由到 `trellis-implement` agent实施。

## 1. Dependency and Browser-Entry Probe

- [x] 确认当前 Node `>=20.19.0`，再添加官方 `sass@1.101.0` 与固定 `less@4.6.7` 直接依赖并更新 lockfile；记录实际版本。本任务不新增根 package engine policy。
- [x] 在 `apps/platform-web/vite.config.ts` 配置 production name preservation（esbuild `keepNames: true` 或经实测等价配置），满足 Dart Sass browser bundling要求。
- [x] 用最小 production Vite build + preview/browser probe确认 `import("sass")` 选择 browser/default build，`compileStringAsync()` 在 minification后可运行且 chunk无 Node built-ins。
- [x] Probe固定 `less@4.6.7` exported core factory `import("less/lib/less/index.js")`：用 Map FileManager构造隔离 API并执行 Promise render；确认动态 import前后 `window.less`/`window.LESS_PLUGINS`不变，无 DOM stylesheet扫描或页面隐藏。禁止导入 package root和 `lib/less-browser/bootstrap.js`。
- [x] 若 Less无可靠声明，只定义本任务实际使用的窄 structural types；不引入整套不匹配 API 的类型依赖。
- [x] 记录依赖/chunk基线；若任一 browser entry不满足安全/兼容要求，回到规划拆分/取消，不用 Node polyfill绕过，也不能只交付另一编译器后归档本任务。

## 2. Shared Preprocessor VFS

- [x] 新建 `style-preprocessors/vfs.ts`，实现 strict root-bound path resolution。
- [x] 支持 canonical source key、entry directory、文本读取、非法 URL/scheme/query/hash/encoded slash检测。
- [x] 越 root时明确失败，不复用普通 JS resolver的 clamp语义。
- [x] 为 Sass/Less adapter提供共享的错误包装和 dependency collection primitives。
- [x] 反向搜索仓库已有 path/text helpers；文本分类复用 `isTextFilePath`，预处理器 path helper因必须严格拒绝 root escape而不复用普通 workspace clamp语义。

## 3. Sass Adapter

- [x] 新建懒加载 Sass adapter，缓存 `import("sass")` Promise。
- [x] 实现 `compileStringAsync` 调用，传入 root `url: entryCanonicalUrl`，并按 `.scss`/indented `.sass` 选择 syntax。
- [x] 实现 `tsian-vfs:///frontend/src/**` canonical URL转换和 Map-backed Importer。
- [x] 实现显式、extension-less、partial、index以及 import-only候选层级。
- [x] 同层多候选时抛 ambiguity error；不按固定扩展顺序静默选择。
- [x] 支持 `@use/@forward` 与常规相对 `@import`；拒绝 `pkg:`、bare package和 root escape。
- [x] 评估 source map → Vue `inMap` / esbuild组合；使用 browser-safe编码，不使用 Buffer。
- [x] 返回 CSS和dependencies；source map经评估后按本阶段已记录限制保持关闭。

## 4. Less Adapter

- [x] 新建懒加载 Less adapter，缓存 `less/lib/less/index.js` factory Promise；每次 compilation用 Map FileManager构造隔离 Less API。
- [x] 首次 import probe确认 pinned core factory subpath无 DOM bootstrap；实现不得设置/恢复 `window.less`，动态 import前后全局 identity保持不变。
- [x] 实现 per-render Map-backed FileManager/plugin，使用 Promise-based `loadFile`；不启用 `syncImport`，不依赖 compiler-sfc内置 Less bridge或 `loadFileSync`。
- [x] claim imports，阻止 browser XHR fallback；支持显式/extension-less `.less`。
- [x] 设置 `rewriteUrls: "all"`，验证 nested imported-file asset URL最终从 entry context被 esbuild解析。
- [x] 设置 `javascriptEnabled: false` 和 `disablePluginRule: true`。
- [x] 用 side-channel记录安全违规，使 `(optional)` 无法吞 root escape/非法 scheme；missing optional可保持非致命。
- [x] 不启用 Less source map；限制已写入 `research/validation.md`。

## 5. Shared Dispatcher

- [x] 新建 `style-preprocessors/index.ts`，定义语言、输入、结果和统一 diagnostics。
- [x] dispatcher按 `scss/sass/less` 调用对应 adapter；CSS不进入该层。
- [x] compiler imports保留在对应 adapter的 literal dynamic import中，未从 shared index静态引入。

## 6. Standalone Workspace Integration

- [x] 确保 `.scss/.sass/.less` 被加载为文本；与并行 text/blob重构合并到单一分类来源。
- [x] 扩展 workspace resolution candidate lists，包括 module variants所需后缀。
- [x] 保持 `?raw` 原文、`?url/?inline` file/dataurl，以上路径不加载预处理器。
- [x] 无 query的 standalone preprocessors调用 dispatcher。
- [x] 普通文件返回 `css`，`.module.*` 返回 `local-css`。
- [x] 保持 canonical path + esbuild suffix invariant。

## 7. Vue SFC Integration

- [x] `validateStyleBlock` 接受 `css/scss/sass/less`，继续拒绝 Stylus/unknown/style src。
- [x] `compileSfcStyle` 在 Vue scoped transform前调用 shared dispatcher。
- [x] Sass map可用时传 `inMap`；Less不承诺 map。
- [x] 保持 virtual style imports、`args.path + args.suffix`、module import、`__cssModules`、`__scopeId`。
- [x] 以聚焦 compiler/SFC probe验证 `<style lang="scss" scoped module="theme">` 和 Less module组合；完整 esbuild输出由父任务fixture复验。

## 8. Diagnostics and Failure Semantics

- [x] 所有 adapter错误包含 language、entry filename和 requested import；保留 line/column/extract（可用时），并转换为 esbuild `PartialMessage.location`。现有 build-status仍只持久化 message，因此 error text必须自包含文件与位置。
- [x] 测试 missing、ambiguous、binary、root escape、illegal scheme、Less `@plugin` 和 JavaScript evaluation。
- [ ] 由父任务综合fixture验证 trigger/build-status标记失败、隐藏 rebuilding overlay，并保留旧 dist。

## 9. Validation

### Build/static

- [x] `npm run build:web`
- [x] `git diff --check`
- [x] 检查 production assets 中 Sass/Less独立 lazy chunks和无 Node built-ins/bootstrap标记。

### Parent-level consolidated browser integration

以下完整浏览器回路延后到父任务 `07-10-browser-frontend-builder-official-adapters` 的最终集成阶段，不作为本子任务归档阻塞项。父任务将在 Sass/Less、`import.meta.glob` 和 Worker 能力子任务全部完成后，构造一个综合测试前端包统一运行上传 → IndexedDB → browser esbuild-wasm → write-back → SW → packaged iframe 验证。

- [x] 将本任务的 standalone、SFC、imports、scoped/module、asset URL、错误矩阵和 lazy loading 用例移交父任务综合 fixture清单（见 `research/validation.md`）。
- [ ] 由父任务最终集成阶段固化 fixture源码、zip生成方式、测试卡/上传步骤、DOM/computed-style/network/build-status断言与清理。
- [ ] 由父任务验证真实浏览器 compiler chunk隔离、Promise缓存、旧 dist保留和 `play-frontend-dev` 无回归。

### Parent fixture handoff cases

以下用例写入本任务 `research/validation.md` 的移交矩阵，由父任务最终综合前端包执行，不是本子任务内待执行清单：

- [ ] standalone `.scss` + `@use` partial。
- [ ] standalone indented `.sass`。
- [ ] standalone `.less` + nested import。
- [ ] `.module.scss` / `.module.sass` / `.module.less`。
- [ ] Vue scoped/module/named module + `scss/sass/less`。
- [ ] Sass `@forward`、import-only candidate和 ambiguity precedence。
- [ ] Less inline JavaScript与 `@plugin`拒绝。
- [ ] nested style asset URL。
- [ ] `?raw/?url/?inline` bypass。
- [ ] missing/ambiguous/root escape/binary/`@plugin` failures。
- [ ] plain CSS不加载任何 compiler；SCSS只加载 Sass；Less只加载 Less；重复构建复用缓存。
- [ ] 至少两次 rebuild，确认 esbuild initialize和compiler Promise均可复用。

### Parent-level real-source smoke

以下 smoke 由父任务最终综合集成阶段执行：

- [ ] 重建 `play-frontend-dev` 源码包。
- [ ] packaged iframe可加载，Console无构建器相关错误，Network无新增 404。
- [ ] 按用户当前偏好，不要求逐项人工视觉细测；未使用能力以 fixture为主，实际使用时再补针对性回归。

### Performance record

- [x] 记录实际 Sass/Less版本。
- [x] 记录 production lazy chunk raw/gzip大小。
- [x] 将冷动态加载+首次 compile和热 compile耗时移交父任务最终综合测试记录。
- [x] 将 plain build未加载 compiler的网络证据移交父任务最终综合测试记录。

## 10. Review and Finish

- [x] 确认 Sass和 Less两条能力都满足 AC；若任一未交付，回到 planning拆分/修订，不归档本子任务。

- [x] 运行 `trellis-check`，处理所有 High/Medium发现。
- [x] 将新发现的 browser compiler/VFS gotcha更新到 `.trellis/spec/platform-web/frontend/quality-guidelines.md`。
- [x] 更新 PRD acceptance状态与 completion notes，诚实记录父任务延期项。
- [ ] 按 Phase 3.4提交代码和任务文档；不提交 `tmp/` 或并行任务文件。
- [ ] 归档 `07-10-sass-less-vfs-adapters` 并记录 journal；父任务保留 planning，进度变为 2/4。

## Rollback Points

- Sass和 Less adapters相互独立，可分开提交/回滚。
- shared VFS helper完成后先用 pure fixture验证，再接插件。
- 接入 standalone styles后先验证普通 CSS无回归，再接 Vue SFC。
- 任一 compiler browser构建不满足安全/体积要求时，保留显式 unsupported，不影响另一 compiler和普通 CSS/Vue。
