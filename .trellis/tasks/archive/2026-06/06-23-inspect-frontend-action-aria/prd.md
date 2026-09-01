# inspect_frontend action集扩展与aria快照

## Goal

为 `inspect_frontend` 工具补齐高频缺失的 DOM 交互动作，并把结构层采集从"裁剪过的 raw HTML 树"升级为 Playwright 风格的 **aria snapshot（无障碍树 YAML）**，提升对 packaged 前端的语义密度与 token 效率。这是 `06-23-assistant-frontend-inspection` 的增量演进——不引入新工具、不动 session 模型，只在现有 single-tool 闭环内增强采集与交互。

方向依据：助手自检 packaged 前端时，当前 `structure.domSummary`（`frontend-inspector.ts:978 serializeDom`）输出的是裁剪过的原始 HTML，对 LLM 语义密度低、token 浪费多；action 集只有 click/type/press/scroll，缺 selectOption/hover/check/fill 等高频表单动作，助手自检表单类前端时动作面不足。

## User Value

- **Token 效率**：aria snapshot YAML（`- heading "登录"`、`- button "提交"`）比 raw HTML 对 LLM 更友好，同等信息量 token 更少，助手读结构层更准。
- **动作面闭合**：助手自检带下拉/复选/单选/悬停的前端时不再"有 selector 没动作可用"，闭环完整。
- **鲁棒性**：auto-waiting（等元素出现/可操作）减少"动作发太快渲染没跟上"的假阴性，observeBetween 步间快照更可信。

## Confirmed Facts（已通过代码探明，无需重新论证）

- **现有 action 集与类型**：`InspectDomActionType = "click" | "type" | "press" | "scroll"`（`workspace-tools.ts:149`），`InspectDomAction` 接口（`:151`），`INSPECT_DOM_ACTION_TYPES` Set 校验（`:1087`），`applyAction` 实现（`frontend-inspector.ts:502`，用 `contentDocument.querySelector` + `dispatchEvent`）。
- **现有结构层采集**：`collectStructure`（`frontend-inspector.ts:955`）调 `serializeDom`（`:978`）输出裁剪 HTML 树（`MAX_DOM_DEPTH=8`、`MAX_DOM_TEXT=200`、`MAX_ATTR_VALUE=120`、`MAX_DOM_SUMMARY=8000`），`collectKeyComputedStyles`（`:1030`）采 `:root` CSS vars + `KEY_SELECTORS` 容器，`extractRenderedText`（`:1065`）采消息区文本。
- **schema 定义**：`inspectFrontendSchema`（`tool-schemas.ts:120`）的 `actions.items` enum 为 `["click","type","press","scroll"]`（`:143`），`structure` 输出 `domSummary/computedStyles/renderedText/bridgeState`（`workspace-tools.ts:179`）。
- **文本协议说明**：`buildWorkspaceToolInstructions`（`index.ts:783-784`）给助手的示例只有 send/click，需同步新增 action 类型的示例。
- **single-tool 串行约束**：`frontend-inspector.ts:64 currentSession` 单会话串行，`disposeCurrentSession`（`:80`）保证后一次 dispose 前一次——新增 action 不破坏此约束，仍在一个 `inspect_frontend` 调用内顺序执行 `actions[]`。
- **aria snapshot 可在浏览器内实现**：无障碍树计算基于 DOM API（`element.computedRole`/`aria` 属性/`getComputedStyle` visibility），不依赖 CDP，same-origin `contentDocument` 完全可做。Playwright 的 aria snapshot 也是注入页面侧脚本实现。
- **auto-waiting 可用 MutationObserver**：same-origin 下对 `contentDocument` 挂 `MutationObserver` 轮询等元素出现/可操作（visible + enabled + stable），不依赖 CDP 的 `Page.lifecycleEvent`。
- **diff 基于文本行**：`computeDiff`（`frontend-inspector.ts:466`）对 `structure.domSummary` 做行级 Set diff——升级成 aria YAML 后行级 diff 仍成立（YAML 每行一个节点），`KEY_SELECTORS` diff 逻辑不变。

## Requirements

### R1 aria snapshot 结构层（替换 domSummary 的 raw HTML）

- `structure.domSummary` 输出格式从裁剪 HTML 树改为 **aria snapshot YAML**：缩进表无障碍树，节点标注 role + accessible name + 状态（checked/disabled/expanded/level 等），形如：
  ```
  - heading "登录" [level=1]
  - textbox "用户名"
  - textbox "密码"
  - button "提交"
  - link "忘记密码"
  ```
- 只采**可见且有意义**的节点：跳过 `display:none`/`visibility:hidden`/`aria-hidden`/纯装饰节点；保留交互元素（button/link/textbox/checkbox/radio/select/combobox/menu/tab 等）与内容容器（heading/paragraph/list 等）的层级。
- **全量替换 raw HTML**：`serializeDom`（裁剪 HTML 树）直接替换为 aria snapshot 序列化函数，不保留 `structureFormat` 降级开关——旧格式无外部依赖调用方，留着是包袱。diff 基线跨升级不连续不影响实际场景（助手通常同会话内连续 inspect，diff 在同格式下成立）。
- `MAX_DOM_SUMMARY` 截断逻辑不变（超长标 `truncated`）。aria YAML 行级 diff 与现有 `computeDiff` 兼容（YAML 每行一个节点，Set diff 成立）。
- `computedStyles` / `renderedText` / `bridgeState` 字段不变。

### R2 action 集扩展

