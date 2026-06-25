# Design: 游戏前端与桌面助手工具调用过程显示优化

## 1. 架构边界

四层改动，严格分层，不越界：

```
┌─ runtime 层 (workspace-tools.ts) ──────────────────────────┐
│  summarizeToolObservationOutput: 去截断 + agent_call 结构化  │
│  不动 formatRuntimeWorkspaceToolObservationMessage (model 路径)│
└──────────────────────────┬─────────────────────────────────┘
                           │ onTool(callId, name, status, output)
┌─ 契约层 (contracts/bridge.ts) ─────────────────────────────┐
│  turn-tool payload.output: string → string | 结构化对象      │
└──────────────────────────┬─────────────────────────────────┘
                           │ turn-tool 事件 (bridge 转发 / 直传)
        ┌──────────────────┴──────────────────┐
        ▼                                     ▼
┌─ 默认游戏前端 ───────────┐         ┌─ 桌面助手 ──────────────┐
│ (default-frontend-files) │         │ (AssistantView +         │
│ 过程区跨 turn 内存保留    │         │  useAssistantTimeline)   │
│ agent_call 显 title+resp │         │ output UI 侧截断         │
│ 普通工具只显状态          │         │ agent_call 显 title+resp │
└──────────────────────────┘         └──────────────────────────┘
```

**不触碰的边界**（master 上下文安全保证）：
- `formatRuntimeWorkspaceToolObservationMessage`（喂回模型）——本任务不动，冗余包装是单独技术债（`docs/active/tool-result-structure-followup.md`）。
- `appendTurnToContext` / `compressContext`（master 持久化上下文）——从不存工具调用，本任务不碰。
- trace 落盘 + `REMOTE_RESOURCE_FORBIDDEN`——保持现状。

## 2. 决策点 1：过程区跨 turn 保留机制

### 现状问题

默认游戏前端（`default-frontend-files.ts`）的 DOM 编排：
- `beginTurn()`：建 `process-zone`（过程节点）+ `streaming-msg`（流式正文）。
- `handleSnapshot()`（L638）：`$story.innerHTML = ""` 清空整个 `story-inner`，重建只含 user/assistant 正文的消息列表。过程区被抹掉。
- `finalizeTurn()`（L601）：折叠过程节点，但此时过程区已是游离节点，重渲染无视觉效果（死代码）。

### 参考已有实现

桌面助手已实现"跨 turn 保留"（`useAssistantTimeline.ts` + `AssistantView.vue`）：
- `timeline` 是 assistant message 上的响应式数组，`finalize()` 只折叠不删。
- 渲染时 `msg.timeline` 平铺在正文框之前（`AssistantView.vue:223-291`），各节点独立折叠。
- 每条 assistant message 独立持有自己的 timeline，天然跨 turn 累积。

### 方案：会话级过程累积数组

游戏前端是原生 JS（非 Vue），无法用响应式数组，但可借鉴同构思路：

1. **新增会话级累积数组** `turnProcessLog`：存所有已完成 turn 的过程节点（thought/tool/interim），按 turn 分组。
2. **`handleSnapshot` 改为只重建正文区**：不再 `$story.innerHTML = ""` 全清。改为：
   - 保留或重建一个稳定的"过程历史区"（渲染 `turnProcessLog`）。
   - snapshot 的 messages 渲染为"正文区"（当前 turn 正文 + 历史）。
   - 两个区在 `story-inner` 内顺序排列：过程历史区在前，正文区在后（或按 turn 交织——见下方权衡）。
3. **`finalizeTurn` 改为将当前 `turnState.timeline` 推入 `turnProcessLog`**：而非折叠游离节点。

### 渲染交织策略（权衡）

两种排列：

**A. 分区式**（过程区在前，正文区在后）：
- 实现简单：过程历史区一次性渲染所有 turn 的过程节点，正文区渲染 snapshot messages。
- 缺点：过程与正文在视觉上分离，不按 turn 交织，读起来需要上下对照。

**B. 按 turn 交织**（每个 turn 的过程节点紧跟该 turn 正文）：
- 视觉连贯：过程→正文→下一 turn 过程→下一 turn 正文。
- 实现较复杂：需要把 `turnProcessLog` 和 `snapshot.messages` 按 turn 号合并排序渲染。
- 但 snapshot 的 messages 没有 turn 号（`ConversationMessageRecord` 无 turn 字段），需用累积的 turn 计数对齐。

**推荐 B**，与桌面助手的"timeline 平铺在正文前"语义一致，且玩家阅读顺序自然。实现上：维护一个 `renderedTurns` 结构，每个 turn 条目含 `{ processNodes[], userContent, assistantContent }`，`handleSnapshot` 时用 snapshot messages 回填各 turn 的正文。

### 不持久化（方案 A 约束）

`turnProcessLog` 是纯内存变量，刷新页面 / 重开存档 → 重建为空，只剩 snapshot 正文。符合 PRD R2。

## 3. 决策点 2：agent_call 结构化 payload 形态

### 现状

`turn-tool` 契约 payload（`bridge.ts:139-147`）：
```ts
{ agentId, turn, round, callId, name, status, output?: string }
```
`output` 是 `string`，agent_call 的 output 是整坨 `JSON.stringify({status, targetAgent, historyMode, metadata, response})` 截断 500 字。

### 方案：output 扩展为 discriminated union

