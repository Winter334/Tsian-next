# Design: import.meta.glob VFS 子集

## Scope and Constraints

本任务只在 `apps/platform-web/src/frontend-build` 内增加 `import.meta.glob` 的浏览器/VFS 子集。输入仍是构建前预加载的 `Map<string, string | Uint8Array>`，输出仍由同一次 `esbuild-wasm` 主构建产生并通过现有 `writeBackDist` 写入 `frontend/dist/**`。

核心约束：

- 不运行 Vite、Node glob 插件或任何磁盘扫描。
- 不修改 Game Card contract、Dexie schema、Service Worker 路径或 play bridge。
- 普通源码路径不加载 parser/matcher/transform chunk。
- lazy glob 必须复用当前 ESM splitting，不创建独立子构建。
- unsupported 语义在构建期失败，不留到 packaged iframe 运行时。

## Dependency Strategy

添加平台直接依赖：

- `@babel/parser`：以浏览器可打包入口解析 JS/TS/JSX，获取准确 AST range/location。
- `magic-string`：按 source range 替换调用并在 eager 模式前插入静态 import。
- `picomatch` 与 `@types/picomatch`：纯字符串 glob 匹配；浏览器实现显式导入 `picomatch/posix`，避免 package root 的 OS 检测分支，并禁止调用文件系统型 glob 库。

当前 lockfile 已有这些运行时包的传递版本，但实现必须声明直接依赖，不能依赖 Vite/compiler 的偶然传递依赖。`estree-walker`不是必要条件：实现可用聚焦的 Babel AST traversal，只遍历对象/数组节点并跳过元数据字段，避免再引入一个只为单一宏使用的直接依赖。

`glob-transform/index.ts` 先用 `code.includes("import.meta.glob")` 快速跳过，再通过 memoized literal dynamic import 加载实际实现：

```ts
let transformPromise: Promise<typeof import("./transform")> | null = null

export async function transformImportMetaGlob(input: GlobTransformInput) {
  if (!input.code.includes("import.meta.glob")) return { code: input.code, changed: false }
  transformPromise ??= import("./transform")
  return (await transformPromise).transformImportMetaGlob(input)
}
```

这样 plain build 不请求 parser、MagicString 和 matcher chunk；同页重复构建复用模块 Promise。

## Proposed Module Structure

```text
apps/platform-web/src/frontend-build/
├── glob-transform/
│   ├── index.ts          # 快速 gate、懒加载与共享输入/输出类型
│   ├── path.ts           # strict pattern 解析、匹配 key、生成 import specifier
│   └── transform.ts      # parser、AST 验证、picomatch、MagicString 代码生成
├── plugins/
│   ├── workspace-source-plugin.ts
│   └── sfc-plugin.ts
├── engine.ts
└── write-back.ts
```

Glob 逻辑属于独立编译能力，不塞进已接近 400 行的 workspace plugin。`path.ts` 只负责 glob pattern 的严格路径语义，不扩展 Sass/Less 专用的 `style-preprocessors/vfs.ts`，也不改变普通 JS import 当前的 root clamp 行为。

## Internal Contract

```ts
export interface GlobTransformInput {
  code: string
  importer: string
  loader: "js" | "jsx" | "ts" | "tsx"
  sources: Map<string, string | Uint8Array>
}

export interface GlobTransformResult {
  code: string
  changed: boolean
}
```

转换结果不单独返回依赖列表：生成的 static/dynamic imports 会被 esbuild 正常解析并纳入 metafile。错误转换为 esbuild `PartialMessage`，至少含 `text` 和 `location.file/line/column/lineText`。

## Transform Integration

### Entry source

`engine.ts` 在构造 `stdin` 前调用 transform，传入 entry path、entry loader 和完整 sources Map。transform 后的内容仍作为同一 stdin entry 构建。

### Workspace JS/TS/JSX

`workspace-source-plugin.ts` 在完成 source/query/预处理器分支判断后，仅对 `js/jsx/ts/tsx` loader 的文本模块调用 transform。JSON、CSS、assets、`?raw/?url/?inline` 和二进制内容不进入宏转换。

