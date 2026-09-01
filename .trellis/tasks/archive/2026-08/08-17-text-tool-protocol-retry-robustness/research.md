# Research: Text Tool Protocol Retry Robustness

## Reproduction

- 真实失败链：成功 `agent_call` observation 后，模型先生成 `TEXT_TOOL_PROTOCOL_INVALID_JSON`；唯一一次纠错又输出 `<tsian-tool-call-records>`，触发 `TEXT_TOOL_PROTOCOL_NON_EXECUTABLE_TAG` 并耗尽预算。
- 同一请求历史更早已出现一次历史标签回显并在纠错后恢复，证明该混淆可重复。
- 最终历史标签中的 `commit_opening` 参数没有被执行；runtime 失败路径丢弃本回合 workspace transaction。

## Source Anchors

- `apps/platform-web/src/agent-runtime/index.ts:414-442`：text 模式系统提示；当前包含完整 call-records 错误示例。
- `apps/platform-web/src/agent-runtime/index.ts:1575,1778-1807`：当前重试预算为 1；错误后追加 user protocol-error，耗尽时抛最后错误。
- `apps/platform-web/src/agent-runtime/index.ts:1888-1907`：当前成功轮追加 assistant call-records + user observations；图片 observation 使用 `ContentPart[]`。
- `apps/platform-web/src/agent-runtime/text-tool-protocol.ts:11-18,111-116,178-188`：标签常量、非执行标签错误和严格 parser。
- `apps/platform-web/src/agent-runtime/text-tool-protocol.ts:357-380`：压缩交互识别和工具名提取当前依赖 assistant call-records。
- `apps/platform-web/src/agent-runtime/context-lifecycle.ts:739-760,807-920`：task 压缩提示构造、call key、native/text 原子分组和未解决失败固定保留。
- `apps/platform-web/src/agent-runtime/context-lifecycle.ts:922-995`：保留最近 N 组、一次性语义摘要早期交互、产出 user checkpoint。
- `apps/platform-web/src/agent-runtime/orchestration/message-formatting.ts:20-55`：provider 调用前合并连续同 role 字符串消息，不修改内部数组；多模态内容不合并。
- `apps/platform-web/src/platform-host/runtime-turn.ts:396-405`：失败时 discard transaction 后重新抛错。

## Spec Contracts

- `.trellis/spec/platform-web/frontend/type-safety.md:488-492`：text/native 是并列模式；唯一 executable tag 为 `<tsian-tool-calls>`；非执行历史标签回显必须进入 bounded protocol retry。
- `.trellis/spec/platform-web/frontend/type-safety.md:519-530`：无效 JSON、非数组、空数组、历史标签均为协议错误；失败/中止后持久状态等价于回合前。
- `.trellis/spec/platform-web/frontend/type-safety.md:852-858`：跨回合 Tool memory 是受限语义投影；原始 observation、call arguments 和 provider 协议消息不持久化为模型历史。
- `.trellis/spec/platform-web/frontend/type-safety.md:1106-1113`：protocol 使用 accepted observation 原值；UI presentation、audit 和 model delivery 是独立消费者。
- `.trellis/spec/platform-web/frontend/quality-guidelines.md:389-398`：text manifest 与 native 共享 schema；历史标签是非执行 runtime artifact；消息层级和缓存边界必须保持。
- `.trellis/spec/guides/ai-facing-content-changes.md`：删除诱发概念时清除 AI-facing 残留；新增约束使用正向重定向，避免完整负例反向诱导。
- `.trellis/spec/guides/prompt-self-contained-and-tone.md`：提示只描述模型要执行的动作、判据和输出，不混入开发侧因果解释。

## Existing Verification Surface

- `apps/platform-web/src/integration/assistant-runtime.smoke.test.ts:302-323`：当前 text tool round fixture 是 assistant call-records + user observations。
- `apps/platform-web/src/integration/assistant-runtime.smoke.test.ts:360-457`：已有 native/text task 压缩、并行组、失败固定保留和 resolved unpin smoke。
- `apps/platform-web/src/integration/assistant-runtime.smoke.test.ts:879-1050`：已有 scripted provider、成功事务提交和失败事务回滚 harness，可扩展 text-mode 纠错链。
- 验证命令：`npm run test:smoke:web`、`npm run build:web`、`git diff --check`。
