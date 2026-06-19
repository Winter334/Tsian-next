# PRD — 限制机制改造（token 预算）

> 父任务：`06-19-tool-runtime-performance`。**依赖子1（tool-skill-decouple）**——子1 改了工具循环形态（use_skill 注入、run_script 执行），token 预算机制需在新循环上实现。

## 目标与用户价值

消除当前"工具循环 3 轮硬掐"的强烈受限体感，对标主流 agent 框架（ZCode / Claude Code / Codex）的"几乎无轮次限制"体验：

- **去掉硬轮次限制**：`maxToolRoundsPerAgent: 3` 移除，工具循环不再因轮次耗尽抛错。模型探索路径（list→read→list→read）能自然完成多步探索后给回复。
- **改为 token 预算约束**：单次请求上下文超 token 上限时触发压缩，而非硬掐。上限默认 256k，覆盖主流模型上下文窗口。
- **温和兜底**：压缩后仍超限时报"上下文已满，请开始新会话"，不裸抛"助手不可用"，不丢已流式的 thought 文本。

用户价值：模型在需要 5-6 轮探索的场景下不再被 3 轮卡死；上下文真正不够时给可操作的提示而非突兀报错。

## 背景（来自实测 + 勘察）

- `maxToolRoundsPerAgent: 3`（`index.ts:190`）在 native（`:1071`）和 text（`:1256`）两处循环用，耗尽抛 `reached the workspace tool round limit without a final response`（`:1136`/`:1302`）。
- 实测：deepseek-v4-pro-auto 在 blank card 查 Agent，4 轮全 `finishReason: tool_calls`，round limit 耗尽报错，4 轮思考流全丢。
- 主流框架不用硬轮次限制，靠 token/context 总量预算约束工具循环，体感几乎无轮次限制。
- `contextWindow` 字段已存在于 `BrowserAiModelConfig`（`config/ai.ts:22`），但当前仅作 metadata 不强制（spec："until token-counting prompt-truncation task implements enforcement"）——本任务正是落实这个 enforcement。

## 需求

### R1 移除 maxToolRoundsPerAgent 作为循环终止条件

- native 与 text 两处工具循环不再因 `round >= maxToolRounds` 抛错。
- `maxToolRoundsPerAgent` 字段可保留在 `AgentRuntimeCollaborationPolicy`（向后兼容，不破坏配置 shape），但**不再作为循环终止条件**——或直接移除该字段（破坏性，原型期可接受）。**倾向移除**（YAGNI，不留死字段）。
- 循环终止条件改为：①模型返回 `finishReason: stop`（正常结束）；②上下文超 token 预算且压缩后仍超（R2）；③abort（停止按钮）。

### R2 上下文 token 预算 + 压缩

- **每轮调用模型前**，估算当前 `runtimeMessages`（含 system + history + tool messages）的 token 总量。
- **上限**：默认 256k tokens。实际上限 = `min(256000, model.contextWindow ?? 256000)`——model 配了更小 contextWindow 时用配置值，没配时用 256k 默认。
- **超限时触发压缩**（MVP 策略）：
  - 从 `runtimeMessages` 中间丢弃最早的 tool 调用/observation 轮次。
  - 保留：system prompt + 最初 user message + 最近 N 轮 tool 交互（N=2-3，design.md 定）。
  - 压缩后继续循环（不抛错）。
- **压缩后仍超限**（极端情况）：抛温和错误"上下文已满，无法继续。请开始新会话或精简对话历史。"——不丢已流式的 thought 文本（流式已推 UI 的保留）。

### R3 token 估算方式

- **MVP 用字符数估算**：token ≈ 字符数 / 4（粗略，中英混合场景可接受）。不引入 tokenizer 依赖。
- 估算函数：遍历 `runtimeMessages`，累加每条 message 的 content 字符数 / 4。toolCalls 的 arguments 也计入。
- design.md 评估是否需更精确（如按中文字符 / 2、英文 / 4 分开估算），MVP 倾向统一 / 4。

### R4 不再出现 round limit 报错

- `reached the workspace tool round limit without a final response` 错误条件随 R1 移除。
- AssistantView 的 catch 逻辑：当前对 AbortError 保留半截 + "（已停止）"，对其它错误设 errorMessage。新增对"上下文已满"错误的处理——保留已流式 thought + 显示温和提示（不 pop 占位消息）。

## 验收标准

- [ ] `maxToolRoundsPerAgent` 不再作为工具循环终止条件（字段移除或停用）。
- [ ] 工具循环可超过 4 轮不报 round limit 错（实测：让模型探索 6+ 轮）。
- [ ] 上下文超 token 上限时触发压缩而非抛错；压缩后继续循环。
- [ ] 压缩后仍超限时温和报错"上下文已满"，不裸抛"助手不可用"，不丢已流式 thought。
- [ ] 不再出现 `reached the workspace tool round limit without a final response`。
- [ ] token 上限默认 256k，model.contextWindow 配置可覆盖（更小值生效）。
- [ ] `npm run build`（含 contracts）通过。
- [ ] 真实 API 实测：模型多步探索不被卡死；人为构造超长上下文触发压缩不崩。

## 明确不做

- 不做软提示（接近 token 临界值时提醒模型"尽快收尾"）——后续演进。
- 不做精确 token 计数（引入 tokenizer）——MVP 用字符数估算。
- 不做复杂压缩策略（摘要式压缩、重要轮次保留优先级、滑动窗口）——MVP 用"丢弃最早 tool 轮次"简单策略。
- 不改 abort 机制（停止按钮，子2a 已实现）。
- 不改 model.config 的 contextWindow 字段定义（字段已存在，本任务只落实 enforcement）。

## 依赖

- 上游：子1（tool-skill-decouple）——工具循环形态变了（use_skill 注入、run_script 执行），token 预算在新循环上实现。
- 下游：无。

## 开放问题

- 压缩时保留最近 N 轮的 N 值：倾向 2-3 轮（足够模型继续任务），design.md 定。
- token 估算精度：统一 / 4 还是中英分开？MVP 倾向统一 / 4，design.md 评估误差可接受性。
- `maxToolRoundsPerAgent` 字段移除 vs 保留停用：倾向移除（不留死字段），但需确认配置 shape 破坏性影响（原型期可接受）。design.md 定。
- 压缩后是否给模型一个"上下文已压缩，早期工具结果可能丢失"的提示？倾向是（让模型知道早期信息可能不在了），design.md 定。
