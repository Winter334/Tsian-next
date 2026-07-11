# Design: Sass / Less 虚拟文件适配

## Scope and Constraints

本任务扩展 `apps/platform-web/src/frontend-build` 的浏览器构建能力。输入仍是 IndexedDB 预加载后的 `Map<string, string | Uint8Array>`；输出仍由 esbuild-wasm 生成并通过 `writeBackDist` 写入 `frontend/dist/**`。

核心约束：

- 无 Node `fs/path/process.cwd()`、无临时磁盘、无 native subprocess。
- 不运行完整 Vite 或 Node-only esbuild plugins。
- 编译器按需懒加载，普通 CSS/Vue 不承担 Sass/Less 初始化成本。
- 复用前置任务已确立的 VFS request/suffix、Vue virtual styles、scoped CSS、`local-css` 和 output materialization。
- 新会话必须先检查并保留其它并行任务的 dirty files。尤其 `engine.ts` 可能同时被 workspace text/blob 重构修改；实现要基于当时 HEAD/working tree 合并，不覆盖它。

## Parallel-Work Integration Gate

当前父规划与本任务文档可以独立提交，但代码实施必须等 `07-10-workspace-editable-text-reading` 完成或至少将其 `engine.ts`、`media-type.ts`、`workspace-blob.ts` 基线提交。原因：该任务正在把 frontend source text/binary classification收敛到共享 `isTextFilePath` 和 Blob投影；Sass/Less需要在同一分类来源加入扩展，不能在未提交 dirty diff上重复编辑/提交。

新会话启动时：

1. `git status --short`。
2. 若上述并行任务文件仍 dirty，暂不激活 Sass/Less任务；先完成/提交并行任务，或创建独立 worktree并基于其 commit。
3. 基线干净后重新阅读当时的 `engine.ts` 与 `media-type.ts`，更新 implementation步骤以复用唯一 text classification。

这不是对隐藏 dirty state的依赖，而是显式顺序门槛。

## Proposed Module Structure

```text
apps/platform-web/src/frontend-build/
├── style-preprocessors/
│   ├── index.ts          # language dispatch, shared result/error shape
│   ├── vfs.ts            # strict root-bound path and text source lookup
│   ├── sass.ts           # Dart Sass lazy loader + Map Importer
│   └── less.ts           # Less lazy loader + Map FileManager
├── plugins/
│   ├── workspace-source-plugin.ts
│   └── sfc-plugin.ts
└── engine.ts
```

如果实现阶段发现官方浏览器 API 类型限制需要少量声明，可在 `style-preprocessors/less.ts` 内定义窄 structural types；不要复制整套过时的 Less 类型定义。

## Shared Contract

建议内部契约：

```ts
export type StylePreprocessorLanguage = "scss" | "sass" | "less"

export interface StylePreprocessorInput {
  language: StylePreprocessorLanguage
  source: string
  filename: string
  sources: Map<string, string | Uint8Array>
}

export interface StylePreprocessorResult {
  css: string
  dependencies: string[]
  sourceMap?: unknown
}

export async function compileStylePreprocessor(
  input: StylePreprocessorInput,
): Promise<StylePreprocessorResult>
```

`filename` 是拥有该 style 的 canonical `frontend/src/` 相对路径：

- standalone：`styles/main.scss`
- SFC inline block：`components/Foo.vue`

它决定相对 import 和最终 CSS `url(...)` 的 entry resolve context。virtual `?tsian-style=N` query 只用于 esbuild module identity，不传给预处理器。

## Shared VFS Rules

### Strict root-bound resolution

预处理器 import 与普通 JS import 不同：越过 root 必须报错，不能把多余 `..` clamp 到 root。

`style-preprocessors/vfs.ts` 应提供：

- slash normalization；
- `.`/`..` resolution 并在空 root 上 pop 时失败；
- 禁止绝对路径、NUL、反斜杠、未知 scheme、authority、query/hash、encoded slash/backslash；
- 从 sources Map 读取文本，遇到 `Uint8Array` 报“样式源码必须是文本”；
- 返回真实 canonical file key，不返回原始 unresolved request。

不要改变普通 workspace resolver 的既有 clamp/兼容行为来满足预处理器安全规则；预处理器用更严格的共享 helper。

### Source loading in engine

`.scss/.sass/.less` 必须作为文本进入 sources Map。实现时优先复用当时仓库已经落地的统一 `isTextFilePath` / Blob-to-workspace projection；若该并行任务尚未合入，再最小扩展当前文本后缀分类。不要同时维护两份 text/binary allowlist。

## Standalone Style Pipeline

在 workspace plugin 中：

1. 解析 canonical `args.path + args.suffix`。
2. 先执行现有 query 验证。
3. `?raw` 返回原始文本；`?url/?inline` 继续走 file/dataurl loader，均不预处理。
4. 无 query 且后缀为 `.scss/.sass/.less` 时调用 dispatcher。
5. `.module.scss/.module.sass/.module.less` 返回 `local-css`；其它返回 `css`。
6. 返回 compiled CSS 时保持 module path 为真实 entry style path，使 esbuild 从该目录解析 CSS URL。

