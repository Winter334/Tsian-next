# Design — inspect_frontend action集扩展与aria快照

## 1. 架构总览

```
inspect_frontend(input)                                    [platform-host/frontend-inspector.ts]
  ├─ mount + 等握手（不变）
  ├─ send 回合编排（不变）
  ├─ actions[] 执行（auto-waiting 前置 + 扩展动作集）         [§3 扩展]
  │    └─ waitForActionable(selector) → applyAction(doc, action)   [§3.1/§3.2]
  ├─ 采集结构层                                              [§2 重构]
  │    └─ collectAriaSnapshot(doc) → aria YAML（替换 serializeDom）
  ├─ computedStyles / renderedText（不变）
  ├─ diff（行级 Set diff，YAML 每行一节点，兼容）            [§2.4]
  └─ dispose（不变）
```

核心：**结构层采集函数替换 + action 分支扩展 + auto-waiting 前置**。不动 mount/bridge/ephemeral turn/单会话串行等既有机制。新逻辑集中在 `frontend-inspector.ts` 两个区域：`collectStructure` 调用链（§2）和 `applyAction` + action 执行前等待（§3）。

## 2. aria snapshot 结构层（替换 serializeDom）

### 2.1 序列化函数替换

删除 `serializeDom`（`frontend-inspector.ts:978`），新增 `serializeAria`：

```ts
function serializeAria(root: Element, maxDepth: number): string {
  const lines: string[] = []
  walkAria(root, 0, lines, maxDepth)
  return lines.join("\n")
}

function walkAria(el: Element, depth: number, out: string[], maxDepth: number): void {
  if (depth > maxDepth) return
  if (!isRelevantForAria(el)) return          // 跳隐藏/装饰节点（§2.2）
  const role = computeAriaRole(el)
  const name = computeAccessibleName(el)
  const state = computeAriaState(el)
  const indent = "  ".repeat(depth)
  const label = name ? ` "${name}"` : ""
  const stateStr = state ? ` [${state}]` : ""
  out.push(`${indent}- ${role}${label}${stateStr}`)
  for (const child of Array.from(el.children)) {
    walkAria(child, depth + 1, out, maxDepth)
  }
}
```

输出形如：
```
- main
  - heading "登录" [level=1]
  - textbox "用户名"
  - textbox "密码"
  - button "提交" [disabled]
  - link "忘记密码"
```

### 2.2 节点过滤（isRelevantForAria）

跳过以下节点（不进 aria 树）：
- `display:none` / `visibility:hidden`（`getComputedStyle` 判断）
- `aria-hidden="true"`
- `hidden` 属性
- 纯装饰：`<script>`/`<style>`/`<link>`/`<meta>`/`<head>` 及其子
- 空文本节点（aria 只走 element，文本由 accessible name 承载）

保留：所有未跳过的 element，role 由 `computeAriaRole` 算（显式 `role` 属性优先，否则按 tag 隐式映射）。

### 2.3 role / name / state 计算

**role（computeAriaRole）**：
1. 显式 `role` 属性存在且合法 → 用它。
2. 否则按 tag 隐式映射：`button`→`button`、`a[href]`→`link`、`input[type=checkbox]`→`checkbox`、`input[type=radio]`→`radio`、`input[type=text]/[notype]`→`textbox`、`textarea`→`textbox`、`select`→`combobox`、`h1-h6`→`heading`、`ul`→`list`、`li`→`listitem`、`nav`→`navigation`、`img`→`img`、`p`→`paragraph`、`div/span`→`generic`（generic 不进输出，但递归其子）。
3. 无映射 → `generic`（输出行 `- generic "name" "。

**accessible name（computeAccessibleName）**，优先级：
1. `aria-label`
2. `aria-labelledby`（查 ref 元素 textContent）
3. `<input>`/`<textarea>`/`<select>`：`<label for>` 关联文本 / `placeholder` / `title`
4. `<img>`：`alt` / `title`
5. **"name from contents"型元素**（button/link/heading/listitem/cell/columnheader + 显式 role 为 button/link/heading/menuitem/tab/option 等）：textContent（裁剪）
6. **容器型元素**（main/section/article/nav/div/span/p/form/table 等）：**不从子文本累积 name** — 容器的 name 只来自 aria-label/labelledby，否则会把所有后代文本碾进容器 name，塌缩子结构（测试发现的缺陷 A）
7. 无 → 空字符串（不输出 name 部分）

**generic 标识（computeGenericIdentifier）**：generic 节点输出时附 ` #id` 或 ` .首个语义class`，让助手能定位 `.user-msg`/`.msg-body` 等结构容器。跳过通用 class（flex/hidden/grid 等 util class）。完全折叠 generic 会导致 div 容器结构丢失（测试发现的缺陷 B）。

