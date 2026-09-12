# 执行记录

## 当前状态：已完成并归档（2026-09-12）

2026-09-10 的工程交付在后续[原著驱动任务](../09-11-canon-driven-storytelling/implement.md)中继续适配，用户现已确认整体任务圆满结束。本任务一并归档，无独立待验收事项；下文保留当时实现与交接历史，不恢复被后续最终职责取代的架构师预建实体库、frontier 或原著偏离展示方案。

## 回滚点与范围

- 用户要求先提交此前工作。已提交 `191cd02e feat: card-owned saves and semantic stage-manager maintenance`，包含前置清理、场记语义化与本任务规划；未 push。
- 本次开局实现保留为工作区改动，未另行提交。原本的编辑器/平台工作区、AGENTS/.codex/.agents、日志等无关改动保持原状。
- 本轮只改卡属协议/资产、真实卡前端及对应测试与打包验证。没有修改通用注入器、增加平台业务 schema、调用真实 AI 或建设迁移框架。

## 已实现

1. **架构师的语义入口**
   - 仅启用开局建模 Skill：inspect_source_opening / read_opening_slice / propose_opening / submit_initial_world。
   - Agent 不再接收源 manifest、存储 schema、frontier 原文，不暴露原始文件编辑工具/agent_call；取证工具返回章节内容与截断说明，不返回分片路径。
   - 玩家确认前只访谈/提出方案，界面展示角色、切入点、开局情境与约束。确认校验用户实际看到的 proposalId，防止确认未看过的新方案。
   - 世界定义包含力量阶梯、维度含义/分类、规则、术语和穿戴槽位；初始对象通过同批 key 表达关联。实体、关系、场景和当前局面一次语义提交，不要求模型拼存储结构。
2. **卡脚本负责存储与计算**
   - 生成稳定对象标识/引用、人物关系分片与可选反向关系、渲染包装、状态/量表标识、属性刻度、装备有效贡献及 runtime。
   - 复用源文本读取逻辑和场记装备核心；递归校验 Skill 输入，拒绝机器字段、无效引用、冲突持有、容器循环、量表越界等。不能只依赖平台的顶层 Skill 类型校验。
   - 正文产生前，同一模型重复提交幂等；修订模型保留兼容 key 的对象标识，删除本模型已移除的托管路径，不覆盖外部修改。出现正文 transcript 后不再改写初始模型。
   - 已删除原 entity/graph/state/publish 脚本、旧路径地图及未使用锁逻辑；保留并收窄 source/session/started-play 的真正保护。
3. **卡前端固定编排**
   - 已确认访谈 → 架构师建模 → 写手 → 场记 turn 0 → 完成。分别 invokeAgent，架构师不再调度/转抄/审稿；建模和访谈共享语义会话，写手使用独立持久 slot，场记使用非持久任务材料。
   - 写手注入来自实际提交的世界、实体、场景、关系与当前状态，不依赖架构师口头交接。schema 翻译保留在卡层。
   - `frontend-actions/opening` 承担 confirm / publish / retry_story / finish，使用平台 Action 的原子事务和专用隔离 Worker。
   - **最终采用持久 transcript，而非额外 rawReply 文件/重复投影接口**：写手 invocation 在独立 slot 原子保存已由平台投影的 assistant 结果。Action 从对应 transcript 发布 turn 0 与正式 player context；UI 响应丢失后可以继续发布，不再生成正文。responseRef 不跨 invocation 使用。
   - publish 仍保持 setup pending；核验场记凭据后 finish 才 complete。turn 0 维护令 runtime.turn=1，首个正式 turn 1 维护后为 2。
   - 模型/正文/维护失败只继续未完成步骤。已记录的格式错误正文需要显式重试才换一个新 slot。刷新只恢复显示状态，不静默调用 AI。完成后刷新开局自动 checkpoint。
4. **配套退出旧入口**
   - 删除模型输出的开局继续标记、投影规则与前端自动续调用机制；保留程序生成的内部 model 请求标识供访谈 transcript 恢复识别。
   - 停止 frontier 的同步后自动调用及 StoryView 手动/提示入口；架构师不再启用 frontier Skill。新存档移除无依据的 frontier 示例节点。旧工具/结构保留供后续重构，不设计替代系统。
   - 更新初始 schema 说明、卡 README、世界/属性指南。RAG 未修改。资料分类、plotOrder 的语义判断及既有场记协议保留。

