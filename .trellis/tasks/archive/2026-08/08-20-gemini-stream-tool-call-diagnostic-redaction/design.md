# Design: Gemini 流式工具调用与诊断脱敏修复

## Scope and Boundaries

本任务只修改 `apps/platform-web` 的 Native 流式结果归类、Agent 工具循环防御、统一诊断凭据识别和现有 Assistant smoke。无 contracts shape、Dexie schema、provider 配置或 UI 结构变更。

## 1. Native Stream Result Invariant

`streamAssistantReplyNative()` 已跨 SSE chunk 累积完整 `NativeToolCall[]`。累积结果比 provider finish reason 更接近平台语义：只要工具调用非空，本轮就必须进入工具执行阶段。

流结束后的归类顺序调整为：

```ts
const resolvedFinish = toolCalls.length > 0
  ? "tool_calls"
  : finishReason ?? "stop"
```

这条 provider-neutral 不变量同时覆盖：

- Gemini `functionCall` + `STOP`；
- functionCall 与终止 reason 位于不同 SSE chunk；
- 中转站返回与 payload 内容矛盾的 finish reason。

不把修复只放进 `geminiAdapter.extractStreamFinish()`，因为终止 chunk 不保证重复之前 chunk 的 `functionCall`；只有共享流循环持有完整 accumulator。

## 2. Agent Loop Defensive Invariant

Native Agent 工具循环不再让 `finishReason === "stop"` 抢先于非空工具调用。退出条件以 `result.toolCalls.length === 0` 为准：

- 无工具调用：返回最终文本，finish reason 只用于 timeline/trace 语义；
- 有工具调用：执行全部调用、追加 assistant tool-call message 和逐个 tool observation，再进入下一轮。

这与各 provider 非流式 parser 已采用的“toolCalls 覆盖 finish reason”规则一致，并防止未来 adapter 再次产生矛盾结果。

## 3. Diagnostic Credential Boundary

### Persistence / monitor / single-copy boundary

向共享 `SECRET_KEYS` 增加规范化键 `xgoogapikey`。`prepareDiagnosticRecord()` 在每次 put/update 前运行，因此修复后的新记录会在进入 IndexedDB 前移除结构化 `x-goog-api-key`：

- 系统监视器读取不到原值；
- 虚拟诊断文件和单条复制读取不到原值；
- 普通导出输入默认已是无凭据记录。

不对已有记录执行 backfill、migration 或 delete。

### Export defense in depth

导出继续运行 `sanitizeDiagnosticExportValue()`。更新共享结构化识别后，即使导出输入是修复前的旧记录，`x-goog-api-key` 也会在文件构造前移除。

同时把 `x-goog-api-key` 加入 `redactCredentialText()` 的 header 文本模式，用于清洗 request/response/error/reproduction 普通字符串中的 header dump。不能依赖 `sk-` / `AIza` 值模式。

## 4. Verification Strategy

长期测试资产保持精简，不修改现有 Assistant smoke，不新增永久专项测试文件。实现期创建两个职责单一、可独立运行的临时 Vitest 文件：

1. Gemini Native streaming 临时测试：
   - mock SSE 返回 `functionCall`，同轮或终止 chunk 返回 `finishReason: "STOP"`；
   - 断言结果分类为 `tool_calls`；
   - 通过 Agent loop 或等价真实调用边界证明工具 observation 会进入下一轮并得到最终文本。
2. Diagnostic credential 临时测试：
   - 使用不具备已知前缀的假 Key；
   - 断言 `prepareDiagnosticRecord()` 后原值不存在；
   - 断言诊断包构造对结构化与文本形式 `x-goog-api-key` 都不输出原值，同时保留普通文本。

临时测试运行通过后删除，并在最终检查中确认测试文件清单和 `package.json` 长期测试入口均未增长。

测试必须覆盖：

1. 配置 Gemini provider，启用 native + streaming，使用不具备已知前缀的假 Key。
2. mock SSE 返回 `functionCall`，同轮或终止 chunk 返回 `finishReason: "STOP"`。
3. 断言下一请求包含对应 `functionResponse` observation，并返回最终文本。
4. 查询持久化诊断，断言假 Key 不存在。
5. 用诊断包构造边界验证结构化与文本形式的 `x-goog-api-key` 均不进入任何导出文件，同时普通文本保留。

不批量恢复已删除测试，不把临时测试加入 `test:smoke:web`，也不启用全仓自动发现。

## Compatibility and Risks

- Provider compatibility：仅在已经解析到真实工具调用时覆盖 finish reason；无工具 `STOP` 行为不变。
- Multi-tool compatibility：所有累积调用保持原顺序并照常执行。
- Diagnostic compatibility：仅新增一种 credential key/header 识别；普通 `maxOutputTokens` 等 token 计数字段不受影响。
- Existing data：旧记录可能继续在本地监视器中显示原值，直到自然淘汰；用户已明确不要求迁移。导出旧记录仍经过更新后的二次清洗。
- Test maintenance：临时测试不会形成永久回归保护，未来同类缺陷可能再次出现；用户接受该取舍，以换取长期 smoke 的精简、稳定和低维护成本。

## Rollback

- 流式归类与 Agent 循环防御可一同回滚，不影响存储。
- `xgoogapikey` 与导出文本模式可独立回滚，不涉及 schema/data migration。
