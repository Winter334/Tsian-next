# 访谈驱动的开局建模：实施计划

## 执行策略

1. 用户批准最终规划摘要后运行 `task.py start`。
2. 派一个 `trellis-implement` 子代理完成开发前端与卡 workspace 的约定范围实现及本地验证；Prompt 以 `Active task: .trellis/tasks/08-08-interview-driven-opening-modeling` 开头。
3. provider 网络失败时恢复原 agent id，先读任务产物和当前 diff，只补未完成项。
4. 实现完成后派一个 `trellis-check` 子代理做全范围检查。
5. 无阻塞问题即结束；只有检查发现阻塞验收问题时，恢复原实现代理做一次针对性修复并复跑受影响验证。

## 开工前门禁

- [ ] 用户在本次最终规划摘要之后明确批准实施。
- [ ] `prd.md`、`design.md`、`implement.md` 无开放阻塞问题。
- [ ] `implement.jsonl` / `check.jsonl` 使用可完整注入的 spec/research 条目并通过 `task.py validate`。
- [ ] `git status` 已记录；不覆盖 `.trellis/.template-hashes.json` 等既有非本任务改动。
- [ ] 产品代码修改范围严格限制为 `apps/play-frontend-dev/**` 与 `cards/沉浸阅读器.tsian-card/workspace/**`；已存在的卡前端导出残留改动不回滚，但不再手工同步。

## Phase A：会话协议与回复投影

### A1. 协议类型与 parser

- [ ] 在卡前端新增/整理 `OpeningSourceIdentity`、`OpeningTurnState`、`OpeningInterviewControl`、attempt/receipt 类型和严格 parser。
- [ ] 实现 source identity 稳定 hash、动态 sessionId/slot/path；slot 只含安全字符。
- [ ] 实现 bootstrap/answer marker 编解码；恢复时隐藏 bootstrap、只显示 answer 的原始文本，并按 attemptId 去重。
- [ ] 实现本地隐藏块 parser/sanitizer；任何异常均 fail closed，绝不把内部 JSON 渲染给玩家。

### A2. Reply projection

- [ ] 更新卡内 `workspace/config/reply-projection.json`，保留正式故事 `[[选项]]` 规则。
- [ ] 新增 `[[开局会话]]` 规则：保留 content、删除 display、投影 `openingState`。
- [ ] 新增 `[[开局选项]]` 规则：保留 content、删除 display、投影 `openingChoices`。
- [ ] 验证 context 写入后仍含开局隐藏块，而即时 UI 和刷新恢复 UI 均不显示 marker/JSON。

## Phase B：Agent Skill 与原子提交

### B1. 合并 Skill

- [ ] 重写卡内 `world-architect/skills/开局建模/SKILL.md`，覆盖原著/原创、轻量侦察、逐轮单问、动态选项、自由指定、定向阅读、隐藏状态、重复 attempt 去重和最终提交。
- [ ] 从卡内 `world-architect/agent.json` 与 `AGENT.md` 移除旧《游玩设定》启用入口及“初始理解 → 角色 → 游玩设定 → 裁剪”残留。
- [ ] 删除或停用旧《游玩设定》Skill；无消费者时删除其旧提交 scripts，否则保留为明确未启用兼容残留。
- [ ] 保持 Skill 自包含，只写 Agent 可执行行为与判据；不引用未注入概念。
- [ ] 不修改 `frontier推进` Skill、helper 或 action。

### B2. 隐藏进度状态

- [ ] 每个成功回复输出完整 `OpeningTurnState`；revision 单调递增，processedAttemptId 匹配当前 marker。
- [ ] `readSlices` 只记录真实章节 refs/ranges；`decisions` / `unresolved` 用稳定 key 替换。
- [ ] 限制块大小、数组数量和字符串长度；拒绝整段小说与完整正式模型。
- [ ] 重复同 attemptId 时只重放最新问题/状态，不增 revision、不重复应用决定。
- [ ] 不新增 runtime contextPath，不新增中间状态 action；进度由最近 context 隐藏块提供。

