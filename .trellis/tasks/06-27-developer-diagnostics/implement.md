# Implement — 开发者诊断

## 执行顺序

D1（渲染器）→ D2（数据采集增强）→ D3（DebugView 浏览器）→ D4（验证）。渲染器先做，可独立验证；数据采集增强后渲染器自动展示新字段。

### D1：trace 人类可读渲染器

- [ ] D1.1. `trace.ts` 加截断常量：`TRACE_ERROR_STACK_LIMIT=1000`。加 `truncate(text, limit)` helper（超长截断 + `…`）。**无 OUTPUT/RESULT preview 常量**——trace 不记业务内容片段。
- [ ] D1.2. `trace.ts` 加 `formatTraceEventForHuman(event, baseTimestamp?)`：时间偏移 `mm:ss.SSS`、type 左对齐定宽(24)、agentId/turn 前缀、data 拍平 key=value（友好名映射 out/msg/tokens_in/tokens_out/dur/finish）、ok 省略/FAIL 标记、errorStack 缩进行（`└`）。
- [ ] D1.3. `trace.ts` 加 `formatTraceForHuman(events)`：按 timestamp 排序，首事件 timestamp 为 base，逐行渲染 join `\n`。
- [ ] D1.4. 验证：构造 mock events → formatTraceForHuman 输出可读（手测或临时 console）。

### D2：数据采集增强

> **Scope corrections (探索后修正)**：
> - **`model` 字段移除**——`agent-runtime` 是纯层，`capabilities.callModel` 不透明；模型名只在 host 层 `AiDebugRecord.model`（DebugView Token 面板已显示）。runtime 拿不到，不记。
> - **`turn_started/completed/failed` 在 `platform-host/index.ts`**（非 agent-runtime）——D2.4 的 turn_failed 改在 host 层改。
> - **`context_compressed` 用 `estimateContextTokens`**（index.ts:2052 已可见的估算器，非 `estimateTokenCount`）。
> - **diagnostics.ts:16 `TRACE_TURN_PATH_PATTERN` 仍是旧路径 `.tsian/traces/`**（refactor 时漏更新）→ D2.fix 必修，否则 D3 trace 浏览器加载不到 events。

- [ ] D2.1. `index.ts:1531` (native) + `:1659` (text non-tool) + `:1861` (text loop) model_call_completed：data 加 `finishReason`、`usage`(lastRoundUsage → input/output/total；native 可用，text 路径 undefined 则省略)、`toolCalls`(result.toolCalls/nativeToolCalls → {name, argsKeys: Object.keys(参数)}；text 路径从 parseRuntimeWorkspaceToolCalls 结果)。**不记 model 字段**（runtime 拿不到）、**不记 outputPreview**。失败时(ok:false)加 `error`+`errorStack`。
- [ ] D2.2. `workspace-tools.ts:242` workspace_tool_called：记录 startTime（emit 前）→ data 加 `durationMs`。**不记 resultPreview**——完整结果在 workspace 文件。
- [ ] D2.3. `index.ts:1186`(delegated) + `:2157`(entry) agent_step_completed：data 加 `durationMs`。配对方案：started 事件 data 加 `startedAt`（Date.now()），completed emit 时若无配对 started 则从 traceCollector.events 末尾找同 agentId+debugLabel 的最近 started；渲染器也可用 startedAt 算。简化：completed 存 `startedAt` 让渲染器算偏移（renderer 友好名 `dur`）。
- [ ] D2.4. `index.ts:1221`(delegated failed) + `:2164`(entry failed) agent_step_failed + `index.ts:964`/`assistant-chat.ts:691` turn_failed：data 加 `errorStack`(truncate(error.stack, TRACE_ERROR_STACK_LIMIT))。已有 `errorToTraceData` 提供 message/code，仅补 stack。
- [ ] D2.5. `index.ts:2075` context_compressed 修正：`compressContext` 调用前算 `estimateContextTokens(agentContext)`(before)，调用后算 `estimateContextTokens(compressedContext)`(after)，data 加 `beforeTokens`/`afterTokens`/`ratio`(after/before)。`context_compression_failed`(:2082) 加 `beforeTokens`（after 无，只存 before + error/stack）。
- [ ] D2.6. 过度采集删减：`browser-skill-script-executor.ts:380` workspace_mutation(write) 删 `updatedAt`；`workspace-tools.ts` agent_called 删 `callerDepth`/`depth`/`maxDepth`/`callCount`/`historyMode`；`workspace-tools.ts:1700-1701` skill_loaded 删 `skill.scope`/`skill.agentId`。
- [ ] D2.fix. **`diagnostics.ts:16`** `TRACE_TURN_PATH_PATTERN` `.tsian/traces/turns/` → `.tsian/save/traces/turns/`（refactor 漏更新，必修否则 runtime-diagnostics 查不到 trace 文件）。
- [ ] D2.7. 验证：玩回合 → 查 trace 文件，新字段存在 + context_compressed 有 before/after/ratio + 删减字段不在；diagnostics.ts 解析不破（未知 key 忽略，删字段无影响）。

