# Design — 拆分 runtime-host/ai.ts

> 评估结论：**不拆。**

## 评估依据

### 文件结构
`runtime-host/ai.ts`（当前 1859 行，master 时 1605 行）分四层：
- 类型层（12-37）：`export type` re-export + NativeToolCall + RuntimeChatMessage（26 行连续）
- debug/工具层（105-364）：aiDebug state + mask/preview/log/fetch/abort + OpenAI body helper
- provider adapter 层（365-1133）：ProviderAdapter interface + openai/gemini/claude adapter + native message builder
- 顶层 API 层（1126-1859）：generateAssistantReply / generateAssistantReplyNative / streamAssistantReplyNative / streamAssistantReplyText

### 为什么不拆

1. **类型层收益微乎其微**：仅 26 行连续块可干净提取，ModelCallResult/GenerateAssistantReplyOptions（84-126）与运行时代码交织，强行拆会割裂。
2. **主体是 provider adapter 单一职责域**：三个 adapter（OpenAI/Gemini/Claude）+ 共享 helper（buildOpenAiContent、buildChatCompletionsUrl、fetchJsonWithTimeout 等）是一个 call-graph cluster。module-structure-guide 明确："按 call graph 找 seam"，它们不是多个职责的堆叠，是一个职责（provider 适配）的内部协作。
3. **拆 adapter 必然制造循环**：adapter 依赖同文件 helper（content builder、url builder、fetch），helper 留主文件 → 反向 import → 违反防循环约定。
4. **不在制造痛苦**：仅 1 消费方（platform-host/index），churn 不高，无合并冲突压力。

### 结论
符合"1000+行单一职责 OK"原则。与父任务排除标准一致（类似 frontend-inspector.ts：大但稳定且内聚）。不做拆分。
