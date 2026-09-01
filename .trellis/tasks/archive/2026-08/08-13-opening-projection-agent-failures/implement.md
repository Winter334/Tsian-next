# 实施计划

## 0. 开始条件

- [ ] 用户审阅并明确批准最新 PRD/design/implement 摘要。
- [ ] 运行 `task.py start`，确认任务状态为 `in_progress`。
- [ ] 加载 `trellis-before-dev` 与 Phase 2.1 细节；实现 sub-agent 使用本任务 `implement.jsonl`。

## 1. 修复 card opening projection 契约

- [ ] 在 `commit-opening.js` 中把 `displayContent` 按平台契约视为可选，使用 `displayContent ?? content` 语义验证玩家可见正文。
- [ ] 按 design 拆分 projection validation issues；保持 `OPENING_REPLY_PROJECTION_FAILED` code 和全部正式写入前校验。
- [ ] 有界复制 projector metadata/diagnostics，排除正文、choices 文本和预览。
- [ ] `browser-skill-script-executor.ts` 的 `reply.project` SDK 返回 assistant projection 外加 diagnostics/config/rule metadata，与 commit consumer 和 spec 一致；保留现有 trace。
- [ ] turn 0 assistant item 仅在 projector 实际返回时写 `displayContent`；player context 继续只写 clean `content`。
- [ ] 检查重复提交、clean-save、refs/frontier 和原子写入路径没有改变。

Rollback point：card script 单文件修改可独立回退；不得通过修改平台 projector 强制返回冗余字段。

## 2. 补齐真实 seam smoke

- [ ] 在现有 `assistant-runtime.smoke.test.ts` 引入 `projectAssistantReply`，fixture 使用正式 `[[选项]]` 规则语义，并通过与 production browser-script SDK 相同的投影形状交给 opening script。
- [ ] 成功路径通过真实 projector 产生省略 `displayContent` 的结果，再执行 opening script。
- [ ] 断言 turn 0 clean content、choices projection、可选 display 字段和 player context 一致。
- [ ] 把关键 projection failure 改为真实“无 choices”路径，断言结构化 issue 和零写入。
- [ ] 保留现有 ref/path/already-complete/already-started 行为断言，不新增测试文件。

Rollback point：若 smoke fixture 与生产卡配置难以共享，保留最小等价 choices rule 字符串并明确断言规则语义；不引入跨包构建时文件读取。

## 3. 把 opening Skill 重构为顺序流程

- [ ] 将恢复现场、按需取证、收敛访谈、组装最小草案、委派 storyteller、对齐正文终点、`commit_opening` 写成一条主流程；每步给出完成条件和失败去向。
- [ ] 让访谈每轮只表达当前建模分歧，不把切入点与人称/文风配置捆绑；保留自由回答。
- [ ] 在玩家确认开始后，用 `agent_call` 将已确认事实、切入点、最小模型草案和终点约束交给 storyteller，正文与正式 `[[选项]]` 均由 storyteller 生成。
- [ ] storyteller 返回后核对来源事实、openingReply 终点、runtime/scene/present/实体状态；按“修 brief 重新委派 / 修草案 / 回到玩家问题”分流。
- [ ] 将 `OPENING_REPLY_PROJECTION_FAILED` 按 details 映射回正文生成或停止；未映射错误和同一输入复现相同 code 保留原错误并停止。
- [ ] 不在 AI-facing Skill 中添加“禁止读取 writer 文件”的孤立禁令，也不教授 lane/displayContent、executor/checkpoint 等内部机制。
- [ ] 按 AI-facing content 与自包含指南复读 Skill，确认流程术语、storyteller brief、完成条件和失败分支均在当前 Skill 内可理解。

Rollback point：Skill 文案与脚本逻辑独立；若文案增加噪声，保留结构化 details 和最短恢复规则即可。

## 4. 修复 optional read 与 checkpoint supersession

- [ ] `commit-opening.js` 的 `optionalFile` 仅捕获 `WORKSPACE_FILE_NOT_FOUND` 并返回 `null`；其他异常原样抛出。
- [ ] smoke 的 workspace read 使用真实 not-found 抛错语义，证明缺失 legacy optional files 的成功路径。
- [ ] 增加非 not-found 读取失败的零写入断言，不为测试改变生产 executor。
- [ ] `compressTaskContext` 输出顺序改为 framework → summary → pinned unresolved → recent，保持每个 native round 原子性和成功解除 pin 行为。
- [ ] 扩展现有 compression smoke：失败 payload 不进入 compressor、原始失败轮位于 checkpoint 后、同 key 成功后旧失败不再 pin。

Rollback point：optional-read 与 checkpoint-order 可分别回退；不修改摘要 prompt/schema、全局预算或 Tool 协议。

## 5. 根因核对与范围审计

- [ ] 对照 `research/findings.md` 逐项确认：哪些由本次代码/提示词修复，哪些属于模型执行或延后平台治理。
- [ ] 对照最新建模请求确认流程覆盖：`agent_call` 未使用、storyteller 上下文逆向、互斥模块读取、切入点与人称捆绑、尚未进入 commit。
- [ ] 搜索是否还有 card opening 调用方把 `displayContent` 当必填。
- [ ] 确认不修改 projector、contracts、通用 Tool schema、checkpoint prompt/schema、全局 tool budget 和六维规则。
- [ ] 更新 PRD/设计中因实现发现而变化的技术事实；需求范围变化则退回用户审阅。

## 6. 验证

- [ ] `npm exec vitest run -- apps/platform-web/src/integration/assistant-runtime.smoke.test.ts`
- [ ] `npm run test:smoke:web`
- [ ] `npm run build:web`
- [ ] `npm run package:card`
- [ ] `git diff --check`
- [ ] 手工审查 validation matrix：display omitted/present/invalid，content empty，choices missing/count/item，diagnostics bounded，所有失败零正式写入。
- [ ] 手工审查 optional read matrix 与 checkpoint message order；复核复测日志中的相同错误/前端逆向诱因已被覆盖。
- [ ] 手工审查 Skill 阶段流：每阶段有完成条件与失败去向；storyteller 委派发生在 commit 前；访谈示例不把切入点和表达配置绑定。
- [ ] 运行 `trellis-check` 完整审查 spec、复用、跨层数据流与工作区一致性。

## 7. 完成

- [ ] 必要时通过 `trellis-update-spec` 修正项目级契约文档；若现有 spec 已准确，仅记录无需更新的证据。
- [ ] 汇总契约修复、测试覆盖、提示词变化与未处理根因。
- [ ] 按 Trellis Phase 3 完成提交与 session wrap-up。
