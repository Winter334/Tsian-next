# Design — Skill 脚本执行能力升级与文档约定

## 0. 设计总纲

升级 `browser-skill-script-executor.ts` 的执行模型，三件事：

1. **放开原生能力**：从 AsyncFunction 形参列表删除 `globalThis`/`self`/`console`/`setTimeout`/`setInterval`/`clearTimeout`/`clearInterval`/`fetch`，让脚本直接拿到 Worker 原生全局（纯做减法）。
2. **vendor 第三方库**：给脚本注入一个受限的 `importScripts` 函数，只允许加载 skill 目录内的 UMD 库文件。
3. **精简 tsian SDK**：移除 `tsian.fetch`，`tsian` 精简为 `workspace.*` + `log` + `trace`。

配套更新 skill-authoring 文档。

## 1. AsyncFunction 形参列表调整

### 1.1 现有形参列表（全传 undefined 等效屏蔽）

```js
const runner = new AsyncFunction(
  "input", "tsian", "signal",
  "fetch", "importScripts", "indexedDB", "caches",
  "globalThis", "self", "window", "document",
  "localStorage", "sessionStorage",
  "XMLHttpRequest", "WebSocket", "EventSource",
  "Worker", "SharedWorker", "navigator", "location",
  "\"use strict\";\n" + source
);
```

调用时全部形参传 undefined（L272-293），等效屏蔽所有浏览器 API。

### 1.2 调整后形参列表

**删除**（放开 Worker 原生全局）：
- `globalThis` / `self` — UMD 库挂载依赖（wrapper 的 `g = globalThis`）
- `console` — 调试输出（Worker 原生，输出到主线程控制台）
- `setTimeout` / `setInterval` / `clearTimeout` / `clearInterval` — 异步/定时（Worker 原生）
- `fetch` — 裸 fetch（Worker 原生，完整 Response）

**保留屏蔽**（传 undefined）：
- `window` / `document` / `localStorage` / `sessionStorage` — Worker 本就无 DOM，维持屏蔽防误导
- `XMLHttpRequest` / `WebSocket` / `EventSource` / `Worker` / `SharedWorker` / `navigator` / `location` — 维持屏蔽（本次不开这些，避免过度放开）
- `indexedDB` / `caches` — 维持屏蔽（skill 脚本不应直接操作存储，走 tsian.workspace）

**新增注入**（传受限包装函数）：
- `importScripts` — 受限包装函数（见 §2）

### 1.3 调整后形参列表

```js
const runner = new AsyncFunction(
  "input", "tsian", "signal", "importScripts",
  "window", "document", "localStorage", "sessionStorage",
  "XMLHttpRequest", "WebSocket", "EventSource",
  "Worker", "SharedWorker", "navigator", "location",
  "indexedDB", "caches",
  "\"use strict\";\n" + source
);
const output = await runner(
  toJsonValue(message.input),
  tsian,
  signal,
  restrictedImportScripts,  // 受限包装函数
  undefined, undefined, undefined, undefined,  // DOM 类维持屏蔽
  undefined, undefined, undefined,
  undefined, undefined, undefined, undefined,
  undefined, undefined,  // 存储类维持屏蔽
);
```

**关键**：`globalThis`/`self`/`console`/`setTimeout`/`setInterval`/`clearTimeout`/`clearInterval`/`fetch` 不在形参列表里 → 脚本直接拿到 Worker 原生全局（不再被 undefined 遮蔽）。

### 1.4 UMD 库挂载验证

UMD wrapper（如 marked.min.js）：`(function(g,f){...else{g["marked"]=f()}}(typeof globalThis<"u"?globalThis:...,...))`

- Worker 里 `typeof exports`/`typeof module`/`typeof define` 全 undefined（无 CommonJS/AMD）→ UMD 走 `else { g["marked"] = f() }` 分支
- `g = globalThis` → 删除 globalThis 形参后，函数体内 `globalThis` 指向真实 Worker 全局
- `g["marked"] = f()` → 库挂到 `globalThis.marked`（即 `self.marked`）
- 脚本后续用 `self.marked.parse(...)` 或 `marked.parse(...)`（marked 是全局变量）访问

