# Implement — inspect_frontend action集扩展与aria快照

## 验证命令

```bash
# 类型检查（主要门）
cd apps/platform-web && npx vue-tsc --noEmit -p tsconfig.app.json

# 构建
cd apps/platform-web && npm run build

# 手动验证（dev 里，见下方各阶段验证步骤）
cd apps/platform-web && npm run dev
```

## 实现阶段（有序 checklist）

### Phase A — aria snapshot 结构层（替换 serializeDom）

目标：`inspect_frontend()` 的 `domSummary` 输出 aria YAML，不再是 raw HTML。先做采集层（最影响助手阅读体验的部分），动作扩展放 Phase B。

- [ ] A1 `platform-host/frontend-inspector.ts`：加 `MAX_ARIA_NAME=80` 常量；删 `MAX_DOM_TEXT`/`MAX_ATTR_VALUE`（aria 不用）
- [ ] A2 加 `isRelevantForAria(el)`：跳 `display:none`/`visibility:hidden`/`aria-hidden`/`hidden`/`<script>`/`<style>`/`<link>`/`<meta>`/`<head>`
- [ ] A3 加 `computeAriaRole(el)`：显式 `role` 属性优先 → tag 隐式映射（button/link/textbox/checkbox/radio/combobox/heading/list/listitem/navigation/img/paragraph）→ 无映射返 `generic`
- [ ] A4 加 `computeAccessibleName(el)`：`aria-label` → `aria-labelledby`（查 ref textContent）→ input 的 `<label for>`/`placeholder`/`title` → button/a/h* 的 textContent → img 的 alt/title → 空
- [ ] A5 加 `computeAriaState(el)`：组合 disabled/checked/expanded/level/required/selected/readonly，返 `[key=val key=val]` 字符串或空
- [ ] A6 加 `walkAria(el, depth, out, maxDepth)` + `serializeAria(root, maxDepth)`：`generic` role 递归子但不输出行；输出 `- role "name" [state]` 缩进行
- [ ] A7 `collectStructure`（`:955`）：`serializeDom(doc.body, 0)` 替换为 `serializeAria(doc.body, MAX_DOM_DEPTH)`；`.slice(0, MAX_DOM_SUMMARY)` 不变
- [ ] A8 删 `serializeDom`（`:978`）及其辅助（`MAX_DOM_TEXT` 引用清除）
- [ ] A9 验证：vue-tsc 通过；dev 起，inspect_frontend() 无 actions 调用，`domSummary` 返回 aria YAML（含 role+name+state 的缩进行），不再是 `<div ...>` HTML 树；对带表单的默认前端能看到 `textbox`/`button`/`heading` 等节点

### Phase B — action 集扩展（类型 + 校验 + 实现）

目标：`inspect_frontend({actions:[...]})` 支持 selectOption/check/fill/hover/focus。

- [ ] B1 `agent-runtime/workspace-tools.ts:149` `InspectDomActionType` 加 `"selectOption"|"check"|"fill"|"hover"|"focus"`
- [ ] B2 `:151` `InspectDomAction` 加 `value?: string`/`label?: string`/`checked?: boolean`
- [ ] B3 `:1087` `INSPECT_DOM_ACTION_TYPES` Set 加 5 新类型
- [ ] B4 `:1127` `normalizeInspectFrontendArguments` action 校验：type 枚举错误信息更新（`must be one of: click, type, press, scroll, selectOption, check, fill, hover, focus`）；加 `value`/`label`/`checked` 归一化（非空 string/boolean 才写入，镜像 text/key/to 模式）
- [ ] B5 `platform-host/frontend-inspector.ts:502` `applyAction` 加 5 个 case：selectOption（HTMLSelectElement value/label 匹配 + input/change）、check（checkbox/radio checked + input/change）、fill（input/textarea/contenteditable 清空填入 + input/change）、hover（mouseover+mouseenter）、focus（el.focus + focus/focusin）
- [ ] B6 每个新 case 的目标类型不匹配抛对应错误码：`INSPECT_NOT_SELECT`/`INSPECT_NOT_CHECKABLE`/`INSPECT_NOT_FILLABLE`/`INSPECT_NOT_FOCUSABLE`/`INSPECT_OPTION_NOT_FOUND`/`INSPECT_SELECT_NO_VALUE`
- [ ] B7 验证：vue-tsc 通过；inspect({actions:[{type:"fill",selector:"#input",text:"新值"},{type:"selectOption",selector:"#lang",value:"zh"}]}) 能执行；inspect({actions:[{type:"hover",selector:"#menu"}]}) 触发 hover 态；inspect({actions:[{type:"check",selector:"#agree"}]}) 勾选；inspect({actions:[{type:"focus",selector:"#input"}]}) 聚焦；type 类型不匹配抛对应错误码

### Phase C — auto-waiting 前置

目标：action 执行前等元素可操作，减少"渲染没跟上"的假阴性。

