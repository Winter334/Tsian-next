# 开局回复投影与 Agent 失控根因

## 证据范围

- 失败请求：`C:/Users/流莺白沙/.codex/attachments/2a875aab-2e55-4935-9636-859f256ca366/pasted-text.txt`
- 当前代码：card `commit-opening.js`、平台 `reply-projection.ts`、opening Skill、runtime tool schemas/checkpoint compression、现有 smoke test。
- 既有设计：回复投影 spec 与 07-15/08-08/08-10 Trellis 归档任务。
- 六维属性值规则按用户要求延后，不纳入本任务判断。
- 修复后复测请求：`C:/Users/流莺白沙/.codex/attachments/ba9cd06f-ea6c-4838-9a4d-1cc5cd8acc64/pasted-text.txt`。

## 0. 复测新增结论（2026-08-14）

- 投影契约修复已越过原失败点；三次 `commit_opening` 均改为失败于 `WORKSPACE_FILE_NOT_FOUND: save/agents/world-architect/context-understanding.json`。
- `commit-opening.js` 的 `optionalFile()` 直接调用 browser-script `workspace.read` 并期待 null；真实 `executeWorkspaceOperation` 对缺文件抛错。smoke mock 返回 null，形成第二个真实边界缺口。
- browser-script executor 的 `reply.project` 只返回 assistant projection，剥掉内部 projector metadata；smoke 却直接返回内部全量对象。现有 commit 对 diagnostics/config/rule fields 的消费若不补 SDK seam，只会在测试中成立。
- checkpoint 的“最新有效错误”写成旧 `OPENING_ENTITY_TYPE_INVALID`，而被 pin 的紧邻原始 Tool 结果是 `WORKSPACE_FILE_NOT_FOUND`。压缩输出当前把 pinned round 放在 summary 之前，使陈旧摘要在消息顺序上覆盖真实错误。
- checkpoint 后共 34 个串行 Tool 轮、52 次调用、约 110820 字符 Tool 结果；17 次 `frontend/dist` 读取/搜索贡献约 33000 字符。请求有 104 条 messages，Tool content 占消息正文约 74%。
- opening reply 在 canon 分支虚构“九阳焚天诀气息可能被察觉”的犹豫，并把原文立即运功改为选择点；这属于内容一致性 gate 仍需 Agent 执行，不是本次延迟的直接代码根因。

## 0.1 新建模请求：正文职责未委派（2026-08-14）

证据：`C:/Users/流莺白沙/.codex/attachments/abb06cc8-a91e-4d05-9e2b-8ae89d3ae0c5/pasted-text.txt`。

- 从玩家最后一次回答进入正式建模后，发生 19 个 Tool 轮、50 次调用；尚未调用 `commit_opening`。
- 39 次调用触及 `agents/storyteller`，其中 32 次读取写手文件或模块，约带回 3.16 万字符。world-architect 已具备 `agent_call` 且 storyteller 在 contacts 中，但本段调用 0 次。
- storyteller 的 `agent.json` 只启用第三人称、禁用词表、快捷回复、杀超雄；world-architect 仍读取第一/第二/第三人称、多种互斥文风、杀八股和 NSFW 目录，试图自行重建写手上下文。
- 访谈把“重生苏醒”选项写成“第一人称直面……”，把切入时点与叙事人称捆成一个决定；这与 storyteller 的第三人称有效配置冲突，也让玩家回答一个不属于世界模型的表达选择。
- 现有 Skill 的“必要时调用 storyteller”位于末尾附注，没有定义何时进入委派、给什么 brief、返回后如何核对、委派失败回到哪里。Agent 因而沿着“自己先理解 writer 全部配置”推进。

本次处理不增加“禁止读取某目录”的孤立规则，也不修改 storyteller。将 opening Skill 改成阶段流：收敛角色/切入点/必要事实 → 组装最小草案 → `agent_call` storyteller 生成正文与正式选项 → 对齐正文终点和模型 → commit；每阶段定义完成条件与失败去向。流程本身把职责交给正确 Agent，并避免在 world-architect 上下文中继续传播互斥写作模块概念。