**已验证**：AsyncFunction 删除 globalThis 形参后，函数体内 `typeof globalThis === "object"`（指向真实全局），而非 undefined。

## 2. importScripts 受限包装

### 2.1 两种实现方案权衡

**方案 A：源码预拼接（推荐）**

主线程在脚本执行前，扫描脚本源码里的 `importScripts(...)` 调用 → 解析路径（相对 skill 目录）→ 校验逃逸 → 从 workspaceFiles 读 vendor 文件 → 把 vendor 源码拼到脚本源码前 → 一起传进 AsyncFunction。

```
原始 source = "importScripts('lib/marked.min.js'); const html = marked.parse(text);"
主线程解析 → 读 lib/marked.min.js → 拼接：
拼接 source = "<marked.min.js 源码>\n;<原始 source>"
→ runWorkerScript(options, request, 拼接source, ...)
```

优点：
- 实现最简——不需要 worker 内拦截、不需要 blob URL、不需要消息协议改动
- vendor 源码和脚本在同一个 AsyncFunction 作用域，UMD 库挂 globalThis 后脚本直接用
- 路径校验在主线程做（已有 resolveBrowserScriptPath 逻辑可复用）

缺点：
- vendor 源码进 AsyncFunction 函数体，大库（如 73KB marked）会让函数体变大——但 skill 脚本是一次性执行，性能影响可接受
- 脚本里的 importScripts 调用是"标记"而非真实调用（被预拼接替换），如果脚本动态拼 importScripts 字符串（极少见）会失效
- 报错行号偏移（vendor 源码占了几行）——但 skill 脚本调试主要靠 console.log，行号偏移可接受

**方案 B：blob URL 映射**

主线程预解析 importScripts 调用 → 读 vendor 文件 → 造 blob URL → 把"路径→blobURL"映射传进 worker → worker 内受限 importScripts 函数查映射 → 调真正的 `self.importScripts(blobURL)`。

优点：
- vendor 源码不进函数体，函数体保持干净
- 真实的 importScripts 调用语义（支持动态路径、运行时加载）

缺点：
- 实现复杂——需要 worker 消息协议扩展（传映射表）、worker 内包装函数、blob URL 生命周期管理（revoke）
- worker 内 importScripts 是同步的，但 blob URL 是主线程造的，要确保 worker 收到映射后才能执行脚本（消息时序）
- importScripts 在 AsyncFunction 函数体内调用，但 AsyncFunction 函数体不是 Worker 顶层脚本——importScripts 在 Worker 任意位置都能调（它是 Worker 全局方法），但要确保包装函数已注入

**决策：选方案 A（源码预拼接）**。理由：
- skill 脚本定位是批处理工具，不需要运行时动态加载库
- 实现最简，改动最小，不碰 worker 消息协议
- 刚验证的前端 vendor 范式也是"源码内联"思路（`?raw` 把库源码内联进打包产物），方案 A 是同一思路的 runtime 侧
- 缺点（行号偏移/大库进函数体）对批处理脚本可接受

### 2.2 importScripts 调用解析

脚本源码里的 `importScripts('path1', 'path2', ...)` 调用，主线程用正则提取：

```js
// 匹配 importScripts('...') / importScripts("...") / importScripts('...', '...')
const IMPORT_SCRIPTS_RE = /importScripts\s*\(([^)]*)\)/g
```

对每个匹配：
1. 提取参数字符串列表（支持多参数）
2. 每个路径相对 skill 目录解析（复用 resolveBrowserScriptPath 的逃逸校验逻辑）
3. 从 workspaceFiles 读对应文件
4. 文件不存在 → 报 `BROWSER_SCRIPT_VENDOR_NOT_FOUND`
5. 路径逃逸 → 报 `BROWSER_SCRIPT_VENDOR_PATH_INVALID`
6. 非 JS MIME（inferMediaTypeFromPath 非 text/javascript）→ 报 `BROWSER_SCRIPT_VENDOR_NOT_JS`

