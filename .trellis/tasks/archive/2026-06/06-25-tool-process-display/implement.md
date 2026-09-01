# Implement: 游戏前端与桌面助手工具调用过程显示优化

## 执行顺序

按依赖方向自底向上：契约 → runtime → 默认前端 → 桌面助手。每步完成即验证类型。

### Step 1: 契约层 — turn-tool payload output 类型扩展

**文件**: `packages/contracts/src/bridge.ts`

- 新增 `TurnToolOutput` 类型（discriminated union: string | agent_call 结构化对象）。
- `turn-tool` payload 的 `output?: string` 改为 `output?: TurnToolOutput`。
- agent_call 结构化对象形态见 design.md §3。

**验证**:
```bash
npm run build:contracts
```

**review gate**: 确认 `TurnToolOutput` 的 agent_call 分支字段完整（type/targetAgent/response/status/error?），且 union 第一分支保持 string（向后兼容）。

### Step 2: runtime 层 — summarizeToolObservationOutput 去截断 + agent_call 结构化

**文件**: `apps/platform-web/src/agent-runtime/workspace-tools.ts`

- `summarizeToolObservationOutput`（L2063）改造：
  - 普通工具：去 `TURN_TOOL_OUTPUT_MAX_LENGTH` 截断，完整 `String(result)` / `JSON.stringify(result)` 返回。
  - agent_call（`call.name === "agent_call"` 且 `observation.ok`）：解析 `observation.result`，提取 `{type:"agent_call", targetAgent:{title,summary}, response, status:"completed"}` 返回。不截断 response。
  - agent_call failed：`{type:"agent_call", status:"failed", error:{code,message}}`。
- `TURN_TOOL_OUTPUT_MAX_LENGTH` 常量：保留（普通工具仍可用作可选上限，见风险缓解）或移除——实现时按实际决定。倾向移除，普通工具前端不存 output（Step 3），payload 大小无关紧要。
- **不动** `formatRuntimeWorkspaceToolObservationMessage`（L2350，model 路径）。
- **不动** `emitToolObservationTrace`（trace 路径，trace 仍用 `summarizeTraceValue` 自己的截断）。

**验证**:
```bash
npm run build:web
```

**review gate**: 确认 model 路径（`formatRuntimeWorkspaceToolObservationMessage`）一个字节没动。确认 agent_call 的结构化提取字段名与契约 `TurnToolOutput` 一致。

### Step 3: 默认游戏前端 — 过程区跨 turn 保留 + 渲染分流

**文件**: `apps/platform-web/src/storage/default-frontend-files.ts`

这是最大的改动块，分三个子步骤：

**3a. 过程区跨 turn 保留机制**
- 新增会话级 `turnProcessLog` 数组（每元素 = 一个 turn 的 `{turn, processNodes[]}`）。
- `finalizeTurn()`（L601）改为：将当前 `turnState.timeline` 推入 `turnProcessLog`（而非折叠游离节点）。
- `handleSnapshot()`（L638）改为：只重建正文区，不清过程历史区。按 design §2 方案 B（turn 交织）渲染：`turnProcessLog` 的过程节点 + snapshot messages 的正文按 turn 对齐交织。
- `renderMessages()`（L430）：调整为在过程历史区之后渲染正文（或交织渲染），不再 `$story.innerHTML = ""` 全清。
- **不持久化**：`turnProcessLog` 是纯内存，页面加载时初始化为空。

**3b. 渲染分流 — 普通工具 vs agent_call**
- `createProcessNode()`（L470）的 tool 节点 body 渲染（L502）：
  - `output` 是 string → 不渲染 output（普通工具统一不显，仅显 name + status 图标）。
  - `output` 是 object 且 `output.type === "agent_call"` → 渲染 `output.targetAgent.title` 作为标签补充，`output.response` 作为可展开 body（UI 侧截断/折叠）。
  - agent_call failed → 显 `output.error.message`。
- `upsertToolNode()`（L517）：`output` 字段类型从 string 适配为 string | object。

**3c. 过渡文本（interim）保留**
- interim 节点已作为 `turnState.timeline` 的一部分（`finalizeRound` L583），随 3a 的 `turnProcessLog` 推入自然保留，不当正文。确认渲染时 interim 仍用正文样式（现有 L231 `process-node.interim` 样式），不混入 snapshot messages。

**验证**:
```bash
npm run build:web
```
手动验证（dev server）：
- 触发含工具调用的 turn → 回复完成后工具卡片不消失。
- 触发 agent_call → 卡片显示被调用 agent title + response。
- 触发普通工具调用 → 卡片只显 name + 状态，不显 output。
- 刷新页面 → 只剩正文，过程消失。

**review gate**: 确认 `handleSnapshot` 不再 `$story.innerHTML = ""` 全清。确认 `turnProcessLog` 无任何 localStorage / IndexedDB 持久化。

### Step 4: 桌面助手 — agent_call 渲染分流 + output 适配

**文件**: `apps/platform-web/src/views/AssistantView.vue`, `apps/platform-web/src/composables/useAssistantTimeline.ts`

- `useAssistantTimeline.ts` `onTool`（L95）：`output` 参数类型从 `string` 适配为 `string | TurnToolOutput`。节点 `output` 字段同步。
- `AssistantView.vue` tool 节点渲染（L256-288）：
  - `node.output` 是 object 且 `type === "agent_call"` → 显 `targetAgent.title` + `response`（替换现有 `{{ node.output }}` 纯文本，L286）。
  - `node.output` 是 string → 统一不显（对齐 R3 与 R2 一致）。
  - agent_call failed → 显 error.message。
- `finalize()`（L168）已有"只折叠不删"——不变，timeline 跨 turn 保留已实现。

**验证**:
```bash
npm run build:web
```

**review gate**: 确认桌面助手普通工具 output 也统一不显（与游戏前端 R2 对齐）。

### Step 5: 全量验证

```bash
npm run build:contracts
npm run build:web
```

- type-check 通过（vue-tsc -b 含 contracts + platform-web）。
- 无 runtime 报错。

## 验证命令汇总

| 命令 | 覆盖 |
|---|---|
| `npm run build:contracts` | 契约层 type-check + build |
| `npm run build:web` | platform-web type-check (vue-tsc -b) + vite build，含 contracts 依赖 |

## 回滚点

- Step 1 (契约): 回滚 `output?: TurnToolOutput` → `output?: string`。
- Step 2 (runtime): 回滚 `summarizeToolObservationOutput` 恢复截断 + 整坨 JSON。
- Step 3 (默认前端): 回滚 `handleSnapshot` 全清 + `finalizeTurn` 折叠游离节点。
- Step 4 (桌面助手): 回滚 tool 节点 `{{ node.output }}` 纯文本渲染。

每步独立可回滚，无跨步强耦合（契约类型扩展是 superset，旧消费者容忍）。

## 风险文件

- `default-frontend-files.ts`：这是字符串数组拼成的 JS（每行一个数组元素），编辑时要保持数组语法完整性。改动量大，是最易出错的单点。
- `workspace-tools.ts:summarizeToolObservationOutput`：runtime 核心路径，改动要保证 agent_call 成功/失败两分支都覆盖。
