# 访谈驱动的开局建模

## Goal

把当前“初始理解 → 角色设定 → 游玩设定 → 裁剪”的串行开局，改为一次由 `world-architect` 主持的临时访谈会话。玩家导入小说后只先选择“原著角色”或“原创角色”，随后通过同一个简单问答界面完成角色选择或创建、本局偏好、必要澄清和开局确认；Agent 在后台按问题需要渐进阅读小说并形成让第一回合成立的最小模型。

玩家价值：减少开局等待、重复读取、漏读、错误建模、错误切入点和 Token 消耗，同时保持类似 DND 车卡的简单体验。

## Background and Confirmed Facts

- 当前开发前端固定为“导入小说、初始理解、角色设定、游玩倾向、开局确认”五步，权威源码位于 `apps/play-frontend-dev/src/components/setup/**`。
- 当前完整开局建模发生在角色分支与具体角色确定之前：调用入口位于 `apps/play-frontend-dev/src/composables/useSetupState.ts`，初始化 Prompt 位于 `apps/play-frontend-dev/src/lib/source.ts`。
- 原著/原创分支在理解完成后才选择，见 `apps/play-frontend-dev/src/components/setup/step2/UnderstandingReady.vue`；原创角色随后进入独立简表，见 `apps/play-frontend-dev/src/components/setup/step3/OriginalCharacterForm.vue`。
- 当前游玩设定已具备目标交互原型：同一对话中展示 Agent 问题、快捷选项与自由输入，见 `apps/play-frontend-dev/src/components/setup/step4/PlaySetupDialog.vue` 和 `SetupComposer.vue`。
- `invokeAgent` 支持持久 `contextSlot`，当前 setup 已从 context 恢复消息，见 `useSetupState.ts:661`、`:708`、`:763`；正式剧情 turn 在旁路访谈期间通常不递增，不能作为访谈轮次。
- 平台回复投影支持独立的持久 `content` 与玩家可见 `display` 通道，卡内 `workspace/config/reply-projection.json` 可让隐藏会话块保留在 context、同时不显示给玩家。
- 小说源身份可由 `save/source/manifest.json` 的 `importedAt + normalizationVersion` 确定；小说支持章节预览和定向连续读取，不需要把整本小说放入会话。
- Schema 的正式开局至少依赖主角与必要实体、有效场景、人物关系、runtime、frontier、setup summary 和 turn 0；现有提交 helper 只覆盖部分校验，不能直接视为完整提交契约。
- 用户已纠正开发边界：游戏卡前端权威源码是 `apps/play-frontend-dev/**`，通过 `scripts/package-play-frontend-source.mjs` 生成前端源码包并由平台“上传前端包”功能构建更新；Skill、自定义 Tool 与其他卡 workspace 文件的权威源码位于 `cards/沉浸阅读器.tsian-card/workspace/**`。平台内置模板已停止维护，除自动生成 save 框架等平台职责外不更新。
- 项目仍处于测试阶段；用户已确认不为旧流程中间态设计迁移、清理或自动适配。旧完成存档只保留现有信号自然兼容，旧中间态直接要求使用新存档重新开局。

## Requirements

### R1. 单一访谈建模会话

- 导入完成后只展示“原著角色 / 原创角色”分支选择。
- 选择后进入一个连续临时会话；角色选择或创建、本局特别设定、必要澄清和收尾确认都在该会话中完成。
- 首轮成功持久化后分支不可更改；刷新、返回后重进均恢复原会话。更换分支必须重新导入小说并启动新会话。
- 不再保留独立的初始理解结果、原著角色候选表单、原创角色简表或游玩设定子流程。
- 原著候选由 Agent 基于小说在访谈内提出，也接受玩家指定其他原著角色；原创角色字段仅在确有建模需要时逐轮询问。

### R2. 简单且不暴露内部结构的玩家体验

- 每轮最多提出 1～2 个紧密相关的问题，优先只问一个。
- 问题可附小说相关快捷选项，并始终允许自由输入。
- 玩家界面只显示自然语言问题、回答、选项和等待/恢复/失败/重试状态；不得显示 Schema、实体 JSON、内部里程碑、隐藏会话块、置信度、Patch 或草稿模型。
- 内部建模里程碑不得映射成前端子步骤、分页表单或玩家进度清单。