### 2.3 拼接策略

```
拼接后 source = vendorSources.join("\n;\n") + "\n;\n" + 原始 source（importScripts 调用已移除）
```

- vendor 源码按 importScripts 出现顺序拼接
- 每个 vendor 源码后加 `\n;\n` 分隔（防末尾注释吞噬后续代码）
- 原始 source 里的 importScripts(...) 调用替换为空（已预加载，不需要执行）
- 保持 `"use strict";` 在最前（vendor 源码在 strict 模式下执行——UMD 库通常兼容 strict）

### 2.4 路径基准

相对 skill 目录（与 resolveBrowserScriptPath 一致）。`importScripts('lib/marked.min.js')` 解析为 `<skillDir>/lib/marked.min.js`。

skill 目录从 `request.skillPath` 取（`skillDirectoryPath(request.skillPath)`，已有函数）。

## 3. tsian SDK 精简

### 3.1 移除 tsian.fetch

从 `tsian` 对象删除 `fetch: sdkFetch`。同时删除 `sdkFetch` 函数和 `globalFetch` 变量（不再需要）。

`tsian` 精简为：
```js
const tsian = Object.freeze({
  workspace: Object.freeze({ read, list, search, glob, diff, patch, write, move, delete, validate }),
  log(message, data) { postLog("info", message, data); },
  trace(label, data) { postLog("trace", label, data); }
});
```

### 3.2 现有脚本兼容

现有 skill 脚本（validate-workspace-layout.js 等）只用 `tsian.workspace.*` + `tsian.log`，不用 `tsian.fetch`。移除 tsian.fetch 对它们无破坏。

## 4. skill-authoring 文档更新

### 4.1 更新内容

`SKILL_AUTHORING_SKILL_MD`（`local-assistant-files.ts`）补：

- **API 面描述**：skill 脚本可用的 API
  - `tsian.workspace.*` — workspace 读写（保留）
  - `tsian.log(message, data)` / `tsian.trace(label, data)` — 日志/trace（保留）
  - `fetch` — 标准浏览器 fetch（新放开，完整 Response）
  - `console.log/warn/error` — 调试输出到浏览器控制台（新放开）
  - `setTimeout/setInterval/clearTimeout/clearInterval` — 定时器（新放开）
  - `importScripts('lib/foo.min.js')` — 加载 skill 目录内 UMD 库（新）
- **vendor 范式示例**：
  ```
  1. 放库文件到 skill 目录：skills/my-skill/lib/marked.min.js
  2. 脚本顶部：importScripts('lib/marked.min.js')
  3. 脚本里用：const html = self.marked.parse(text)
  ```
- **限制说明**：
  - importScripts 只支持 UMD/classic 库（`<script>` 可加载的格式），不支持 ESM（`import`/`export` 语法会报错）
  - 路径相对 skill 目录，不能逃逸（`../` 或绝对 URL 会被拦截）
  - 库必须先放进 skill 目录（不能从 CDN 加载）

### 4.2 已移除 API 说明

文档明确 `tsian.fetch` 已移除，改用标准 `fetch`。如果旧 skill 脚本用了 `tsian.fetch`，需改为 `fetch`。

## 5. 数据流

### 5.1 脚本执行流（升级后）

```
executeSkillAction(workspace-tools.ts)
  → resolveBrowserScriptPath(skill, executor)  # 脚本路径校验
  → context.runBrowserScript(request, executorContext)
      → createBrowserSkillScriptRunner(platform-host/index.ts)
          → createBrowserSkillScriptRunner(browser-skill-script-executor.ts)
              → isScriptUnderSkillDirectory(request)  # 校验
              → readWorkspaceFileFromFiles(workspaceFiles, scriptPath)  # 读脚本
              → 【新】resolveAndInlineImportScripts(source, request, workspaceFiles)
                  # 扫描 importScripts 调用 → 校验路径 → 读 vendor 文件 → 拼接
              → runWorkerScript(options, request, 拼接后source, executorContext)
                  → createWorker()  # 经典 Worker
                  → worker.postMessage({type:"execute", source: 拼接后source, input})
                  → Worker 内:
                      new AsyncFunction(调整后形参, source)
                      → 形参不含 globalThis/self/console/setTimeout/fetch → 拿 Worker 原生
                      → 形参含 importScripts → 传 undefined（已预拼接，不需要运行时 importScripts）
                      → 脚本执行（vendor 库已挂 globalThis，直接用）
```