- [ ] C1 `platform-host/frontend-inspector.ts` 加 `ACTION_WAIT_TIMEOUT_MS=1000` 常量
- [ ] C2 加 `isActionable(el)`：HTMLElement + `getComputedStyle` 非 none/hidden + 非 disabled/aria-disabled + 非 aria-hidden
- [ ] C3 加 `waitForActionable(doc, selector, timeoutMs)`：rAF 轮询 `querySelector` + `isActionable`，超时返 false
- [ ] C4 actions 执行循环（`:331`）：`if (input.autoWait !== false) { const ok = await waitForActionable(...); if (!ok) throw toolError("INSPECT_WAIT_TIMEOUT", ...) }` 前置于 `applyAction`
- [ ] C5 `agent-runtime/workspace-tools.ts:162` `InspectFrontendInput` 加 `autoWait?: boolean`
- [ ] C6 `normalizeInspectFrontendArguments`：加 `autoWait` 布尔归一化（`typeof input.autoWait === "boolean"` 才写入）
- [ ] C7 `agent-runtime/tool-schemas.ts:120` `inspectFrontendSchema` 顶层 `properties` 加 `autoWait: { type:"boolean", description:"Wait for action targets to be actionable before executing (default true)." }`
- [ ] C8 验证：inspect({actions:[{type:"click",selector:"#late-button"}]}) 对延迟渲染的按钮能等到并点击；超时报 `INSPECT_WAIT_TIMEOUT`（非 `INSPECT_SELECTOR_NOT_FOUND`）；inspect({actions:[...],autoWait:false}) 退回立即查询行为

### Phase D — schema + 文本协议同步

目标：助手知道有新动作和 aria 格式。

- [ ] D1 `agent-runtime/tool-schemas.ts:143` `inspectFrontendSchema.actions.items.properties.type.enum` 加 5 新类型
- [ ] D2 `:145` 附近 `actions.items.properties` 加 `value`/`label`/`checked` 字段定义
- [ ] D3 `agent-runtime/index.ts:783-784` `buildWorkspaceToolInstructions` inspect_frontend 示例段加 fill/selectOption/hover 示例
- [ ] D4 `:809` 说明段补：`domSummary 返回 aria 快照（无障碍树 YAML，role+name+状态）；actions 支持 selectOption/check/fill/hover/focus；默认 auto-waiting 等元素可操作（autoWait:false 关闭）`
- [ ] D5 验证：vue-tsc + build 通过；assistant enabled tool schema（native 模式）含新 enum 值 + autoWait；文本协议说明含 aria + 新动作描述

### Phase E — diff 兼容验证 + 收尾

目标：确认 aria YAML 格式下 diff 仍成立，全量验收。

- [ ] E1 验证 diff：连续两次 inspect（中间改前端文件），第二次结果 `diff.added`/`diff.removed` 正确反映 aria YAML 行级增删（新增节点=新增行，移除节点=移除行）——`computeDiff` 不改，确认其行级 Set diff 对 YAML 成立
- [ ] E2 验证截断：对超深/超大前端，aria snapshot 超 `MAX_DOM_SUMMARY` 截断并标 `truncated:true`
- [ ] E3 验证降级：`autoWait:false` 时退回立即查询 + 不存在抛 `INSPECT_SELECTOR_NOT_FOUND`（与升级前一致）
- [ ] E4 验证不破坏既有：inspect({send:{message:"..."}}) 回合编排不变；inspect({refresh:true}) 拉最新 snapshot 不变；observeBetween 步间快照返 aria 格式；单会话串行不变（连续两次 inspect 第二次 dispose 第一次）
- [ ] E5 完整 vue-tsc + build 通过
- [ ] E6 全量 acceptance criteria 逐条验证（见 prd.md）

## 验证门 / Review Gates

- **A 阶段后**：aria snapshot 能输出、vue-tsc 过 → 确认采集层方向对再继续
- **B 阶段后**：5 个新动作能执行、错误码正确 → 确认动作面闭合
- **C 阶段后**：auto-waiting 生效 + 降级正确 → 确认鲁棒性
- **E 阶段后**：全量验收 → 确认不回归

## 回滚点

- Phase A 出问题：revert `frontend-inspector.ts` 的 aria 段，恢复 `serializeDom`（git 单文件 revert）
- Phase B/C 出问题：注释掉 `applyAction` 新 case / auto-waiting 前置块，inspect 退回原 4 动作 + 立即查询
- Phase D 出问题：schema/说明同步是声明性改动，不影响运行时，可独立 revert

## 注意事项

- **aria role 映射表**：初版覆盖常见交互+容器，冷门 tag 回退 `generic`（递归子不输出噪声）。实际 inspect 输出后再按需补映射，不追求一步到位。
- **accessible name 简化**：未实现完整 WAI-ARIA name calculation，覆盖 `aria-label`/`labelledby`/`placeholder`/`textContent`/`alt` 主路径即可。漏的回退空 name，不影响 role+层级。
- **auto-waiting 用 rAF 不用 MutationObserver**：1000ms 内 rAF 轮询足够，实现简单。MutationObserver 在 iframe 内跨 same-origin 可用但增复杂度，初版不做。
- **hover 只派发 mouseover+mouseenter**：不派发 mouseout（避免误触移出态）。CSS `:hover` 由 mouseover 触发应用，够用。
- **fill vs type 语义**：fill 是清空后整体替换（对齐 Playwright fill），type 是追加派发 key 事件。两者共存，不互相替代。
