# Design: 文本工具协议恢复与长结果引用

## 1. Scope And Boundaries

本任务包含两个独立机制：

1. 文本协议纠错预算从全局剩余次数改为当前纠错 episode 内按错误代码累计。
2. accepted `agent_call.response` 在当前 Agent 工具循环内注册为短引用，由后续 `run_script` 顶层 action input 消费。

两者共享现有 Agent Runtime 工具循环，但不共享状态或错误码。网络层 408/429/5xx 重试、native Provider 工具语法、workspace transaction、observation 32 KiB 接受上限和跨 turn Tool memory 语义保持不变。

唯一可执行文本格式仍为一个显式闭合的 `<tsian-tool-calls>...</tsian-tool-calls>` 严格 JSON 数组块。当前未提交基线中的闭合提示、完整 JSON 缺闭合标签严格兜底、最新纠错替换和成功后移除纠错继续保留。

## 2. Error-Scoped Correction Budget

文本工具循环持有 `Map<errorCode, occurrenceCount>`：

- 某错误代码第 1 次出现时发送第 1 条纠错，`retryRemaining=3`。
- 第 2、3 次出现时分别发送纠错，`retryRemaining=2/1`。
- 第 4 次出现时不再调用模型，抛出包含该错误代码与原消息的耗尽错误。
- 其他错误代码出现时不清除此 Map，因此 `A -> B -> A -> B` 会分别累计并最终终止。
- 任一合法 `tool_calls` 轮清空全部错误计数并移除最新纠错消息；普通最终答复直接结束。

计数键只使用 parser 的结构化 `error.code`，不使用完整错误文本或 JSON 位置，避免同一错误因动态位置变化逃逸预算。

## 3. Current-Loop Result Reference

### 3.1 Session State

`RuntimeWorkspaceToolSessionState` 增加当前循环私有 registry 与递增序号。引用 ID 采用 Provider 无关的 `tool-result-<n>`，值只允许不可变字符串。状态由每次 entry/delegated Agent 工具循环各自创建；不进入 workspace、Dexie、会话历史、UI timeline 或跨 turn context。

### 3.2 Producer And Acceptance Order

仅成功 `agent_call` 且结果中 `response` 为字符串时准备引用：

1. 生成候选 `responseRef`，把它加入候选 observation 的 result。
2. 对包含 `responseRef` 的完整候选 observation 执行既有 JSON/32 KiB acceptance gate。
3. 只有最终 observation 仍为成功时，才把 `response` 按该 ID 注册到 session registry。
4. observation 被拒绝或 `agent_call` 失败时不注册引用。

因此模型在 text/native 两路看到同一个 accepted `{ status, targetAgent, response, responseRef }`，引用不会绕过最终大小校验，也不会指向未被模型接受的结果。

### 3.3 Consumer Contract

`run_script` 增加可选顶层参数：

```json
{
  "skill": "开局建模",
  "script": "commit_opening",
  "input": { "entities": [], "scenes": [] },
  "inputRefs": { "openingReply": "tool-result-0" }
}
```

解析规则：

- `inputRefs` 必须是字符串字段名到非空引用 ID 的对象，只解析 action input 顶层字段。
- 目标字段已在 `input` 中显式提供时返回 `TOOL_RESULT_REF_CONFLICT`，不比较或覆盖值。
- 引用不存在（包含未知、过期和跨循环）时返回 `TOOL_RESULT_REF_NOT_FOUND`。
- 映射格式无效时返回 `TOOL_RESULT_REFS_INVALID`。
- 解析生成新的普通 action input，然后执行现有 action schema 校验；类型不匹配继续返回 `ACTION_INPUT_INVALID`。
- 全部解析与 schema 校验均发生在 browser script/savepoint 之前，失败不产生 staged mutation。

同一引用可在当前循环重复读取；读取不删除 registry 值。MVP 不支持其他 Tool producer、嵌套路径、数组索引、JSON Pointer 或值切片。

## 4. Persistence, Memory And Presentation

- accepted observation 中的 `response` 仍是 Agent 当轮对齐正文的权威结果；registry 只是同字节的短期传递缓存，不允许独立改写。
- `responseRef` 不进入 `AgentContextSnapshot.toolMemories` 的 exact 字段；跨 turn memory 不能使引用看起来仍可消费。
- `buildToolPresentation` 继续只投影截断后的 `response`，忽略 `responseRef`；普通 UI 与持久化 timeline 不展示引用。
- Text/native 都通过共享 tool executor 注册、通过共享 `run_script` 解析，不增加 Provider 分支。

## 5. AI-Facing Workflow

`run_script` schema 简要说明 `inputRefs` 的用途、顶层限制和冲突规则。开局建模 Skill 在 storyteller 返回后保留正文用于阶段 6 对齐；阶段 7 调用 `commit_opening` 时从 observation 读取 `responseRef`，在 `inputRefs.openingReply` 中传递，并从内联 `input` 省略 `openingReply`。

提示只展示正确用法，不宣传缺闭合兜底、不加入 `<tool_call>`/`<arg_value>` 兼容示例，也不要求模型理解 registry 生命周期实现。

## 6. Compatibility And Migration

- `inputRefs` 是 `run_script` 的可选新增参数；原有内联 `input` 完全兼容。
- 不迁移旧会话、诊断记录、测试存档或旧工具历史。旧文本中的 `tool-result-*` 在新循环中只会得到 not-found。
- 不引入 persistent artifact、隐藏数据库、JSON repair 或 `commit_opening` 名称特判。

## 7. Risks And Rollback

- 并发 `agent_call` 的引用分配必须在无 `await` 的注册临界段完成，保证 ID 唯一；observation 顺序仍按原 call index 对齐。
- 若临时引用被 Tool memory exact 字段收集，会形成不可用的跨 turn 标识；实现必须显式排除 `responseRef`。
- 若 resolver 放在 action schema 校验之后，required 字段会提前失败；若放在脚本执行之后，则可能泄漏写入。顺序必须固定为“解析引用 -> action schema -> policy -> script”。
- 纠错预算与结果引用可分别回滚。结果引用应整体回滚 session state、observation 字段、`run_script` schema/resolver 与 Skill 提示，避免留下不可消费的半契约。

## 8. Verification Strategy

只扩展既有 `assistant-runtime.smoke.test.ts` 的核心运行时场景，不新增专项测试文件：

- 覆盖不同错误代码各自获得完整预算、A/B 交替累计、同码第 4 次终止和合法调用清零。
- 覆盖 accepted `agent_call` 产生 `responseRef`，`run_script.inputRefs` 将含换行/引号/选项块的原字符串交给 action。
- 在同一主干场景中抽样冲突或未知引用的执行前失败与 staged workspace 不变。
- 断言 `responseRef` 不进入跨 turn Tool memory/UI presentation。

运行 `npm run test:smoke:web`、`npm run build:web` 与 `git diff --check`。真实 Provider 的闭合标签与纠错效果以用户实际调用复核为准，不增加 Provider 行为模拟测试。