```ts
// 普通工具：output 保持 string（但现在不截断，完整透传）
// agent_call：output 变成结构化对象
type TurnToolOutput =
  | string                                    // 普通工具的原始 output
  | {                                          // agent_call 结构化
      type: "agent_call"
      targetAgent: { title: string; summary?: string }
      response: string                         // 被调用 agent 的完整回复
      status: "completed" | "failed"
      error?: { code: string; message: string } // failed 时
    }

// 契约 payload 调整
| {
    agentId: string; turn: number; round: number
    callId: string; name: string
    status: "loading" | "running" | "success" | "failed"
    output?: TurnToolOutput                    // string → TurnToolOutput
  }
```

### runtime 层产出（`workspace-tools.ts`）

`summarizeToolObservationOutput` 改造：
- **普通工具**：不再截断，直接 `JSON.stringify(result)` 或 `String(result)` 完整返回（string 类型）。
- **agent_call**（`call.name === "agent_call"`）：解析 observation.result，提取 `{type:"agent_call", targetAgent:{title,summary}, response, status, error?}` 结构化对象返回。不截断 `response`。
- agent_call 失败时：`status:"failed"`，`error` 从 `observation.error` 提取。

### 前端渲染分流

默认游戏前端 `createProcessNode`（L470）和桌面助手 `AssistantView.vue:256` 的 tool 节点渲染：
- 检测 `output` 类型：`typeof output === "string"` → 普通工具（按 R2 普通工具统一不显 output，仅显状态）。
- `typeof output === "object" && output.type === "agent_call"` → agent_call 卡片：显示 `targetAgent.title` 作为标签，`response` 作为可展开正文，UI 侧截断/折叠。
- agent_call failed：显示 error.message。

### 契约兼容性

`output?: string` → `output?: TurnToolOutput`（string | object）：
- **远程前端**：第三方远程前端如果按 `typeof output === "string"` 处理，收到 object 会进入未知分支。但 `turn-tool` 事件是过程展示旁路，不影响 RPC 响应；远程前端可选择忽略 object output 或自行适配。契约版本未升（仍是 `tsian.play-bridge.v1`），属容忍性扩展。
- **桌面助手**：同源代码，同步改。
- **向后兼容**：若旧前端收到 object output，最坏情况是 tool 卡片不显示 output（不影响功能），因为 object 不会匹配 `node.output` 的 string 渲染路径。

## 4. 数据流（改动后）

### 游戏前端路径
```
runtime executeRuntimeWorkspaceToolCall
  → observation (完整 result)
  → summarizeToolObservationOutput(observation)
      ├─ 普通工具: String(result) 完整，不截断
      └─ agent_call: {type:"agent_call", targetAgent, response, status} 结构化
  → context.onTool(callId, name, status, output)
  → emitTurnTool(agentId, turn, round, callId, name, status, output)
  → subscribeTurnTool (remote-iframe-bridge)
  → postEvent("turn-tool", {agentId, turn, round, callId, name, status, output})
  → iframe 收到 turn-tool 事件
  → handleEvent("turn-tool", payload)
  → upsertToolNode(timeline, payload)  // output 存入节点
  → renderProcessNodes()
  → [turn-completed] handleSnapshot
      → turnState.timeline 推入 turnProcessLog（内存累积）
      → 只重建正文区，过程区保留
```

### 桌面助手路径
```
runtime → onTool → useAssistantTimeline.onTool
  → timeline.push({type:"tool", ..., output})  // output 已是完整/结构化
  → finalize() 只折叠不删（已有，不变）
  → AssistantView 渲染 msg.timeline（已有框架）
  → tool 节点：output 是 object 且 type=agent_call → 显 title+response
              output 是 string → 统一不显（R3 对齐 R2）
```

## 5. 涉及文件

| 文件 | 改动 | 层级 |
|---|---|---|
| `apps/platform-web/src/agent-runtime/workspace-tools.ts` | `summarizeToolObservationOutput` 去截断 + agent_call 结构化 | runtime |
| `packages/contracts/src/bridge.ts` | `turn-tool` payload `output` 类型扩展 | 契约 |
| `apps/platform-web/src/storage/default-frontend-files.ts` | 过程区跨 turn 保留 + 渲染分流 + 普通工具不显 output | 默认前端 |
| `apps/platform-web/src/views/AssistantView.vue` | tool 节点渲染分流（agent_call 显 title+response） | 桌面助手 |
| `apps/platform-web/src/composables/useAssistantTimeline.ts` | output 类型适配（string → string \| object） | 桌面助手 |

## 6. 权衡与风险

### 风险：output 体积膨胀
去截断后，大文件 read 的 output 可能很大，全部经 `turn-tool` 事件传到前端。
- **缓解**：R2 要求普通工具统一不显 output，前端不渲染 output 内容，但事件仍携带完整 output 到前端内存。
- **进一步缓解**：runtime 层对普通工具仍可保留一个较大的上限（如 10KB），只对 agent_call 完全不限。或前端收到后不存 output（只存 name/status）。design 倾向后者：普通工具前端根本不存 output 字段，只存 name+status，事件 payload 大小无关紧要。

### 风险：契约 output 类型扩展的兼容性
- 低风险：`turn-tool` 是过程展示旁路，不进 RPC 响应；旧前端收到 object 最坏是不显示，不 break 功能。
- 不升契约版本号（容忍性扩展）。

### 风险：过程区交织渲染复杂度
方案 B（按 turn 交织）需维护 turn 对齐。snapshot messages 无 turn 号，用累积计数对齐有 off-by-one 风险。
- **缓解**：implement 时先写单元测试覆盖 turn 对齐逻辑。

## 7. 不做的事（明确排除）

- native tool message content 冗余包装优化（`docs/active/tool-result-structure-followup.md`）。
- 工具过程跨加载持久化（方案 B/C）。
- trace 对前端开放。
- master 上下文装配任何改动。
- 契约版本号升级。
