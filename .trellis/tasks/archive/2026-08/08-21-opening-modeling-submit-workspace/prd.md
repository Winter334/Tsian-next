# 优化开局建模提交与实体落盘

## Goal

提高小说导入后开局建模的可靠性与上下文效率：单个模型分片或派生产物的问题不应迫使整个开局事务反复生成、反复提交；世界架构师已经确认并建模的实体应成为 workspace 中的权威资料，storyteller 按需读取，而不是由架构师在 `agent_call` brief 中复制整份资料。

## Background

- 用户提供的失败现场请求体为合法 JSON，约 116,904 UTF-8 bytes / 85,198 characters，共 8 条消息；最后一条 user 消息约 63,338 characters。
- 该请求处于开局访谈已完成、storyteller 已返回正文与 `responseRef`、世界架构师准备调用 `commit_opening` 的阶段。
- 最后一条消息同时承载已加载的完整《开局建模》Skill、来源读取结果、架构师维护的 opening notes、完整 storyteller 委托与正文 observation、`commit_opening` action 实现/说明，以及 schema 指南等大量内容。
- 当前《开局建模》Skill 要求世界架构师先在内存中组成实体、场景、关系、runtime/frontier、setup summary、turn 0、storyteller brief；等待 storyteller 返回后，再通过一次 `commit_opening` 原子提交全部正式资料和正文。
- 当前提交协议要求失败后按错误映射回退；一个引用、结构或正文对齐问题会使整份输入失败，并可能触发再次生成和再次提交。
- 附件中的直接失败已经定位：第一次 `run_script` 没有任何参数，返回 `ACTION_SKILL_REQUIRED`；随后 `commit_opening` 带了约 1,999 characters 的模型草案，却遗漏 `inputRefs.openingReply`，返回 `ACTION_INPUT_INVALID`；下一次纠错回复又触发 `TEXT_TOOL_PROTOCOL_INVALID_JSON`。`commit-opening.js` 的业务写入逻辑没有执行。
- delegated storyteller 使用 root turn 的 live staged workspace view；只要 world-architect 先通过 action 写入资料，storyteller 就可以读取，无需复制实体事实。
- 项目旧版曾有分步 action，但因访谈未收敛即写正式文件、缺少 managed-path ownership、改选后残留 stale 数据而被原子 action 取代；本任务不得直接恢复旧宽松脚本。

## Requirements

- R1. 复现或从代码与现场请求中确定提交失败的直接原因、失败层级和可稳定验证的触发条件，不把“大请求”本身当作未经证实的根因。
- R2. 重构开局写入边界，按 entity、scene/relationship、runtime/frontier 三个依赖阶段持久化；每个阶段先完成最低必要校验，再在单一 action 事务中写入正常正式路径，并由 Agent 更新自然语言进度笔记；局部失败只重试当前阶段。开局 Skill 不再先组装全量内存草案并在末尾提交完整模型。
- R3. 在正式开局可见性与一致性上保留明确的发布边界：半成品不能被普通正式回合误认为已经完成的开局。
- R3.1. 已完成阶段直接写入正常 `save/...` 权威路径，不建立第二份 draft entity authority；复用 `save/playthrough/opening-notes.md` 用自然语言记录“已完成、下一步、已读范围和必要恢复提示”，不保存 hash、路径清单或校验回执。
- R3.2. `setup-summary.status === "complete"` 继续是开局发布与进入确认屏的唯一完成信号；stage 存在不代表正式开局完成。
- R4. 世界架构师在调用 storyteller 前，将 storyteller 需要的权威实体/场景/关系等资料落到 workspace；storyteller 通过自己的可见 workspace 上下文或按需读取工具取用。
- R5. `agent_call` 只传递任务、切入点、事实边界、正文终点与交付格式等轻量协调信息；不再复制 workspace 已持久化的完整实体事实。
- R6. storyteller 正文仍须和最终发布的 runtime、scene、entity 状态对齐，正文及正式选项只有在开局发布成功后才成为玩家正式首回合。
- R7. 新流程应具备幂等/冲突保护、清晰错误码与可恢复重试语义，并兼容已有开局与“游玩已开始”保护。
- R7.1. 每个阶段 action 只做该阶段真正有价值的最低校验：安全 id/path、核心必填字段、直接依赖 ref、source 范围和“正式游玩未开始”；不尝试证明开放模型 schema 的完全正确，不记录 validation receipt。
- R7.2. 每个建模阶段成功后更新 Agent 可读工作笔记并结束当前持久 invocation，使该阶段文件与笔记一起耐久提交；frontend 通过轻量 continuation 信号触发下一阶段，但不解析工作笔记内容。state 阶段完成后才调用 storyteller；storyteller 或 publish 失败只恢复 finalize 阶段。
- R7.3. 同页正常流程可自动衔接 finalize；刷新恢复不得自动产生模型调用，必须显示可继续/重试状态。
- R7.4. 《开局建模》Skill 的步骤、action 清单、完成条件和错误恢复必须按新持久边界重写：访谈后依次提交 entities、graph、state，每个建模阶段成功即结束当前 invocation；最后阶段只委派 storyteller、核对正文并 publish，不重新提交前序模型。
- R8. 对请求上下文体积、重复事实传递与重试次数建立回归验证，证明优化确实减少重复载荷和全量重试。
- R9. 原著已读剧情应以 timeline source anchor 的可选 `summary` 形成增量大纲，为 timeline 语义、stage-manager 剧情坐标判断与 storyteller 创作参考服务；每条 summary 只概括实际已读原著，不得把未读内容或创作指令伪装成已读原著事实。
- R9.1. Timeline UI 在 source anchor 有 summary 时提供展示：当前及过去节点直接显示，`order > runtime.plotOrder` 的未来节点默认折叠并标示可能剧透，玩家点击后可展开；展开状态只属于当前前端界面，不写入 workspace，也不限制 Agent 读取 summary。