## 1. 确定性契约缺陷

1. 卡规则 `config/reply-projection.json` 对正式 `[[选项]]` 使用 `text: ""`，同时从 content/display 两条 lane 删除选项块并投影 `choices`。
2. 平台 projector 只在最终 display lane 与 content 不同时返回 `displayContent`：`apps/platform-web/src/platform-host/reply-projection.ts:528`。平台 spec 同样规定相等时省略：`.trellis/spec/platform-web/frontend/state-management.md:498,520`。
3. card `commit_opening` 却把 `projected.displayContent` 当成必填非空字符串：`cards/沉浸阅读器.tsian-card/workspace/agents/world-architect/skills/开局建模/scripts/commit-opening.js:250-256`。
4. 因此，按当前正式规则得到的正常 projector 结果 `{content, projections.choices}` 会被稳定拒绝；重写选项文本不能修好。
5. 平台内置 opening template 已正确把 `displayContent` 当可选字段处理：`apps/platform-web/src/storage/workspace-templates/scripts/opening.ts:512-516`。应修 card 调用方，不应改变平台契约或强制 projector 冗余输出。

此缺陷不是 08-12 简化重构新引入；重构前的 card opening script 已有相同必填判断。简化重构新增的 smoke test继续复制了错误假设。

## 2. 测试缺口

- `apps/platform-web/src/integration/assistant-runtime.smoke.test.ts:583-587` 的 `tsian.reply.project` mock 永远返回 `displayContent`，与真实 projector 的可选契约不一致。
- 失败用例只覆盖 `choices: []`，没有覆盖“正文和 choices 均合法、仅省略 displayContent”的真实卡配置路径。
- 07-15 设计明确要求 opening turn 0 复用同一 projector，但当前测试只验证 script 对理想 mock 的消费，没有覆盖 `config/reply-projection.json → projectAssistantReply → commit_opening` seam。

## 3. 诊断契约不足是工具失控的首要诱因

- `commit_opening` 把正文、display、projection object、choices 数量和 choice item 五类检查折叠成同一个 `OPENING_REPLY_PROJECTION_FAILED`，且不返回 `issues`。
- `projectAssistantReply` 已提供 `diagnostics/configPresent/ruleCount/appliedRuleCount`，card script 全部丢弃。
- Agent 在 runtime effective workspace 中看不到 `apps/platform-web/src/platform-host/reply-projection.ts`；它能读到的是 card workspace 和 card frontend。错误要求它修 input，却不告诉哪一项失败，也不给宿主实现访问路径。
- 因而“读取配置后仍无法解释错误”不是提示词补一句 displayContent 内部机制就应该解决的问题。该字段本应对 Agent 隐形；正确修法是调用方遵守契约，并在真正输入不合法时给出结构化、无正文预览的诊断。

## 4. Skill 恢复协议缺少有界失败路径

- opening Skill 当前只说“按 code/message 修正输入后重试”：`SKILL.md:176`。
- `OPENING_REPLY_PROJECTION_FAILED` 不在常见失败列表，Skill 没说明哪些 details 属于可修输入，也没说明重复相同错误或平台/config 级问题时如何停止。
- 该指令与不可操作的笼统 message 组合后，持续诱导 Agent 继续找“可以改的 openingReply”，而不是识别不可由当前可见输入修复的宿主缺陷。
- 最小提示词改进应是正向恢复路径：根据结构化 `issues` 只修当前 input；同一合法 input 仍出现平台/config 级失败时保留错误码并停止提交。无需向 Agent 教授 lane 相等、省略字段等平台内部机制。

## 5. checkpoint 是放大器，不是最初根因

- 请求中的 checkpoint 已把“查看 frontend/host reply.project 实现”写成恢复动作，恢复后模型把它当成新的 user 权威计划。
- 通用 task-checkpoint prompt 强制输出“恢复动作”，但不校验动作是否由当前可见工具/Skill action 支持：`apps/platform-web/src/agent-runtime/context-lifecycle.ts:485-505`。
- 该 checkpoint 很可能忠实保留了压缩前已经形成的错误排查意图；现有证据不足以证明是 compression model 首次发明了该计划。
- 首轮 MVP 优先修上游诊断和 Skill 停止条件；复测已证明 checkpoint 顺序会让陈旧摘要覆盖被 pin 的最新原始失败，因此本任务增加仅调整 summary/pinned round 相对顺序的最小平台修复，不改 compression prompt/schema 或预算。

