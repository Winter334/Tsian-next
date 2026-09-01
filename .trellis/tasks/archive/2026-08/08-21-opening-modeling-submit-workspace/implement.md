# 优化开局建模提交与实体落盘 — Implementation Plan

## Phase 1 — 精简开局 action

- [ ] 1.1 从当前 `commit-opening.js` 提取 source/control/play-started、id/ref 与 opening reply projection 的共享 helper。
- [ ] 1.2 实现 `commit_opening_entities`：批内 validate-before-write，只检查安全 id/path、重复项和核心必填字段，写正常 entity paths。
- [ ] 1.3 实现 `commit_opening_graph`：读取正常 entity authority，批内校验 scene/relationship 直接 refs，全部通过后写正常 graph paths。
- [ ] 1.4 实现 `commit_opening_state`：校验 runtime 核心 refs 与 frontier source 范围，写正常 runtime/frontier 和 pending setup summary 文本。
- [ ] 1.5 实现 `publish_opening`：最低发布检查、正文投影、turn0/context/setup complete；不接收或重写模型 sections。
- [ ] 1.6 action schema 保持开放：不使用全字段 `additionalProperties:false`、内容 hash、path receipt 或 validation audit。

## Phase 2 — Agent 进度与分阶段持久化

- [ ] 2.1 重写《开局建模》frontmatter、输入说明和顺序流程，把“一次提交最小世界模型”改为分阶段持久化，并增加 `opening-interview:continue:<sessionId>`。
- [ ] 2.2 保留恢复、定向取证与访谈收敛步骤；删除“最终阶段前不得写正式模型”、全量内存草案和末尾原子提交规则。
- [ ] 2.3 将建模步骤改为 entities、graph、state 三个 durable phase；每个 persistent invocation 只组装并调用当前 action，成功后更新 notes、输出隐藏 `[[开局继续]]` 并结束，失败不写当前阶段、不伪造完成记录。
- [ ] 2.4 复用 `save/playthrough/opening-notes.md`，自然语言维护已确认、已读原文、已完成、下一步和正文边界；恢复时结合正常 workspace 判断首个未完成阶段。
- [ ] 2.5 state durable 后才调用 storyteller；request 只告诉它读取 notes、runtime、active scene/entity/relationship、frontier 摘要和输出格式，不复制完整模型。
- [ ] 2.6 核对 storyteller 正文与已落盘状态；偏离时只重试正文，模型本身确需修正时回到对应阶段并再次形成持久边界。
- [ ] 2.7 用 `responseRef` 调 `publish_opening`；publish 只写 turn 0、player context、setup complete，移除旧完整 brief、全量 `commit_opening` 和 strict schema 校验提示残留。

## Phase 3 — Frontend continuation 与恢复

- [ ] 3.1 在 reply projection 增加 `openingContinue`，并解析 `opening-interview:continue:<sessionId>`；内部 marker 不显示为玩家消息。
- [ ] 3.2 同页收到 continuation 投影时自动启动下一 invocation；无进展/失败时停止递归并显示重试。
- [ ] 3.3 刷新从 transcript 恢复 continuation 状态但不自动调用模型；点击重试后 world-architect 读取 notes 自行恢复。
- [ ] 3.4 放宽 legacy 检查：合法 source/control + setup pending + opening notes 可拥有 partial formal model；其他未知旧状态继续 fail closed。
- [ ] 3.5 保持 setup complete 为唯一进入 opening confirm / gameplay 的完成门。

## Phase 4 — 原著剧情大纲与展示

- [ ] 4.1 给 source anchor 增加 optional `summary`，parser/旧数据保持兼容。
- [ ] 4.2 开局 state 与 `frontier推进` 为每个重要 source node 写 1–3 句已读内容客观梗概。
- [ ] 4.3 `formatTimelineBlock` 在附近 source 节点包含 summary，保留“未来节点不是已发生事实/必须剧本”提示。
- [ ] 4.4 stage-manager 聚合保持 optional summary；Timeline 对当前/过去 source 节点直接显示 summary。
- [ ] 4.5 Timeline 对 `order > runtime.plotOrder` 的未来 source 节点默认折叠 summary，以明确的可能剧透提示按钮展开；展开状态仅在组件本地保存，刷新无需恢复。
- [ ] 4.6 为 summary 缺省、当前/过去直显、未来默认折叠与点击展开补充组件测试。

## Phase 5 — 自动化验证

- [ ] 5.1 action harness 覆盖 entities→graph→state→publish 成功链路。
- [ ] 5.2 每阶段覆盖一个核心输入错误，断言当前批零写入、前序正常文件保留。
- [ ] 5.3 覆盖 notes 随成功 outer invocation 保存、失败 invocation 不产生虚假阶段记录。
- [ ] 5.4 覆盖 continuation marker 隐藏、同页串行推进、失败停止、刷新不自动调用、重试恢复。
- [ ] 5.5 覆盖 storyteller/publish 失败后正常模型不重建、alreadyComplete 与 play-started 拒绝。
- [ ] 5.6 数据流断言：storyteller request 不复制实体长文本；publish input 不包含 entities/scenes/runtime/frontier。
- [ ] 5.7 覆盖旧 anchor 兼容、附近节点注入 summary、无 summary 原行为，以及未来节点摘要默认折叠。

## Phase 6 — 验证与打包

- [ ] 6.1 `npm run test:smoke:web`
- [ ] 6.2 `npm run build:web`
- [ ] 6.3 `npm run build:play-frontend`
- [ ] 6.4 `npm run package:frontend`
- [ ] 6.5 `npm run package:card`
- [ ] 6.6 `git diff --check`，检查旧 action/严格 schema/完整 brief 残留和未注册脚本。
- [ ] 6.7 真实浏览器验收：阶段失败后继续、刷新恢复、storyteller/provider 失败不重建模型、进入故事后不重发 publish。

## Review Gates

- action 写入前必须完成本批所有最低校验；不要边校验边写。
- notes 是 Agent 工作记忆，不是程序状态机；frontend 只消费 continuation projection。
- 不以“更安全”为由恢复全量模型 schema 校验、hash/receipt 或任意历史迁移系统。
- 原著 summary 只能来自已读内容，只描述 canon，不写创作方向或玩家已发生事实。
- 最后仍有正文 publish，但不得把它重新演化成世界模型的统一提交点。
