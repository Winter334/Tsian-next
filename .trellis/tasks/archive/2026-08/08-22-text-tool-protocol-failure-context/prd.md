# 文本工具协议失败上下文恢复

## Goal

当 Text Tool Protocol 无法解析模型本轮响应时，让下一次纠错调用看见自己刚刚生成但未执行的原始响应和真实解析错误，从原调用继续修正，而不是因上下文缺失重新调查或重建任务。

## Background

- 成功解析的文本工具轮会通过 execution report 向下一轮提供规范化调用记录和执行结果；工具执行失败同样保留调用参数与错误 observation。
- 当前协议解析失败分支只向 `nextMessages` 放入通用纠错 user 消息，未放入刚刚被拒绝的 assistant 响应（`apps/platform-web/src/agent-runtime/index.ts:1774`）。因此模型知道“上一轮未执行”，却看不到具体失败内容。
- parser 已保留本地生成的实际错误消息，例如 JSON 解析位置（`apps/platform-web/src/agent-runtime/text-tool-protocol.ts:211`）；当前格式化逻辑将其替换为按错误码生成的泛化原因（`apps/platform-web/src/agent-runtime/text-tool-protocol.ts:435`）。
- 既有纠错预算按错误码累计，只保留最新纠错消息，并在合法工具调用后清理（`apps/platform-web/src/agent-runtime/index.ts:1784`）。本任务延续该单次工具循环边界。

## Requirements

- R1. `parseResult.kind === "protocol_error"` 时，下一次模型请求必须包含上一轮完整原始 assistant 响应，并保持其 assistant 角色；该响应仅作为本轮纠错上下文，不得执行。
- R2. 纠错 user 消息继续提供结构化错误代码与剩余次数，同时提供 parser 产生的实际错误消息，不再只给泛化原因。
- R3. 同一纠错 episode 只保留最近一组“失败 assistant 响应 + 纠错 user 消息”。再次解析失败时整体替换，不能逐轮累积。
- R4. 一旦得到合法工具调用，失败响应与纠错消息必须一并移除；现有错误计数清理、工具执行和 observation 回灌行为保持不变。
- R5. 失败响应不得进入正式会话历史、Tool Memory、UI timeline、workspace 或跨 turn context。现有 parser-approved interim/thought 展示逻辑保持不变。
- R6. 保持严格 JSON、唯一可执行标签和现有按错误码重试预算；不加入 JSON5、启发式自动修复、失败调用自动执行或 Skill 特判。

## Acceptance Criteria

- [x] AC1. 首次协议解析失败后的下一次 provider 请求中，最近一次原始失败响应以 assistant 消息出现一次，随后是包含错误代码、实际 parser 错误和剩余次数的纠错 user 消息。
- [x] AC2. 连续两次协议解析失败时，第三次 provider 请求只包含第二次失败响应及其纠错消息，不保留第一次失败组合。
- [x] AC3. 失败响应中的工具调用从未执行；修正后的合法调用只执行一次，并继续产生现有 execution report。
- [x] AC4. 合法工具调用后发起的后续 provider 请求不再包含已解决的失败响应或纠错消息，协议错误计数按现有规则清空。
- [x] AC5. 最终持久化会话、Tool Memory 和 UI timeline 不含失败工具响应原文；现有安全 interim/thought 投影不回归。
- [x] AC6. 既有不同错误码独立预算、交替错误终止、缺失闭合标签兜底和正常文本终止行为继续通过测试。

## Out of Scope

- Native Tool Calling 的消息结构。
- 已成功解析后发生的工具/action 业务错误；它们已有调用记录和 error observation。
- 自动修复或宽松执行非法 JSON。
- 修改开局建模 Skill、脚本可见性、Agent workspace 权限或前端交互。
- 为失败响应新增长期持久化、诊断副本或专用数据结构。

## Technical Notes

- 任务范围集中在 Text Tool Protocol 循环及既有 Assistant Runtime smoke 场景，可按轻量任务执行，PRD-only。
- 实现应复用现有 `protocolCorrectionMessage` 的替换/清理生命周期，以成对管理最近一次失败 assistant 消息；不建立新的跨循环状态。
- 验证至少运行相关 smoke 测试、`npm run build:web` 和 `git diff --check`。