### D3：DebugView trace 浏览器

- [ ] D3.1. 新增 `runtime-trace` query resource（platform-host/index.ts）：params {turn?} → 列当前 save 的 trace 文件（`isTraceFilePath` 过滤 effective workspace files）→ 解析 events（导出 diagnostics.ts 的 `parseTraceFileContent` 或新加 `loadTraceEventsForTurn`）→ 返回 `{turn, events, traceKind}[]`。无 turn 时返回全部（首版可只返回最新回合）。
- [ ] D3.2. DebugView 加 trace 浏览器 section：**默认显示最新回合**事件流（mount/refresh 时取 runtimeTurn → query runtime-trace {turn} → `formatTraceForHuman(events)` → `<pre>` 等宽可滚动可复制）。历史回合切换：上/下回合按钮（次要入口）。
- [ ] D3.3. section 命名："运行日志"（与"最近问题"等中文 section 一致；"Trace" 仅是 fact source label）。

### D4：验证

- [ ] D4.1. DebugView 运行日志：**默认显示最新回合**人类可读事件流（非 JSONL），type 对齐、时间偏移、data 拍平、ok/FAIL、errorStack 缩进；可切历史回合。
- [ ] D4.2. 增强 data 生效：model_call 有 finish/usage/toolCalls；tool_call 有 durationMs；failed 事件有 error/stack。
- [ ] D4.3. context_compressed 修正生效：有 before/after tokens + ratio。
- [ ] D4.4. 过度采集删减生效：workspace_mutation 无 updatedAt；agent_called 无 depth/callCount/historyMode；skill_loaded 无 scope/agentId。
- [ ] D4.5. 截断生效：errorStack 不超常量，超长有 `…`。
- [ ] D4.6. 助手 agent 经 runtime-diagnostics 仍正常（JSONL 解析不破坏；D2.fix 路径修正后诊断能查到 trace）。
- [ ] D4.7. vue-tsc + vite build 通过。

## Validation Commands

```bash
npx vue-tsc -b
npx vite build apps/platform-web
# 运行时验证（手动）：
# 1. DebugView → Trace 浏览器 → 选回合 → 人类可读事件流
# 2. 查 .tsian/save/traces/turn-NN.jsonl，新字段存在
# 3. 故意触发失败（如断网让 model_call 失败）→ trace 有 error/stack
```

## 风险点与回滚

- **trace 体积增长**：截断常量控制上限，不进 checkpoint 不放大。回滚 = git revert D2。
- **durationMs 配对**：agent_step started/completed 跨事件——若 collector 不好配对，降级为 completed 存 startedAt，渲染器算偏移。
- **DebugView 加载 events**：新增加载路径，复用 diagnostics parse 逻辑降低风险。

## Follow-up before task.py start

- 确认 `agentContext` 里模型名字段名（D2.1 用）——实现时 grep 确认。
- 截断常量默认值（stack 1000）——实现时可调。trace 不记业务内容片段，故无 output/result preview 常量。