### B3. `commit_opening`

- [ ] 新增单一 `commit_opening` action 和私有 helpers，输入只允许 MVP 的 character/location、scene、character relationship、runtime、frontier、summary 和 opening reply。
- [ ] 明确禁止 container/item、character containers/equipment 和未知 ref-bearing extensions。
- [ ] 在任何 write 前验证 source/session/branch/revision/attempt、setup/turn/context 前置条件、实体字段、文档 identity、全部 refs、frontier source anchor、playerTurn entrypoint、opening reply projection、路径唯一性和输入上限。
- [ ] 对 canonical payload 计算 SHA-256；相同 receipt 幂等返回，不同 payload、已有 complete、enteredPlay、turn>0 或非空正式 context 均拒绝。
- [ ] 要求新流程干净/pending save：entity/scene/relationship 为空，runtime/frontier 为初始形态，无 turn 0 或正式 context；检测到旧中间态即稳定报错且零写入，不做删除或迁移。
- [ ] 写 runtime/frontier、turn 0、正式 player-turn context、opening control receipt，最后 stage complete setup summary。
- [ ] action 只返回短 receipt/路径摘要，不返回 openingReply 正文。

## Phase C：卡前端单会话向导

### C1. 状态与启动

- [ ] 在 `apps/play-frontend-dev/src/composables/useSetupState.ts` 收敛为导入、分支选择、访谈、确认四类视图状态。
- [ ] 导入完成后不再调用旧 opening understanding，也不提前写 runtime protagonist。
- [ ] 分支选择后先写 revision=0 控制文件，再以 bootstrap marker、opening injection、动态 slot、`persist:true` 启动 world-architect。
- [ ] 首个有效 assistant 状态块成功后锁定分支；重新导入产生新 source identity/session/slot。

### C2. 对话 UI

- [ ] Stepper 改为“导入小说 / 创建角色与世界 / 开局确认”。
- [ ] 复用或收敛现有轻量对话组件，支持 agent 问题、开局选项、自由输入、流式等待、recovering、failed 和 retry。
- [ ] 原著候选与原创字段都在对话中处理，不显示 UnderstandingReady、CanonCharacterSelect、OriginalCharacterForm 或 CharacterConfirmed 流程。
- [ ] 无消费者的旧组件和 imports 才删除；保留 OpeningConfirm 与“进入故事”。
- [ ] 确认屏标题从 source manifest 读取，摘要从 setup summary 读取。

### C3. attempt 与恢复

- [ ] 发送前耐久写入 submitted attempt，再显示一条 pending 玩家消息；实际 invoke input 使用 answer marker。
- [ ] invoke resolve 后校验实际 response 隐藏块与 revision/attempt，再清除 attempt；控制文件写回失败可从 context 修复。
- [ ] invoke reject 后标 failed；重试复用同一 attemptId/input，不再次 push 玩家消息。
- [ ] submitted 未知态先重读 context；匹配到 processedAttemptId 即确认成功，否则以同一 attemptId 进入安全重试。
- [ ] 区分 invoke reject 与 resolve 后的投影/写回/导航失败；后者禁止创建新 attempt。
- [ ] 初始化严格执行：setup complete → 有效 context 恢复/修复 state → revision0 bootstrap 重试 → 协议错误 fail closed → 分支选择 → 导入。
- [ ] 普通 workspace 读取错误不得静默回到导入页。

### C4. 目标文件清单

- [ ] 审查并按需修改 `apps/play-frontend-dev/src/composables/useSetupState.ts`、`apps/play-frontend-dev/src/lib/source.ts`。
- [ ] 审查并按需修改 `apps/play-frontend-dev/src/components/setup/SetupWizard.vue`、`SetupStepper.vue`、分支选择/访谈组件、`OpeningConfirm.vue`。
- [ ] 仅在初始化/确认路由需要时修改 `apps/play-frontend-dev/src/App.vue`。
- [ ] 所有新 parser/type/helper 放在卡前端内职责清晰的独立文件，避免继续膨胀 `useSetupState.ts`。