## 6. 请求中的执行异常及归因

请求共 125 条 message、70 次 tool call；checkpoint 后仍有 69 次。tool observation 正文 144,431 字符，占全部 message content 的 94.8%。

| 异常 | 证据 | 归因 | 本任务处理 |
|---|---|---|---|
| 读取/搜索 `frontend/dist/assets/stdin.js` | 多次 read/search；实际是 card UI bundle，不是 host projector 权威 | 不可操作错误 + 错误恢复计划引发的无边界逆向 | 结构化诊断 + Skill 有界停止 |
| `run_script {}` | runtime 返回 `ACTION_SKILL_REQUIRED`；tool schema 已要求 `skill/script` | 模型工具参数失败，不是 schema 缺失 | 不改通用 tool schema；提前阻断失控链 |
| 虚构 `project_reply_probe` | `ACTION_NOT_FOUND` 同时返回三项 available actions | 模型在缺少诊断 action 时猜测能力 | Skill 指向现有 details/停止路径；不新增 probe action |
| 把 lineNumber 当 charOffset | 搜索命中 5440 行后读取 charOffset 5435，落入无关组件 | 逆向路径中的模型执行错误 | 不扩展 read API；移除触发该路径的原因 |
| skill 加载晚、重复读 docs/schema | 已有 checkpoint 和 action index 仍反复探索 | 上下文漂移和工具循环 | 更短的错误恢复路径；测试验证错误可定位 |
| 请求持续膨胀 | 69 次恢复后调用、94.8% tool content | 上述因素叠加；现有 stall/timeout 未及早收敛 | 本任务不新增全局 tool-call budget；记录为后续平台治理候选 |

`providerBody.tools[*].function.parameters = "[circular]"` 是 diagnostic sanitizer 对重复对象引用的导出表示，不是实际 provider body 破损；`sanitizeDiagnosticValue` 在 `apps/platform-web/src/storage/diagnostic-records.ts:128` 产生该占位。

## 7. 内容与模型一致性异常

- Skill 已有“只使用实际读到的内容”和“只创建首回合需要的内容”，所以所有内容漂移不能简单归因于缺少总原则。
- 最终提交前缺少一个明确的跨产物时点检查：`openingReply` 结束、等待玩家选择的瞬间，必须与 runtime location、active scene、scene.present 和实体当前状态一致。
- 失败输入的正文结束时王有信和四名侍卫已在场，但 active scene 仍是“第1章 清晨醒来”且 present 只有萧凌/北清雪，属于终点状态未对齐。
- 正文把纸包草药改成药碗/赊药/大夫，并把“经脉全部修复”写成“续了大半”，说明 storyteller 产物没有在 commit 前按已读来源复核。
- Skill 可增加一个短的提交前一致性 gate：来源事实受已读证据约束；模型时点以 openingReply 末尾为准；委派正文返回后先校对，再提交。不要增加开发侧解释或重复已有最小建模原则。

## 8. 建议实现边界

1. 修复 card `commit_opening` 对 optional `displayContent` 的消费，并按平台惯例条件持久化。
2. 在投影失败 details 中返回有界 issue codes、choice count 与 projector metadata/diagnostics，不返回 opening reply 文本或预览。
3. 让现有 smoke test 调用真实 `projectAssistantReply` 配合正式 choices 规则语义，覆盖省略 displayContent 的成功路径和无 choices 的原子失败路径。
4. 更新 opening Skill 的投影失败恢复和提交前来源/时点一致性 gate。
5. 不修改平台 projector、通用 run_script schema、全局 tool-loop budget 或 checkpoint compression prompt/schema；仅调整已保留 checkpoint 消息的 supersession 顺序。
