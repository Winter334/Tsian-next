# 任意网页布局CSS观察（油猴脚本）

## Goal

提供一个**油猴用户脚本**（Tampermonkey/Violentmonkey），让用户在任意第三方网页触发采集，脚本抓取目标页的 DOM 结构（aria snapshot）+ 关键元素 computedStyle，经 `postMessage` 回传到打开着的 Tsian 平台页；Tsian 侧新增一个 `message` 事件监听器，校验来源后把结果落盘为 workspace 文件（`inspections/<域名>-<时间>.json`），助手下一轮即可 `workspace.read` 读到，用于"看一眼任意网页布局和 CSS，学过来改自己的前端"。

这是 `inspect_frontend`（只支持同源 packaged 前端）的**补充通道**——解决"助手想参考外部网页设计但拿不到渲染后 DOM/computedStyle"的缺口。定位是**外部采集器 + 落盘**，不改动 agent-runtime 工具循环、不引入 browser session、不需要桌面壳。

## User Value

- 助手写前端时能参考任意外部网页的**真实渲染布局与样式**（含 JS 渲染后的 DOM、computedStyle），不再局限于 fetch 抓到的静态 HTML 空壳。
- 对"学布局/配色/组件结构"这类参考需求闭环：用户在目标页按一下快捷键 → 数据落盘 → 助手 `workspace.read` → 改自己的前端。
- 零架构改动：采集逻辑全在用户脚本（外部产物），Tsian 侧只加一个 message 监听器 + 落盘，不碰 agent-runtime 核心。

## Confirmed Facts（已通过代码探明，无需重新论证）

- **跨域硬限制是 `inspect_frontend` 的边界**：`frontend-inspector.ts` 靠 same-origin 读 `contentDocument`（SW 同源化 packaged 前端实现），对跨域网页 `contentDocument` 读不到。用户脚本与目标页**同源运行**，`document`/`getComputedStyle`/`MutationObserver` 全可用，绕过此限制。
- **computedStyle 只在浏览器内可得**：`getComputedStyle(el)` 返回的解析值是"学 CSS"的关键，fetch 抓 HTML 拿不到。用户脚本在目标页内运行可直接调。
- **`browser_script` 跑在 Web Worker 无 DOM**：`browser-skill-script-executor.ts:500 createWorker` 注入的 `window/document` 全 `undefined`（`:276-292`），不能用于操作/采集网页 DOM。所以采集逻辑不能放 `browser_script`，必须在目标页内运行——用户脚本是唯一零壳路径。
- **workspace 写入有 `platform-meta` scope**：`WorkspaceScope`（`runtime.ts:139`）含 `platform-meta`；`writePlatformFile`（`storage/workspace.ts:41`）可写平台级文件。采集结果落盘到 `inspections/` 目录用此 scope，不绑 save、不污染 card-content。
- **`remote-iframe-bridge.ts:401 onMessage` 是现成 message 监听范式**：校验 `event.source`/`channel`/`origin`，可参考其来源校验模式。但本任务的监听器是**窗口级**（监听任意 `window.message`，不限 iframe source），需要独立的 channel 标识 + origin 白名单（Tsian 自身 origin）。
- **aria snapshot 采集逻辑可复用**：任务1（`06-23-inspect-frontend-action-aria`）若先落地 aria snapshot 采集函数，用户脚本可镜像同一段序列化逻辑（纯 DOM API，无框架依赖）。若任务1未落地，用户脚本内自含一份精简版。
- **助手读 workspace 是现成路径**：助手 `workspace.read`（`RUNTIME_WORKSPACE_TOOL_NAMES.read`）可读任意 scope 文件；落盘成 JSON 后助手下轮即可读，不污染工具循环、不需要实时 postMessage 注入上下文。
- **用户脚本分发不需 Chrome 商店审核**：`.user.js` 文件放仓库 `tools/` 或 `apps/platform-web/public/` 目录，用户手动安装到 Tampermonkey/Violentmonkey 即可。

## Requirements

### R1 用户脚本采集器（`tools/tsian-layout-observer.user.js`）

- **触发方式**：用户在目标页按快捷键（如 `Ctrl+Shift+L`）或油猴菜单项触发采集；不在页面 load 时自动跑（避免干扰正常浏览）。
- **采集内容**：
  - **aria snapshot**：目标页 DOM 的无障碍树 YAML（role + accessible name + 状态 + 层级），跳过隐藏/装饰节点。复用任务1的 aria 序列化逻辑或自含精简版。
  - **关键元素 computedStyle**：对 aria snapshot 中的交互/容器元素（或用户指定的 selector 列表），采 `getComputedStyle` 的布局相关属性（display/flex/grid/position/width/height/margin/padding/color/backgroundColor/font-size/border 等）+ CSS 变量（`:root` 自定义属性）。
  - **页面元信息**：URL、title、viewport 尺寸、`<meta name=viewport>`。
  - **可选 selector 聚焦**：用户脚本支持配置一个 selector 白名单，只采这些元素的详细 computedStyle（减少数据量，默认采前 N 个关键容器）。
- **数据量控制**：aria snapshot 截断（如 max 8000 字符），computedStyle 每元素限属性集 + 值长度截断，总 payload 限上限（如 50KB）防 postMessage 阻塞。
- **不采集敏感信息**：跳过 `<input type=password>` 的值、`<input>` 的 value（表单输入内容）、cookie/localStorage。只采结构与样式，不采用户数据。

