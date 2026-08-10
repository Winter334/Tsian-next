# 真实开局请求/响应诊断

## 证据范围

- 附件是玩家第一次回答“萧澈”时发出的第二轮 Provider 请求；其中携带上一轮持久 assistant 回复、本轮 injection、Skill 激活和本轮 tool calls。
- 附件不包含首轮 Provider 的完整 tool-call 轨迹，因此不能只凭此文件证明首轮具体调用名；但上一轮回复和当前 Skill 足以还原最可能路径。

## 阅读序列

上一轮 assistant 回复声称已经“通览开篇”，列出四名原著候选，但其完整隐藏状态是：

```json
{"revision":1,"processedAttemptId":"start","readSlices":[],"decisions":{},"unresolved":{}}
```

当前 Skill 明确要求原著首轮先调用 `inspect_source_opening`。该 action 默认读取前 8 章、每章最多 700 字的预览，但 inspect 覆盖不会进入 `readSlices`。第二轮请求中 Agent 调用了：

```json
{"skill":"开局建模","script":"read_opening_slice","input":{"startIndex":1,"endIndex":3,"maxCharacters":30000}}
```

并获得序章、第 1 章、第 2 章共 9783 字全文。因此实际是“开篇预览 -> 选定主角后读取三章正文”，存在内容重叠，但不是同一个 action 的完全重复。

直接原因：

1. 阅读策略本来就是粗读候选、再按玩家选择精读；
2. `persist:true` 的 sidecar context 只保存 user/assistant 文本，不保存 provider tool observation；
3. `readSlices` 记录已读引用，却不保存正文或事实摘要；首轮 inspect 又完全不计入 `readSlices`；
4. 下一轮若需要上一轮最终回复没有写出的具体证据，只能再次读取源文本。

因此重复读取不是前端恢复失败触发的重试，而发生在前端收到最终响应之前。当前设计降低首轮完整阅读成本，但会付出跨轮预览重叠和额外 tool call。

## 恢复失败

前端 `finishResolvedInvocation` 首先调用 `parseOpeningAssistant`；解析返回 `null` 时直接抛出“访谈回复缺少有效的恢复信息”。本次 session/source/branch/revision/attempt 和章节 ref 均可通过，真正失败的是内容状态形状：

1. 响应写成：

   ```json
   "decisions": {
     "protagonist": {"mode":"canon","ref":"character:萧澈","name":"萧澈"}
   }
   ```

   但 `decisions.*` 只接受 `{ "value": string, "evidenceRefs"?: string[] }`；主角摘要应位于顶层 `protagonist`。

2. 响应写成：

   ```json
   "unresolved": {"openingEntry":"新房苏醒|迎亲出发前|由你决定"}
   ```

   但 `unresolved.*` 只接受 `{ "reason": string }`。

正确形态至少应为：

```json
{
  "protagonist": {"mode":"canon","ref":"character:萧澈","name":"萧澈"},
  "decisions": {
    "protagonist": {"value":"萧澈","evidenceRefs":["source:chapter-0002"]}
  },
  "unresolved": {
    "openingEntry": {"reason":"等待玩家选择新房苏醒、迎亲出发前或由 Agent 决定"}
  }
}
```

Skill 只说 `decisions` / `unresolved` 是稳定 key 的对象，并只给出两个空对象示例，没有向 Agent 声明非空 entry schema。严格契约只存在于前端 TypeScript 中，Agent 无法可靠知道该形状。这是 prompt 自包含缺口，不是单纯模型随机失误。

由于 malformed assistant 已由 persistent invocation 写入 sidecar context，当前恢复遍历会在该 assistant 处 fail-closed；“重新检查”仍会读到同一无效记录，无法自行修复。

## 附带问题

- 同一轮 assistant 发出两个 `run_script` tool call：一个参数 `{}`，返回 `ACTION_SKILL_REQUIRED`；另一个参数完整并成功读取。空调用增加一次无效观察，但不导致最终恢复失败。
- `readSlices.start/end` 的单位未在 Skill 中定义。本次模型把章节序号重复写成每个 ref 的 start/end；前端只校验整数与 ref，因此接受，但这些范围缺乏稳定语义。
- 第二轮玩家可见文案称“第一个问题”，但实际上角色选择已经是上一问；属于轻微文案偏差。

## 初步修复方向

### 跨轮 Tool 上下文

