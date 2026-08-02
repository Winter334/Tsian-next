# Agent 上下文边界与桌面助手检索治理 — Design

## 1. Design Goal

本设计修正一条跨层数据流，而不是给百万字符搜索结果增加若干局部截断：

```text
Authoritative Source / Tool Executor
              │ raw result（执行期内部值）
              ├─ Agent projector → 有界 AgentObservation → model messages
              ├─ UI projector    → UiToolPresentation → timeline / bridge / UI
              └─ Audit projector → AuditEvent → trace / diagnostics policy
```

桌面助手与游戏卡 Agent 继续共用 `runAgentRuntimeTurn`、工具 registry、Worker runner、模型协议、压缩器和 trace 基础设施；差异由 host 构造的 `AgentRuntimeEnvironment` 提供。UI 只消费展示投影。诊断原始记录继续以 `diagnosticRecords` 为权威，不进入普通 Agent WorkspaceView。

## 2. Current Seams to Preserve

现有实现已有以下可复用基础，不重新实现：

- `runAgentRuntimeTurn` 被 formal turn、`invokeAgent` 和 desktop assistant 三个 host 共用。
- `AgentRuntimeCapabilities` 已注入模型调用、browser script、workspace mutation、inspect frontend 和 trace。
- `workspaceTrustBoundary` 已让 delegated Agent 降级到 `runtime-game-agent`，且 runtime Agent 不挂载 diagnostics adapter。
- `AgentContextSnapshot.toolMemories` 已是跨 turn 模型投影，`ConversationMessageRecord.timeline` 已是 UI 时间线。
- `createDiagnosticsWorkspaceAdapter()` 已是 IndexedDB 的按需虚拟投影，资源管理器仍可继续使用。
- `RuntimeTraceEmitter` 已有 workspace/action/agent-call 的结构化摘要事件。

问题集中在这些 seam 之间：host 参数分散、当前轮 raw observation 直接构造模型消息、UI timeline/raw toolCalls 重复保存、desktop ordinary search 合并 virtual diagnostics，以及消息整理器破坏 native tool 关联。

## 3. Runtime Environment Boundary

### 3.1 Composite Environment

把目前散落在 `AgentRuntimeTurnInput` 和 `AgentRuntimeCapabilities` 中的环境差异收敛为一个组合对象。实现可以渐进迁移现有字段，但最终内核只从该对象读取环境策略：

```ts
interface AgentRuntimeEnvironment {
  workspace: {
    files: WorkspaceFile[]
    trustBoundary: AgentWorkspaceTrustBoundary
    mutations?: WorkspaceOperationMutationAdapter
    exposedOperations?: Iterable<WorkspaceOperationName>
    fileFilter?: (file: WorkspaceFile) => boolean
    semanticSearchOwnerId?: string
  }
  context: {
    snapshot?: AgentContextSnapshot
    compressionMode: "narrative" | "task"
    contextCapacityTokens: number
    requestInputBudgetTokens: number
    observationCharBudget: number
    inactivityTimeoutMs?: number
  }
  model: {
    callText: AgentRuntimeCapabilities["callModel"]
    callNative?: AgentRuntimeCapabilities["callModelNative"]
    toolCallMode: BrowserAiToolCallMode
  }
  controlledTools: {
    inspectFrontend?: RuntimeInspectFrontendRunner
    queryDiagnostics?: RuntimeDiagnosticsQueryRunner
    testSkillScript?: RuntimeTestSkillScriptRunner
    browserScript?: RuntimeBrowserScriptRunner
  }
  events: AgentRuntimeEventSink
  audit?: RuntimeTraceEmitter
}
```

不依赖 `kind === "assistant"` 分支做行为选择。Desktop/Game factory 通过提供或缺少端口表达能力。可选环境 id 只能用于 trace 标签，不能参与授权或行为路由。

### 3.2 Desktop Assistant Environment

