# Research: Agent Tool 结果契约

- Query: 汇总已确认的 Tool 结果路径、截断点、分页/制品复用能力、最小实现文件、兼容风险与测试。
- Scope: internal
- Date: 2026-08-03

## Findings

### 1. Tool 结果路径

- 所有正常执行分支在 `apps/platform-web/src/agent-runtime/workspace-tools/tool-execution.ts:476-637` 先形成原始 `RuntimeWorkspaceToolObservation`：包括 `use_skill`、`run_script`、`agent_call`、`inspect_frontend`、`query_diagnostics`、`ask_user`、`test_skill_script`、workspace operations 和 custom Tool。
- 执行异常在 `tool-execution.ts:638-653` 转为失败 observation。
- 正常公共出口在 `tool-execution.ts:656-678`：调用 `projectToolObservationForAgent`，审计同时接收 raw/projected，UI 只接收关闭的 presentation，返回给后续循环的是 projected observation。
- 例外：解析错误/缺失 call 在 `tool-execution.ts:444-463` 提前返回，绕过 projector、审计和 UI terminal event；新 validator 必须覆盖该路径。
- Native 模式在 `apps/platform-web/src/agent-runtime/index.ts:1431-1444` 写入 assistant tool-calls 消息和逐 call-id 的 `role:"tool"` 消息。
- Text 模式在 `apps/platform-web/src/agent-runtime/text-tool-protocol.ts:328-343` 生成 `<tsian-tool-observations>`，由 `index.ts:1883-1907` 作为 user 消息回放。
- 两种模式都从返回的 observation 生成 tool memory：`index.ts:1446-1452`、`:1915-1931`；最终进入 `contextUpdate.toolMemories`（`:2169-2178`），下轮由 `index.ts:550-555` 渲染。
- Native provider 只做传输映射：OpenAI Chat `tool_call_id`（`runtime-host/ai/providers/openai-chat.ts:101-107`）、Responses `function_call_output.call_id`（`openai-responses.ts:20-29`）、Claude `tool_result.tool_use_id`（`claude.ts:44-64`）、Gemini `functionResponse.id/name`（`gemini.ts:43-73`）。
- 图片 read 在 `tool-execution.ts:589-610` 把 base64 从文本 result 移入 `imageParts`；其字节数不受当前 32-KiB 文本 observation 上限约束（`workspace-tools-types.ts:98-106`）。

### 2. 已确认的截断/压缩点

- Runtime 总上限 32 KiB、read 内容上限 24 KiB：`workspace-tools/observations.ts:10-17`；调用方给出的 budget 仍会被 clamp 到 32 KiB（`:58-63`）。
- 非 JSON、循环和异常值会被静默归一化：`observations.ts:19-47`。
- 通用 preview envelope `{preview,charCount,truncatedForModel,anchors?,continuation}`：`observations.ts:65-81`。
- 通用递归压缩后再 preview：`observations.ts:83-89`；最终整个 observation 仍过大时再次 envelope 化：`:201-245`。
- Read 的 24-KiB 截断和 `nextCharOffset` 合成发生在 Runtime projector：`observations.ts:145-165`。
- Search 的 10 files、5 matches/file、400 chars/snippet 截断发生在 Runtime projector：`observations.ts:98-142`。
- Text 模式对已 projected 结果再次调用 `compactLargeValueForModel`：`text-tool-protocol.ts:293-325`。
- `compactLargeValueForModel` 会截断大于 20,000 字符的字符串、超过 50 项的数组和深度超过 4 的值：`agent-runtime/tool-memory.ts:9-21`、`:52-113`。
- Tool memory 还会按 per-tool、最近 turn 和总字符预算生成 summary/placeholder：`tool-memory.ts:202-238`、`:322-367`。这是跨轮记忆保留策略，不应与即时 Tool 输出校验混为一谈。
- `agent_call` UI presentation 独立截为 8 KiB：`observations.ts:248-280`；该点应保留，与 model observation 解耦。
- Workspace read 原始 producer：字符读取默认/最大 24 KiB，行读取默认 2,000、最大 5,000；但完全省略 range 时仍返回整文件：`workspace-operations.ts:49-81`、`:668-783`。
- Workspace search 原始 producer：默认 50、最大 200 files，每文件最多 50 matches；匹配行和 context 字符串无长度上限：`workspace-operations.ts:313-399`、`:786-910`。
- Diagnostics producer 已自行限制：20 records、3 snippets/record、320 chars/snippet、16-KiB section page、30-KiB aggregate：`platform-host/diagnostics-query.ts:15-21`、`:41-93`、`:109-184`。
- Inspector producer 已有字段级上限：DOM 8,000 chars、80 interactables（`frontend-inspector-dom.ts:11-17`、`:70-103`）；diagnostics 50/100/50、stack 2,000、console arg 500（`frontend-inspector-diagnostics.ts:6-10`、`:59-83`）；activity 200、snapshots 50（`frontend-inspector.ts:59-60`、`:230-254`）。但没有最终 aggregate cap。
- Browser script Worker/host 会把输出转为 JSON 值，循环转成 `"[Circular]"`，不支持值转为 `null`：`platform-host/browser-skill-script-executor.ts:65-90`、`:418-450`。脚本错误 stack 截为 1,000 字符（`:93-110`、`:987-1000`）。
- Debug record 的 preview 截断位于 `runtime-host/ai/debug-records.ts:66-69`，不是模型 observation 截断。

