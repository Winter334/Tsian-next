# Implement — Skill 脚本执行能力升级与文档约定

## 验证命令

```bash
# 类型检查（全流程门槛）
npm run build:contracts && npm run build:web

# 端到端验证（dev server + 助手调用 run_script）
npm run dev
```

## 风险文件 / 回退点

- **主改动文件**：`apps/platform-web/src/platform-host/browser-skill-script-executor.ts`（形参列表 + importScripts 解析 + 移除 tsian.fetch）。
- **文档文件**：`apps/platform-web/src/storage/local-assistant-files.ts`（SKILL_AUTHORING_SKILL_MD 更新）。
- **可能微调**：`apps/platform-web/src/agent-runtime/workspace-tools.ts`（vendor 路径校验复用 resolveBrowserScriptPath 逻辑，可能抽公共函数）。
- **回退**：`git checkout -- apps/platform-web/src/platform-host/browser-skill-script-executor.ts apps/platform-web/src/storage/local-assistant-files.ts`，不影响 skill 加载基础机制。

## 有序实现 checklist

### 阶段 A：AsyncFunction 形参列表调整（放开原生能力）

- [ ] **A1** 从 AsyncFunction 形参列表删除 `globalThis`/`self`/`console`/`setTimeout`/`setInterval`/`clearTimeout`/`clearInterval`/`fetch`。
- [ ] **A2** 对应调整 runner 调用的实参列表（删除这些 undefined 参数）。
- [ ] **A3** 保留屏蔽的形参（`window`/`document`/`localStorage`/`sessionStorage`/`XMLHttpRequest`/`WebSocket`/`EventSource`/`Worker`/`SharedWorker`/`navigator`/`location`/`indexedDB`/`caches`）继续传 undefined。
- [ ] **A4** `npm run build:web` 验证类型检查通过。
- **验证门**：build 通过 + 形参列表正确（删 8 个、保留 12 个屏蔽、importScripts 待 B 阶段处理）。

### 阶段 B：移除 tsian.fetch + 精简 SDK

- [ ] **B1** 从 `tsian` 对象删除 `fetch: sdkFetch`。
- [ ] **B2** 删除 `sdkFetch` 函数定义和 `globalFetch` 变量（不再需要）。
- [ ] **B3** 确认 `tsian` 精简为 `workspace.*` + `log` + `trace`。
- [ ] **B4** `npm run build:web` 验证。
- **验证门**：build 通过 + tsian 对象无 fetch + 现有脚本（validate-workspace-layout.js）不破坏（它不用 tsian.fetch）。

### 阶段 C：importScripts 源码预拼接（vendor 第三方库）

- [ ] **C1** 新增 `resolveAndInlineImportScripts(source, request, workspaceFiles)` 函数：
  - 正则扫描 `importScripts(...)` 调用（支持多行、多参数）
  - 每个路径相对 skill 目录解析（`skillDirectoryPath(request.skillPath)` + 路径拼接）
  - 路径逃逸校验（复用 `resolveBrowserScriptPath` 的 `startsWith(skillDirectory/)` 逻辑）
  - 从 workspaceFiles 读 vendor 文件（`readWorkspaceFileFromFiles`）
  - MIME 校验（`inferMediaTypeFromPath` 非 text/javascript 报错）
  - vendor 源码按顺序拼到 source 前，importScripts 调用替换为空
  - 错误码：`BROWSER_SCRIPT_VENDOR_NOT_FOUND` / `BROWSER_SCRIPT_VENDOR_PATH_INVALID` / `BROWSER_SCRIPT_VENDOR_NOT_JS`
- [ ] **C2** 在 `createBrowserSkillScriptRunner` 里，读脚本源码后、调 `runWorkerScript` 前，调 `resolveAndInlineImportScripts` 处理 source。
- [ ] **C3** importScripts 形参传 undefined（已预拼接，不需要运行时 importScripts 函数）——或者保留形参传一个抛错的 stub（提示"importScripts 已预加载，不需要调用"）。选后者更友好（脚本如果动态调 importScripts 会得到清晰提示而非 ReferenceError）。
- [ ] **C4** `npm run build:web` 验证。
- **验证门**：build 通过 + importScripts 预拼接逻辑完整 + 错误码清晰。

### 阶段 D：skill-authoring 文档更新

- [ ] **D1** 更新 `SKILL_AUTHORING_SKILL_MD`（`local-assistant-files.ts`）：
  - API 面描述（tsian.workspace/log/trace + fetch + console + 定时器 + importScripts）
  - vendor 范式示例（放库到 skill 目录 + importScripts 加载 + self.xxx 使用）
  - 限制说明（只 UMD、路径相对 skill 目录、不能逃逸、不能 CDN、不支持 ESM）
  - tsian.fetch 移除迁移说明
- [ ] **D2** 如果 framework-knowledge skill 也有 API 面描述，同步更新。
- [ ] **D3** `npm run build:web` 验证（文档是字符串常量，build 检查语法）。
- **验证门**：文档完整描述新 API 面 + vendor 范式可操作 + 限制清晰。

### 阶段 E：端到端验证

前置：dev server 启动 + 助手可用。

- [ ] **E1** 写一个测试 skill 脚本：vendor marked（放 marked.min.js 到 skill 目录）+ importScripts 加载 + `self.marked.parse("**bold**")` 返回结果。让助手 use_skill + run_script 跑，验证 vendor 加载 + UMD 挂载 + markdown 渲染。
- [ ] **E2** 验证裸 fetch：脚本里 `await fetch('https://...')` 拿 Response，`.text()` 读 body。
- [ ] **E3** 验证 console：脚本里 `console.log('test')`，浏览器控制台可见。
- [ ] **E4** 验证定时器：脚本里 `await new Promise(r => setTimeout(r, 100))` 等待 100ms。
- [ ] **E5** 验证路径逃逸拦截：`importScripts('../foo.js')` 报 `BROWSER_SCRIPT_VENDOR_PATH_INVALID`。
- [ ] **E6** 验证现有脚本不破坏：跑 validate-workspace-layout.js（现有内置 skill），正常返回。
- [ ] **E7** 验证 ESM 报错清晰：`importScripts('lib/foo.esm.js')`（内容含 export）→ UMD 执行报 SyntaxError，错误信息可读。
- **验证门**：6 场景全通过 = 端到端验证完成。

### 阶段 F：工程质量门

- [ ] **F1** `npm run build:contracts && npm run build:web` 通过（vue-tsc）。
- [ ] **F2** git diff 确认只改了 `browser-skill-script-executor.ts` + `local-assistant-files.ts`（+ 可能 `workspace-tools.ts` 抽公共函数）。
- [ ] **F3** 不破坏现有 skill 加载/执行（use_skill/run_script 路径不变）。

## review gates

- 阶段 A→B 间：形参调整 build 通过再删 tsian.fetch。
- 阶段 C→D 间：importScripts 预拼接逻辑 build 通过再写文档。
- 阶段 D→E 间：文档更新后跑端到端验证（验证的是成品能力 + 文档准确性）。

## rollback points

- 阶段 C 失败（UMD 库挂不上）：检查 globalThis/self 形参是否真删了、vendor 源码是否拼对了位置、UMD wrapper 是否走全局挂载分支（Worker 无 CommonJS/AMD）。
- 阶段 E1 失败（vendor 加载报错）：检查路径解析（相对 skill 目录）、文件是否在 workspaceFiles 里、MIME 推断是否 text/javascript。
- 阶段 E2 失败（fetch 报 undefined）：检查 fetch 形参是否真从列表删了（不是传 undefined）。