- WorkspaceView：active card/save 的可编辑视图 + `.tsian/local/assistant/**` + 当前 session temp attachments。
- Trust：`trusted-authoring`，但 delegated Agent 必须由环境派生函数降级成 game runtime view。
- Context：task compression；独立 request input budget；助手 session context path。
- Controlled Tools：`inspect_frontend`、`query_diagnostics`、`test_skill_script` 等明确提供的控制面能力。
- UI sink：Assistant timeline projector。
- 普通 workspace operations 不挂载 diagnostics virtual adapter。

### 3.3 Game Runtime Environment

- WorkspaceView：save/card runtime view，排除 frontend-actions 和平台本地控制面数据。
- Trust：`runtime-game-agent`。
- Context：formal turn 使用 narrative；side invocation/delegated 使用 task；保留现有 transaction/checkpoint 行为。
- Controlled Tools：只含该 Agent 配置和 host 明确允许的能力，不含 diagnostics query。
- UI sink：formal turn、invocation 或无 UI sink，均消费同一个 runtime event contract。

### 3.4 Delegation

`agent_call` 不继承 caller environment。内核调用一个明确的 `deriveDelegatedEnvironment(targetAgent)`：

- 重新解析目标 Agent 的 registry、workspace access、Tool/Skill 可见性和模型配置；
- 强制 runtime game WorkspaceView；
- 删除 diagnostics、test-skill-script、trusted authoring mutations 等桌面控制面端口；
- 保留共享 trace correlation 和上游 UI event sink。

## 4. Tool Result Projection

### 4.1 Internal Execution Result

`executeRuntimeWorkspaceToolCalls` 在每个调用完成后立即形成一次内部结果：

```ts
interface RuntimeToolExecutionResult {
  call: RuntimeWorkspaceToolCall
  raw: RuntimeWorkspaceToolObservation
  agent: AgentToolObservation
  ui?: UiToolPresentation
  audit: ToolAuditProjection
}
```

`raw` 只在当前执行/投影栈内存在。完成 Agent memory、UI event 和 audit event 投影后释放，不进入 contracts、会话消息或 timeline。

### 4.2 Agent Projection

`AgentToolObservation` 是唯一可进入 text/native tool protocol 的结果。投影分两级：

1. 工具专用投影优先：
   - `read`：保留 path、行/字符范围、总量、truncated、next offset 和有界 content；
   - `search`：保留排序后的有限文件、有限 matches、命中周边 snippet、遗漏数量和继续查询提示；
   - `query_diagnostics`：保留 record summary/snippet/record id/section continuation；
   - `agent_call`：保留目标摘要和有界 response；
   - `inspect_frontend` / script：保留结构化摘要和明确 continuation/artifact anchor。
2. 通用最终兜底：对专用投影序列化后再次检查 `observationCharBudget`。仍超限时返回有效 JSON envelope `{ preview, charCount, truncatedForModel, anchors }`，绝不切出无效 JSON。

默认 Agent observation 总预算集中定义为 32 KiB；具体值由 Environment 注入但不能超过平台硬上限，也不能由 Tool/Skill 脚本放大。Agent-facing search 首轮最多保留 10 个文件、每文件 5 个 matches、每个 snippet 400 字符；read content 首轮最多 24 KiB。数组项数和单字段预览只是内部优化，最终序列化总量才是硬边界。

`toolMemories` 从 Agent projection 生成，不再从 raw UI/debug observation 生成，确保跨 turn 投影不可能重新扩张。

### 4.3 UI Projection

共享 contract 改为展示语义而非工具原文：

```ts
type UiToolPresentation =
  | {
      type: "agent_call"
      targetAgent: { id: string; title: string; summary?: string }
      response: string
      responseTruncated?: boolean
      status: "completed" | "failed"
      error?: { code: string; message: string }
    }
```

普通工具没有 presentation；UI 仍获得 `callId/name/displayName/status/round/agentId`。`agent_call.response` 的展示投影最多 8 KiB，超出时设置 `responseTruncated`，完整 delegated response 仍由调用方 Agent 在当前轮的有界 AgentObservation 中消费。未来新增展示 payload 必须先有明确消费者，再扩展 discriminated union。

