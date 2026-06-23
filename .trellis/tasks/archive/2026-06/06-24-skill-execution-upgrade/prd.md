# Skill 脚本执行能力升级与文档约定

## Goal

升级 skill 脚本（`browser_script` executor）的执行能力，让它从"只能纯手写 JS 做 workspace 读写"提升到"能 vendor 第三方库 + 用原生浏览器 API"，同时精简 API 面让助手 agent 更容易生成正确代码。配套更新 skill-authoring 文档约定，把新能力教给 agent/卡作者。

## User Value

- **skill 脚本能用第三方库**：卡作者/助手放 UMD 库到 skill 目录，脚本 `importScripts('lib/marked.min.js')` 即可用，不必手抄库源码。复刻刚验证的前端 vendor 范式到 runtime 侧。
- **API 面更窄更标准**：移除非标准的 `tsian.fetch`（削平的 fetch 包装），放开标准裸 `fetch`/`console`/`setTimeout`——agent 训练数据里这些是主流接口，比 `tsian.fetch`/`tsian.log` 自然得多，降低 agent 生成错误代码的概率。
- **调试体验**：放开 console 让 skill 脚本能直接 `console.log` 调试，输出到浏览器控制台（现在只能 `tsian.log` 回传主线程）。
- **异步能力**：放开 setTimeout/setInterval 支持轮询/延迟类脚本。
- **文档同步**：skill-authoring 指导更新，agent fork/创建 skill 时能看到新 API 面和 vendor 范式示例，新能力可被发现和使用。

## Confirmed Facts（已通过代码探明，无需重新论证）

- **现有执行模型**（`browser-skill-script-executor.ts`）：经典 Worker（`new Worker(url)` 无 `type:module`）+ 源码字符串塞进 `new AsyncFunction(形参..., 源码)`。形参列表含 `importScripts`/`fetch`/`console`/`setTimeout` 等，但调用时**全部传 undefined**，等效屏蔽。
- **Worker 原生全局**：`setTimeout`/`setInterval`/`clearTimeout`/`clearInterval`/`console` 是经典 Worker 原生全局（`self.xxx`），只要不从 AsyncFunction 形参传 undefined 遮蔽，脚本就能直接拿到。放开这些是**纯做减法**——从形参列表删除即可。
- **importScripts 是经典 Worker 原生**，但必须注入一个**受限包装函数**（只允许 skill 目录内文件），不能简单"不屏蔽"——否则脚本可加载任意 URL。
- **tsian.fetch 内部就是裸 fetch**（`browser-skill-script-executor.ts:148` `globalFetch(resource, init)`），区别只在返回值：tsian.fetch 把 body 强制 `await response.text()` 成扁平 `{ok,status,headers,body:string}`，裸 fetch 返回完整 Response（流式/二进制/abort 都可用）。移除 tsian.fetch 无网络能力损失。
- **vendor 文件可从 workspaceFiles 读出**：executor 持有 `workspaceTransaction.workspaceFiles`（`index.ts:794`），`RuntimeBrowserScriptExecutorRequest` 含 `skillPath`（`workspace-tools.ts:1797`），vendor 路径解析所需信息齐全。
- **路径逃逸校验可复用**：`resolveBrowserScriptPath`（`workspace-tools.ts:1681`）已实现"路径必须以 `${skillDirectory}/` 开头"校验，vendor 文件路径解析可复用同逻辑。
- **MIME 推断已支持**：`inferMediaTypeFromPath`（`media-type.ts:26`）对 `.js`/`.mjs` 返回 `text/javascript`，blob URL 的 Content-Type 可正确设置（importScripts 要求合法 JS MIME，否则 NetworkError）。
- **UMD 库挂载依赖 globalThis 形参放开**：UMD wrapper 用 `g = typeof globalThis < "u" ? globalThis : ...` 取全局，然后 `g["marked"] = f()` 挂载。但现有 AsyncFunction 形参列表含 `"globalThis"` 且传 undefined（`browser-skill-script-executor.ts:257,279`），导致 UMD 库的 `g` 是 undefined、`g["marked"]=f()` 抛 `Cannot set properties of undefined`。要让 UMD 库工作，**必须同时从形参列表删除 `globalThis`/`self`**（让 UMD wrapper 拿到真实 Worker 全局）。这与放开 console/setTimeout 是同一类操作（删形参）。
- **importScripts 包装实现位置**：Worker 内调用（importScripts 是 Worker 全局方法），但 vendor 文件内容在主线程 workspaceFiles。最佳模式：主线程预解析脚本里的 importScripts 调用 → 校验路径 → 从 workspaceFiles 读 vendor 文件 → 造 blob URL → 把"路径→blobURL"映射传进 worker → worker 内受限 importScripts 函数查映射调真正的 `self.importScripts(blobURL)`。或更简方案：放开 globalThis/self 后，主线程把 vendor 源码直接拼到脚本源码前（UMD 库挂 globalThis，后续脚本用 `self.marked`）——但源码拼接有调试/性能顾虑（大库进函数体），需 design 阶段权衡。
- **现有 skill 脚本**（`local-assistant-files.ts`）：`validate-workspace-layout.js` 等用 `tsian.workspace.*` + `tsian.log`，**不使用 tsian.fetch**，移除 tsian.fetch 对现有脚本无破坏（workspace/log 保留）。
- **skill-authoring 文档**（`local-assistant-files.ts` 的 `SKILL_AUTHORING_SKILL_MD`）：当前描述 executor 约束（type=browser_script, path 相对 scripts/, timeoutMs≤60000），未提及 fetch/console/定时器/importScripts 的 API 面。需更新。

