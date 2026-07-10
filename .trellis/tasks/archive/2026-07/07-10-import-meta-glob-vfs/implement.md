# Implementation Plan: import.meta.glob VFS 子集

## 0. Preflight and Activation

- [x] 阅读父任务 `prd.md` 以及本任务 `prd.md`、`design.md`、`implement.md`。
- [x] 运行 `git status --short`，保留任务归档改动与未跟踪 `tmp/`，不覆盖或提交无关内容。
- [x] 验证 `implement.jsonl` / `check.jsonl` 各有真实上下文条目。
- [x] 用户审核规划后运行 `task.py start 07-10-import-meta-glob-vfs`；不启动父任务。
- [x] 按 Phase 2.1 将实现交给 `trellis-implement` agent。

## 1. Dependency and Browser Bundle Probe

- [x] 在 `apps/platform-web` 声明固定/兼容版本的 `@babel/parser`、`magic-string`、`picomatch` 直接依赖和 `@types/picomatch` 开发依赖，更新 lockfile；不要依赖 Vite 的传递安装。
- [x] 选择与当前 Node/toolchain 兼容的 Babel 7 parser，不盲升要求 Node 22.18+/24.11+ 的 Babel 8。
- [x] 确认 `picomatch/posix` 可被 Vite 浏览器 bundle，production chunk 不含 `fs/path/process.platform` 等 Node-only路径。
- [x] 确认 parser、MagicString、matcher 只从 literal dynamic import chunk进入，不扩大普通平台首屏 chunk。
- [x] 若 production browser bundle 不成立，回到规划选择其它 browser-safe parser/matcher；不加 Node polyfill。

## 2. Strict Glob Path Model

- [x] 新建 `glob-transform/path.ts`，实现 root-bound pattern normalization；先反向搜索并复用适合的 request/relative primitives，不能复制普通 resolver后悄悄改变其 clamp语义。
- [x] 接受 importer 相对 `./` / `../` 与 root alias `@/`；严格拒绝 bare、absolute、authority、scheme、backslash、NUL、query/hash、非法/encoded separators 和 root escape。
- [x] 将 pattern 分解为 matcher-facing canonical root pattern、result-key strategy和 matched-file import specifier strategy。
- [x] 相对 key 保留调用侧相对表示；alias key固定为 `/canonical/key`。
- [x] import specifier始终从 importer到 matched canonical key重新计算，并带 `./` / `../`。
- [x] 用 pure fixtures覆盖 nested importer、合法 `..`、越界、alias、特殊 glob grammar和编码攻击形式。

## 3. Lazy Transform Boundary

- [x] 新建 `glob-transform/index.ts`，定义 `GlobTransformInput/Result`与统一 error shape。
- [x] 无 `import.meta.glob` 文本时同步/快速返回 unchanged，不动态加载实现。
- [x] 有宏文本时 memoize literal `import("./transform")` Promise，重复构建复用模块缓存。
- [x] 保持 parser/matcher imports只存在于 `transform.ts`，不要从 barrel静态 re-export runtime symbols。

## 4. Parser and Semantic Validation

- [x] 新建 `glob-transform/transform.ts`，按 `js/jsx/ts/tsx` loader配置 `@babel/parser`。
- [x] 实现聚焦 AST traversal，精确识别 `import.meta.glob`，跳过注释/字符串并避免遍历 location/token元数据造成循环或噪声。
- [x] 接受 string literal和无插值 template literal；拒绝变量、interpolation、array和动态 expression。
- [x] options只接受省略、空对象或唯一静态 boolean `eager`；拒绝 duplicate/computed/spread/method/shorthand/unknown options。
- [x] 主动拒绝 property extraction、computed access、optional/non-direct call等不受支持形式。
- [x] 将 parser/semantic errors转成自包含 importer和能力名的 esbuild location diagnostics。

## 5. VFS Enumeration and Matching

- [x] 使用 `picomatch/posix` 对 `sources.keys()`做纯字符串、case-sensitive、`dot: false`匹配。
- [x] 支持 globstar、braces、extglob、字符类；不扩展到 pattern数组或negative patterns。
- [x] 排除 importer自身，按 canonical key lexical sort，空匹配返回空结果。
- [x] 不读取 IndexedDB、不匹配 npm/CDN package、不把 `Uint8Array`内容解码；只需匹配其文件 key。
- [x] 验证 Windows宿主不会改变 POSIX匹配结果。

## 6. Deterministic Code Generation

