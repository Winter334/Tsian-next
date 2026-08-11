# 重构 Agent 上下文状态与压缩

## Goal

建立可跨 Agent、跨调用链稳定工作的上下文体系：压缩只负责把旧交互投影成可继续工作的上下文，关键流程状态由明确的外部权威维护，Tool Memory 只保存后续真正需要的语义结果。由此降低重复读取、无效工具循环、压缩后状态丢失和常驻上下文膨胀，同时保持任务型 Agent 与正文 Agent 各自需要的连续性。

## Background and Confirmed Facts

- 开局访谈由前端通过持久化 `invokeAgent("world-architect", ..., { persist: true, contextSlot })` 驱动，运行在 `task` 压缩模式。
- `use_skill` 当前同时承担“加载说明”和“激活 action 门禁”。`run_script` 只接受本次工具循环内已激活的 Skill；跨用户轮持久化的 `use_skill` Tool Memory 不会恢复内存中的激活状态，已经造成 `SKILL_NOT_ACTIVATED` 失败。
- 当前开局进度的 `protagonist/decisions/unresolved/readSlices/phase` 由 Agent 手动从上一条 assistant 消息的 `[[开局会话]]` 读取、更新并完整重写。前端验证形状、会话身份、revision、attempt 和 source refs，但不验证语义继承；控制文件只保存会话、attempt、revision 与 receipt。
- task 单轮压缩当前生成自由格式“已完成工作摘要”。实测摘要记录了大量工具过程，丢失精确提交草稿，并混淆 `commit_opening` 输入结构与持久化结构。
- Tool Memory 由核心运行时统一投影。持久化 task 链路会跨轮直接注入；narrative 链路虽不直接注入，仍会保存、计入上下文预算并参与后续压缩；一次性非持久化链路主要只受同轮原始工具消息影响。
- 当前 Tool Memory 通用投影可为单工具保留 8,000 字符、最近总计 32,000 字符，导致 Skill 正文预览、source 正文和重复读取结果进入跨轮上下文。
- `commit_opening` 采用 fail-fast 校验，独立错误被拆成多次完整 payload 重试。
- 持久化 `invokeAgent` 使用游戏最大 turn 作为 Agent context turn。开局尚未产生正式 turn 时，多次访谈均记为 `turn=1`，使按 turn 的 Tool Memory 老化与跨轮压缩无法区分新旧访谈轮次。
- world-architect 常驻注入同时包含 `docs/novel-airp-schema-guide.md`、`save/schema/current.md`、多个 README；这些内容和开局 Skill action schema 存在明显重复。
- OpenAI 官方 compaction 的公开原则是携带后续所需关键状态，而不是按 user/assistant role 决定权威。Tsian 的注入消息也可能使用 user role，因此 role 不能作为权威判据。

## Requirements

### R1. Skill 加载与 action 执行解耦

- `use_skill` 只负责向 Agent 提供当前 Skill 的完整说明和 action 索引，不再建立 `run_script` 所需的临时授权状态。
- `run_script` 每次根据当前 Agent 可见且启用的 Skill 解析 action；不可见、禁用或未声明的 action 仍必须拒绝。
- 移除跨轮 `use_skill` 激活记忆及其造成的伪状态；不得扩大现有 workspace、executor 或 Agent 权限。

### R2. 压缩形成固定的可继续工作上下文

- 不按消息 role 判断权威；按来源、是否已验证、是否已持久化、是否被后续内容取代来判断。
- task 跨轮压缩输出固定 Markdown 结构：当前目标、有效约束、已确认决策、权威状态与产物、已完成结果、当前工作点、未解决问题、下一步。
- task 单轮工具循环压缩输出固定 checkpoint：本轮目标、已验证事实、持久化效果、当前未完成操作、最新有效错误、恢复动作。
- narrative 压缩输出固定剧情结构：当前场景、关键因果经过、玩家选择、角色与关系变化、线索与未决事项、紧接续点。
- 摘要必须是“当前完整快照”，而非调用时间线；再次压缩时更新、覆盖和删除失效信息。
- 不记录无语义价值的工具过程；成功结果覆盖旧失败，只保留最新未解决错误。
- 不得根据当前压缩片段中未出现某信息，推断整个任务不存在该信息。
- 精确 ID、路径、ref、hash、revision、receipt 和错误码必须原样保留。
- 最新尚未处理的用户/玩家输入和仍依赖精确内容的当前操作不得被有损摘要；若内容过大，应引用外部权威或保留原始消息，而不是伪造近似 payload。

### R3. 对话档案、模型工作集与领域状态分层

- 已有完整会话档案继续作为 UI、审计和恢复来源，不因模型上下文压缩而丢失：formal turn 使用历史 turn 文件，桌面助手使用独立消息存储。
- 持久化 `invokeAgent` 的 `context.json` 只承担模型工作集，不再同时冒充不可压缩的完整会话档案。
- 仅玩家可见的持久化 `invokeAgent` 会话保存独立完整 transcript；当前消费者是开局访谈。后台持久化调用不新增完整 transcript，继续使用领域状态、诊断记录与压缩工作集。
- 模型工作集只保留近期原文、固定摘要和必要的权威引用。
- 领域流程不得把不可丢失状态仅保存在可压缩的自然语言消息中。

### R4. 开局进度由 Skill action 与独立文件维护

