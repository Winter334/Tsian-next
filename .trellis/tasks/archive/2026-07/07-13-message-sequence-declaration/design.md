# Design：消息序列声明机制

## 架构概述

扩展 contextPaths 的 `ContextPathObject` 加 `position` 字段，让每条注入声明它在消息序列中的位置。编译时按 position 分组，消息构建时按骨架顺序组装。PREFILL.md 纳入 contextPaths 体系（`position: "tail"` + `role: "assistant"`），保留兼容读取。

## 消息序列骨架

改造后的完整消息序列（entry agent 路径）：

```
[system prompt]              ← 固定（AGENT.md + SOUL.md + 工具说明）
[before-history]             ← contextPaths position: "before-history"
[history]                    ← 固定（context snapshot / formatHistory 兜底）
[workspace-context]          ← contextPaths position 默认或 "workspace-context"
[tool memory]                ← 固定（task-mode 助手工具记忆）
[turn-runtime]               ← 固定（"当前回合：N"）
[before-input injection]     ← 前端 InjectionMessage position: "before-input"（现有）
[player input]               ← 固定
[after-input injection]      ← 前端 InjectionMessage position: "after-input"（现有）
[after-input]                ← contextPaths position: "after-input"
[tail]                       ← contextPaths position: "tail"
```

delegated agent_call 路径骨架类似，但固定层不同（调用方信息、调用请求等）。

## 数据契约变更

### ContextPathObject（`packages/contracts/src/runtime.ts`）

```ts
export type ContextPathPosition = "before-history" | "workspace-context" | "after-input" | "tail"

export interface ContextPathObject {
  path?: string
  template?: string
  role?: "system" | "user" | "assistant"
  position?: ContextPathPosition  // 新增，默认 "workspace-context"
}
```

### ContextInjection（`packages/contracts/src/runtime.ts`）

```ts
export interface ContextInjection {
  role: "system" | "user" | "assistant"
  content: string
  source: string
  position: ContextPathPosition  // 新增，编译时从 contextPath 条目携带
}
```

### AgentContextEntry（`packages/contracts/src/runtime.ts`）

```ts
export interface AgentContextEntry {
  // ... 现有字段不变 ...
  /** 按 position 分组的注入条目。 */
  contextInjectionsByPosition: Record<ContextPathPosition, ContextInjection[]>
  /** 保留 contextInjections（= workspace-context 组），向后兼容 buildDelegatedAgentMessages。 */
  contextInjections: ContextInjection[]
  /** PREFILL.md 兼容读取。有 tail contextPath 时此字段不使用。 */
  prefillFile?: WorkspaceFile  // 保留但不再在消息构建中直接消费
}
```

## 数据流

```
agent.json contextPaths[]
  ↓ registry.ts: parseContextPathEntries（解析 position，默认 workspace-context）
AgentRegistryEntry.contextPaths: ContextPathEntry[]
  ↓ context.ts: assembleAgentContext（编译每条 entry → ContextInjection + position）
AgentContextEntry.contextInjectionsByPosition: Record<position, ContextInjection[]>
  ↓ index.ts: buildEntryAgentMessages（按骨架顺序从各组取注入，逐条产出消息）
RuntimeChatMessage[]（可能含连续相同 role）
  ↓ index.ts: mergeConsecutiveRoleMessages（整合器：合并连续同 role 消息 + XML 标签分隔）
RuntimeChatMessage[]（无连续相同 role，Claude/Gemini 兼容）
```

## 消息整合器

### 设计

在消息序列发送给模型之前，过一遍整合器 `mergeConsecutiveRoleMessages(messages)`：
- 扫描消息数组，把连续相同 role 的消息合并成一条
- 合并时仅用换行拼接内容，**不加自动标签**——标签由作者在 contextPath 条目内容里显式写（与酒馆预设一致）
- 不连续的相同 role 不合并（如 `[system, user, system]` 保持三条）

### 为什么不加自动标签

酒馆预设大量使用跨条目标签和嵌套标签：
- **跨条目标签**：开标签在条目A，闭标签在条目B（如 `<Story setting>` 开在"故事设定"条目，闭在"故事设定结束"条目）。合并后自然形成完整标签块。
- **嵌套标签**：标签内含子标签（如 `<think_rules>` 内嵌 `<ai_last_output>` `<peip>` 等）。

自动加标签会破坏这两种模式——给只含开标签的条目再包一层，导致双重嵌套或结构错乱。正确做法是整合器只做 role 合并 + 换行拼接，标签完全由作者控制。

### 合并示例

```
输入（未合并，逐条消息）：
[system: AGENT.md + SOUL.md]
[assistant: 越狱确认复述内容]
[user: 早期剧情摘要内容]
[user: 玩家上轮输入]
[assistant: 上轮正文]
[user: meta 信息内容]
[user: writing-rules 内容]
[system: modules 内容]
[user: 当前回合：2]
[user: 玩家本轮输入]
[system: COT 框架内容（含 <cot>...</cot> 标签）]
[assistant: <think> 续写引导]

输出（合并连续同 role 后，纯换行拼接）：
[system: AGENT.md + SOUL.md]
[assistant: 越狱确认复述内容]
[user: 早期剧情摘要内容\n\n玩家上轮输入\n\n上轮正文]
[user: meta 信息内容\n\nwriting-rules 内容]
[system: modules 内容]
[user: 当前回合：2\n\n玩家本轮输入]
[system: COT 框架内容（含 <cot>...</cot> 标签）]
[assistant: <think> 续写引导]
```