## 验证证据

- 6 个定向 Vitest 文件 **64 项通过**：opening-modeling、opening-setup、assistant-runtime.smoke、stage-manager-maintenance、stage-manager-sync、remote-iframe-bridge。
- 新测试覆盖：唯一语义工具暴露/use_skill 完整载入、分片取证、实际回复投影、确认竞态、深层非法字段、引用/刻度/装备、幂等与前正文修订、托管路径删除、实际事实注入、固定调用顺序、无提交凭据不能成功、已保存正文复用、格式错误显式重试、维护失败只重试维护、刷新不调用 AI、访谈响应丢失恢复、turn 0→1→2。
- 卡前端 `vue-tsc --noEmit`、平台 `vue-tsc -b` 通过；`npm run build:web` 通过（已有 bundle 大小/dynamic import/@vueuse 注解警告，无构建错误）。
- `npm run package:card -- --out tmp/immersive-reader-semantic-opening.tsian-card.zip` 使用真实 Chrome 执行构建、导出、导入回环和新存档/checkpoint 检查。
- 打包 harness 对**实际导入卡资产**运行真实 Skill Worker 与 Frontend Action 服务/隔离 Worker，在独立临时事务中验证模型/发布输出失败回滚、幂等、错误正文拒绝/重试、场记 turn 0 与完成边界。浏览器模式不加测试方外围 Skill 回滚，确实检验生产 runner 的 savepoint；inline 单测不作为隔离性证据。Action 的存储提交使用临时测试事务，持久绑定/bridge 合同由既有专项回归覆盖，不触碰玩家存档。
- 真实/付费 AI 调用 **0**。固定夹具及构建成功不代表实际建模质量、正文消费质量或耗时已验证。

## 交付用户实测

导入 `tmp/immersive-reader-semantic-opening.tsian-card.zip`，使用新测试存档：

1. 原著角色与原创角色各走一次访谈；先要求修改方案，再点击确认，检查角色/切入点没有漂移。
2. 观察固定阶段为建世界、开局正文、资料整理。架构师应不再进入文件检查/写手调用/正文审稿循环。
3. 对照写手正文与初始设定；剧情实际变化应由场记反映到人物、场景和关系。未发生选项不应写入状态。
4. 在正文完成后的维护阶段制造中断/失败，再重试：不应重新生成正文；刷新应等待手动继续。
5. 进入故事后执行第一个正式回合，确认回合编号、选项、装备/属性和历史显示正常。
6. 记录开局总耗时及各阶段体感。前一轮场记“约一分钟”来自用户实测，本轮不承诺未经实测的开局性能。

工程实现完成后保留此任务记录，后续用户测试反馈继续在此追踪。


## 2026-09-11 用户实测与后续方向

本任务已有工程测试不能代表实际 AI 效果全部通过。用户提供了 `tmp/新开局建模.json`、`tmp/开局正文.json`、`tmp/开局维护.json`，只读核对发现：

- 旧时间线消费者把不存在的 frontier 显示为不可读；旧原作文风模块仍依赖 frontier.sourceWindow 学习。这是停用后的配套遗漏，不是正文历史损坏。
- 写手实际收到已建资料，但没有连续原文；通用预设也会改变原著情绪和叙事风格，用户因此决定向原著驱动的互动改编调整。
- 紫星塔已存在却被场记再次创建。场记当次没有调用 lookup，不是 UUID 导致查询失败；创建入口缺已有候选检查。

用户已确认新的职责与范围，记录在后续任务 [原著驱动的正文推进与历史资料整理](../09-11-canon-driven-storytelling/prd.md)。后续不再要求架构师预建实体库，写手负责原著阅读/推进，场记统一整理本局事实；明确取消原著偏离识别与展示。这是新任务方向，不能从本任务旧设计重新恢复被取消的功能。

本轮仅记录分析和交接，没有追加业务修复或新的测试。旧实现仍在未提交工作区；新会话应保留并在其上改造。