### 3. 可复用分页与制品能力

- `read`：已有权威 workspace path；支持 line `offset/limit` 和 exact character `charOffset/charLimit/nextCharOffset`。这是可复用的真实分页。
- `query_diagnostics read`：已有 record id、section、`offset/nextOffset`，是真实分页（`diagnostics-query.ts:154-184`）。
- `query_diagnostics list/search`：只有“缩小 filters/query”的 continuation hint（`:68-93`、`:109-151`），没有 cursor，不应称为分页。
- `search`：结果 path 可交给 `read`，但 search 本身没有 cursor/offset；当前 continuation 只是缩小 path/query/pattern（`observations.ts:128-142`）。
- `glob`：已有 `limit/truncated`，默认 50、最大 200（`workspace-operations.ts:971-989`）。
- Skill/custom Tool browser script 可调用受权限约束的 `tsian.workspace.*`，写入 workspace 后返回 path 作为制品引用（`browser-skill-script-executor.ts:850-888`）。
- 当前没有通用 Tool artifact envelope、统一 output cursor，custom `tool.json` 也没有 output schema/size/artifact 字段（`packages/contracts/src/runtime.ts:677-713`、`agent-runtime/registry.ts:1114-1274`）。
- `agent_call` 没有可重读的 response artifact；`inspect_frontend` 也没有结果 artifact/page token，只能再次 inspect 获取新快照。

### 4. 最小兼容方案

1. 将 `projectToolObservationForAgent` 替换为只验证、不改写的严格边界：验证最终文本 observation 为 JSON-safe 且不超过固定上限；不得 normalize、compact、slice 或生成 preview。
2. 违反时返回小型失败 observation，建议稳定 code `TOOL_OBSERVATION_CONTRACT_VIOLATION`，details 只含 `{toolName, reason, maxChars, actualChars?}`，不得带入违规原文。
3. 把现有 read/search shaping 下沉到 Agent-facing producer；底层通用 `executeWorkspaceOperation` 可保留现有 SDK/UI 兼容语义。
4. `query_diagnostics` 直接复用现有 bounded producer；`agent_call`、inspector、Skill script、test script、custom Tool 分别产出自身有语义的 bounded result。
5. Text 模式删除二次 `compactLargeValueForModel`；Native provider 映射不变。
6. Tool memory 从已验证 observation 生成，继续保留独立 summary/placeholder retention。
7. MVP 不新增通用 artifact 子系统：复用 workspace path、diagnostic id、read offset；script/custom Tool 使用“summary + workspace path”或自定义分页。
8. Custom Tool/Skill 不强制迁移 manifest。小于上限的现有输出保持形状；超过上限的输出由“静默截断成功”变为结构化失败，作者再增加摘要、分页或 path 返回。
9. 删除全局 fallback 前必须覆盖其他可能超限的 built-ins：`list`、`diff`、带完整 file content 的 mutation result、大型 copy/move/delete path arrays、validation errors、`use_skill` action lists、`ask_user` answer。否则它们会从可用但被截断变成频繁 contract violation。
10. 保留最终 provider request 总预算；多个单独合规 observation 仍可能使整次请求超限（`index.ts:1255-1268`、`:1704-1715`）。

### 5. 最小实现文件