跨条目标签在合并后自然闭合：如果条目A含 `<Story setting>` 开标签，条目B含世界书内容，条目C含 `</Story setting>` 闭标签，三者同 role 连续，合并后变成一条消息 `<Story setting>\n世界书内容\n</Story setting>`——完整标签块。

### 整合器调用时机

- **native 路径**：在 `callAgentModelWithWorkspaceToolsNative` 每轮调用 `callModelNative` 前整合
- **text 路径**：在 `callAgentModelWithWorkspaceTools` 每轮调用 `callModel` 前整合
- 工具循环内的 splice-replace 操作的是未整合的原始消息数组，整合器只负责最终发送前的合并
- `locateHistorySpan` 在未整合的数组上操作，不受整合器影响

## 关键实现细节

### 1. registry.ts — parseContextPathEntries

在现有解析逻辑中加 position 字段：
- 读取 `entry.position`
- 验证值在 4 个合法值内
- 非法值 → 默认 `"workspace-context"`
- 不写 position → 默认 `"workspace-context"`

### 2. context.ts — assembleAgentContext

遍历 contextPaths 时：
- 把 position 从条目携带到编译后的 `ContextInjection`
- 按 position 分组到 `contextInjectionsByPosition`（4 个数组）
- `contextInjections` 字段 = `contextInjectionsByPosition["workspace-context"]`（向后兼容）
- PREFILL.md 兼容迁移：
  - 如果 `contextInjectionsByPosition["tail"]` 为空且 PREFILL.md 文件存在 → 自动创建一条 `{ role: "assistant", content: prefillFile.content, source: "PREFILL.md (compat)", position: "tail" }` 加入 tail 组
  - 如果 tail 组已有条目 → 忽略 PREFILL.md

### 3. index.ts — buildEntryAgentMessages

`buildEntryAgentMessages` 继续逐条产出消息（每个 injection 一条消息），不做合并。合并由整合器在发送前统一处理。

每条注入消息用 source 前缀标注（供 locateHistorySpan 扫描和 debug 用）：

```ts
function contextInjectionsToMessages(
  injections: ContextInjection[],
): RuntimeChatMessage[] {
  return injections.map(inj => ({
    role: inj.role,
    content: `<!-- source: ${inj.source} -->\n${inj.content}`,
  }))
}
```

注意：前缀用 HTML 注释 `<!-- source: xxx -->` 而非之前的 `"Workspace 注入 xxx："` 文本前缀。注释在合并时被替换为 XML 标签，在未合并时也不影响模型理解（HTML 注释被模型视为元信息）。

改造 buildEntryAgentMessages 返回数组（逻辑不变，只是从 contextInjectionsByPosition 各组取注入）：

```ts
return [
  { role: "system", content: buildWorkspaceAgentSystemPrompt(...) },
  ...contextInjectionsToMessages(context.contextInjectionsByPosition["before-history"]),
  ...historyMessages,
  { role: "user", content: `${label}（元信息）：\n${formatAgentRuntimeContextMeta(context)}` },
  ...contextInjectionsToMessages(context.contextInjectionsByPosition["workspace-context"]),
  ...toolMemoryMessages,
  { role: "user", content: `${turnLabel}：${turn}` },
  ...beforeInputInjection,
  { role: "user", content: playerInput },
  ...afterInputInjection,
  ...contextInjectionsToMessages(context.contextInjectionsByPosition["after-input"]),
  ...contextInjectionsToMessages(context.contextInjectionsByPosition["tail"]),
]
```

### 3.5 index.ts — mergeConsecutiveRoleMessages（新增整合器）

```ts
function mergeConsecutiveRoleMessages(
  messages: RuntimeChatMessage[],
): RuntimeChatMessage[] {
  const result: RuntimeChatMessage[] = []
  for (const msg of messages) {
    const last = result[result.length - 1]
    if (last && last.role === msg.role) {
      // 合并：纯换行拼接，不加自动标签（标签由作者在内容里显式写）
      last.content += `\n\n${msg.content}`
    } else {
      result.push({ ...msg })
    }
  }
  return result
}
```

不加自动标签的理由：酒馆预设大量使用跨条目标签（开标签在条目A、闭标签在条目B）和嵌套标签。自动加标签会破坏这些结构。整合器只做 role 合并 + 换行拼接，标签完全由作者控制。

**调用时机**：在 native/text 两个工具循环中，每轮调用 model API 前对当前 messages 数组过一遍整合器。工具循环内的 splice-replace 操作原始数组，整合器只负责最终发送前的合并。

