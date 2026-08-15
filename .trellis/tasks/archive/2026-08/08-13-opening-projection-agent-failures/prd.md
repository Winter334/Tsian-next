# 修复开局回复投影契约并分析 Agent 异常

## Goal

修复合法 `openingReply` 无法通过 `commit_opening` 的回复投影契约冲突，并针对失败请求中出现的无效工具调用、无关源码逆向、上下文膨胀和建模/正文漂移，找出可由代码、诊断契约或 Agent 指令消除的根因，使开局建模能在可恢复、可解释的边界内完成。

## Background

- 卡内 `config/reply-projection.json` 的正式 `[[选项]]` 规则使用 `text: ""`，因此投影后的 `content` 与 display lane 相同。
- 平台投影契约规定：当 display lane 与 `content` 相同时省略可选的 `displayContent`。
- `commit_opening` 当前却要求 `projected.displayContent` 为非空字符串，导致符合现有配置的正式 opening reply 被拒绝为 `OPENING_REPLY_PROJECTION_FAILED`。
- 现有 smoke test mock 总是返回 `displayContent`，没有覆盖卡内真实配置经过平台 projector 后省略该字段的情况。
- browser-script `reply.project` SDK 当前还会剥掉内部 projector 的 `diagnostics/configPresent/ruleCount/appliedRuleCount`，而 smoke 直接返回内部全量结果；因此 `commit_opening` 在测试中可见、线上不可见的结构化配置诊断也是 seam 分叉。
- 失败请求在恢复 checkpoint 后继续进行了大量无效读取和猜测调用；需区分模型能力问题、提示词问题、错误诊断不足、工具可见性边界和 checkpoint 导向问题。
- 修复投影契约后的复测不再触发 projection error，但 `commit_opening` 连续三次因缺失可选的 `save/agents/world-architect/context-understanding.json` 返回 `WORKSPACE_FILE_NOT_FOUND`。browser-script SDK 的 `workspace.read` 在缺文件时抛错，card 脚本却把它当作可空返回，现有 smoke mock 同样错误地返回 `null`。
- 复测 checkpoint 把紧邻的真实 `WORKSPACE_FILE_NOT_FOUND` 概括成旧的 `OPENING_ENTITY_TYPE_INVALID`；checkpoint 后仍发生 34 个串行 Tool 轮、52 次调用，其中 17 次读取/搜索 `frontend/dist`，说明未解决原始失败与摘要的相对顺序及通用停止条件仍不足。
- 新一次建模请求没有进入 `commit_opening`，却在玩家确认角色与切入点后出现 19 个 Tool 轮、50 次调用；其中 39 次访问 `agents/storyteller`，读取约 3.16 万字符的写手配置与模块。`agent_call` 已对 world-architect 可见但调用 0 次。
- storyteller 实际只启用第三人称、禁用词表、快捷回复与杀超雄模块，world-architect 却自行读取互斥人称、文风和 NSFW 模块；访谈选项还把“重生苏醒”与“第一人称”绑定，和 storyteller 的第三人称配置冲突。现有 Skill 只在末尾说“必要时调用 storyteller”，没有把委派正文纳入从访谈到提交的主流程。

## Requirements