## Phase D：兼容、文档与卡包

- [ ] 更新卡 workspace README：`opening-interview.json` 是会话控制/receipt，最新 context 隐藏块是访谈进度权威，setup summary 是完成信号。
- [ ] 保留 pending `understanding-summary.json` 兼容文件，但新 UI/Skill 不消费。
- [ ] 已完成旧存档只按现有 setup summary/enteredPlay 自然恢复；旧流程中间态显示测试期不兼容提示，要求新存档重新导入，不做适配、清理或迁移。
- [ ] 确认 diff 不包含 `apps/platform-web/**` 或内置 workspace 模板；前端产品改动落在 `apps/play-frontend-dev/**`，卡内容改动落在卡 workspace。
- [ ] 运行 `npm run build:play-frontend`，要求零诊断。
- [ ] 运行 `npm run package:frontend`，核对 `.tsian-frontend.zip` 的 `frontend.json` 与 `src/**` 清单；通过平台上传前端包验证构建入口。

## Phase E：验证

### E1. 静态与脚本验证

- [ ] 解析所有修改 Skill 的 `tsian-actions` JSON。
- [ ] 对新增/修改 browser scripts 做语法编译。
- [ ] 用临时/内联 harness 验证 `commit_opening`：成功、未知 ref、重复 id、source/session 不匹配、已有 complete、turn>0、非空正式 context、旧中间态拒绝且零写入、相同 receipt 幂等、不同 payload 拒绝。
- [ ] 验证隐藏状态大小/字符串/数组上限以及禁止 full model/原文的边界。
- [ ] 运行 `git diff --check`。

### E2. 手工路径

- [ ] 原著候选 → 选择 → 问答 → 完成 → 确认屏。
- [ ] 原著自由指定窗口外角色 → 定向读取，不拒绝、不剧透。
- [ ] 原创角色不出现简表；姓名/身份等逐步询问。
- [ ] 无特殊设定快速完成；自定义 trait/处境进入正式主角实体。
- [ ] 刷新恢复最后问题、选项、readSlices/decisions 和已选分支。
- [ ] invoke reject 后重试消息不重复；resolve 后控制写回失败只恢复不重发。
- [ ] submitted 未知态和重复 attemptId 不重复推进。
- [ ] setup complete 刷新进入确认屏；点击进入后加载 turn 0。
- [ ] 已完成旧存档自然恢复；旧中间态不崩溃、不误判，明确提示使用新存档且不修改旧文件。
- [ ] 导出的卡包重新导入后完整走通至少一条原著与一条原创路径。

## 检查代理职责

检查报告只分阻塞/非阻塞；非阻塞建议不触发新一轮实现。重点检查：

- PRD AC1～AC12 逐项证据；
- 玩家 UI 无内部 marker/JSON 泄漏；
- context content 保留状态/选项，display 隐藏；
- revision/attemptId 与 duplicate retry 的端到端一致性；
- `commit_opening` 先全校验后 delete/write，receipt 与正式进度保护成立；
- 旧中间态只 fail closed 并提示新建存档，任何旧文件均不修改；
- 前端改动位于开发前端，卡内容改动位于卡 workspace，frontier推进及平台模板未被改动；
- `.tsian-frontend.zip` 来自最新 `apps/play-frontend-dev/src/**`。

## 高风险文件与回滚点

- `apps/play-frontend-dev/src/composables/useSetupState.ts`：先拆协议/持久化 helper，再改状态机，避免单文件混合职责。
- `workspace/config/reply-projection.json`：必须保留正式故事 `[[选项]]` 行为；开局规则只作用于新 marker。
- `world-architect/skills/开局建模/**`：Skill 文本、action schema 和 script 校验必须一致。
- `commit_opening`：干净 save 前置条件和全部 payload 校验均在写入前完成；平台事务是第二道防线。
- 前端源码包：最后运行现有打包脚本；不手工同步卡目录中的 `frontend/**` 或 `game-card.json`。