- 删除 `TurnToolOutput`，统一用 `UiToolPresentation` 替代。
- `TurnTimelineItem.tool.output` / bridge `ToolEvent.output` 改为语义明确的 `presentation?`。
- 删除 `ConversationMessageRecord.toolCalls` 和 `AgentRuntimeTurnContextUpdate.toolCalls`。
- Assistant/Play timeline 只持久化展示节点，不保存 raw args/observation。
- 不建立通用 resultRef 或结果表；若未来 UI 需要查看某类完整结果，先为该 authoritative source 设计专用查询。

### 4.4 Audit Projection

- Provider diagnostics 继续保存完整 provider request/response，是模型调用审计权威。
- Tool audit 使用现有 `RuntimeTraceEmitter`，记录 call identity、参数摘要、结果数量/大小、Agent/UI 投影字符数、truncated、duration、anchor 和错误；不复制通用 raw result。
- read/search 的完整事实仍以 workspace 文件为权威；diagnostics query 的完整事实仍以 diagnostic record id 为权威；有 durable output 需求的 Skill/Tool 应显式写 workspace artifact。

这满足审计可定位性，又遵守“同一信息不写第二份”和“无消费者不建字段”。

## 5. Diagnostics as a Desktop-only Controlled Tool

### 5.1 Remove Agent Virtual Mount

- Desktop assistant 不再把 `createDiagnosticsWorkspaceAdapter()` 传给 Agent workspace execution 或 Skill/Tool Worker SDK。
- Resource Manager 继续使用 virtual adapter 浏览、复制和导出诊断；这是 UI/platform-owner 路径，不进入模型 registry。
- Game runtime 维持完全无 diagnostics adapter。

### 5.2 `query_diagnostics`

新增平台受控 Tool，仅当 Environment 提供 `queryDiagnostics` runner 时生成 schema。Agent 配置仍可关闭它；delegated/runtime Agent 即使声明同名也不可获得平台实现。

输入使用 closed discriminated operations：

```ts
type DiagnosticsQueryInput =
  | { operation: "list"; recordType?; status?; provider?; model?; operationId?; limit? }
  | { operation: "search"; query: string; recordType?; limit? }
  | { operation: "read"; id: string; section?: "summary" | "error" | "attempts" | "request" | "response"; offset?: number; limit?: number }
```

- `list` 只读 summary projection，最多 20 条。
- `search` 可以检查完整权威记录，但最多返回 20 条记录、每条最多 3 个 320 字符 snippet，只返回 record id、summary 和匹配周边；不回传完整命中行或 record body。
- `read` 按 record id + section 显式读取，并按字符范围分页，单次 section 内容最多 16 KiB；默认 `summary`，读取 request/messages/response 必须显式选择 section。
- runner 自身执行 result 总量上限；Agent projector 再做最终总量兜底。
- output 中包含 `truncated`、`nextOffset` 和 record id，支持继续读取。

官方 `framework-knowledge/references/diagnostics.md` 改为教授 `query_diagnostics`，不再要求 Agent 使用普通 workspace list/read/search 访问 `.tsian/local/diagnostics`。

## 6. Ordinary Workspace Retrieval

### 6.1 Scoped Search

- Agent-facing `search` schema增加可选 `path`。
- `searchWorkspaceFiles` 真正按规范化 directory root 过滤普通 workspace files；virtual adapter 的 path 语义与普通搜索保持一致。
- 全局 search 仍允许，但只作用于当前 Environment WorkspaceView；Desktop view 中 diagnostics 不存在。
- path scope、workspace scope 和 actor access 三者都必须满足，不能以 path 绕过权限。

### 6.2 Read Continuation

保留现有 line offset/limit，并为 workspace read contract 增加可选的 0-based `charOffset/charLimit` 与 `totalChars/returnedChars/nextCharOffset`。字符模式与 line offset/limit 互斥，`charLimit` 使用与 Agent read projection 一致的 24 KiB 平台上限；Resource Manager 未传字符参数时保持现有完整读取语义。不得用“截断后让 Agent 重读同一行”伪装可恢复。

### 6.3 Retrieval Guidance

Desktop Assistant 的常驻说明只加入可执行规则：

- 已知精确文件时直接 read；
- 不知道位置时先 scoped search；
- 只有目录结构未知时才 list；
- 找到足以回答问题的证据后停止；
- 诊断问题使用 `query_diagnostics`，不在普通 workspace 搜诊断。