- R1. `commit_opening` 必须接受 `displayContent` 缺失但 `content`、`projections.choices` 合法的 projector 结果，并按平台既有 fallback 契约生成 turn 0。
- R2. 保持 `displayContent` 的平台可选语义，不通过强制 projector 冗余返回字段来修复卡内调用方。
- R3. 增加覆盖真实 reply-projection 配置语义的回归验证，不能继续仅依赖与真实 projector 契约不一致的 mock。
- R3a. browser-script `reply.project` 必须在既有 assistant projection 字段之外，向受控脚本返回有界 diagnostics 与 rule metadata；不得包含原始回复或文本预览。
- R4. 审计开局 Skill、action 描述、错误 details、恢复 checkpoint 和可见工具边界，给出失败请求中每类异常的因果链。
- R5. 对可通过 Agent-facing 指令消除的异常，最小化修改 Skill/action 提示；对属于运行时诊断或代码契约的问题，在对应层修复，不把宿主缺陷伪装成提示词规则。
- R6. Agent 遇到不可由当前可见输入修正的投影失败时，应获得足够的结构化诊断并停止无边界逆向或虚构 action；不得绕过 `commit_opening` 直接写正式模型。
- R7. 保留当前原子提交、clean-save 校验、正式 `[[选项]]` 投影和 turn 0/player context 数据流。
- R8. `commit_opening` 检查不存在的可选 legacy 文件时必须把精确的 `WORKSPACE_FILE_NOT_FOUND` 解释为“缺失”，同时继续传播权限、路径、运行时等其他读取错误。
- R9. task checkpoint 压缩必须把被保留的未解决原始失败轮放在生成摘要之后，使原始 code/message/details 在消息顺序上覆盖摘要中的陈旧错误；不得把完整失败 payload 送入有损摘要。
- R10. 开局 Skill 对没有本 Skill 输入修复动作的错误，以及同一输入复现的相同错误，必须停止提交并保留 code，而不是继续读取前端 bundle 或推测宿主实现。
- R11. 开局 Skill 必须把访谈、证据读取、最小模型草案、storyteller 正文生成、一致性核对和 `commit_opening` 组织成可顺序执行的流程；每一步说明完成条件，以及未完成或失败时返回哪一步、重试还是停止。
- R12. 角色与切入点等建模决定应按其实际影响独立确认；访谈不主动把人称、文风等 storyteller 表达配置捆进开局选项。首回合正文与正式选项由 storyteller 使用自己的上下文生成，world-architect 只提供已确认事实、切入点和最小模型草案。

## Acceptance Criteria

- [ ] 使用卡内正式 `[[选项]]` 规则投影出的合法 opening reply，即使没有 `displayContent`，也能通过 `commit_opening` 并写出一致的 turn 0/player context。
- [ ] 缺少正文、缺少 choices、choices 为空/超限/含非法项时仍返回 `OPENING_REPLY_PROJECTION_FAILED`，且不会产生部分正式写入。
- [ ] 回归测试直接覆盖真实 projector 的 `displayContent` 省略语义以及 opening commit seam。
- [ ] 失败诊断能区分正文、展示 fallback、choices 和 projector diagnostics，不再只返回无法定位的笼统消息。
- [ ] production browser-script SDK 与 smoke 对 `reply.project` 的返回形状一致，结构化 metadata 在线上不再被剥掉。
- [ ] 开局 Skill 明确 Agent 可采取的恢复动作；恢复只依赖当前 Skill 声明的 action 与结构化 details，并对平台/配置级失败设定有界停止条件。
- [ ] 干净存档中可选 legacy context 文件全部缺失时，真实 workspace-read 抛错语义下的 `commit_opening` 仍成功；非 not-found 读取错误不被吞掉。
- [ ] task compression 继续原样保留未解决失败轮，且 checkpoint 摘要出现在该失败轮之前；后续成功仍能解除同一语义操作的旧失败 pin。
- [ ] 相同 `WORKSPACE_FILE_NOT_FOUND` 不再诱发无界重试或 `frontend/dist` 逆向指令。
- [ ] 《开局建模》能按清晰阶段从会话恢复推进到提交，每阶段均有完成条件和失败去向；玩家确认开始后，正文生成阶段通过 `agent_call` 委派 storyteller，而不是由 world-architect 重建写手的人称/文风配置。
- [ ] 访谈快捷选项只表达当前要确认的建模分歧，不再把切入点与第一/第三人称或文风偏好绑定。
- [ ] 形成一份基于请求证据的根因清单，分别标注代码契约、测试缺口、诊断/可见性、提示词/checkpoint、模型执行和内容一致性问题。
- [ ] 相关定向测试、类型检查/构建与 Trellis quality check 通过。

## Out of Scope

- 六维属性的取值规则、是否恢复独立填写阶段及相关 schema 设计。
- 重做开局访谈前端产品流程、小说来源导入或正式回合回复投影架构。
- 修改 storyteller 的配置、模块选择或常驻写作提示词；本任务只定义 world-architect 如何向现有 storyteller 交付首回合 brief。
- 针对单一模型供应商增加专用提示词或容错分支。
- 修正本次失败存档中的具体小说建模结果；本任务修复可复现的契约和 Agent 行为边界。
