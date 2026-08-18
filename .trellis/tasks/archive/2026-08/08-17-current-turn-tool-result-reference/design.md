# Design: 当前轮长工具结果引用

## 1. MVP Contract

生产者仅为最终 accepted 的成功 `agent_call.response`，消费者仅为后续 `run_script` 的顶层 action input 字段。公开形状为：

```json
{
  "status": "completed",
  "targetAgent": { "id": "storyteller", "title": "Storyteller" },
  "response": "完整正文",
  "responseRef": "tool-result-0"
}
```

```json
{
  "skill": "开局建模",
  "script": "commit_opening",
  "input": { "summary": "..." },
  "inputRefs": { "openingReply": "tool-result-0" }
}
```

不支持其他结果字段、递归路径、数组索引、JSON Pointer、切片或跨循环消费。

## 2. Registration Flow

`RuntimeWorkspaceToolSessionState` 增加 `toolResultRefs: Map<string, string>` 与递增序号。每个 entry 或 delegated Agent tool loop 创建自己的 state，因此父/子 Agent、不同 turn 和不同 `invokeAgent` 调用天然隔离。

`agent_call` 完成后，执行器先构造带候选 `responseRef` 的 observation，再执行现有 acceptance gate。只有带引用的 observation 通过 JSON 安全和 32 KiB 上限后，才在同步临界段注册原始 `response` 并推进序号。失败、超限或非字符串响应不注册。

## 3. Resolution Flow

`executeRunScript` 的顺序调整为：

1. 规范化 `skill`、`script`、`input` 与 `inputRefs`。
2. 解析 `inputRefs`，拒绝无效映射、未知/过期引用和与 `input` 的字段冲突。
3. 得到新的普通 action input。
4. 解析 Skill action，执行现有 action input schema 校验和 executor policy。
5. 创建 savepoint 并运行 browser script。

脚本、action declaration 和 `commit_opening` 不感知引用机制。引用类型固定为字符串；目标字段的最终类型仍由既有 action schema 约束。

结构化错误：

- `TOOL_RESULT_REFS_INVALID`：`inputRefs` 或其字段/值格式非法。
- `TOOL_RESULT_REF_CONFLICT`：目标顶层字段同时出现在 `input` 与 `inputRefs`。
- `TOOL_RESULT_REF_NOT_FOUND`：引用未知、过期或来自另一个 loop。
- `ACTION_INPUT_INVALID`：引用解析后不满足 action schema。

## 4. Non-Persistence

- registry 不暴露给 browser script SDK，不写入 workspace/Dexie/history。
- accepted observation 保留原始 `response`；registry 不成为可独立修改的数据权威。
- Tool memory 的 exact-field 投影显式忽略 `responseRef`；UI presentation 继续忽略该字段。
- 当前工具循环结束即丢弃 state。同一引用在循环内可重复读取，但不能跨 turn 重放。

## 5. Skill Integration

开局建模阶段 5 从 storyteller observation 获取 `response` 与 `responseRef`。阶段 6 仍直接核对 `response` 正文终点；阶段 7 的 `commit_opening` 调用从 `input` 省略 `openingReply`，改用 `inputRefs.openingReply=responseRef`。若引用失败，按 action 错误停止，不重新复制正文或绕过原子提交。

## 6. Compatibility And Rollback

原有 `run_script.input` 调用保持不变；`inputRefs` 可选。无旧记录迁移、无 Provider 专用 ID、无 `commit_opening` 特判。回滚必须同时移除 model schema、session registry、observation 字段、resolver 与 Skill 指引。
