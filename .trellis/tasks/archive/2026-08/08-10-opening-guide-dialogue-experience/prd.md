# 开局向导对话与模型一致性优化

## Goal

改善开局建模对话阶段的反馈质量、上下文一致性与正式模型完整性：让流式响应动画更自然，让前置角色类型选择真正进入 Agent 上下文，并让开局按实际内容需要正常建立角色、地点、关系、容器、物品和装备等正式数据。

## Background and Confirmed Facts

- 用户正在实际体验此前优化过流程与 UI 的开局向导，并已进入“与 Agent 对话建立开局模型”阶段。
- 当前流式输出动画观感不佳，需要重新设计。代码显示等待、首个 delta 到达和最终落定分别使用三种不同视觉，存在明显的容器切换与布局跳变。
- 用户在前置卡片中选择“原创角色”或“原著角色”后，Agent 仍会重复询问同一问题。
- 当前开局建模 Skill 的职责、调用顺序和数据流不够直观，需要结合实现解释。
- 前端源码权威是 `apps/play-frontend-dev/src/**`；`cards/沉浸阅读器.tsian-card/frontend/**` 是历史导出残留，不参与整卡打包。
- `OpeningBranchChoice.vue:14,25` 已分别发送 `canon` / `original`，并由 `SetupWizard.vue:124` 直接交给 `startOpeningInterview`。
- `useSetupState.ts:539-555` 把 branch 写入 `opening-interview.json`，再启动 `world-architect` 的持久临时会话。
- `opening-interview.ts:384` 的 injection 已携带 branch 枚举；因此缺陷不是“完全没传”，而是 Agent-facing 语义不够显式：当前只给 `canon` / `original`，没有直接说明对应中文选择，也没有把“该选择已确认，首问直接进入所选分支”建立为自包含契约。
- 《开局建模》Skill 使用“原著分支/原创分支”描述行为，但没有明确声明 `canon = 原著角色`、`original = 原创角色`。实际重复询问证明当前提示边界不足。
- `PlaySetupDialog.vue:89-96` 在 running 状态先显示独立 Canvas 余烬动画，收到文本后切换为自定义流式卡片；完成后再替换成正式 `NarrativeMessage`。流式块与落定消息的背景、边框、间距和排版不同。
- 当前流式内容通过 `useSetupState.ts:97-105` 订阅 `world-architect` content delta，并用 `sanitizeOpeningDisplay` 隐藏尚未完成的内部协议块。
- 当前正式 schema、物品栏前端与装备管理 Skill/Action 已支持 container/item、character containers/equipment；只有新 `commit_opening` 为缩小首版校验面而硬性限制 entity 为 character/location。
- 旧版开局实体提交曾允许 container/item，但校验较宽松；本轮应恢复正常内容能力，同时使用当前原子提交和确定性装备语义建立完整闭包，不能简单恢复旧脚本。

## Requirements

- R1：重新设计开局建模对话中的流式输出反馈，使等待、持续生成与结束状态自然且可辨认。
- R1.1：采用“安静的连续排版”方向：等待、流式生成和完成始终使用同一消息骨架，不再在 Canvas、独立流式卡片和正式消息之间切换。
- R1.2：首个文本 delta 到达前，在消息正文位置显示低干扰状态与小型呼吸光点；文本到达后光点跟随内容末尾；完成时光点淡出，正文位置和排版不跳变。
- R1.3：不使用打字机逐字补间，不使用随机粒子聚拢或闪烁矩形 caret；`prefers-reduced-motion` 下取消呼吸与淡出动画，保留静态状态标记。
- R2：前置卡片选中的“原创角色/原著角色”必须进入发给 Agent 的上下文，并成为后续问答的已知事实；无冲突时 Agent 不得再次询问角色类型。
- R2.1：前端 injection 必须同时包含稳定枚举和清楚的人类语义，并明确这是已由玩家确认、会话内不可改写的事实。
- R2.2：《开局建模》Skill 必须自包含地定义 branch 映射，并从所选分支的最高价值首问开始，不重复确认分支。
- R3：核对角色选择从 UI 状态、前端消息构造到 Agent/Skill 消费的完整链路，并修复实际断点，而非仅改提示文案。
- R4：结合相关代码整理开局建模的触发条件、消息注入、Skill 调用、问答推进、模型产物和前端状态变化，向用户给出可验证的流程说明。
- R5：保持此前已经完成的角色卡片 UI 与开局建模主流程兼容，不扩大到无关的世界观、角色卡业务内容重写。
- R6：开局正式模型按当前内容需要建立最小充分闭包；`character`、`location`、`container`、`item`、角色持有容器与装备都使用既有正式 schema，不对物品/装备设置额外的必建或禁建规则。
- R6.1：小说事实、玩家设定或开局处境确实需要某个容器、物品或装备时，按与角色、地点、关系相同的普通建模判据创建并闭合引用；与当前开局无关时不为填充结构而创建。
- R6.2：《开局建模》Skill 只说明“按实际需要建立最小充分模型”和正式 schema 约束，不把 container/item/equipment 写成特殊警告、例外或强制清单。
- R6.3：`commit_opening` 必须接受并完整校验开局实际使用的 container/item、character containers/equipment、数量、嵌套与装备引用；未知 ref-bearing extension 继续使用既有正式 schema 边界，不作为绕过核心模型的替代通道。

## Acceptance Criteria

- [ ] 选择“原创角色”后进入对话，首次 Agent 响应不会再次询问“原创还是原著”。
- [ ] 选择“原著角色”后进入对话，首次 Agent 响应不会再次询问“原创还是原著”。
- [ ] 发给 Agent 的上下文可明确区分两种选择，且不存在 UI 选择与消息内容不一致的路径。
- [ ] 手工检查两种分支的实际请求，确认 injection 含正确且唯一的角色类型语义，控制文件、隐藏状态与恢复路径保持同一 branch。
- [ ] 流式响应的等待、生成中和完成状态有明确且协调的视觉表现，不干扰正文阅读。
- [ ] 从等待到首个 delta、持续生成到最终落定，全程保持同一消息宽度、边距、字体和正文起始位置，没有容器替换造成的明显跳变。
- [ ] reduced-motion 模式不播放循环或位移动画，且等待/生成状态仍可辨认。
- [ ] 构建与打包验证覆盖最新前端和卡 workspace；根据仓库 smoke-only 策略不新增独立 UI/组件测试文件。
- [ ] 开局建模流程说明能对应到实际代码入口、消息/状态流和 Skill 产物。
- [ ] 不涉及物品/装备的普通开局不会产生无意义的 container/item 数据。
- [ ] 涉及持有物或装备的开局能按正式 schema 创建必要 container/item，并让 character containers/equipment、容器 contents 与 item 引用形成可读取的完整闭包。
- [ ] Skill、action schema 与脚本中不再残留“开局只允许 character/location”或特殊禁止 container/item/equipment 的 AI-facing 规则。

## Out of Scope

- 本轮不重写开局世界观或角色塑造的业务内容。
- 本轮不处理 Agent Tool Observation 的生产复测。
- 未经最终规划确认，不直接修改产品代码。