不写开发侧事故解释、token 因果史或其它 Skill 默认已知概念。

## 7. Native Tool Protocol

修改 `mergeConsecutiveRoleMessages`：

- 永不合并 `role: "tool"`；每个 tool message 保留自己的 `toolCallId`。
- 永不合并携带 `toolCalls` 的 assistant message。
- 只在双方都是普通 string-content 且无 tool protocol metadata 时合并 system/user/assistant。
- 多模态消息维持现有不合并策略。

并行一轮 N 个 tool calls 必须产生一条 assistant tool-calls message + N 条独立 tool result messages；OpenAI/Claude/Gemini adapter 分别验证关联不丢失。

## 8. Input Budget and Request Preflight

### 8.1 Capacity vs Consumption

环境同时提供：

- `contextCapacityTokens`：模型技术窗口；
- `requestInputBudgetTokens`：产品允许的单次输入消费上限。

Desktop Assistant 默认消费预算沿用现有 task 触发量级，但不随超大模型窗口无界增加：以 `min(modelContextWindow, 256_000) * 0.45` 计算默认值。Game environment 保留现有 narrative/task 策略，二者互不共享配置决策。

### 8.2 Final Preflight

- 在 role merge、内部 marker 清理、tool schema 组装完成后估算最终 provider request。
- native 估算必须包含 tool schemas 和 tool-call arguments；text 估算包含序列化 observation。
- 超过预算时回到现有 compression path；压缩后必须重新 preflight。
- 若最新有界 observation + 必需上下文仍无法满足预算，返回现有 soft budget error，不发送 HTTP 请求。
- provider `beginAiRequestTrace` 只会看见已通过 preflight 的请求。

## 9. UI and Persistence

- Assistant message storage 只保存 user/assistant content、attachments 和 presentation timeline。
- `normalizeMessages` 不再保留 `toolCalls`；timeline 普通 tool 节点不含 raw output。
- Assistant mapper 不再从 timeline 反造 `AgentContextToolCall`。
- Formal turn、invokeAgent 和 play-bridge 使用同一 `presentation?` contract；Play UI 保持只显示名称和状态。
- 当前项目无需迁移。Reader 可自然忽略旧 JSON 多余字段；不扫描、不回写、不加迁移版本或兼容分支。

## 10. Testing Strategy

### Pure/Contract

- Agent observation projector：单字段、50×50 聚合、循环/异常值、超长单行、最终字符硬上限、continuation。
- UI projector：普通工具无 payload；agent_call 有 closed presentation。
- Environment：Desktop/Game registry、WorkspaceView、controlled tools、budget 和 delegation downgrade。
- Message merge：parallel tool calls、toolCallId、assistant toolCalls、多模态。

### Integration

- 复现 50 条 diagnostics records 均含相同用户关键词；ordinary search 不触碰 diagnostics，`query_diagnostics` 返回有限 snippets。
- Desktop assistant Skill/Tool script 无法通过 workspace SDK 读 diagnostics。
- Game Agent 无 `query_diagnostics` schema，手写调用返回 unsupported/unavailable。
- Assistant UI session JSON 无 raw observation；reload 后 timeline 名称/状态/agent_call presentation 一致。
- Final preflight 包含 tool schemas，并在 fetch 前阻止超预算请求。
- 原始复现路径最终 request 不含 diagnostic body 或百万字符 observation。

### Required Builds

- contracts build
- platform-web focused tests + Vue type-check/build
- play-bridge build and affected play frontend tests/build when shared ToolEvent contract changes
- whitespace/diff check

## 11. Rollback

- Environment aggregation可暂时保留旧函数签名 adapter，但不得恢复第二套运行循环。
- 如果 `query_diagnostics` 暂不可用，Desktop Assistant 应明确返回能力不可用；不得重新挂载 diagnostics 到普通 workspace search。
- UI presentation contract可回退到只显示 name/status；不得恢复 raw observation 持久化。
- observation projector可使用更保守的 preview envelope；不得解除最终总量硬上限。