## Requirements

### 已定（来自用户对齐）

- **放开 importScripts** 限定到 skill 目录内文件。卡作者放 vendor 库到 skill 目录，脚本 `importScripts('lib/foo.min.js')` 加载，路径逃逸 skill 目录即报错。这是 vendor 第三方库的核心机制。
- **移除 tsian.fetch**，放开标准裸 `fetch`。API 面更窄更标准，利于 agent 生成正确代码。`tsian` 对象精简为 `workspace.*` + `log` + `trace`。
- **放开 console**：Worker 原生，输出到主线程浏览器控制台，调试用。
- **放开 setTimeout/setInterval/clearTimeout/clearInterval**：Worker 原生，支持异步/轮询类脚本。
- **不开放 ESM**：UMD/classic 库生态够用（marked/lodash/chart.js 等都有 UMD 构建）。ESM 需重构执行模型（module worker + 虚拟模块解析），成本不匹配 skill 脚本批处理定位。留作后续演进。
- **DOM/window/document 维持屏蔽**：Worker 本就无 DOM，维持现状。
- **skill-authoring 文档更新**：更新 skill-authoring SKILL.md 描述新 API 面（fetch/console/定时器/importScripts）+ vendor 范式示例（放库到 skill 目录 + importScripts 加载）。

### 待探索（需求探索中，逐项与用户对齐后填入）

（需求探索进行中）

## Acceptance Criteria

### 执行能力
- [ ] skill 脚本能 `importScripts('lib/foo.min.js')` 加载 skill 目录内的 UMD 库，库挂全局后脚本可用（如 `self.marked.parse(...)`）。
- [ ] importScripts 路径逃逸 skill 目录（如 `../foo.js` 或绝对 URL）被拦截并报清晰错误。
- [ ] skill 脚本能用裸 `fetch` 拿完整 Response（text/json/blob/arrayBuffer/abort 等原生能力）。
- [ ] skill 脚本能用 `console.log/warn/error` 输出到浏览器控制台。
- [ ] skill 脚本能用 `setTimeout`/`setInterval`/`clearTimeout`/`clearInterval`。
- [ ] `tsian.fetch` 移除，`tsian` 对象精简为 `workspace.*` + `log` + `trace`。
- [ ] 现有 skill 脚本（validate-workspace-layout.js 等）不破坏（它们只用 workspace.* + log）。

### 沙箱边界
- [ ] importScripts 只能加载 skill 目录内文件，不能加载任意 URL / 逃逸目录。
- [ ] DOM/window/document 维持屏蔽（undefined 形参）。
- [ ] 超时 abort 时清理 setInterval 定时器（防止泄漏）。

### 文档约定
- [ ] skill-authoring SKILL.md 更新：描述新 API 面（fetch/console/定时器/importScripts）+ vendor 范式示例。
- [ ] 文档明确 importScripts 只支持 UMD/classic 库，不支持 ESM（`import`/`export` 语法会报错）。

### 工程质量
- [ ] vue-tsc 类型检查通过（`npm run build:web`）。
- [ ] 改动集中在 `browser-skill-script-executor.ts` + `workspace-tools.ts`（路径校验复用）+ `local-assistant-files.ts`（文档）。
- [ ] 不破坏现有 skill 加载/执行机制（use_skill/run_script 路径不变）。

## Out of Scope

- ESM 支持（module worker + 虚拟模块解析）——留作后续演进，触发条件是"碰到 ESM-only 库刚需"。
- 新增内置 skill / skill 数量补充。
- skill 发现/加载机制优化。
- 前端 ESM 支持开发（前端已天然支持，无需开发）。
- importScripts 域名白名单（路径已限定 skill 目录内，无需额外网络层限制）。

## Open Questions

- ~~vendor 文件路径相对基准~~ → **已定：相对 skill 目录**（与 resolveBrowserScriptPath 一致）。
- importScripts 受限包装实现位置：主线程造 blob URL 传 worker vs worker 内拦截 self.importScripts？（影响实现复杂度）→ design 阶段定。
- 移除 tsian.fetch 后是否保留一条 trace 日志 → **已定：不保留，纯裸 fetch**。脚本需要可观测性自己 console.log/tsian.trace。
- 超时/abort 与 setInterval 的清理策略 → **已定：依赖 worker.terminate() 隐式清理**。现有超时机制就是 terminate 杀整个 worker，定时器随之消失，无需额外 clearInterval 逻辑。

（需求探索已收敛，剩余为 design 阶段技术细节）