### R2 postMessage 回传协议

- 用户脚本采集后，向 `window.postMessage` 发结构化 payload：
  ```
  { channel: "tsian.layout-observer.v1", kind: "snapshot", payload: { url, title, aria, computedStyles, meta, ts } }
  ```
- **targetWindow 选择**：用户脚本在目标页运行，`window.postMessage` 默认发给自己（同窗口）。要让 Tsian 页收到，需：
  - **方案 A（推荐）**：用户脚本用 `GM_xmlhttpRequest`（油猴特权 API，绕 CORS）把 payload POST 到 Tsian 页暴露的接收端点（需 Tsian 起 SW fetch 路由或 BroadcastChannel）。
  - **方案 B**：若 Tsian 页与目标页同窗口（用户在 Tsian 内开新标签再切回），用 `BroadcastChannel("tsian.layout-observer")` 广播，Tsian 页监听同 channel。
  - **方案 C（最简，降级）**：用户脚本把 payload 写入 `localStorage`（目标页 origin 下），用户手动复制回 Tsian；或脚本直接 `prompt()` 弹出 JSON 让用户复制粘贴给助手。
  - **design.md 需决策方案选择**（A/B/C 的可行性、CORS、用户体验权衡）。

### R3 Tsian 侧接收与落盘

- 新增一个窗口级 `message` 监听器（或 BroadcastChannel 监听，取决于 R2 方案），校验：
  - `channel === "tsian.layout-observer.v1"`
  - `kind === "snapshot"`
  - payload 结构合法（url/title/aria/computedStyles/meta 字段存在且类型对）
- **来源校验**：方案 A（GM_xmlhttpRequest）校验请求来源；方案 B（BroadcastChannel）天然同源；方案 C 无来源问题（用户手动）。
- **落盘**：校验通过后，调 `writePlatformFile`（`storage/workspace.ts`）写入 `inspections/<域名>-<时间戳>.json`，scope=`platform-meta`。文件名 URL-safe 化（域名 + 路径段 + 时间戳）。
- **去重/上限**：同域名短时间内多次采集，新文件覆盖或追加版本号；`inspections/` 目录设文件数上限（如 50），超限删最旧。
- **通知助手**：落盘后可选 emit 一个 trace 事件或 workspace 变更通知，让助手知道有新采集数据可读（或在助手下一轮自然通过 `workspace.list` 发现）。

### R4 助手侧使用路径

- 助手不需要新工具。用户采集后，在对话中提示助手"我已采集 X 网页布局，在 `inspections/` 下"，助手用 `workspace.read`/`workspace.list` 读取 JSON，解析 aria + computedStyle，学习后改自己的前端文件。
- **可选**：在 `buildWorkspaceToolInstructions` 加一句说明 `inspections/` 目录的用途，让助手知道有参考数据时可主动 `workspace.list("inspections")` 发现。

### R5 安全与隐私

- **用户脚本不采集用户输入数据**（密码、表单值、cookie、localStorage），只采结构与样式。
- **Tsian 侧校验 payload 结构**，拒绝畸形/超大 payload（防 DoS）。
- **落盘文件不含用户敏感数据**（因采集端已跳过）。
- **用户脚本明确告知用户采集范围**：触发时弹一次确认（油猴 `GM_notification` 或 `confirm`），说明"将采集本页布局与样式（不含输入数据）回传 Tsian"。

## Acceptance Criteria

- [ ] `tools/tsian-layout-observer.user.js` 安装到 Tampermonkey/Violentmonkey 后，在任意网页按快捷键能触发采集，生成 aria snapshot + computedStyle payload。
- [ ] 采集 payload 跳过 `<input type=password>` 值、表单 value、cookie/localStorage，只含结构与样式。
- [ ] 触发时有确认提示告知用户采集范围。
- [ ] Tsian 侧监听器能接收并校验 payload（channel/kind/结构），拒绝畸形 payload。
- [ ] 校验通过的 payload 落盘为 `inspections/<域名>-<时间戳>.json`（scope=platform-meta），助手 `workspace.read` 能读到。
- [ ] 同域名短时多次采集有去重/版本化策略，`inspections/` 目录有文件数上限防膨胀。
- [ ] 助手读 `inspections/` 下 JSON 后能解析 aria + computedStyle，用于参考改前端。
- [ ] 大 payload（超上限）被截断或拒绝，不阻塞页面/监听器。
- [ ] 不采集时（未触发快捷键）用户脚本对目标页浏览零干扰。

## Out of Scope

- **无人值守采集**：本任务需用户主动触发快捷键。自动定时/页面切换自动采集属扩展级能力，留待浏览器扩展方案。
- **任意网页操作（click/fill/导航）**：本任务只采观察数据，不对目标页施加操作。操作链属 Playwright 级能力，超出范围。
- **截图**：不采集截图（computedStyle + aria 对"学 CSS"已够；截图对学样式无直接价值）。
- **浏览器扩展**：MV3 扩展的 `chrome.scripting`/`chrome.debugger` 强能力本任务不用。油猴脚本 ROI 更高，扩展留待"无人值守多步操作"需求。
- **网络请求列表 / 控制台日志采集**：属 Playwright 级诊断能力，不在"看布局 CSS"范围。
- **多标签页管理**：用户脚本单页触发，不涉及多标签 session。