- 保留现有 opening control 对 session/source/branch/attempt/revision/receipt 的控制职责。
- 新增独立、单一权威的开局内容进度，维护 `protagonist/decisions/unresolved/readSlices/phase` 及继续工作所需的最小字段。
- Skill action 提供读取和带 expected revision/attempt 的原子更新；Agent 负责语义选择，脚本负责结构、幂等、继承和并发前提。
- 前端恢复与提交校验从权威进度读取，不再依赖扫描 assistant 消息中的完整 `[[开局会话]]` 作为状态权威。
- Agent 玩家可见回复只承担问题、说明与选项；内部进度格式不应泄露给玩家。
- 测试期现有开局会话无需迁移。

### R5. Tool Memory 改为语义投影

- 同轮工具协议仍保留精确调用和结果；跨轮只保留后续需要的语义投影。
- 默认不持久化 `use_skill`、普通 list/search/glob/diff 过程、重复 Skill 读取、无效参数尝试和大段原文。
- source/read 类结果只保留 refs、范围、用途和经确认的结论；正文仍以 source/files 为权威。
- 写入/提交类结果保留路径、变更结果、revision/hash/receipt；失败类只保留最新可操作错误和必要的恢复引用。
- 支持工具或 Skill action 显式提供受限的 memory projection；通用运行时不得以截取返回值前 N 字符作为主要长期记忆策略。
- 新记录应能按资源、action 或操作身份覆盖已失效记录；成功应清除被其解决的失败。
- 明确并测试 persistent invokeAgent、桌面助手、narrative 正式回合和一次性/委派调用的不同消费策略。

### R6. 持久化 invokeAgent 使用独立上下文序列

- Agent context 的逻辑轮次必须独立于游戏 turn，持久化 `invokeAgent` 每次成功交互可区分先后。
- 游戏 turn 仍用于游戏状态、checkpoint 和剧情语义，不得因 context sequence 改变。
- Tool Memory 老化、recentTurns 分组、跨轮压缩和恢复使用正确的 context sequence。

### R7. `commit_opening` 批量校验

- 在任何写入前收集相互独立的结构与投影问题，返回有上限的 `issues[]`，至少包含 `code/path/message`。
- 前置结构无效时避免派生级联错误；存在任一 issue 时事务不得产生部分写入。
- 一次反馈应覆盖可同时发现的 entity、scene、runtime、frontier 与 openingReply 问题。
- 本要求限定为 opening 领域校验，不要求改变所有 Skill/Tool 的通用输入 schema 错误契约。

### R8. 从权威源精简 world-architect 常驻上下文

- 完整参考手册保持按需读取，不作为常驻注入重复发送。
- `save/schema/current.md`、schema guide、README、AGENT.md 与 Skill 各自有清晰职责和单一信息权威，删除重复字段说明和过期内容。
- 常驻上下文只保留高频且每轮都会影响决策的最小契约；不能仅通过移除 `contextPaths` 掩盖源文件内容重复。
- 开局 Skill 与 action schema 保持自包含，同时避免把完整通用 schema 在多个常驻文件中重复描述。

## Acceptance Criteria

- [ ] 可见且启用的 Skill action 可由 `run_script` 直接解析执行，无需先调用 `use_skill`；隐藏、禁用和未声明 action 继续被拒绝。
- [ ] 跨轮上下文不再把旧 `use_skill` 记录呈现为仍有效的激活状态。
- [ ] 三类压缩均输出固定结构，并通过测试证明不会退化为工具调用时间线、不会按 role 误判注入内容、不会从缺失片段作全局否定推断。
- [ ] task 压缩保留最新未完成操作所需的精确信息或权威引用；已解决失败和重复探索不再进入摘要。
- [ ] formal turn 与桌面助手的既有完整历史不受模型压缩影响；开局访谈可从独立完整 transcript 恢复，后台持久化调用不产生无消费者的 transcript。
- [ ] 开局的正式进度可在无 `[[开局会话]]` 历史块的情况下由权威文件恢复，revision/attempt 幂等与 source ref 校验仍成立。
- [ ] 连续多轮开局访谈产生递增的 context sequence；Tool Memory 的 recent-turn 策略能区分并淘汰旧轮次。
- [ ] Tool Memory 不再持久化 Skill 正文或 source 正文；各链路只接收与其后续决策相关的语义投影。
- [ ] `commit_opening` 对多个独立错误一次返回多个 issues，且失败时无部分写入。
- [ ] world-architect 常驻注入中重复 schema/README 内容显著减少，并有测试或快照证明必要动态上下文仍存在。
- [ ] 相关 contracts、runtime、frontend 与卡包测试通过；真实浏览器开局集成测试由用户手动完成。

## Out of Scope

- storyteller 动态文风偏好链路。
- 未经实际失败证实的 opening frontier 读取窗口语义调整。
- 调整 task/narrative 压缩触发比例或模型 contextWindow 配置。
- 迁移当前测试期的开局会话与旧测试存档。
- 仅为展示目的重做开局对话 UI。

## Risks and Deferred Items

- 固定摘要仍是有损投影，不能替代领域状态或精确工具 payload；需要通过保留规则与外部权威共同保证可恢复性。
- Tool Memory 是跨链路核心能力，改变默认投影可能影响诊断体验，需要保留 UI timeline/trace 与模型记忆的边界。
- 常驻上下文精简可能暴露原先由重复文档偶然兜底的缺失规则，实施时需逐条核对真实消费者。