**state（computeAriaState）**，组合输出 `[key=val key=val]`：
- `disabled`：`el.disabled` 或 `aria-disabled="true"`
- `checked`：`el.checked`（checkbox/radio）或 `aria-checked`
- `expanded`：`aria-expanded`
- `level`：`h1-h6` 的数字 / `aria-level`
- `required`：`el.required` 或 `aria-required="true"`
- `selected`：`<option selected>` / `aria-selected`
- `readonly`：`el.readOnly` 或 `aria-readonly`

### 2.4 diff 兼容

`computeDiff`（`frontend-inspector.ts:466`）对 `domSummary` 做**行级 Set diff**：
```ts
const prevLines = new Set(prev.structure.domSummary.split("\n"))
const currLines = new Set(curr.structure.domSummary.split("\n"))
```
aria YAML 每行一个节点（`- role "name" [state]`），行级 Set diff 天然成立——新增/移除的节点即新增/移除的行。无需改 `computeDiff`。

### 2.5 常量调整

- `MAX_DOM_DEPTH=8` → 保留（aria 树通常比 HTML 树浅，因 generic 不输出，8 层够）。
- `MAX_DOM_SUMMARY=8000` → 保留（截断逻辑不变）。
- 删除 `MAX_DOM_TEXT`/`MAX_ATTR_VALUE`（aria 不输出 attribute 原文，由 name/state 承载语义；name 截断用新常量 `MAX_ARIA_NAME=80`）。
- `KEY_SELECTORS`（`collectKeyComputedStyles` 用）→ 保留不变，computedStyle 采集与 aria 独立。

### 2.6 collectStructure 改动

```ts
function collectStructure(doc, bridgeReady): InspectFrontendStructure {
  if (!doc || !doc.body) { /* 空态，不变 */ }
  const domSummary = serializeAria(doc.body, MAX_DOM_DEPTH).slice(0, MAX_DOM_SUMMARY)  // 替换 serializeDom
  const computedStyles = collectKeyComputedStyles(doc)   // 不变
  const renderedText = extractRenderedText(doc)          // 不变
  return { domSummary, computedStyles, renderedText, bridgeState: bridgeReady ? "ready" : "loading" }
}
```

## 3. action 集扩展 + auto-waiting

### 3.1 auto-waiting 前置

在 `applyAction`（`frontend-inspector.ts:502`）调用前加等待。改 actions 执行循环（`frontend-inspector.ts:331`）：

```ts
for (let step = 0; step < input.actions.length; step += 1) {
  const action = input.actions[step]!
  if (input.autoWait !== false) {                          // 默认 true
    const ok = await waitForActionable(doc, action.selector, ACTION_WAIT_TIMEOUT_MS)
    if (!ok) {
      throw toolError("INSPECT_WAIT_TIMEOUT", `等待选择器可操作超时：${action.selector}`, { selector: action.selector, timeoutMs: ACTION_WAIT_TIMEOUT_MS })
    }
  }
  applyAction(doc, action)
  // observeBetween 逻辑不变
}
```