扩展 resolver candidate lists 以支持 `import "./theme"` / 目录 index 时，不把 Sass `_partial` 规则塞进全局 JS module resolver；partial/index import semantics 只在 Sass Importer 内。

## Vue SFC Pipeline

当前顺序保持不变，仅在 `compileSfcStyle` 中插入预处理：

```text
styleBlock.content
  → compileStylePreprocessor(lang, source, owning .vue filename, sources)
  → compiler.compileStyleAsync({ source: css, scoped, inMap? })
  → esbuild css/local-css
```

- `validateStyleBlock` allowlist 扩展为 `css/scss/sass/less`。
- CSS block跳过 dispatcher。
- module name、virtual imports、`__cssModules`、`__scopeId` 不变。
- Sass source map 若能可靠生成，可作为 `inMap` 交给 Vue compiler；Less 本阶段不承诺 map chaining。

## Sass Adapter

### Dependency and loading

使用官方 `sass` 包的 browser/default condition。`sass@1.101.0` 要求运行 npm/Vite 的 Node 环境 `>=20.19.0`；新会话在安装前验证，不在本任务中修改根 package 的全局 engine policy：

```ts
let sassPromise: Promise<typeof import("sass")> | null = null

function loadSass() {
  return sassPromise ??= import("sass")
}
```

只使用 `compileStringAsync()`；不使用 browser 不可用的 `compile(file)` 或 `sass-embedded`。根调用必须传 `url: entryCanonicalUrl`，让相对 import从 entry canonical URL解析。

Dart Sass browser文档要求 bundler禁用 name renaming（esbuild示例为 `keepNames`）。因此 implementation必须在 `apps/platform-web/vite.config.ts` 的 production esbuild配置启用 `keepNames: true`（或经实测完全等价的 name-preservation选项），并用 production build + preview/browser fixture实际调用 lazy Sass chunk；开发模式成功不构成验收。该配置是平台 bundle构建设置，不是游戏卡 esbuild-wasm build option。

### Canonical URLs

使用：

```text
tsian-vfs:///frontend/src/<canonical-key>
```

保留 `/frontend/src/` anchor，URL normalization 后可识别 root escape。`canonicalize()` 返回唯一实际文件 URL；`load()` 从 URL 还原 Map key并返回：

```ts
{
  contents,
  syntax: "scss" | "indented" | "css",
  sourceMapUrl: canonicalUrl,
}
```

### Candidate semantics

按 Sass 语义分层匹配，不“第一个命中即赢”：

- 显式 `.scss/.sass`：目标和同目录 `_partial`。
- extension-less：普通 `.scss/.sass` 与 `_partial`；未命中再试 `index/_index`。
- `@import` 可优先考虑 `.import.scss/.import.sass` 变体。
- 同一优先层存在多个 Sass 候选时抛 ambiguity error。
- 只有 Sass candidate 不存在时才考虑 CSS；外部/URL/CSS import 按 Sass 原生行为保留。
- 不支持 `pkg:`/bare package/node_modules。

### Source maps

推荐启用 `sourceMap` + `sourceMapIncludeSources`，并用 browser-safe base64 或 Vue `inMap` 传递。实现必须验证最终 esbuild map 是否保留 VFS source/sourceContent；若组合不可稳定工作，可降级为有文档的 source-map 限制，但不得引入 Node Buffer。

### URL caveat

Sass 对 imported partial 内的 `url(...)` 不自动按 partial 文件重基；最终由 entry stylesheet/SFC 目录解释。本任务明确采用这一行为，不额外实现 per-partial URL rebasing。

## Less Adapter

### Dependency and loading

固定 `less@4.6.7`，使用 package exports允许的 core factory subpath：

```ts
let lessFactoryPromise: Promise<LessFactory> | null = null

async function loadLessFactory(): Promise<LessFactory> {
  if (!lessFactoryPromise) {
    lessFactoryPromise = import("less/lib/less/index.js")
      .then((module) => module.default as LessFactory)
  }
  return lessFactoryPromise
}
```

`less/lib/less/index.js` 只组装 core parser/render/environment API，接收 external environment、file managers和 version；它不包含 `lib/less-browser/bootstrap.js` 的 DOM启动逻辑。每次 compilation可用 factory创建隔离 API：

```ts
const createLess = await loadLessFactory()
const less = createLess(environment, [vfsFileManager], "4.6.7")
const result = await less.render(source, options)
```

不导入 package root `less`/`dist/less.cjs`，因为该 browser distribution可能内嵌 bootstrap并读写 `window.less`、扫描 stylesheet。禁止导入/调用 `less/lib/less-browser/bootstrap.js`，禁止使用 `window.less` / `window.LESS_PLUGINS`。core factory是 exported但低层的版本锁定 API；升级 Less版本前必须检查 subpath export、factory signature和安全 fixture。production probe断言动态 import前后全局 identity不变、无 DOM扫描/页面隐藏。