为了避免入口作为 stdin 和普通 source 同时转换，stdin 仍由 engine 独立处理；workspace plugin 只处理通过 `workspace` namespace 加载的依赖模块。

### Vue SFC

`sfc-plugin.ts` 在 `compileScript()` 前转换原始 `<script>` / `<script setup>` 内容，而不是等整个 SFC 被编译成 JS 后再处理。实现流程：

1. parse 原始 SFC，取得 script block 的 content range 和 SFC 行列偏移；
2. 分别对普通 script 与 script setup 内容调用同一 transform，诊断位置加回 block offset；
3. 把转换后的 block content 写回一份临时 SFC source 并重新 parse；
4. 对更新后的 descriptor 执行现有 `compileScript` / template / style 组装。

这使 eager imports 留在合法的 module script 中，也让错误位置指向用户 `.vue` 源码而非 compiler-sfc 生成模块。若实现阶段确认 compiler-sfc 提供更直接且保留 source location 的 block 替换 API，可采用等价方案，但不得把 generated-module 行号冒充原 SFC 行号。virtual style 请求不进入 glob 逻辑。

## Parsing and Supported Syntax

使用 `@babel/parser`，按 loader 开启 TypeScript/JSX 插件，并启用 `sourceType: "module"`、ranges/locations。只识别精确的：

```ts
import.meta.glob(pattern)
import.meta.glob(pattern, { eager: true | false })
```

pattern：

- 接受单双引号字符串；
- 接受无 expression 的 template literal；
- 拒绝变量、插值模板、数组和任意动态表达式。

options：

- 可省略或为空对象；
- 只接受非 computed 的 `eager`，值必须是 boolean literal；
- 拒绝 spread、duplicate `eager`、computed key、shorthand、method 和未知 key；
- 明确点名拒绝 `import/query/as/exhaustive`，不隐式实现 Vite 扩展项。

AST traversal 同时检查所有 `import.meta.glob` 形态。只有上述直接 `CallExpression` 可进入转换；属性提取、assignment、optional call、computed access 等均构造定位错误。普通字符串或注释中的同名文本不会被误判。

## Pattern Resolution and Object Keys

### Accepted pattern origins

- `./`、`../`：相对于 importer 目录解析；允许留在 source root 内的 `..`。
- `@/`：相对于 VFS source root 解析。

拒绝 bare pattern、`/` 绝对路径、URL/scheme、authority、反斜杠、NUL、query/hash、非法 percent encoding、encoded separator/control，以及越出 root 的 `..`。

### Matching

将规范化后的 VFS key 作为 POSIX、case-sensitive 字符串交给 `picomatch`：

- 支持 globstar、braces、extglob、字符类；
- `dot: false`；
- 枚举 `sources.keys()`，排除 importer 自身；
- 只匹配文件 key，不执行文件系统操作；
- 匹配结果按 canonical key lexical sort；
- 空匹配合法，生成 `{}`。

### Result object keys

- 相对 pattern 保留调用侧相对前缀，key 以 importer 目录为参照，例如 `./views/*.ts` → `./views/a.ts`，`../views/*.ts` → `../views/a.ts`。
- `@/` pattern 展开为 VFS root key，例如 `@/views/*.ts` → `/views/a.ts`。

内部 import specifier 不复用展示 key，而是从 importer 到 canonical matched key 重新计算稳定相对 specifier，并确保以 `./` 或 `../` 开头，从而继续经过现有 workspace resolver。

## Code Generation

### Lazy

```ts
const modules = import.meta.glob("./views/*.ts")
```

转换为：

```ts
const modules = {
  "./views/a.ts": () => import("./views/a.ts"),
  "./views/b.ts": () => import("./views/b.ts"),
}
```

esbuild 的 `format: "esm"` + `splitting: true` 负责输出 chunks。

### Eager

```ts
const modules = import.meta.glob("./views/*.ts", { eager: true })
```