**waitForActionable 实现**：
```ts
const ACTION_WAIT_TIMEOUT_MS = 1000

async function waitForActionable(doc: Document, selector: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const el = doc.querySelector(selector)
    if (el && isActionable(el)) return true
    await new Promise((r) => requestAnimationFrame(r))     // 同源 iframe 内 rAF 可用
  }
  return false
}

function isActionable(el: Element): boolean {
  if (!("style" in el)) return false                    // duck-type 代替 instanceof(跨 realm 安全)
  if (el.getAttribute("aria-hidden") === "true") return false
  if (el.hasAttribute("hidden")) return false
  if ((el as HTMLElement).style.display === "none") return false   // inline display:none 快速路径
  const win = el.ownerDocument?.defaultView              // iframe 自己的 window,同 realm getComputedStyle 稳定
  if (win) {
    const style = win.getComputedStyle(el)
    if (style.display === "none" || style.visibility === "hidden") return false
  }
  return true                                            // 不等 enabled(自检场景需操作初始 disabled 元素)
}
```

**跨 realm 注意**：el 来自 iframe document，`el instanceof HTMLElement`（父窗口的）会返 false。用 `"style" in el` duck-type 代替。`getComputedStyle` 用 `el.ownerDocument.defaultView`（iframe 自己的 window）调用，同 realm 稳定——不是跨 realm 问题，`instanceof` 才是。

**不等 enabled 的理由**：自检场景助手可能要操作/观测初始 disabled 的元素（如默认前端 `#send` 按钮在 bridge ready 前是 disabled，`#input` textarea 初始也 disabled）。若 auto-waiting 等 enabled，这些元素永远等不到（隐藏 iframe 的 bridge 握手可能不完整），导致 `INSPECT_WAIT_TIMEOUT` 假阴性。disabled 元素也允许 action 执行（`applyAction` 各 case 按需处理，如 click 仍派发事件）。

不挂 MutationObserver（rAF 轮询在 1000ms 内足够，且实现更简单；MutationObserver 在 iframe 内跨 same-origin 可用但增加复杂度，初版不做）。

`autoWait:false` 时跳过等待，直接 `applyAction`（内部 querySelector 不存在抛 `INSPECT_SELECTOR_NOT_FOUND`，与现有行为一致）。

### 3.2 新增动作（applyAction case 分支）

`applyAction`（`frontend-inspector.ts:502`）现有 click/type/press/scroll 四个 case，新增：

**selectOption**：
```ts
case "selectOption": {
  if (!(el instanceof HTMLSelectElement)) {
    throw toolError("INSPECT_NOT_SELECT", `selectOption 目标不是 <select>：${action.selector}`)
  }
  if (action.value !== undefined) {
    el.value = action.value
  } else if (action.label !== undefined) {
    const opt = Array.from(el.options).find((o) => o.textContent?.trim() === action.label)
    if (!opt) throw toolError("INSPECT_OPTION_NOT_FOUND", `option 文本无匹配：${action.label}`)
    el.value = opt.value
  } else {
    throw toolError("INSPECT_SELECT_NO_VALUE", "selectOption 需 value 或 label 参数")
  }
  el.dispatchEvent(new Event("input", { bubbles: true }))
  el.dispatchEvent(new Event("change", { bubbles: true }))
  break
}
```

**check**：
```ts
case "check": {
  if (!(el instanceof HTMLInputElement) || !["checkbox", "radio"].includes(el.type)) {
    throw toolError("INSPECT_NOT_CHECKABLE", `check 目标不是 checkbox/radio：${action.selector}`)
  }
  el.checked = action.checked !== false                     // 默认 true，false=取消
  el.dispatchEvent(new Event("input", { bubbles: true }))
  el.dispatchEvent(new Event("change", { bubbles: true }))
  break
}
```

**fill**：
```ts
case "fill": {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.value = action.text ?? ""                            // 清空后填入（区别 type 的追加）
  } else if (el.isContentEditable) {
    el.textContent = action.text ?? ""
  } else {
    throw toolError("INSPECT_NOT_FILLABLE", `fill 目标不可填：${action.selector}`)
  }
  el.dispatchEvent(new Event("input", { bubbles: true }))
  el.dispatchEvent(new Event("change", { bubbles: true }))
  break
}
```

