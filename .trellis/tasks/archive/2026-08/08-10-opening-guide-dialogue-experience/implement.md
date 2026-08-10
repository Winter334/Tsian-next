# 开局向导对话与模型一致性优化：实施计划

## 开工门禁

- [ ] 用户在最终规划摘要之后明确批准实施。
- [ ] 任务保持 `planning`，批准前不运行 `task.py start`。
- [ ] `prd.md`、`design.md`、`implement.md` 和两份 context manifest 通过校验。
- [ ] 记录当前 git 状态，保留已授权删除的旧 Trellis 任务文件，不覆盖无关改动。

## 1. 强化角色选择 injection

- [ ] 在 `apps/play-frontend-dev/src/lib/opening-interview.ts` 建立封闭 branch label 映射。
- [ ] 更新 `buildOpeningInjection`：同时携带枚举、中文选择结果和“直接进入所选分支首问”的自包含指令。
- [ ] 保持 start/answer marker、control schema、hidden state 和恢复校验不变。
- [ ] 搜索 branch/injection 消费者，确认没有第二处独立中文映射或旧的重复确认指令。

**回滚点：** 前端 build 通过，现有控制文件 parser 和 invoke options 的类型/形状无变化。

## 2. 收紧《开局建模》Skill 首轮行为

- [ ] 在 Skill 入口明确 `canon = 原著角色`、`original = 原创角色`。
- [ ] 将首轮要求改为直接进入 injection 指定分支；原著路径给候选/接受指定，原创路径从最高价值角色信息开始问。
- [ ] 删除“只允许 character/location”及特殊禁止 container/item/equipment/ref extensions 的 AI-facing 规则，改为按当前内容需要建立最小充分正式模型。
- [ ] 说明使用既有正式 schema 与引用结构，不为无关内容创建实体，也不把核心事实藏进 extensions。
- [ ] 按提示词自包含与 AI-facing restriction 指南审查：只保留 Agent 执行所需的映射、输入事实和动作，不加入开发侧解释。
- [ ] 搜索 Skill、action description/schema 与 prompt literals，确认旧限制概念零残留。

**回滚点：** Skill 文本变更独立于 action schema/scripts，可单独恢复。

## 3. 扩展 `commit_opening` 正式实体闭包

- [ ] 扩展 action `entities` schema：支持 canonical character/location/container/item，并允许 character containers/equipment、container contents 和 item equipment 规则。
- [ ] 重构 entity normalization 为“先建立全部实体，再验证引用”的两阶段流程；保持 id/path 唯一与封闭字段。
- [ ] 验证 container contents 类型/count、容器环、跨角色共享和所有 root/nested refs。
- [ ] 验证 equipped item 的角色可达性、可用数量、item type、slotType、属性键与安全整数。
- [ ] 让 `applied` 和最终 attributes 遵循现有确定性装备公式，不信任模型自报的派生贡献；评估可复用边界，避免产生语义不同的第三套规则。
- [ ] 保持 relationships 仅 character-to-character；scene/runtime/frontier 复用扩展后的 entity map，既有 session/clean-save/receipt/turn0 校验不变。
- [ ] 保持同一 action 全量预检后提交；任一 entity/graph/equipment 错误均零持久写入。

**回滚点：** 一次性 harness 的无物品基线与 container/item/equipment 成功/失败矩阵通过后，才继续 UI 和打包验证。

## 4. 实现安静的连续流式排版

- [ ] 为 `NarrativeMessage.vue` 增加默认不启用的 quiet streaming 变体，使用正文末尾呼吸光点。
- [ ] 保持 StoryView 的现有默认 streaming 行为不变。
- [ ] 在 `PlaySetupDialog.vue` 的 running 分支统一渲染 `NarrativeMessage`：无 delta 显示“正在整理…”，有 delta 显示 sanitized streaming text。
- [ ] 删除 setup 访谈旧 standalone `EmberForge`、独立 streaming card/caret 与相关 CSS。
- [ ] 加入 reduced-motion 和必要的 live/busy 语义；保持 sanitizer、自动滚动和 error/retry UI 不变。
- [ ] 检查等待 → delta → 完成时的 margin、正文起点和滚动位置无明显跳变。

**回滚点：** quiet 变体和 PlaySetupDialog 使用点可一起恢复，不触碰共享流式状态协议。

## 5. 构建、打包与静态检查

- [ ] 运行 `npm run build:play-frontend`。
- [ ] 运行 `npm run package:frontend`，核对包内相关源码与 `apps/play-frontend-dev/src/**` 一致。
- [ ] 解析《开局建模》Skill 的 `tsian-actions` JSON，编译引用 scripts。
- [ ] 运行不落仓库的一次性 action harness：无物品基线、普通容器/物品、装备闭包、缺失 ref、环/共享、不可达/错槽、整数溢出、失败零写入、相同 receipt 幂等。
- [ ] 运行 `npm run package:card`，确认整卡使用最新前端源码与 card workspace。
- [ ] 运行 `git diff --check`。
- [ ] 运行 `python ./.trellis/scripts/task.py validate 08-10-opening-guide-dialogue-experience`。

## 6. 质量检查与手工交接

- [ ] 派 `trellis-check` 做 PRD、设计、代码、AI-facing 文案、实体/容器/装备闭包、源码权威、构建与打包一致性检查。
- [ ] 检查范围不包含 `cards/沉浸阅读器.tsian-card/frontend/**`、平台模板或无关正式故事 UI 改动。
- [ ] 向用户交接手工路径：原著/原创首问；无物品开局；有普通持有物/装备且角色页可读取；等待、首个 delta、持续生成、完成、刷新恢复、窄屏和 reduced-motion。
- [ ] 用户反馈若只涉及视觉参数，在既定 quiet 方向内调整；若要求更换动画方向或改变访谈业务流程，返回规划。

## 验证策略说明

仓库已明确采用 smoke-only 自动化拓扑，并禁止未经范围决策新增独立 UI/组件测试文件。本任务不创建新的 `*.test.ts`；UI 与 Agent 首问行为通过 build/package、请求 inspection 和用户手工验收验证。