转换为：

```ts
import * as __tsian_glob_0_0 from "./views/a.ts"
import * as __tsian_glob_0_1 from "./views/b.ts"

const modules = {
  "./views/a.ts": __tsian_glob_0_0,
  "./views/b.ts": __tsian_glob_0_1,
}
```

binding 名含当前调用序号和匹配序号，避免同模块多次 glob 冲突；通过 AST binding scan 或生成后唯一性检查避免与用户 binding 重名。多处替换按 MagicString range 执行，静态 imports 统一 prepend，保持结果确定。

## Diagnostics

解析错误沿用 Babel 的 line/column；宏语义错误以目标 AST node location 为准。esbuild message text 自包含：

- `import.meta.glob`
- importer
- 失败 pattern/option（适用时）
- 支持范围或失败原因

现有 build status 只可靠持久化最终 message，因此 text 不能只依赖结构化 location 表达文件信息。

错误矩阵至少覆盖：

- dynamic/interpolated/array pattern；
- bare、absolute、scheme、query/hash、backslash、encoded separator 和 root escape；
- unknown/computed/spread/non-boolean/duplicate options；
- property extraction、computed access、optional/non-direct call；
- source parse error；
- no match（成功而非错误）。

## Entry Output Selection

lazy glob 增加 dynamic entry chunks 后，`write-back.ts` 不再选择“第一个含 `entryPoint` 的 output”。`engine.ts` 把根 stdin 的 source identity（`frontend/src/${entryPath}`）传给 `writeBackDist`；后者从 metafile outputs 中精确选择该根 entry 对应的 JS output，若零个或多个匹配则明确失败。

实现 probe 确认：当 `stdin.sourcefile` 为 `main.ts` 且 `stdin.resolveDir` 为 `frontend/src` 时，esbuild-wasm 0.28.1 将根 output 的 `entryPoint` 记录为 `frontend/src/main.ts`；dynamic workspace chunk 则使用 `workspace:<canonical-key>`。因此匹配条件固定为完整 root identity，而不是裸 `entryPath` 或任意第一个 `entryPoint`。

## Validation and Parent Handoff

### Child focused validation

仓库当前没有持久 frontend-build test runner。本子任务采用可重复的临时/研究 probe，记录到 `research/validation.md`：

1. parser/transform pure fixture：lazy/eager、多调用、TS/JSX、Vue compiled-module text、空匹配和全部错误矩阵；
2. Map VFS + esbuild-wasm probe：入口、嵌套 workspace module、Vue SFC 脚本，验证 lazy chunks、eager bundling、metafile entry selection 和 assets；
3. production `npm run build:web`，检查 parser/matcher/transform 独立 lazy chunk，plain build 不静态包含 Node built-ins；
4. `git diff --check`；
5. 真实 `play-frontend-dev` 源码包构建 smoke，不应因未使用 glob 而加载或回归。

### Parent consolidated browser integration

完整上传 → IndexedDB → browser esbuild-wasm → dist write-back → Service Worker → packaged iframe 回路继续由父任务在 Worker 子任务完成后统一执行。本子任务需移交：

- lazy/eager glob 的 DOM/通信可观察结果；
- 相对与 `@/` key、排序、empty match；
- Vue SFC/TS/JSX 使用；
- lazy chunks/CSS/assets 的 Network 与 Console；
- unsupported 变体进入 build status 且保留旧 dist；
- plain build 不请求 glob toolchain chunk、首次/重复 glob 构建的冷/热耗时。

## Compatibility and Rollback

- 无 schema/contract migration。
- transform 以源码快速 gate 隔离；若回滚，可删除三个调用点和 `glob-transform/`，普通构建路径保持原样。
- 如果 parser/matcher 的 production browser bundle 出现 Node built-in 或不合理 eager 体积，停止实施并回到 planning；不加 Node polyfill。
- lazy CSS 仍遵循当前 write-back 将所有 CSS 链接进 HTML 的行为，本任务不重做 CSS chunk runtime。