- `apps/platform-web/src/agent-runtime/workspace-tools/observations.ts` — 改为严格 validator + contract violation；保留独立 UI projector。
- `apps/platform-web/src/agent-runtime/workspace-tools/tool-execution.ts` — 每个 producer 接入 bounded result，并让 early parse errors 也过 validator。
- `apps/platform-web/src/agent-runtime/text-tool-protocol.ts` — 删除二次通用 compaction。
- `apps/platform-web/src/agent-runtime/workspace-operations.ts` 或新增同目录 Agent-facing adapter — read/search 生产者归属。
- `apps/platform-web/src/agent-runtime/index.ts` — 确认 native/text 都只消费 validated observation；memory 路径不再依赖“projected/truncated”语义。
- `apps/platform-web/src/agent-runtime/tool-memory.ts` — 仅调整命名/注释和输入前提；保留 retention。
- `apps/platform-web/src/agent-runtime/workspace-tools/action-executors.ts`、`skill-actions.ts` — Skill/custom script bounded output 与违规错误。
- `apps/platform-web/src/platform-host/frontend-inspector.ts` — aggregate bounded structured output。
- `apps/platform-web/src/platform-host/diagnostics-query.ts` —原则上无需重构，只需验证/测试其满足边界。
- `apps/platform-web/src/agent-runtime/workspace-tools-types.ts`、`turn-types.ts` — observation discriminated contract、违规 code、移除/重命名 caller-controlled `observationCharBudget`。
- `packages/contracts/src/runtime.ts` — read cap ownership和 tool-memory 注释；若违规结构公开则补 shared type。
- Host budget callers：`platform-host/assistant-chat.ts:721-722`、`ai-invocation.ts:388-389`、`runtime-turn.ts:238-239`。

### 6. Specs 与测试

需要更新：

- `.trellis/spec/platform-web/frontend/type-safety.md:473`、`:868-894`：从 Runtime generic truncation 改为 producer-owned bounded output + Runtime validation/fail-loud。
- `.trellis/spec/platform-web/frontend/type-safety.md:419`、`:466-480`、`:489-491`：明确各 producer 和 custom Tool/Skill 兼容行为。
- `.trellis/spec/platform-web/frontend/quality-guidelines.md:280-283`：删除“统一 projector 截断”规则，保留 UI isolation/provider correlation/memory retention。
- `.trellis/spec/platform-web/storage/diagnostics.md:66-68`：记录 diagnostics 是 producer-owned 范例，并区分 read paging 与 list/search narrowing。
- `.trellis/spec/contracts/frontend/type-safety.md:78`、`:405-419` 及 `packages/contracts` backend specs：同步 shared contract 和构建要求。

需要修改/新增测试：

- `workspace-tools/observations.test.ts:10-89`：改测 validator 原样通过、oversize/non-JSON-safe 返回违规、违规原文不泄露、UI 8-KiB projection 独立。
- `workspace-operations-retrieval.test.ts:52-64`：把 exact read continuation 断言移到 Agent read producer；保留底层 read 兼容测试。
- 新增 search producer 的 10/5/snippet/count/continuation 测试。
- `platform-host/diagnostics-query.test.ts:44-80`：保留 paging/bounds，并新增“未经 Runtime 改写即通过 validator”。
- 新增 `agent_call` oversized response 和 inspector aggregate tests。
- 扩展 `platform-host/browser-skill-script-executor.test.ts:157-212` 及 action/custom Tool tests：合规旧输出不变、超限结构化失败、workspace artifact path 可重读。
- 新增 text protocol 测试：validated observation 直接序列化，无二次 compaction。
- 保留并扩展 `runtime-host/ai/providers/native-tool-correlation.test.ts:38-73`：除 call id 外断言 content 不变。
- 更新携带 `observationCharBudget` 的 fixtures：`agent-runtime/environment.test.ts:14-18`、`request-budget.test.ts:45-50` 和 assistant isolation tests；最终 request-budget 测试继续保留。
- 保留 `storage/assistant-conversations.test.ts:15-47`：raw Tool output 仍不得进入 timeline/session storage。

## Caveats / Not Found

- 未确认存在任何通用 artifact storage contract、custom Tool output schema 或统一 cursor；已掌握代码显示这些能力目前不存在。
- 未确认所有 workspace mutation 返回值的精确最大体积；仅确认其 shared contracts 可携带完整 file/path arrays，因此删除 fallback 前必须逐一做 producer bound。
- 未确认图片的字节/像素上限；当前 32-KiB 文本限制明确不覆盖 `imageParts`。
- 未确认 `test_skill_script` 外层 `{ok:true,result:{ok:false,error}}` 是否应改语义；这超出输出大小治理，MVP 应保持现状。
- Search 原始结果在 `.slice(0, limit)` 后不携带 corpus 总数，因此现有 projector 的 `totalFiles` 不是完整命中总数。