- [x] lazy生成确定性对象值 `() => import(relativeSpecifier)`。
- [x] eager用 MagicString prepend namespace imports并替换宏调用为对象；binding names在同模块唯一且不与用户 bindings冲突。
- [x] 同模块多次 glob、nested expression、semicolon/no-semicolon、TS/JSX均保持有效语法。
- [x] 生成 JSON-escaped key/specifier，避免文件名引号或 Unicode破坏源码。
- [x] 如生成 sourcemap能无损接入 esbuild plugin result则保留；否则记录当前 transform map限制，不伪造 source location。

## 7. Entry Integration

- [x] `engine.ts` 在 stdin build前对 entry文本调用 transform，传 canonical entry path和 loader。
- [x] 确认无宏入口不触发 dynamic chunk请求。
- [x] transform错误保留原 entry文件与行列并进入现有 build失败链路。

## 8. Workspace Module Integration

- [x] `workspace-source-plugin.ts` 只对无 query的文本 JS/TS/JSX module调用 transform。
- [x] JSON、CSS/preprocessor、Vue、assets、`?raw/?url/?inline`、binary不进入宏转换。
- [x] 保持 source path + `suffix` invariant和现有 resolveDir/loader行为。
- [x] 嵌套模块生成的 imports继续被 workspace resolver解析。

## 9. Vue SFC Integration

- [x] 在 compiler-sfc `compileScript`前转换 `<script>`与`<script setup>` block source。
- [x] 使用 block source ranges把转换内容写回临时 SFC并重新 parse，保留现有 descriptor/template/style流水线。
- [x] eager imports必须位于合法 module script；不得插入 template/style或virtual style模块。
- [x] transform diagnostic映射回原 `.vue`文件行列/lineText，不暴露 generated module伪位置。
- [x] 验证普通 script、script setup、TypeScript setup以及同时存在两种 script block时的宏用法。

## 10. Entry Output Selection

- [x] 先用最小 esbuild-wasm metafile probe记录 stdin root output与dynamic import chunk的 `entryPoint`实际值。
- [x] 扩展 `WriteBackInput`携带预期根 entry identity，`findEntryOutputPath`精确选择根 JS output；零匹配/多匹配明确失败。
- [x] 不依赖 metafile object iteration顺序，不把 lazy glob chunk写入 HTML entry script。
- [x] 保持所有 chunks/assets写入、CSS links和stale cleanup逻辑不变。

## 11. Focused Validation

- [x] pure transform fixtures：lazy/eager、相对/alias、empty、sort、self exclusion、多宏、TS/JSX、完整错误矩阵。
- [x] Map VFS + browser esbuild-wasm fixture：entry、嵌套 module和Vue SFC宏，验证chunks/metafile/imports/assets。
- [x] 确认 eager modules静态打包、lazy modules产生split chunks并可执行。
- [x] 确认 unsupported pattern/options/non-call用法在构建期报文件、行列和原因。
- [x] `npm run build:web`。
- [x] `git diff --check`。
- [x] 检查production glob lazy chunk及无Node built-ins；plain build不加载toolchain chunk。
- [ ] 重建真实 `play-frontend-dev` 源码包，确认无glob路径不回归（按PRD边界延期到父任务完整浏览器回路）。

## 12. Parent Fixture Handoff

- [x] 创建 `research/validation.md`，记录依赖版本、已执行probe、chunk体积、已知限制和父任务用例矩阵。
- [x] 移交lazy/eager、相对/alias key、sort/empty、TS/JSX/Vue、chunks/CSS/assets、错误状态/旧dist保留场景。
- [x] 移交plain网络隔离、首次glob冷构建与重复热构建耗时检查。
- [x] 完整上传 → IndexedDB → esbuild-wasm → dist → SW → packaged iframe回路保留给父任务最终综合fixture，不把子任务未执行项误标为完成。

## 13. Review and Finish

- [x] 运行 `trellis-check`，处理High/Medium发现。
- [x] 将稳定的browser glob/VFS runtime契约更新到 `.trellis/spec/platform-web/frontend/quality-guidelines.md`。
- [x] 更新PRD acceptance与Completion Notes，区分已验证和父任务延期项。
- [ ] 提交本子任务代码/文档，不包含`tmp/`和无关任务归档改动。
- [ ] 归档 `07-10-import-meta-glob-vfs`，父任务保持planning并进入3/4；下一步规划Worker子任务。

## Rollback Points

- dependency + lazy boundary先独立验证；失败可在接插件前回滚。
- pure path/transform先通过fixture，再分别接entry、workspace、Vue。
- entry output selection用metafile probe先行，避免与宏转换故障混在一起。
- 三个transform调用点可独立撤回；无宏路径应始终保持原有build行为。
