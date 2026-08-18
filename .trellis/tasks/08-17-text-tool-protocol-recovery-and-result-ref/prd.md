# 文本工具协议恢复与长结果引用

## Goal

让文本工具协议在模型逐步修正格式时继续推进，并让 Agent 能以短引用把当前工具循环中的长文本结果交给后续 Skill action，避免重新生成大段嵌套 JSON 导致引号、括号或供应商原生工具标记污染。

## Background

- GLM 在 `<tool_call>` 下稳定混入函数式、属性式和 `<arg_value>` 原生工具语法；唯一可执行标签已恢复为私有 `<tsian-tool-calls>`，`<tool_call>` 只进入纠错。
- 当前工作区已有未提交的协议改动：显式闭合提示、完整 JSON 缺闭合标签时的严格兜底、只保留最新纠错消息、恢复成功后移除纠错消息。
- 当前全局 `protocolErrorRetriesRemaining` 不区分错误代码。模型从 `NON_EXECUTABLE_TAG` 进展到 `INVALID_JSON` 时，后者会被前者已消耗的预算直接掐断。
- `agent_call` 返回 `{status,targetAgent,response}`（`apps/platform-web/src/agent-runtime/index.ts:975`）；`run_script` 在 action schema 校验前直接使用模型提供的 `input`（`apps/platform-web/src/agent-runtime/workspace-tools/skill-actions.ts:384-440`）。
- `RuntimeWorkspaceToolSessionState` 当前只保存已加载 Skill（`workspace-tools-types.ts:514-516`），天然是当前工具循环内、非持久化状态的落点。
- 真实失败中，storyteller 正文在 observation 内是合法转义字符串；world-architect 将其重新嵌入 `commit_opening.input.openingReply` 时丢失正文双引号转义并破坏尾部括号层级。
- 既有 “Agent Tool Observation 契约治理” 明确要求 accepted observation 是即时权威结果，并把通用 artifact 系统延期；本任务只解决已出现的当前循环跨工具复用，不建立持久化 artifact 或第二份正文权威。

## Requirements

### R1. 保持私有、严格的可执行文本协议

唯一可执行文本标签保持 `<tsian-tool-calls>...</tsian-tool-calls>`。模型原生 `<tool_call>`、历史/observation/error 标签和供应商特有 `<arg_value>` 不得兼容执行或自动修复。

### R2. 按错误类型治理纠错预算

协议错误预算按错误代码分别记录。一个新错误类型首次出现时拥有完整纠错机会；同一错误类型反复达到上限才终止。合法工具调用成功后清空本轮错误计数。

### R3. 防止不同错误交替形成无限循环

错误类型变化不得简单清空所有历史计数。同一错误代码的出现次数在一次连续纠错 episode 内累计，即使中间夹有其他错误；因此 A→B→A→B 最终仍会因 A 或 B 达到上限而终止。

### R4. 当前循环长结果引用

MVP 只为当前工具循环内已接受的 `agent_call.response` 提供短 `responseRef`。后续 `run_script` 通过顶层 `inputRefs: { <actionInputField>: <responseRef> }` 把引用解析为 action input 的顶层字段，再执行既有 action schema 校验与脚本；不要求模型重新序列化正文。

### R5. 引用不成为第二数据权威

引用值只存在于当前 `RuntimeWorkspaceToolSessionState`，不可跨 turn、跨顶层/委派 Agent 工具循环、持久化、压缩进历史或写入隐藏数据库。原始 accepted observation 仍是唯一权威结果。

### R6. Text/native 一致

Text 与 native 模式必须从同一 accepted observation 获得引用标识，并通过同一 `run_script` 输入解析路径消费。不得为某一 Provider 增加专用格式。

### R7. 明确失败，不猜测修复

未知、过期、跨循环、冲突或格式错误的引用必须在 action 执行前返回结构化错误，不得回退成字面量、空字符串、JSON repair 或重新请求模型复制正文。

### R8. 无历史迁移

项目仍在测试阶段，不迁移既有会话、诊断记录或测试存档；只保证新工具循环的契约。

### R9. 测试集保持克制

不新增 Provider 行为模拟或作用面有限的专项测试文件。更新已有核心 parser/runtime smoke 断言，运行构建与必要主干验证；真实模型效果由实际 Provider 调用确认。

## Child Task Map

- `08-17-text-tool-error-scoped-retries`：实现 R2-R3 及对应错误文案、现有断言更新。
- `08-17-current-turn-tool-result-reference`：实现 R4-R7，并调整开局建模 Skill 使用引用提交 storyteller 正文。
- 父任务负责现有未提交协议基线、跨子任务一致性、最终真实场景复核与规范同步。

## Acceptance Criteria

- [ ] AC1. `<tsian-tool-calls>` 是唯一可执行文本标签；`<tool_call>` 与 `<arg_value>` 永不执行。
- [ ] AC2. `NON_EXECUTABLE_TAG` 消耗自身预算后，首次 `INVALID_JSON` 仍获得完整的当前错误纠错预算。
- [ ] AC3. 同一错误代码第 4 次出现时终止；A/B 错误交替不能无限运行。
- [ ] AC4. 任一合法工具调用成功后，协议错误计数和过时纠错消息均被清空。
- [ ] AC5. 成功 `agent_call` 返回的长 `response` 带当前循环短 `responseRef`；后续 `run_script.inputRefs.openingReply` 可用该引用为 `commit_opening.openingReply` 提供原始字符串。
- [ ] AC6. 被引用正文逐字保持，包括换行、ASCII/中文引号和 `[[选项]]`；模型不需要在调用 JSON 中再次内联正文。
- [ ] AC7. 未知、过期、跨循环或冲突引用在脚本开始前失败，且不产生 staged workspace mutation。
- [ ] AC8. Text/native 两种模式共享同一引用注册和解析逻辑；会话历史、Tool memory、UI timeline 不持久化引用值副本。
- [ ] AC9. 既有 Tool observation 32 KiB 接受上限、事务回滚、workspace trust boundary 与调用/结果 ID 对齐保持不变。
- [ ] AC10. 不迁移旧记录，不添加 `arg_value`/JSON 自动修复，不新增窄专项测试文件；必要构建和主干检查通过。

## Out of Scope

- 持久化或跨 turn 的通用 artifact 存储。
- 自动把任意超限 Tool result 写入 workspace。
- 为其他 Tool result 生产引用、递归解析嵌套字段或支持任意 JSONPath/JSON Pointer。
- JSON5、宽松 JSON、未转义引号修补或供应商原生工具语法兼容执行。
- 改变 storyteller 正文、`commit_opening` 业务校验或玩家可见开局内容。