### R3. Schema 与小说内容共同驱动

- Novel AIRP Schema 是后台完成条件和依赖图，不是固定玩家问卷。
- Agent 根据分支、已有回答、最新隐藏会话状态和小说事实动态决定下一问，不维护跨小说固定问题序列。
- 小说已明确且可安全建模的事实不得重复询问；只有玩家偏好、多个合理选择、冲突信息或会阻塞开局且无法可靠推断的内容才提问。
- Agent 先做足以提出当前问题的轻量侦察，再按玩家选择定向读取真实小说切片；不得为了“理解完整”无目标反复读取。
- 正式模型只使用已记录切片范围内、对当前开局成立的事实，保持 spoiler-safe。

### R4. 可恢复的渐进状态

- 每个成功 Agent 回复都携带一个仅保留在持久 context、从 UI 隐藏的紧凑会话块，至少记录 session/source/branch、单调 `revision`、已处理 `attemptId`、真实 `readSlices`、稳定键的 `decisions` / `unresolved` 和必要主角摘要。
- 最新有效隐藏会话块是访谈进度权威；`save/playthrough/opening-interview.json` 只保存会话控制、当前 revision、失败/提交中的 attempt 和最终 receipt，不复制完整草稿或玩家可见正文。
- 隐藏会话块不得包含整段小说或完整正式实体模型；最新块必须足以避免丢失阅读范围和已确认决策。
- 访谈轮次使用会话 `revision + attemptId`，不得使用正式剧情 turn。

### R5. 最终提交与幂等安全

- 正式实体、场景、关系、runtime、frontier、setup summary、turn 0 和正式玩家回合 context 只在完成轮统一提交；访谈中途不写正式半成品。
- 提交范围是让第一回合成立的最小依赖闭包；MVP 开局提交不创建 container/item/equipment，也不接受无法完整校验的任意 ref-bearing 扩展。
- 单一 `commit_opening` 必须先完成输入 schema、文档 identity、全部允许 ref、scene/runtime/frontier、turn 0、player-turn agent 与重复路径校验，再进行任何写入。
- 提交必须绑定当前 session/source/branch/revision/attemptId 与规范化 payload hash；相同 receipt 重试返回既有结果，不同 payload 或已开始正式游玩时 fail closed。
- `commit_opening` 只接受新流程创建的干净/pending save：不得已有旧流程 entity/scene/relationship、turn 0 或正式玩家回合 context。检测到旧中间态或来源不明的正式模型时 fail closed，并提示使用新存档，不执行删除、清理或迁移。
- 只有依赖闭包、turn 0、正式 context、receipt 和 `setup-summary.status="complete"` 同一事务提交成功后，访谈才完成。

### R6. 会话恢复与失败处理

- 临时会话使用按 source identity 派生的独立 context slot，不污染正式游玩 Agent 上下文。
- 首轮 context user turn 使用可精确过滤的 bootstrap marker；内部启动指令通过非展示 injection 提供，不能恢复成玩家消息。
- 玩家回答先以稳定 `attemptId` 耐久记录，再以可解析 marker 送入 Agent；恢复时按 marker 去重并只显示真实回答。
- invoke reject 后保留回答并可用同一 attempt 原地重试；刷新遇到提交结果未知时先重读 context，匹配到 assistant state 即确认成功，未匹配时以同一 attemptId 安全重试。
- invoke 已提交但前端投影、状态写回或导航失败时，只从 setup summary、context 和控制文件恢复，禁止重发为新 attempt。
- setup complete 永远优先进入独立确认屏；残缺或身份不匹配的 state/context 必须 fail closed，不得猜测分支或覆盖未知进度。

### R7. 兼容与交付边界