## Out of Scope

- 不改写 storyteller 的文风、叙事质量规则或通用创作 Skill。
- 不重构 ongoing frontier 推进流程，除非复用同一底层 staging/publish 原语是实现本任务所必需。
- 不改变小说源文件分片、章节识别或导入格式。
- 不新增 provider 专用修复、`commit_opening` 名称特判、通用 response artifact 数据库或自动猜测缺失 `inputRefs` 的平台行为。
- 不迁移测试期旧开局中间态；未知旧正式文件继续要求新存档。
- 不为开放的 entity/model schema 建立全量递归校验、内容 hash、managed-path receipt 或 validation 审计日志。

## Acceptance Criteria

- [ ] AC1. 有证据链说明附件请求为何在提交阶段失败，包含具体代码路径、输入条件和错误表现；若附件缺少错误响应，应明确区分已证实与待复现部分。
- [ ] AC2. 开局建模拆成 entity、scene/relationship、runtime/frontier 与正文 publish 四个恢复边界；每批只有整批校验通过才落盘，某一阶段失败时已完成前序仍保持有效且不重复生成。
- [ ] AC3. 已分阶段落盘的资料在 publish 前对 storyteller 可读，但不会让正常游戏入口把存档判定为已正式开局。
- [ ] AC4. storyteller 能从 workspace 读取已落盘的实体/场景/关系及必要状态；委托内容不再内嵌这些资料的完整副本。
- [ ] AC5. publish 核对当前 source/session、核心 runtime/scene/entity 引用、正式游玩状态与 storyteller 响应；已完成重复调用安全返回，已进入游玩时拒绝覆盖。
- [ ] AC6. 任一实体、关系、场景、runtime/frontier 或正文校验错误能定位到所属阶段/文件，修复后只重试相应阶段或最终 publish。
- [ ] AC7. 自动化测试覆盖成功开局、各阶段失败零本阶段写入、前序阶段恢复、storyteller/publish 失败后继续、重复提交、已开始游玩保护以及旧存档兼容。
- [ ] AC8. 测试或诊断输出能比较优化前后的最终提交输入大小及重复提交范围，避免用主观判断宣称上下文已缩减。
- [ ] AC9. 正常同页流程在 stage ready 后自动衔接一次 finalize；刷新或恢复 staged save 时不自动调用模型，玩家可明确重试继续。
- [ ] AC10. opening notes、setup summary、正式模型、turn 0 与 player context 的状态组合均有确定处理；合法的分阶段进度不会进入正式游玩，也不会因正常 entity/scene 文件存在而被判成旧脏存档。
- [ ] AC11. 已读原著剧情节点具有简短客观梗概；storyteller 的附近 source 节点注入能带上梗概，旧 anchor 缺少梗概时仍正常工作。
- [ ] AC12. Timeline 对有 summary 的当前/过去 source 节点直接展示摘要；未来节点默认只显示可点击的剧透提示，点击后展开摘要，刷新后无需保留展开状态。
- [ ] AC13. 《开局建模》Skill 不再出现“阶段 7 前不写正式模型”、全量内存草案、复制完整模型的 storyteller brief 或末尾 `commit_opening`；恢复时能根据 opening notes 与正常 workspace 从首个未完成阶段继续。