### FileManager

每次 render注册一个 Map-backed FileManager/plugin：

- claim processed imports，禁止 browser XHR fallback；
- 使用 Promise-based `loadFile` 从 sources Map解析，成功返回 `{ filename: canonicalKey, contents }`；本任务不使用 compiler-sfc内置 Less preprocessor bridge，也不启用 `syncImport`，因此不要求 `loadFileSync`；
- extensionless import可补 `.less`；不实现 Sass partial/index；
- strict root escape、illegal scheme、binary input清晰失败；
- 用 side-channel记录 policy violations，使 `(optional)` 也不能吞掉越界/非法路径错误。

### Render options

初始安全配置：

```ts
{
  filename,
  plugins: [vfsPlugin],
  rewriteUrls: "all",
  rootpath: "",
  urlArgs: "",
  javascriptEnabled: false,
  disablePluginRule: true,
  sourceMap: false,
}
```

`rewriteUrls: "all"` 将 nested imported-file URL 改写到 entry style context，再由 esbuild VFS resolver输出资产。`(inline)` raw content中的 URL 不保证按原文件重写，列为已知限制。

### Plugin execution boundary

必须同时禁用 inline JavaScript 和 Less `@plugin`。只设置 `javascriptEnabled: false` 不足以阻止 `@plugin` 读取并执行 JavaScript。

## Diagnostics

adapter内部统一保留：

- `Sass` / `SCSS` / `Less`
- entry `filename`
- requested import（可用时）
- message
- line/column/extract（编译器提供时）

插件边界将其转换为 esbuild `PartialMessage`：`text` 包含 language/import上下文，`location.file/line/column/lineText` 使用 compiler位置。`buildFrontend()` 的直接调用因此能获得结构化 esbuild diagnostics；现有 `trigger.ts` / `build-status.ts` 仍只持久化最终 message，本任务不扩展跨层 status contract，message必须自包含 filename和位置。安全错误和编译错误都不得静默降级为 CSS。

## Lazy Loading and Performance

验证四个场景：

1. 平台启动 / plain CSS build：无 Sass/Less chunk请求。
2. SCSS/Sass build：只请求 Sass chunk。
3. Less build：只请求 Less chunk。
4. 同页重复 build：dynamic import promise和浏览器模块缓存复用。

子任务记录 production output 中的 lazy chunk raw/gzip size。真实浏览器首次 dynamic import + compile、warm compile 时间及请求隔离由父任务最终综合 fixture 统一记录。预期 Sass chunk显著大于 Less，因此不得静态 import。

## Validation

### Static checks

```bash
npm run build:web
git diff --check
```

### Consolidated browser integration

本子任务先以 production build、浏览器编译器入口/安全 probe 和 Map VFS adapter fixtures验证实现边界。完整的上传 → IndexedDB → browser esbuild-wasm → write-back → SW → packaged iframe回路不在每个能力子任务重复执行；待父任务所有能力子任务完成后，由父任务构造一个综合测试前端包统一验证 Sass/Less、`import.meta.glob`、Worker 与既有 Vue/CSS能力组合。

- 本任务 `research/validation.md` 只需记录已执行的聚焦 probe、production chunk证据和转交给父任务的用例矩阵；
- 综合 fixture zip可生成到未跟踪 `tmp/`，不提交二进制 zip；长期复用的源码 fixture由父任务最终集成阶段决定落点；
- 失败语义可以使用同一 fixture源码的 invalid variants，统一验证 `frontend-build-status` 和旧 dist保留。

最小源码包包含：

- standalone `.scss` + `@use` partial；
- indented `.sass`；
- standalone `.less` + nested import；
- `.module.scss` / `.module.sass` / `.module.less`；
- Vue scoped/module/命名 module + lang组合；
- Sass `@use`、`@forward`、import-only candidate和 ambiguity precedence；
- Less inline JavaScript与 `@plugin`拒绝；
- imported style中的图片 URL；
- `?raw/?url/?inline` bypass；
- missing/ambiguous/root escape/binary/`@plugin` failure cases。

断言 outputs、computed styles、module classes、scope attribute、asset network、Console 和 build status；执行至少一次重复构建验证编译器缓存。

### Parent-level real source smoke

父任务最终综合阶段重建现有 `play-frontend-dev` 源码包，确认 packaged iframe 可加载且无构建器相关 Console/network error。该前端不使用 Sass/Less，仅用于统一验证普通 Vue/CSS 路径无回归。

## Compatibility and Rollback

- 构建失败继续保留旧 dist。
- Sass、Less adapters相互独立，可分别回滚；普通 CSS/Vue pipeline不应依赖编译器存在。
- 无 schema/contract migration。
- 若任一编译器 browser build无法满足安全、兼容或 bundle要求，停止实施并回到规划拆分/取消该部分；本子任务不得以只交付 Sass或只交付 Less的状态标记完成，也不得用 Node polyfill强行上线。