### 4. index.ts — locateHistorySpan 改造

当前逻辑（`index.ts:318-357`）：
- `start = 1`（硬编码，假设 history 紧随 system）
- 扫描锚点前缀找 `end`

改造后：
- `locateHistorySpan` 操作的是**未整合**的原始消息数组（整合器只在发送前调用）
- 从 index 1 开始扫描，跳过 before-history 注入消息，找到 history 段的 start
- 识别 before-history 注入消息：它们以 `<!-- source:` 注释开头（contextInjectionsToMessages 产出的格式）
- history sentinel 不变：`"最近对话："` / `"调用方 Agent："` / `"早期剧情摘要："` / `"（暂无历史对话）"`
- 具体算法：
  1. `start = 1`
  2. 如果 `messages[start]` 以 `"<!-- source:"` 开头 → `start++`，重复
  3. 否则 stop，当前 `start` 就是 history 段起点
- end 的扫描逻辑：现有锚点 `"Workspace Agent 上下文"` 改为新的 meta 消息前缀（meta 消息内容以 `"Workspace Agent 上下文"` 开头不变，因为 meta 消息不由 contextInjectionsToMessages 产出）

无 before-history 注入时：`messages[1]` 不以 `"<!-- source:"` 开头 → start 停在 1，行为不变。

### 5. index.ts — buildDelegatedAgentMessages 改造

delegated 路径同样支持 position 注入：
- before-history：在 system 和"调用方 Agent"之间
- workspace-context：现有位置（"目标 Agent 上下文"之后）
- after-input：在"调用请求"之后
- tail：消息序列末尾

delegated 路径的固定层不动：调用方信息、最近对话窗口、调用请求。

### 6. workspace-templates.ts — storyteller 配置改造

storyteller agent.json contextPaths 改为：

```json
{
  "contextPaths": [
    { "path": "agents/storyteller/prefill-accept.md", "role": "assistant", "position": "before-history" },
    "save/agents/storyteller/writing-styles.md",
    "save/agents/storyteller/writing-rules.md",
    { "template": "{{file:modules/*.md?enabled}}", "role": "system" },
    { "path": "agents/storyteller/cot-template.md", "role": "system", "position": "after-input" },
    { "template": "<think>\n嘿嘿，要求阅读完毕！起笔！\n", "role": "assistant", "position": "tail" }
  ]
}
```

新增文件：
- `agents/storyteller/prefill-accept.md`：从现有 `STORYTELLER_PREFILL_MD` 拆出越狱确认复述内容
- `agents/storyteller/cot-template.md`：COT 问题框架 + 输出格式硬模板

删除：`agents/storyteller/PREFILL.md` 文件条目（兼容读取会兜底，但显式配置 tail 后不依赖它）

### 7. local-assistant-files.ts — validateAgentConfig

校验 position 值在 4 个合法值内。

## 缓存影响分析

API prefix cache 按 token 序列前缀匹配，不按单条消息匹配。合并 vs 拆分对缓存命中效果一样——前缀匹配到变化点为止，不管变化点在一条消息内还是在消息边界上。

| position | 缓存影响 |
|---|---|
| before-history | 插在 system 和 history 之间。如果内容稳定（越狱确认等不变内容），system + before-history + history 仍是稳定前缀，缓存命中不受影响。**约束：before-history 只放稳定内容** |
| workspace-context | 现有行为不变 |
| after-input | 在 history 之后、turn-runtime 之后，本身就在缓存断点之后，无影响 |
| tail | 在消息末尾，不影响前缀缓存 |

### 消息合并的必要性

合并连续相同 role 消息是 Claude/Gemini API 的硬要求（不接受连续相同 role）。OpenAI 虽然接受但内部加隐式分割。合并后用 XML 标签分隔内容，比多条消息的前缀标注更紧凑、更省 token。

整合器在发送前统一合并，工具循环内部操作未合并的原始数组，互不干扰。

## 兼容性

| 场景 | 行为 |
|---|---|
| 现有 agent 无 position 声明 | 全部默认 workspace-context，消息序列与当前一致 |
| 现有 agent 有 PREFILL.md 无 tail contextPath | 自动兼容为 tail 注入 |
| 现有 agent 有 PREFILL.md 且有 tail contextPath | tail contextPath 优先，PREFILL.md 忽略 |
| locateHistorySpan 无 before-history | start = 1（扫描跳过 0 条），行为不变 |
| delegated 路径无 position 声明 | workspace-context 注入行为不变 |

## 风险点

1. **locateHistorySpan 改造**（最高风险）：start 计算错误会导致上下文压缩 splice 错位置。需测试：无 before-history / 有 before-history / 有 assistant before-history 三种场景。
2. **缓存命中**：before-history 注入如果内容变化频繁会破坏稳定前缀缓存。约束：只放稳定内容。
3. **delegated 路径**：确保固定层（调用方信息、调用请求）不被 position 注入打乱。
4. **PREFILL.md 兼容**：确保已发布的旧 game card 存档（有 PREFILL.md 无 tail contextPath）行为不变。