项目已有适合复用的 `AgentContextSnapshot.toolMemories`，无需保存完整 provider Tool 协议或 raw observation。它由已投影的 observation 生成，只保留有界 summary、args summary、anchors、状态和稳定 id；近期记录保留摘要，较老记录可退化为只说明执行过该动作的 placeholder。

当前开局 sidecar 没有真正使用它，存在两个独立断点：

1. `apps/platform-web/src/agent-runtime/index.ts:2154-2163` 已返回 `contextUpdate.toolMemories`，但 `apps/platform-web/src/platform-host/ai-invocation.ts:467-475` 调用 `stageAgentContextFile` 时未传该字段，`history-turns.ts:106-135` 的输入也没有接收它。
2. `apps/platform-web/src/agent-runtime/index.ts:535-555` 用 Agent 路径判断 `isAssistant`，只为 `.tsian/local/` 桌面助手渲染 `toolMemories`。`world-architect` 的 side invocation 虽在 `ai-invocation.ts:384-389` 明确运行于 task compression mode，仍被排除。

因此第二轮实际只能从 `context-<slot>.json` 得到上一轮 user/assistant 正文；隐藏 `[[开局会话]]` 因为属于 assistant 正文而可见，但上一轮 Tool call、Tool output 和它们的有界 memory 均不可见。同一 Tool loop 内仍会看到本轮 Tool observation，这与跨用户轮次是两回事。

最小一致修复是让持久 task-mode Agent 写回并注入已有 Tool memory，而不是增加 Agent id 特判。它只回答“做过什么、结果概要和权威 anchors 是什么”，不替代：

- `[[开局会话]]`：业务决策、未决项、revision/attempt 幂等状态；
- workspace/source：事实权威与需要细节时的按需重读；
- UI timeline / diagnostics：展示与审计。

这也与原有 environment 设计一致：persistent side invocation 是 task-mode，能力应由环境/模式表达，不应依赖“桌面助手路径”判断。

### 阅读策略

- 保留粗读后精读：首轮更快，但允许一次预览重叠；应把文案改为“根据开篇预览”，并清楚区分 inspect 与全文 read。
- 首轮直接精读固定初始窗口：减少第二轮重复 tool call，但提高首轮延迟；由于 tool observation 不持久，仍需把后续要复用的关键事实写进隐藏状态或最终回复，否则更晚仍可能重读。
- 不建议把全文或 tool observation 持久化进隐藏状态；会复制源文本并快速膨胀 context。

### 状态协议

- 必须向 Agent 补全非空 `protagonist`、`decisions.*`、`unresolved.*` 和 `readSlices` 范围语义，不能只展示空对象。
- 保持 session/source/branch/revision/attempt/ref 的严格 fail-closed。
- 产品决定本次测试会话可直接废弃，只预防未来错误；不增加前端规范化、迁移或原地恢复。
- 字段级错误 UI 有诊断价值，但本次不修改游戏前端，继续保留现有 fail-closed 通用错误。
- 纯 Skill 文案只能补足 Agent-facing schema，不能从机制上保证模型每次手写 JSON 都正确；本次产品决策仍先只完善 Skill 内容，不增加 Skill-local 校验 action。若真实测试后仍不稳定，再另行把进度追踪整体剥离为脚本 action 负责读写，而不是追加一个只做表面校验的脚本。
- 不建议新增始终注入的 world-architect 专用状态 Tool：协议只属于《开局建模》，常驻能力会污染其它任务，并容易与隐藏会话形成第二状态权威。若未来决定脚本化，能力也应作为《开局建模》的 Skill-local action 随 Skill 激活，而不是常驻 Tool。
- Skill/script 无法单独修复已经持久化且在 Agent 调用前就恢复失败的旧记录；本次明确不修复该测试记录，新建会话验证更新后的 Skill。

## 成熟 Agent 参考

- OpenAI 官方 Conversation state 文档说明 Conversations 可跨 session/device/job 持久化，并将 messages、tool calls、tool outputs 等保存为 conversation items；`previous_response_id` 也可把完整响应串成 threaded conversation：<https://developers.openai.com/api/docs/guides/conversation-state>。
- OpenAI 官方 Codex SDK 文档说明同一 thread 可重复 `run()`，也可通过 thread id 恢复后继续：<https://developers.openai.com/codex/sdk>。
- 这并不要求应用永久回放每个原始字节。成熟实现通常在近期上下文保留精确执行项，在长期上下文做摘要/压缩，并另外保留权威 artifact/ref。项目现有 `toolMemories` 正是这种“模型可用、大小有界、与 raw audit 分离”的本地实现。