**hover**：
```ts
case "hover": {
  el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true }))
  el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false, cancelable: true }))
  // 给一帧让 :hover CSS 应用，再 mouseout（可选，初版只 mouseover+mouseenter 触发 hover 态）
  break
}
```

**focus**：
```ts
case "focus": {
  if (el instanceof HTMLElement) {
    el.focus()
    el.dispatchEvent(new Event("focus", { bubbles: true }))
    el.dispatchEvent(new Event("focusin", { bubbles: true }))
  } else {
    throw toolError("INSPECT_NOT_FOCUSABLE", `focus 目标不可聚焦：${action.selector}`)
  }
  break
}
```

### 3.3 类型与校验扩展

**`InspectDomActionType`**（`workspace-tools.ts:149`）：
```ts
export type InspectDomActionType =
  | "click" | "type" | "press" | "scroll"
  | "selectOption" | "check" | "fill" | "hover" | "focus"
```

**`InspectDomAction`**（`:151`）加可选参数：
```ts
export interface InspectDomAction {
  type: InspectDomActionType
  selector: string
  text?: string                // type / fill
  key?: string                 // press
  to?: "top" | "bottom"        // scroll
  value?: string               // selectOption（按 option value）
  label?: string               // selectOption（按 option 文本）
  checked?: boolean            // check（默认 true）
}
```

**`InspectFrontendInput`**（`:162`）加 `autoWait`：
```ts
export interface InspectFrontendInput {
  // ... 现有字段
  autoWait?: boolean           // 默认 true，false 退回立即查询
}
```

**`INSPECT_DOM_ACTION_TYPES`**（`:1087`）Set 加新类型：
```ts
const INSPECT_DOM_ACTION_TYPES = new Set<InspectDomActionType>([
  "click", "type", "press", "scroll",
  "selectOption", "check", "fill", "hover", "focus",
])
```

**`normalizeInspectFrontendArguments`**（`:1127`）action 校验：
- type 校验枚举信息更新（`must be one of: click, type, press, scroll, selectOption, check, fill, hover, focus`）
- 加 `value`/`label`/`checked` 参数归一化（与 text/key/to 同模式，非空字符串/布尔才写入 action）
- 加 `autoWait` 布尔归一化（默认不设，执行侧 `!== false` 判断）

### 3.4 schema 扩展

**`inspectFrontendSchema`**（`tool-schemas.ts:120`）：
- `actions.items.properties.type.enum` 加新类型
- `actions.items.properties` 加 `value`/`label`/`checked` 字段
- 顶层 `properties` 加 `autoWait: { type: "boolean", description: "..." }`
- `actions.items.required` 仍 `["type", "selector"]`（新参数都可选）

### 3.5 文本协议说明同步

**`buildWorkspaceToolInstructions`**（`index.ts:783-784`）的 inspect_frontend 示例段：
```ts
`- ${RUNTIME_WORKSPACE_TOOL_NAMES.inspectFrontend} arguments={"send":{"message":"看一下当前前端渲染"}}`,
`- ${RUNTIME_WORKSPACE_TOOL_NAMES.inspectFrontend} arguments={"actions":[{"type":"click","selector":"#send"}],"observeBetween":true}`,
`- ${RUNTIME_WORKSPACE_TOOL_NAMES.inspectFrontend} arguments={"actions":[{"type":"fill","selector":"#name","text":"新值"},{"type":"selectOption","selector":"#lang","value":"zh"}]}`,
`- ${RUNTIME_WORKSPACE_TOOL_NAMES.inspectFrontend} arguments={"actions":[{"type":"hover","selector":"#menu"}],"refresh":true}`,
```
说明段（`:809`）补一句：`domSummary 返回 aria 快照（无障碍树 YAML，role+name+状态），actions 支持 selectOption/check/fill/hover/focus，默认 auto-waiting 等元素可操作。`

## 4. 改动文件清单