- 上传由 `apps/play-frontend-dev` 打出的最新前端包、并更新卡 workspace 后，新导入/新开局使用新流程。
- 已完成旧存档继续依据 setup summary/enteredPlay 进入确认屏或正式游玩，不重新访谈。
- 旧流程中间态不进入新访谈、不自动迁移；显示简短不兼容提示并要求使用新存档重新导入开局。
- 不更新平台内置 workspace 模板，不自动迁移用户既有本地可编辑卡。
- `apps/play-frontend-dev/src/**` 是游戏卡前端源码权威；交付运行 `npm run build:play-frontend` 与 `npm run package:frontend`。卡目录中既有 `frontend/**` 与 `game-card.json` 是早期导出残留，本次已产生的改动不回滚，但不再作为后续手工同步目标。
- `cards/沉浸阅读器.tsian-card/workspace/**` 是 Skill、自定义 Tool、Agent/config/docs 等卡内容源码权威。只有自动生成 save 框架等平台职责才修改平台前端；内置模板不维护。

### R8. 轻量 Trellis 执行方式

- 实现阶段优先派一个 `trellis-implement` 子代理完成约定范围；质量检查阶段派一个 `trellis-check` 子代理。
- 子代理因 API 网络波动失败时优先恢复原 agent id，只补未完成部分。
- 检查无新阻塞时不再次派实现；只有检查发现阻塞验收问题才做一次针对性修复并复跑受影响验证。
- 阶段性结论与进度必须写入任务产物或代码变更，不能只依赖聊天输出。

## Acceptance Criteria

- [ ] AC1：导入后只选择原著/原创分支，随后进入一个连续对话界面，不再经过初始理解结果页、原著候选表单或原创简表。
- [ ] AC2：原著分支可由 Agent 提供小说相关候选，也可自由指定其他原著角色；原创分支的必要资料全部通过逐轮问答收集。
- [ ] AC3：首轮成功后刷新或离开再返回会恢复同一访谈和分支；重新导入才生成新 source identity 与 slot。
- [ ] AC4：玩家界面不出现隐藏会话块、Schema、实体草稿或内部里程碑；问题与选项依据小说和已有回答动态变化。
- [ ] AC5：至少覆盖原著候选、原著自由指定、原创角色、无特殊设定、自定义 trait/处境路径。
- [ ] AC6：成功轮以 `revision + attemptId` 关联；刷新能从持久 context 恢复最新问题、选项、已读切片和决策，正式剧情 turn 恒为 0 时仍正确。
- [ ] AC7：单轮失败保留回答并以同一 attemptId 重试，UI 不重复玩家消息；事务已提交但前端后处理失败时不会重发。
- [ ] AC8：完成时存在通过校验的主角与必要实体、有效开局场景、runtime、frontier、setup summary、turn 0 和正式玩家回合 context，所有允许 ref 指向本次闭包中的目标。
- [ ] AC9：重复相同完成提交返回同一 receipt；不同 payload、已 complete、已有正式 context 或 turn > 0 均拒绝覆盖；失败零写入。
- [ ] AC10：旧完成存档按现有 complete/enteredPlay 信号继续工作；旧流程中间态不会被误判为新会话，而是提示使用新存档，不发生自动清理或迁移。
- [ ] AC11：相关卡内 Skill/Action schema 与 `apps/play-frontend-dev` 前端源码一致；开发前端构建通过，生成的 `.tsian-frontend.zip` 可由平台上传并运行新流程。
- [ ] AC12：提交成功后进入现有独立开局确认屏；只有玩家点击“进入故事”后才切换到正式游玩。

## Out of Scope

- 向玩家展示或编辑内部实体、Schema、Patch、置信度、隐藏会话状态或建模进度。
- 将临时访谈历史带入正式 storyteller 对话。
- 重构正式游玩阶段的 frontier 推进、场记维护、装备或历史召回机制。
- 在开局提交中创建 container/item/equipment，或为所有小说定义固定 DND 数值问卷。
- 修改 `apps/platform-web` 平台宿主或内置 workspace 模板、迁移既有本地可编辑卡。
- 旧流程中间态迁移、半成品识别清理、跨版本 save 修复或原地升级。
- 为 provider 网络波动修改模型供应商或代理基础设施。

## Deferred Follow-up

- 整卡打包器另建后续任务：保留现有 `package:frontend` 日常上传能力，并新增 `package:card` 负责构建开发前端、合并卡 workspace/封面/源 manifest、只在 ZIP 内生成 `game-card.json`。本任务不扩展打包脚本，也不清理早期导出的卡前端残留。
