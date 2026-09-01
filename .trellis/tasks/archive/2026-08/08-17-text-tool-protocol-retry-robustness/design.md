# Design: Text Tool Protocol 纠错与执行历史治理

## Scope

改动集中在 `apps/platform-web/src/agent-runtime/**` 及既有 Assistant Runtime smoke。原生工具调用、共享执行器、workspace 事务和 provider 请求重试不变。

## Safety Invariants

1. 唯一可执行文本格式仍是一个 `<tsian-tool-calls>` JSON 数组块。
2. 执行历史、observation、协议错误和旧 `<tsian-tool-call-records>` 都是非执行数据；模型回显时只能进入协议纠错，绝不直接执行。
3. JSON 继续使用严格 `JSON.parse`。不引入 JSON5、通用 repair 或参数语义猜测。
4. 工具仅在完整解析与校验成功后执行一次；纠错响应不会产生部分执行。

## Model-Facing Execution Report

合法工具轮执行后，runtime 直接构造一条 user 消息：

```text
Text Tool Protocol execution report:
<tsian-executed-tools>[{"id":"text-r0-c0","name":"read","arguments":{"path":"save/a.json"}}]</tsian-executed-tools>
<tsian-tool-observations>[{"id":"text-r0-c0","name":"read","ok":true,"result":{...}}]</tsian-tool-observations>
Use these completed results to continue. If another tool is needed, emit one <tsian-tool-calls> block; otherwise answer normally without protocol tags.
```

- `<tsian-executed-tools>` 取代新生成历史中的 `<tsian-tool-call-records>`，保留 id/name/arguments。
- observation 继续使用 accepted observation，不做第二次压缩或投影。
- 图片结果与上述报告文本放在同一 `ContentPart[]` user 消息中，避免相邻同角色消息在多模态路径无法整合。
- 旧 `<tsian-tool-call-records>` 仍由剥离器和非执行标签检测器识别，防止旧模型习惯被误判为普通最终文本；runtime 不再生成该标签。
- 原始执行报告只活在当前工具循环。跨回合仍仅保留现有语义 `toolMemories`。

## System Prompt

- 只保留一个完整正例：`<tsian-tool-calls>[{"name":"TOOL_NAME","arguments":{}}]</tsian-tool-calls>`。
- 删除完整历史标签负例，避免反向强化。
- 用正向规则说明：runtime user 消息中的 executed-tools/observations 是已经完成的结果；新的工具请求只使用 executable tag。
- 无工具需求时正常回答，不输出任何协议标签。

## Correction Loop

`TEXT_TOOL_PROTOCOL_MAX_RETRIES = 3` 表示初始响应失败后，最多再调用模型纠错 3 次，总计最多 4 个连续协议响应。预算在合法 `tool_calls` 轮后重置；普通最终答复结束本轮。

每次可重试错误注入一条 runtime user 纠错消息，包含：

- 错误代码和短原因；
- “上一响应未执行”；
- 当前剩余纠错次数（含即将进行的这次）；
- 按错误代码选择的修正动作；
- 唯一正确调用模板；
- 无需工具时正常作答的出口。

纠错动作矩阵：

| 错误类别 | 修正动作 |
|---|---|
| `INVALID_JSON` | 重新生成完整严格 JSON 数组；使用双引号，转义换行、引号和控制字符；禁止注释、尾逗号 |
| `NON_EXECUTABLE_TAG` | 将意图重新表达为 executable block；不复制 executed-tools/observations/error 标签，不携带 runtime id |
| `BLOCK_UNCLOSED` / `MULTIPLE_BLOCKS` | 只输出一个开闭匹配的 executable block |
| `CALLS_NOT_ARRAY` / `CALLS_EMPTY` | 使用非空 JSON 数组；无需工具则退出协议并正常作答 |
| `CALL_INVALID` / `TOOL_NAME_REQUIRED` / `ARGUMENTS_INVALID` | 每项使用 `{name, arguments}` 对象，name 为非空字符串，arguments 为对象 |

不把完整被拒响应回放进 assistant 历史。模型根据当前任务上下文重新生成调用，避免再次强化错误协议块。

## Task Compression

文本模式的 task 分组改为解析单条 user 执行报告中的 `<tsian-executed-tools>` 与 `<tsian-tool-observations>`：

1. 以 id 对齐调用与 observation，得到 name/arguments/status。
2. 一条执行报告计为一个完整工具轮；并行调用保持同一组。
3. 最近 `taskKeepRecentRounds`（默认 5）组保留原文。
4. 未被后续同 key 成功调用解决的失败组继续固定保留。
5. 其余早期报告与旧 checkpoint 一次性送入现有语义压缩模型。

`locateTaskInteractionSpan` 和工具名提取改为按新标签识别 user 报告；protocol-error user 消息仍属于工具交互段。role 不再是文本执行报告的识别条件。

## Compatibility

- 无存储迁移：原始协议消息不跨回合持久化。
- 无 provider 配置迁移。
- 原生工具调用路径和压缩分组保持原样。
- 旧历史标签只保留为拒绝/剥离输入，不继续出现在 AI-facing 正常历史或正例中。

## Verification

- 更新既有 Assistant Runtime smoke 的文本压缩 fixture 为单条 user 执行报告，验证最近轮、并行 id 对齐和未解决失败固定保留。
- 增加 scripted text-mode runtime 场景：无效 JSON → 旧历史标签 → 未闭合块 → 合法写调用 → 最终答复；断言只执行一次且报告只在 user 消息中。
- 增加耗尽场景：连续 4 个无效协议响应后失败，不发起第 5 次协议尝试，事务保持基线。
- 检查首轮系统提示无完整错误块且包含唯一正例；检查每种错误提示包含对应修正动作和剩余次数。

### Regression Test Retention

- 优先把同一协议族的输入变体合并为表驱动测试，把跨层成功/回滚链保留为少量端到端 smoke。
- 不永久保留仅证明某个临时实现分支、重复验证相同契约或逐字绑定非契约文案的专项断言。
- 必须保留唯一执行、防历史重放、纠错上限、事务回滚、ID 对齐、多模态消息和压缩固定失败等安全/数据完整性边界，除非已有更通用测试覆盖同一失败模式。
- 每次任务收尾审计本次触及的测试文件；“没有可清理项”是有效结果，不为减少测试数量而删除必要防线。

## Rollback

回滚点局限于文本协议 formatter/parser、文本工具循环、文本 task 分组、smoke fixture 和对应规范。若新执行报告出现兼容问题，可整体恢复旧 assistant-record/user-observation 双消息形态；不得单独放宽历史标签执行限制。