| # | 文件 | 改动 |
|---|---|---|
| 1 | `platform-host/frontend-inspector.ts` | 删 `serializeDom` + `MAX_DOM_TEXT`/`MAX_ATTR_VALUE`；加 `serializeAria`/`walkAria`/`computeAriaRole`/`computeAccessibleName`/`computeAriaState`/`isRelevantForAria`/`MAX_ARIA_NAME`；`collectStructure` 调 `serializeAria`；加 `waitForActionable`/`isActionable`/`ACTION_WAIT_TIMEOUT_MS` + actions 循环前置等待；`applyAction` 加 5 个 case |
| 2 | `agent-runtime/workspace-tools.ts` | `InspectDomActionType` 加 5 类型；`InspectDomAction` 加 `value`/`label`/`checked`；`InspectFrontendInput` 加 `autoWait`；`INSPECT_DOM_ACTION_TYPES` Set 扩；`normalizeInspectFrontendArguments` 加参数归一化 + 枚举信息更新 |
| 3 | `agent-runtime/tool-schemas.ts` | `inspectFrontendSchema` enum 扩 + 新参数字段 + `autoWait` 顶层字段 |
| 4 | `agent-runtime/index.ts` | `buildWorkspaceToolInstructions` inspect_frontend 示例 + 说明段补 aria/autoWait/新动作 |

4 处文件，无新增文件、无契约层改动（`InspectDomAction`/`InspectFrontendInput` 是 workspace-tools.ts 内部类型，非 contracts 导出）。

## 5. 数据流

- **入参**：`InspectFrontendInput`（增 `autoWait`，actions 增新 type + `value`/`label`/`checked`）
- **采集出参**：`InspectFrontendStructure.domSummary` 从 raw HTML → aria YAML（字段名不变，内容格式变）
- **错误码新增**：`INSPECT_WAIT_TIMEOUT`/`INSPECT_NOT_SELECT`/`INSPECT_OPTION_NOT_FOUND`/`INSPECT_SELECT_NO_VALUE`/`INSPECT_NOT_CHECKABLE`/`INSPECT_NOT_FILLABLE`/`INSPECT_NOT_FOCUSABLE`
- **不变**：`InspectFrontendResult` 结构、capability 签名、单会话串行、ephemeral turn、diff 逻辑（行级 Set diff 对 YAML 成立）

## 6. 不破坏现有的保证

- 不改 `mountRemoteIframeFrontend` / `createInspectionBridge` / `runEphemeralTurn` / `disposeCurrentSession` / ephemeral save 隔离。
- aria 全量替换，旧 `serializeDom` 删除——无外部调用方依赖旧格式（domSummary 是工具结果字段，只喂给 LLM，无代码反序列化它）。
- `autoWait:false` 等价现有行为（立即 querySelector + 不存在抛 `INSPECT_SELECTOR_NOT_FOUND`）。
- 新动作全在 same-origin `contentDocument` 内，不引入跨域/Worker/新执行通道。
- diff 跨格式不连续（升级前 HTML vs 升级后 YAML）——但 `lastInspectSnapshot` 是模块级运行时状态，页面刷新即重置，不存在"跨升级 diff"的实际场景。

## 7. 风险与回退

- **aria role 映射不全**：隐式映射表可能漏冷门 tag/role。初版覆盖常见交互+容器元素，漏的回退 `generic`（递归子，不输出噪声）。后续按 inspect 实际输出补映射。
- **accessible name 算法简化**：未实现完整 WAI-ARIA name calculation（递归-labelledby、name from contents 等），初版覆盖 `aria-label`/`labelledby`/`placeholder`/`textContent`/`alt` 主路径。漏的回退空 name，不影响 role + 层级信息。
- **auto-waiting 超时假阴性**：1000ms 对慢渲染前端可能不够。`ACTION_WAIT_TIMEOUT_MS` 设为常量，后续可调或暴露成参数。
- **回退**：整块是 `frontend-inspector.ts` 内函数替换 + workspace-tools 类型扩展。出问题可 revert 该文件 aria 段（恢复 serializeDom）或注释掉新 case 分支，不影响 platform 其他功能。
