# AI API 请求自动重试

## Goal

为浏览器端 AI API 请求增加传输层自动重试，降低中转站/API 临时断连、短暂限流或 5xx 抖动导致整个 Agent 回合/流程中断的概率。

## Background / Evidence

- 当前 `fetchJsonWithTimeout` 只提供超时 abort 与 JSON 读取；`fetch()` 抛错或超时后直接抛出，没有重试（`apps/platform-web/src/runtime-host/ai/fetch.ts:55`）。
- 非流式 text 请求 `generateAssistantReply` 捕获请求错误后只写 debug record 并原样抛出（`apps/platform-web/src/runtime-host/ai/calls.ts:28`）。
- 非流式 native 请求 `generateAssistantReplyNative` 同样失败即抛出（`apps/platform-web/src/runtime-host/ai/calls.ts:113`）。
- 流式 text/native 请求在 `fetch()` 或 SSE 读取失败时也会失败并中断当前 turn；流式 text 在收到 delta 后会向 UI 输出增量（`apps/platform-web/src/runtime-host/ai/calls.ts:213`、`apps/platform-web/src/runtime-host/ai/calls.ts:607`）。
- 正式玩家回合的 `callModel` / `callModelNative` 都调用 runtime-host/ai 的四个请求入口（`apps/platform-web/src/platform-host/runtime-turn.ts:152`）。
- `interaction.invokeAgent` 旁路调用也通过同一组请求入口（`apps/platform-web/src/platform-host/ai-invocation.ts:333`）。
- 桌面 Assistant 也通过同一组请求入口（`apps/platform-web/src/platform-host/assistant-chat.ts:515`）。
- `agent_call` delegated Agent 不是单独请求实现；它在 Agent Runtime 内再次调用 `callAgentModelWithWorkspaceTools`，并继续使用 host 注入的同一 `capabilities.callModel` / `callModelNative`（`apps/platform-web/src/agent-runtime/index.ts:837`）。因此请求层重试会覆盖 `agent_call`。

## Requirements

- R1. 在 runtime-host/ai 请求层实现自动重试，而不是在 Agent Runtime 工具循环层实现。
- R2. 初始请求不算重试；失败后最多自动重试 3 次，总请求机会最多 4 次。
- R3. 每次重试前等待，并且退避时间逐次变长。
  - 可接受默认：约 `800ms -> 1600ms -> 3200ms`，允许少量 jitter。
- R4. 只重试瞬时/传输类错误：
  - `TypeError: Failed to fetch` / 网络级 fetch 失败；
  - 请求超时；
  - HTTP `408`、`429`、`500`、`502`、`503`、`504`。
- R5. 不重试确定性错误：
  - 用户主动停止 / abort；
  - HTTP `400`、`401`、`403`；
  - provider 返回的确定性请求错误（例如参数/schema/tool 配置错误）。
- R6. 流式请求只允许在尚未输出任何 delta 之前自动重试；一旦已有内容流出，就不自动重试，以避免 UI 重复片段和上下文不一致。
- R7. 重试必须尊重传入的 `AbortSignal`：用户停止、任务超时、`agent_call` timeout 触发后不得继续等待或发起下一次重试。
- R8. 请求 debug record / console 日志应能看出失败发生在第几次尝试，最终失败时保留可诊断错误信息。
- R9. 覆盖范围必须包括：正式玩家回合、桌面 Assistant、`interaction.invokeAgent`、以及 `agent_call` delegated Agent。

## Acceptance Criteria

- [x] 非流式 text 请求遇到 `Failed to fetch` 时，最多自动重试 3 次；若后续成功，调用方收到成功结果而不是整个 turn 中断。
- [x] 非流式 native 请求具备同等重试行为。
- [x] 流式 text/native 请求在首个 delta 前失败时可以重试；首个 delta 后失败时不重试。
- [x] HTTP `408/429/500/502/503/504` 会重试；HTTP `400/401/403` 不重试。
- [x] 用户主动停止或上层 timeout abort 后不会继续重试。
- [x] `interaction.invokeAgent` 路径通过共享请求层获得同等重试能力。
- [x] `agent_call` delegated Agent 路径通过共享 `capabilities.callModel` / `callModelNative` 获得同等重试能力；重试耗时计入 delegated Agent 的 timeout。
- [x] `npm run build:web` 通过。
- [x] `git diff --check` 通过。

## Out of Scope

- 不做 UI 设置项；重试次数与退避参数先作为代码级默认。
- 不改变模型选择、provider preset、tool-call mode 分派逻辑。
- 不在工具执行层重试 workspace 工具；本任务只处理 AI API 请求。
- 不对已经输出流式内容的请求做自动重放。

## Open Questions

- 无阻塞问题；用户已明确要求失败后自动重试 3 次并使用逐次变长退避。

## Completion Review (2026-08-07)

- Implementation commit: `db5510d fix: retry transient AI request failures`.
- Current request layer retains `AI_REQUEST_MAX_RETRIES=3`, retryable transport/HTTP classification, abortable exponential backoff and first-delta streaming gating across text/native entry points.
- Focused runtime-host AI tests passed: 3 files / 14 tests.
- `npm run build:web` and `git diff --check` passed; only existing non-blocking Vite/Rollup warnings remain.
- `.trellis/spec/platform-web/frontend/quality-guidelines.md` contains the executable retry contract.
