# PRD — 限制机制改造（token 预算）

> 父任务：`06-19-tool-runtime-performance`。**依赖子1（tool-skill-decouple）**——子1 改了工具循环形态（use_skill 注入、run_script 执行），token 预算机制需在新循环上实现。

> **⚠️ 状态：搁置，待重写（2026-06-19）**
> 规划讨论中发现本任务原设想的"工具循环内 token 压缩"建立在错误假设上（以为历史对话是上下文大头、压缩可只在 turn 内做）。经厘清，AIRP 的 master agent 上下文生命周期 + 压缩持久化是更底层的基础，需先落实。本任务的 design.md / implement.md 已偏离，保留作历史参考，**待新基础任务 `agent-session-context-lifecycle` 完成后重写**。下方"讨论结论沉淀"记录真实范围，供重写时依据。

---

## 讨论结论沉淀（2026-06-19，供重写依据）

### AIRP 架构认知（决定本任务真实形态）

- **一次存档 = 和 master agent 的一次超长会话**。玩家与 master agent 对话，master agent 调工具安排其它 agent（正文 agent 写剧情、记忆 agent 总结记忆、状态 agent 维护状态）。
- **三层视角分离**：
  - 玩家视角（UI）：完整未压缩的剧情正文，可向前翻阅所有历史。存档原文永远完整。
  - master agent 视角（上下文）：压缩 + 累积到阈值 + 再压缩的循环，保持"1 摘要 + K 轮正文"稳态。
  - 工作区（持久记忆）：记忆 agent 总结的人物/事件/地点/设定 + 状态 agent 维护的状态文件（前端渲染成 UI）。
- **压缩对象 = 剧情正文序列**（user 输入 + assistant 正式回复），**过滤掉思考流和工具调用**（它们不是剧情，混进摘要会污染质量）。每个 turn 的工具过程是 turn 内的，用完即弃，不跨 turn 保留进上下文。
- **压缩持久化**：master agent 的会话上下文记录独立于玩家剧情正文存档，跨 turn / 跨加载保持稳态。

### 本任务原设想的错误

1. **以为历史对话是上下文大头** → 实际 `normalizeHistory slice(-20)` 已把历史砍到 20 条，体积有限，很少触发 token 压缩。真正的增长源是工具循环内 tool 交互累积。
2. **以为压缩可只在 turn 内做、跨 turn 重建可接受** → 实际压缩不持久化会跨 turn 失忆，稳态不成立。
3. **以为 token 预算压缩是独立可做的机制** → 实际它依赖 master agent 上下文生命周期（持久化、跨加载恢复、压缩稳态）这个底层基础。

### 本任务真实范围（待新基础任务完成后重写）

在新基础任务 `agent-session-context-lifecycle` 落实"master agent 会话上下文记录持久化 + 跨加载稳态 + 剧情正文压缩"后，本任务在其上做：

- **去 maxToolRoundsPerAgent 硬轮次限制**：工具循环不再因轮次耗尽抛错（PRD 原始痛点，仍有效）。
- **工具循环内 token 预算兜底**：管 tool 交互累积（assistant toolCalls + tool observation + 注入 SKILL.md）的体积，超阈值时占位符修剪 / 丢弃早期 tool 轮次。这部分是新基础任务**不覆盖**的（新基础任务管"跨 turn 剧情正文压缩"，本任务管"turn 内 tool 交互体积"）。
- **温和兜底**：压缩后仍超限时报"上下文已满"，不裸抛"助手不可用"。

> 即：新基础任务管"跨 turn 的剧情正文上下文压缩持久化"，本任务管"turn 内工具循环的体积兜底 + 去轮次限制"。两者职责分明，本任务依赖新基础任务先建立上下文生命周期的底层。

### 依赖

- 上游：子1（tool-skill-decouple）——工具循环形态。
- 上游（新增）：`agent-session-context-lifecycle`——master agent 上下文生命周期 + 压缩持久化基础。
- 下游：无。

---

## 以下为原 PRD 内容（规划讨论前的设想，保留作历史参考，部分已被上方"讨论结论"修正）

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
