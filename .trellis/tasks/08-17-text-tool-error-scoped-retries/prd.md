# 文本协议按错误类型纠错预算

## Goal

让文本工具协议按具体错误类型继续纠错，避免模型已经从一种格式错误推进到另一种错误时被共享总预算提前中止，同时可靠终止同类错误或错误循环。

## Background

- 当前 `TEXT_TOOL_PROTOCOL_MAX_RETRIES = 3` 表示初始非法响应后最多再调用模型 3 次。
- `apps/platform-web/src/agent-runtime/index.ts` 使用单一 `protocolErrorRetriesRemaining`；任何协议错误都会递减同一个值，只有合法工具调用才重置。
- 真实链路为多次 `NON_EXECUTABLE_TAG` 后切换到 `INVALID_JSON`。最后一次响应已经使用正确标签，却因旧预算归零而没有收到 JSON 转义纠错。
- Provider-bound 上下文只保留最新纠错消息的改动已经存在于当前未提交基线中，应继续保留。

## Requirements

- R1. 用当前纠错 episode 内的按错误代码计数替代单一剩余次数。
- R2. 同一错误代码第一次失败后仍最多提供 3 次纠错调用；该代码第 4 次失败时终止。
- R3. 新错误代码首次出现时从 3 次纠错机会开始，不继承其他代码的已消耗次数。
- R4. 错误代码计数不因出现另一错误而清空；A→B→A 里的第二个 A 是 A 的第二次失败。
- R5. 合法工具调用成功后清空所有错误代码计数；普通最终答复直接结束。
- R6. 纠错消息只保留当前最新错误，并明确 `retryRemaining` 是当前错误类型的剩余纠错次数。
- R7. 最终异常必须报告触发终止的错误代码与消息，不吞掉 staged transaction 失败。
- R8. Text/native API 请求重试保持在 runtime-host 层，不与协议纠错计数混合。

## Acceptance Criteria

- [ ] AC1. 首次 `NON_EXECUTABLE_TAG` 纠错显示 remaining=3；随后首次 `INVALID_JSON` 也显示 remaining=3。
- [ ] AC2. 同一代码连续或交替出现到第 4 次时终止，不发出该代码的第 4 次纠错调用。
- [ ] AC3. A/B 交替最终会因某个代码达到上限而终止，不存在无限循环。
- [ ] AC4. 合法工具调用后再次出现某错误时按新 episode 的首次错误计算。
- [ ] AC5. Provider-bound 请求始终至多包含一条协议纠错，成功工具轮后不残留纠错。
- [ ] AC6. 现有集成 smoke 的错误序列断言按“每错误类型预算”更新，不新增独立专项测试文件。
- [ ] AC7. `npm run build:web`、`git diff --check` 和必要主干 smoke 通过。

## Out of Scope

- 根据错误文本位置或完整模型响应建立模糊指纹。
- 自动修复 JSON 或兼容 Provider 原生 `<tool_call>` 格式。
- 修改网络层 408/429/5xx 重试策略。