在 `InspectDomActionType` 新增以下动作（均走 same-origin `contentDocument.querySelector` + 事件派发，不引入新执行通道）：

- **`selectOption`**：对 `<select>` 设 `value` 或按 `<option>` 文本匹配选中，派发 `change`/`input` 事件。参数：`value?: string`（按 option value）或 `label?: string`（按 option 文本）。
- **`check`**：对 `<input type=checkbox/radio>` 设 `checked=true`，派发 `change`/`click` 事件。参数：`checked?: boolean`（默认 true，false=取消勾选）。
- **`fill`**：对 `<input>`/`<textarea>`/`[contenteditable]` 清空后填入文本，派发 `input`/change 事件。与现有 `type` 区别：`type` 是追加派发 key 事件，`fill` 是整体替换（对齐 Playwright `fill` 语义，更适合表单重填）。
- **`hover`**：派发 `mouseover`/`mouseout`/`mouseenter`/`mouseleave` 事件序列（触发 CSS `:hover` 与 hover 态 JS）。无参数。
- **`focus`**：对可聚焦元素调 `el.focus()`，派发 `focus`/`focusin` 事件。用于"聚焦后看焦点态样式/行为"。

每个新动作在 `applyAction`（`frontend-inspector.ts:502`）加 `case` 分支，在 `INSPECT_DOM_ACTION_TYPES`（`workspace-tools.ts:1087`）加类型，在 `InspectDomAction` 接口加对应可选参数，在 `inspectFrontendSchema`（`tool-schemas.ts:143`）enum + properties 加字段。

### R3 auto-waiting（可选，默认开）

- `InspectFrontendInput` 增加可选 `autoWait?: boolean`，默认 `true`。
- 每个 action 执行前，等目标 selector 元素**出现且可操作**（存在 + visible + 非 disabled + 非 aria-disabled），超时（如 1000ms）则报 `INSPECT_WAIT_TIMEOUT`，不执行动作。
- 实现：轮询 `contentDocument.querySelector(selector)` + 可操作性检查（可复用 `MutationObserver` 加速，或简单 `requestAnimationFrame` 轮询兜底）。
- `autoWait: false` 时退回现有"立即 querySelector + 不存在抛 INSPECT_SELECTOR_NOT_FOUND"行为。

### R4 工具说明同步

- `inspectFrontendSchema` 的 `actions.items` enum 与 properties 同步新增动作类型与参数。
- `buildWorkspaceToolInstructions`（`index.ts:783-784`）的 inspect_frontend 示例补充新动作与 `structureFormat`/`autoWait` 的用法说明，让助手知道有这些能力。

### R5 不破坏现有保证

- 不改 `mountRemoteIframeFrontend`、`createInspectionBridge`、`runEphemeralTurn`、单会话串行、ephemeral save 隔离等既有机制。
- aria snapshot 全量替换 raw HTML，旧 `serializeDom` 函数删除（无降级路径）。
- `autoWait:false` 等价于现有"立即 querySelector + 不存在抛 INSPECT_SELECTOR_NOT_FOUND"行为，可降级。
- 新动作均在 same-origin `contentDocument` 内完成，不引入跨域/新执行通道。

## Acceptance Criteria

- [ ] `inspect_frontend()` 返回的 `domSummary` 是 aria snapshot YAML（role + name + 状态），不再是 raw HTML 树。
- [ ] aria snapshot 跳过隐藏/装饰节点，保留交互元素与内容容器的层级结构。
- [ ] `inspect_frontend({actions:[{type:"selectOption",selector:"#lang",value:"zh"}]})` 能选中 `<select>` 对应 option 并派发 change 事件。
- [ ] `inspect_frontend({actions:[{type:"check",selector:"#agree"}]})` 能勾选 checkbox；`checked:false` 能取消。
- [ ] `inspect_frontend({actions:[{type:"fill",selector:"#name",text:"新值"}]})` 能清空并填入文本。
- [ ] `inspect_frontend({actions:[{type:"hover",selector:"#menu"}]})` 能触发 hover 态（CSS/JS 响应）。
- [ ] `inspect_frontend({actions:[{type:"focus",selector:"#input"}]})` 能聚焦元素。
- [ ] `autoWait:true`（默认）时，action 前等元素可操作；元素延迟出现能等到；超时报 `INSPECT_WAIT_TIMEOUT` 而非静默失败。
- [ ] `autoWait:false` 时退回现有"立即查询，不存在抛 INSPECT_SELECTOR_NOT_FOUND"行为。
- [ ] 连续两次 inspect 的 `diff` 在 aria YAML 格式下仍正确反映结构层增删变化。
- [ ] `inspectFrontendSchema` 的 enum 与 properties 含所有新增动作与参数；文本协议示例含新动作用法。
- [ ] 现有 inspect_frontend 测试（send/actions/refresh/observeBetween/diff）在新格式下不回归。

## Out of Scope

- **任意网页/跨域前端**：本任务只增强 packaged（同源）前端自检。任意网页观察走 `06-23-web-layout-observer-userscript` 任务，不在此处理。
- **截图**：仍为延后项（`screenshot` 传 true 报 not-supported），同源 `html2canvas` 不稳，design 已标由玩家手动截图代替。
- **工具拆分 / browser session**：不引入。仍是 single-tool 闭环，actions[] 在一次调用内顺序执行。工具族拆分留待未来"无人值守操作任意网页"需求。
- **网络拦截 / 控制台网络请求列表 / 多标签页**：均属 Playwright 级能力，超出本任务范围。
