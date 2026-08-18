# 当前轮长工具结果引用

## Goal

让调用 Agent 在同一工具循环内以短引用把 `agent_call` 返回的长正文交给后续 `run_script` action，避免模型重新生成带大量换行、引号和嵌套括号的 JSON 字符串。

## Background

- `agent_call` 成功结果当前为 `{status,targetAgent,response}`，同一 accepted observation 同时供 Text/native 消息和 Tool memory 使用。
- `run_script` 当前读取 `input` 后立即执行 action input schema 校验；没有引用解析阶段。
- 当前工具循环已有 `RuntimeWorkspaceToolSessionState`，生命周期正好覆盖一次 entry/delegated Agent loop，且不会持久化。
- `executeRuntimeWorkspaceToolCalls` 保证 `agent_call` group 在 serial `run_script` group 之前完成，但模型需要在下一模型轮看到引用后才可能消费。
- 既有 observation 契约禁止运行时事后裁剪或自动 artifact；本能力只保留当前循环内部、accepted-result 派生的不可变引用。

## Requirements

- R1. 只为已通过最终 observation acceptance gate 的成功结果注册引用；失败或超限结果不得留下可消费引用。
- R2. 引用值为不可变当前循环状态，不写 workspace、Dexie、历史、Tool memory 或 UI timeline。
- R3. 仅 `agent_call.response` 生产引用。Text/native 模式看到同一 `responseRef` 字段；引用 ID 不依赖 Provider 的 tool call id 语法。
- R4. `run_script` 接受顶层 `inputRefs: { <actionInputField>: <responseRef> }`。解析仅覆盖 action input 的顶层字段，并发生在 action schema 校验之前；解析后脚本只收到普通 action input，不感知引用机制。
- R5. 模型显式提供的 action input 与引用目标冲突时 fail loud，不静默覆盖。
- R6. 未知、过期、跨 Agent loop、格式非法或类型不符的引用在脚本执行前失败，不产生 savepoint 后写入。
- R7. 引用消费不删除源值；同一当前循环内可以再次引用，但不能跨 turn 重放。
- R8. 开局建模 Skill 使用引用把 storyteller response 交给 `commit_opening.openingReply`，不再要求模型内联复制正文。
- R9. 原始 `response` 仍保留在 observation 中供阶段 6 对齐；引用不是摘要，也不是第二权威正文。
- R10. 不引入通用持久化 artifact、隐藏数据库或 `commit_opening` 名称特判。

## Acceptance Criteria

- [ ] AC1. 成功 `agent_call` observation 同时包含原始 `response` 和短 `responseRef`，两者指向逐字相同的字符串。
- [ ] AC2. `run_script` 可用 `inputRefs: { "openingReply": responseRef }` 将原始字符串注入 action input 顶层字段，再通过原 action schema 校验；不支持递归路径。
- [ ] AC3. `commit_opening` 收到的 `openingReply` 与 storyteller response 逐字一致，包含换行、引号与选项块。
- [ ] AC4. 引用解析发生在 browser script/savepoint 执行前；解析失败时 workspace staged state 不变。
- [ ] AC5. 同一引用可在当前 loop 内读取多次；新 turn、父/子 Agent loop 或另一 invokeAgent 调用中不可用。
- [ ] AC6. Text/native 使用相同 session registry、公开引用 ID 和错误代码。
- [ ] AC7. 结果引用不会出现在持久化会话、跨 turn Tool memory 或普通 UI presentation 中。
- [ ] AC8. 不改变 accepted observation 大小校验和 `agent_call` UI 8 KiB 展示投影。
- [ ] AC9. 更新开局建模 Skill 与模板镜像，移除“重新内联 openingReply”的诱导；不新增窄专项测试文件。
- [ ] AC10. `npm run build:web`、相关既有 runtime/Skill smoke 与 `git diff --check` 通过。

## Out of Scope

- 跨 turn、跨 Agent loop 或持久化结果引用。
- 自动引用所有 Tool result、任意 JSONPath/JSON Pointer 投影或集合切片。
- 自动把超限 observation 写成 artifact。
- 让 browser script SDK 直接读取 Agent Runtime 私有 session registry。
