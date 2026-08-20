# Gemini 流式工具调用与诊断脱敏修复

## Goal

修复 Gemini 原生流式响应在已经返回 `functionCall` 时仍被平台误判为普通 `stop`、进而导致 Agent 空回的问题；同时补齐 `x-goog-api-key` 在统一诊断记录与导出文本中的凭据识别，避免系统监视器、单条复制和对外诊断包暴露新请求的 Gemini API Key。

## Background and Confirmed Facts

- 最新诊断锚点 `5c86466a-97f1-4309-a75e-024b14759b88` 报错 `Entry agent "world-architect" returned an empty reply.`；对应请求 `07d4b2c1-4c37-43f3-9643-d516efab0b57` 实际成功解析出 `use_skill`、`read` 两个工具调用，但正文为空且被记录为 `finishReason: "stop"`。
- Gemini/NewAPI 的正常响应可以在 `candidates[].content.parts[]` 中返回 `functionCall`，同时使用 `finishReason: "STOP"`。非流式 Gemini 解析已用 `toolCalls.length > 0` 覆盖该 finish reason；流式路径没有保持同一不变量。
- `streamAssistantReplyNative()` 当前优先采用 adapter 返回的显式 finish reason，只有缺失时才根据累积工具调用推断：`apps/platform-web/src/runtime-host/ai/calls.ts:491`。
- Native Agent 工具循环在 `finishReason === "stop"` 时直接返回，即使 `result.toolCalls` 非空：`apps/platform-web/src/agent-runtime/index.ts:1333`。
- `normalizedSecretKey("x-goog-api-key") === "xgoogapikey"`，但该值不在 `apps/platform-web/src/storage/diagnostic-records.ts:39` 的 `SECRET_KEYS` 中；因此新诊断记录可能把 Gemini Key 留在系统监视器和单条复制内容中。
- 当前导出包中的测试 Key 已被 `[redacted]`，但这是密钥值恰好命中 `sk-…` / 已知前缀兜底的结果，不足以覆盖任意格式的 `x-goog-api-key`。
- 统一诊断导出已有第二次结构化与文本脱敏边界；本任务扩充该边界，不引入新的诊断存储或导出路径。
- 仓库在 2026-08-08 的测试收敛任务中主动选择 smoke-only 策略，并删除 126 个专项测试文件；这不是技术限制。当前 `apps/platform-web/src/integration/assistant-runtime.smoke.test.ts` 已有 1424 行。用户决定：这类单点缺陷应通过可独立运行的任务期临时测试验证，验证完成后删除；长期 smoke 只保留“项目关键主链能够正常运行”的精简保底职责，不吸收每个 bug 的专项回归断言。

## Requirements

- R1: Native 流式调用一旦成功解析出至少一个工具调用，本轮最终分类必须为 `tool_calls`，不得被 provider 的 `STOP` / `stop` 覆盖。
- R2: Agent Native 工具循环必须以实际 `result.toolCalls` 是否为空作为是否继续执行工具的权威事实；非空工具调用不得因矛盾的 finish reason 被跳过。
- R3: Gemini 流式工具调用轮必须执行工具、注入 observation，并继续下一轮模型调用，直到获得真实最终文本或发生真实错误。
- R4: 新写入或更新的诊断记录必须把结构化 `x-goog-api-key` 视为凭据，使系统监视器、虚拟诊断文件和单条复制不会包含其原值。
- R5: 诊断包导出必须再次清洗结构化 `x-goog-api-key`，并清洗普通文本中形如 `x-goog-api-key: <value>` 的 header 行；行为不得依赖密钥具有 `sk-`、`AIza` 等特定前缀。
- R6: 不迁移、不批量重写、不删除已有历史诊断记录；修复后的导出边界仍须安全处理旧记录中的该字段。
- R7: 保持其他 provider、非流式调用、普通最终文本、诊断完整文本与现有保留/查询行为不回退。
- R8: 两项缺陷必须分别用可独立运行、失败含义单一的任务期临时测试验证；临时测试在验证完成后删除，不进入长期测试资产、显式 smoke 入口或最终提交。
- R9: 本任务应把“允许任务期临时专项测试，但长期 smoke 不承载单点 bug 精确回归”的准入边界写入平台质量规范。

## Acceptance Criteria

- [x] 模拟 Gemini SSE 先返回 `functionCall`、终止 reason 为 `STOP` 时，平台将该轮判定为 `tool_calls`，执行工具并把 observation 发回下一轮。
- [x] 上述流程随后返回最终文本时，Agent turn 成功完成，不再抛出 `returned an empty reply`。
- [x] 同一响应内一个或多个已解析工具调用都不会因 `STOP` 被跳过；普通无工具的 `STOP` 仍作为最终结束。
- [x] 使用不含 `sk-` / `AIza` 前缀的假 Gemini Key 产生新诊断后，持久化记录、系统监视器数据源和单条复制内容均不包含该原值。
- [x] 对包含结构化或文本形式 `x-goog-api-key` 的记录构建诊断包时，所有导出文件都不包含原值，同时普通请求/响应文本仍完整保留。
- [x] 已有历史诊断记录不做迁移或批量清理。
- [x] 两个任务期临时测试可分别运行并准确定位 Gemini 流式归类或诊断脱敏失败，且修复后均通过。
- [x] 最终工作树不保留临时测试文件，不修改长期测试入口，不向现有 smoke 添加本任务专项断言。
- [x] 质量规范明确长期 smoke 的精简保底职责和任务期临时专项测试的创建、运行、删除规则。
- [x] 现有 smoke、contracts build 和 platform-web build 通过。

## Out of Scope

- 不修改 Gemini/NewAPI base URL 自动补全或模型列表拉取行为。
- 不改变模型自身的 `finishReason`，不为某个中转站增加专用协议分支。
- 不迁移、清理或删除修复前已经存储的诊断记录。
- 不重构统一诊断架构、保留策略、查询协议或系统监视器 UI。
- 不批量恢复此前删除的 provider/storage/diagnostic 测试套件，不新增永久专项测试文件，也不扩充长期 smoke 的单点功能断言。
