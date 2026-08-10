# 开局访谈重复读取与恢复诊断

## Goal

修复开局访谈跨轮看不到既有 Tool 工作摘要的问题，并补全《开局建模》Skill 的状态协议，降低未来回复因状态形状不明确而被前端拒绝的概率；本次测试会话不做兼容或修复。

## Background and Confirmed Facts

- 附件中的第二轮确实调用 `read_opening_slice(1..3)` 并读取 9783 字；首轮完整 Tool 轨迹不在附件中，但上一轮 `readSlices: []` 与 Skill 规则表明首轮最可能调用的是 `inspect_source_opening`。这是“开篇预览后按玩家选择精读正文”的内容重叠，不是同一全文 action 的恢复重试。
- 本次响应的 session/source/branch/revision/attempt 与章节 ref 可通过校验；恢复失败由两个内容 schema 错误独立触发：`decisions.protagonist` 错用了顶层 protagonist 形状，`unresolved.openingEntry` 错用了字符串。
- Skill 只展示空 `decisions:{}` / `unresolved:{}`，没有声明非空 entry 的结构；严格契约只存在于前端 TypeScript。
- 框架已有 `AgentContextSnapshot.toolMemories`：保存有界、确定性的 Tool 名称、状态、参数摘要、结果摘要与 anchors；较旧记录可退化为 placeholder，不保存完整 raw observation。
- `invokeAgent(persist:true)` 会读取对应 `context-<slot>.json`，side invocation 使用 `compressionMode: "task"`，runtime 也会返回 `contextUpdate.toolMemories`。
- 当前有两个接线缺口：`ai-invocation.ts` 写回 sidecar 时丢弃 `contextUpdate.toolMemories`；`buildEntryAgentMessages()` 只对 `.tsian/local/` 桌面助手路径渲染 Tool memory，因而排除了 task-mode 的 `world-architect`。
- 所以本次第二轮只能看到上一轮 user/assistant 文本（包括 `[[开局会话]]`）、本轮 injection、Skill 与 workspace 上下文；它看不到上一轮 Tool call/output 或已有机制生成的 Tool memory。同一 Tool loop 内仍能看到本轮 observation。
- 访谈专用《开局建模》Skill 的权威作者文件位于沉浸阅读器卡包 workspace；它不是游戏前端源码的副本。

## Requirements

- R1：补齐 persistent task-mode Agent 的 Tool memory 写回和下轮注入；由 compression mode/environment 决定，不增加 `world-architect` 或桌面助手 id/path 特判。
- R2：Tool memory 只保留现有有界模型投影与 retention/placeholder 行为；不持久化 raw observation、整段源文本或 UI timeline。
- R3：补全访谈 Skill 的完整状态 schema，包括顶层 `protagonist`、`decisions.* = {value,evidenceRefs?}`、`unresolved.* = {reason}`、精确示例、字段归属和 `readSlices` 范围语义。
- R4：Skill 明确区分开篇预览与正文精读；已有状态或 Tool memory 足以支持当前决策时不得无效重复读取，需要更精确证据时仍允许从 source 权威按需重读。
- R5：保持三层权威分离：`[[开局会话]]` 维护业务进度和幂等字段，Tool memory 维护跨轮执行痕迹，workspace/source 维护事实；不建立第二份开局状态权威。
- R6：本次只从 Skill 内容改善状态生成，不新增 Skill-local 校验或进度脚本，也不新增始终注入的自定义 Tool。

## Acceptance Criteria

- [x] persistent `world-architect` 的下一轮请求能收到上一轮 Tool memory 摘要、参数与 anchors；formal narrative turn 不因此新增 Tool memory 层。
- [x] context 文件和模型历史中不出现 raw Tool observation 或被复制的整段源文本；现有 retention 与 placeholder 上限继续生效。
- [x] Skill 明确给出非空 `protagonist`、`decisions`、`unresolved` 的合法 JSON 示例，并说明每个字段的唯一归属。
- [x] Skill 明确 `readSlices` 的记录单位，禁止把章节 index 填入字符范围；预览后精读只在当前问题确实需要正文证据时发生。
- [ ] 刷新后的新测试中，Agent 能从 Tool memory 知道上一轮执行过的 inspect/read 动作，并按 Skill 输出 canonical 状态。
- [x] 扩展现有 Assistant runtime smoke 覆盖 task-mode Tool memory 写回/注入；platform web 与卡包构建验证通过，不新增独立测试文件。

## Key Decisions

- 复用现有 `toolMemories`，不保存完整历史 Tool 协议，也不新增开局专用常驻 Tool。
- 本次测试 sidecar 可直接废弃；不为已持久化的 malformed 回复增加前端白名单兼容、迁移或原地修复。
- 本轮以完善 Skill 内容作为状态格式预防机制，不改游戏前端 parser/恢复 UI，不增加 Skill-local 脚本。
- 如果后续新测试仍频繁出现格式不规范，将另立任务把进度追踪整体剥离为脚本 action 负责读写；届时脚本成为进度权威接口，而不只是附加校验器。

## Out of Scope

- 不持久化或回放完整 raw Tool output/provider Tool 消息。
- 不消除所有合法重读；Tool memory 摘要不足以回答新问题时仍可读取 source 权威。
- 不修改游戏前端开局 parser、恢复错误文案或本次测试 sidecar，不兼容旧 malformed 状态。
- 不新增 Skill-local 校验脚本、进度存储脚本或 world-architect 常驻 Tool。
- 不重新设计整个开局问答业务内容，不处理 Agent Tool Observation 契约治理的后续生产测试。

## Risks and Deferred Items

- Tool memory 是有界摘要，不能代替源文本；它降低无意识重复动作，但不保证以后永不重读。
- Skill 文案不能从机制上保证模型永远输出合法 JSON；新测试仍失败时，再评估完整进度脚本化，而不是扩展本次范围。
- 前端仍会对不合法状态 fail-closed 并显示现有通用错误；这是本轮接受的测试期行为。
- 浏览器中的新开局会话行为由用户按 `docs/active/pending-verification.md` PV-006 手动验证，不阻塞代码交付。