### 5.2 vendor 加载流

```
脚本源码: importScripts('lib/marked.min.js'); ...
  → resolveAndInlineImportScripts:
      1. 正则匹配 importScripts('lib/marked.min.js')
      2. 路径 'lib/marked.min.js' → 相对 skill 目录 → '<skillDir>/lib/marked.min.js'
      3. 校验: 路径以 <skillDir>/ 开头 ✓
      4. readWorkspaceFileFromFiles(workspaceFiles, '<skillDir>/lib/marked.min.js')
      5. inferMediaTypeFromPath → text/javascript ✓
      6. 读出 vendor 源码
      7. 移除 importScripts 调用，vendor 源码拼到 source 前
  → 拼接后 source 传进 Worker
  → Worker 内执行: vendor 源码先跑（挂 globalThis.marked）→ 脚本跑（用 self.marked）
```

## 6. 契约不变项

- `RuntimeBrowserScriptExecutorRequest` 接口不变（已含 skillPath）
- `createBrowserSkillScriptRunner` 签名不变
- `executeSkillAction` / `runBrowserScript` 调用路径不变
- Worker 消息协议不变（仍是 `{type:"execute", source, input}`）
- skill 加载/执行机制（use_skill/run_script）不变

## 7. 兼容性与迁移

- **现有 skill 脚本**：只用 `tsian.workspace.*` + `tsian.log`，不受影响。
- **用了 tsian.fetch 的脚本**：需改为 `fetch`。现有内置脚本不使用 tsian.fetch，但卡作者写的可能有——文档标注迁移。
- **UMD 库挂载**：需要放开 globalThis/self 形参，已验证可行。
- **无需数据迁移**：纯执行模型改动，不碰 workspace 数据结构。

## 8. 权衡与风险

### 8.1 源码拼接的行号偏移

vendor 源码拼到脚本前，报错行号会偏移（vendor 占了 N 行）。缓解：skill 脚本调试主要靠 console.log（已放开），不依赖精确行号；且 vendor 源码是 minified 单行，行号偏移通常就 1-2 行。

### 8.2 globalThis 放开的安全边界

放开 globalThis 后，脚本能访问 Worker 全局的所有属性。但 Worker 全局本身能力有限（无 DOM、无 window），且 skill 脚本来源受信任（卡作者/玩家/助手）。维持屏蔽的（window/document/navigator/location 等）通过形参 undefined 遮蔽，即使 globalThis 拿到了，`globalThis.window` 在 Worker 里也是 undefined（Worker 没有 window）。风险可控。

### 8.3 importScripts 正则解析的局限

正则 `importScripts\s*\(([^)]*)\)` 不能处理：
- 跨行参数（`importScripts(\n  'lib/foo.js'\n)`）→ 用多行正则 `/g` + `\s*` 覆盖
- 动态拼接路径（`importScripts(varName)`）→ 不支持，文档标注"路径必须是字符串字面量"
- 注释里的 importScripts（`// importScripts(...)`）→ 误匹配，但拼接无害（读不到文件会报错，脚本作者会注意到）

缓解：文档明确"importScripts 路径必须是字符串字面量，不支持动态拼接"。skill 脚本是 agent/卡作者显式写的，动态拼接极少见。

### 8.4 回退

改动集中在 `browser-skill-script-executor.ts`（形参 + importScripts 解析 + 移除 tsian.fetch）+ `local-assistant-files.ts`（文档）。出问题 git revert 这两个文件回旧版，不影响 skill 加载/执行基础机制。
