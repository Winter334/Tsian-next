# 简化开局访谈状态与校验

## Goal

让开局建模回归“与玩家讨论需求 → 按需阅读原文 → 记录语义工作笔记 → 确认后生成正式开局”的普通 Agent 工作流。进度文件只帮助 Agent 抵抗上下文压缩；前端不再把每次自然语言回复当成一笔必须推进 revision 的事务。最终提交只阻止已经证实会导致无法开局、错误覆盖或部分写入的问题。

## Background

- 当前前端为每条玩家输入创建 `attemptId`，并要求回复后 `processedAttemptId` 精确匹配且 `revision + 1`。本次实测中，玩家只要求重新闭合选项标签，Agent 正常返回可显示内容但没有调用进度 action，前端因此拒绝该回复。
- 开局成功对话已经由 player invocation transcript 独立持久化；模型工作上下文压缩不会删除这份 UI 档案。
- `opening-progress.json` 的实际价值是保存 `protagonist/decisions/unresolved/readSlices` 等语义工作笔记，不是充当第二套对话事务日志。
- Runtime Workspace 已为 browser script 提供事务/savepoint；最终 action 失败时可以保证 staged writes 不被接受。
- 当前 `commit_opening` 在原有约 1000 行规范化逻辑外又增加批量 `issues[]` 预校验，并对名称逐字一致、完整窗口、固定时间、深层 equipment/container 闭包等大量理论风险实施阻断。
- 当前工作树中已有一项用户批准的小修正：补全 `advance_opening_progress` 的 action schema。本任务会在简化 action 合约时吸收该改动，不得把它误当无关修改丢弃。

## Requirements

### R1. 访谈是语义对话，不是逐轮事务

- 成功返回的非空 Agent 回复应立即进入对话并允许继续，不依赖本轮是否写入工作笔记。
- 解释、追问、重复说明、格式修正等不产生新决定的轮次可以不写进度。
- 前端不得再用 `attemptId/processedAttemptId/revision` 判断一条自然语言回复是否有效。
- 调用失败时保留当前页面内的重试能力；刷新后以成功 transcript 为恢复边界，未成功提交的输入允许玩家重新输入，不为此增加持久化事务协议。

### R2. 使用原生 Workspace 工具维护工作笔记

- 使用 `save/playthrough/opening-notes.md` 保存小型、可读的语义工作笔记，内容聚焦主角、已确认事项、待确认事项和已读原文范围。
- 删除 `read_opening_progress`、`advance_opening_progress` 及其 helper；不再为单文件读写封装 Skill action。
- Skill 明确授权 world-architect 在有耐久语义变化时使用原生 `read/write` 读取或完整重写该笔记。当前 Agent 已启用 `workspace_read/workspace_write` 且具有 level 1 存档维护权限，无需新增权限能力。
- 笔记不定义 JSON schema，不包含 `sessionId/sourceHash/branch/revision/processedAttemptId/phase/updatedAt` 等无实际消费者的控制或审计字段。
- 不强制每轮写入，也不强制旧决定、未决项或阅读范围逐字段继承；Agent 对语义取舍负责。
- 完成状态只以正式 `setup-summary` 为准，不由工作笔记或 control 重复维护。

### R3. 前端恢复只使用实际需要的来源

- transcript 负责恢复已成功的玩家/Agent 对话及选项投影。
- 精简 opening control，只保留当前来源、会话 slot 和角色分支；不维护逐轮 attempt/revision/receipt，也不重复保存完成状态。
- 恢复流程不扫描或比对语义进度，不因工作笔记缺失、未更新或与 transcript 轮数不同而阻断对话。
- 开局选项解析应容忍回复末尾存在未闭合的 `[[开局选项]]`：将从开始标签到文本末尾视为选项块，避免纯显示问题触发额外 Agent 轮次。

### R4. 最终提交采用证据驱动的最小校验

- `commit_opening` 自行读取当前 control/source，不要求 Agent 回传 session/revision/attempt envelope。
- 保留阻断性校验仅限：输入可解析；写入 ID/路径安全且不重复；来源可读取；runtime 必需字段可供前端解析；runtime 的主角和 active scene 引用能指向本次写入；frontier 有后续推进实际使用的有效窗口/来源锚点；首回合可投影为可显示正文和选项；正式游戏尚未开始。
- 对可从目标对象推导的名称、章节 metadata、kind/order 等字段由脚本归一化，不因逐字不一致要求 Agent 重试。
- 移除重复的批量 `issues[]` 预校验和 speculative checks，包括固定“元年”、完整章节 metadata 回显、ready-to-commit 门禁、逐字段 progress inheritance、深层 equipment/container 算术闭包及未知可选字段一律失败等没有下游硬依赖的规则。
- 最终 action 继续依赖 Runtime Workspace 事务保证全成或全不成；已完成的重复调用直接返回完成状态，不再通过 payload hash/revision receipt 建立第二套提交协议。

### R5. 边界与同步

- 不修改通用 Agent context、压缩、Tool Memory 或 transcript 平台合约；本任务只简化开局领域消费者。
- 不迁移测试期旧开局会话或旧进度文件；旧状态允许要求新建存档。
- 同步开局 Skill、browser scripts、play frontend、平台 workspace template 导入列表及相关规范。
- 游戏前端权威源码仍为 `apps/play-frontend-dev/src`；卡包通过现有 `package:card` 链路生成，不手改 `frontend/dist`。

## Acceptance Criteria

- [ ] 玩家要求解释、重述或修正标签时，即使 Agent 没有写进度，非空回复仍正常显示，界面不会进入“访谈回复轮次无法确认”。
- [ ] 访谈 Skill/action 不再暴露或要求 `basedOnRevision`、`attemptId`、`processedAttemptId` 或逐轮 revision；进度专用 actions/scripts 已移除。
- [ ] `opening-notes.md` 由 Agent 使用原生 Workspace 工具按需维护；文件缺失或本轮未更新时不阻断前端。
- [ ] 刷新页面能从 transcript 恢复所有成功对话和最近一次选项；失败且未进入 transcript 的输入无需跨刷新恢复。
- [ ] 未闭合但位于回复末尾的 `[[开局选项]]` 能正常提取选项并从显示正文中移除。
- [ ] 一个满足最小实体/场景/runtime/frontier/首回合要求的 payload 能一次提交成功，不因名称、固定时间或其他无消费者的形式约束失败。
- [ ] 非法写入 ID、runtime 悬空主角/场景引用、不可投影首回合、已进入正式游戏仍会阻断且产生零部分写入。
- [ ] 重复调用已经完成的 `commit_opening` 返回完成状态，不重复创建正式文件。
- [ ] play frontend、platform web 和相关 smoke checks 通过；卡包构建链路通过。浏览器内完整开局体验由用户手动验证。

## Out of Scope

- 调整通用上下文压缩、Tool Memory 或 transcript 格式。
- 迁移当前测试存档。
- 改造 storyteller 文风模块或访谈偏好消费。
- 借本任务重新设计完整 AIRP entity/schema。
