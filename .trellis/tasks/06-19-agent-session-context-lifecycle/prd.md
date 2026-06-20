# PRD — master agent 会话上下文生命周期与压缩持久化

## Goal 与用户价值

落实 AIRP 基础模型：master agent 有独立的"会话上下文记录"（区别于玩家可见的剧情正文存档），持久化跨 turn / 跨加载保持上下文稳态。这是 token 预算优化（`tool-token-budget`）的底层依赖，需先落实。

用户价值：
- **master agent 跨 turn / 跨加载不失忆**：当前每个 turn 从剧情正文存档（`saveHistory`）重建上下文，工具过程跨 turn 丢失、压缩无持久化导致稳态不成立。落实后 master agent 始终在"一个连续上下文窗口"中与玩家对话。
- **超长会话不崩**：一次存档可能上百上千轮，master agent 上下文经压缩保持"1 摘要 + K 轮正文"稳态，不会随对话增长无限膨胀。
- **玩家视角不受影响**：剧情正文存档（可翻阅完整原文）独立保留，压缩只作用于 master agent 的上下文记录。

## 背景与已确认事实（代码勘察）

### AIRP 架构模型（讨论确认）

- **一次存档 = 和 master agent 的一次超长会话**。玩家与 master agent 对话，master agent 调工具安排其它 agent（正文 agent 写剧情、记忆 agent 总结记忆、状态 agent 维护状态）。
- **三层视角分离**：
  - 玩家视角（UI）：完整未压缩的剧情正文，可向前翻阅所有历史。存档原文永远完整。
  - master agent 视角（上下文）：压缩 + 累积到阈值 + 再压缩的循环，保持"1 摘要 + K 轮正文"稳态。
  - 工作区（持久记忆）：记忆 agent 总结的人物/事件/地点/设定 + 状态 agent 维护的状态文件（前端渲染成 UI）。
- **压缩对象 = 剧情正文序列**（user 输入 + assistant 正式回复），**过滤掉思考流和工具调用**（它们不是剧情，混进摘要会污染质量）。每个 turn 的工具过程是 turn 内的，用完即弃，不跨 turn 保留进上下文。

### 当前代码事实（勘察确认）

- `saveHistory`（IndexedDB `saveHistory` 表）：存 `ConversationMessageRecord[]`（`{role, content}`，仅 user/assistant 原文）。`getHistoryForSave`（saves.ts:314）取完整记录无截断；`normalizeHistory`（index.ts:274）`slice(-20)` 截到最近 20 条进 message。→ 这是**玩家视角的剧情正文存档**，但当前也**误用作 master agent 上下文源**。
- `agentSessionTranscript`（工作区文件 `save/{agentPath}/session.jsonl`）：存 `AgentSessionTranscriptRecord`（每轮 model 调用的完整 messages + modelOutput + toolCalls + toolObservations + round + status），**追加写入**（`appendJsonlRecords`），agent-runtime 侧**只写不读**——是 trace/审计性质，不参与上下文重建。
- `rawAirpHistoryTurn`（工作区文件 `save/.../raw-history/turn-N.json`）：每轮 user 输入 + assistant 正式输出，是剧情正文存档的工作区镜像。
- **当前 turn 生命周期**：`runAgentRuntimeTurn` 从 `recentHistory`（= `saveHistory` 原文）`buildEntryAgentMessages` 构建初始 messages → 工具循环内 push tool 轮次 → turn 结束 `nextHistory = [...historyBefore, user, assistant]` 存回 `saveHistory`。**工具过程不持久化进上下文源，压缩未实现，跨 turn 从原文重建。**

### 当前架构的缺陷（本任务要修）

1. master agent 上下文源 = 剧情正文存档（`saveHistory`），两者混为一份。工具过程跨 turn 丢失。
2. 无压缩持久化。上下文随对话增长无限膨胀（仅 `slice(-20)` 条数硬限，非 token 体积约束）。
3. `slice(-20)` 条数限制与 token 体积约束维度冲突（详见 `tool-token-budget` prd 讨论结论）。

## Requirements

### R1 master agent 会话上下文记录独立化

- master agent 的上下文记录与玩家剧情正文存档分离。上下文记录持久化，跨 turn / 跨加载恢复。
- 上下文记录内容 = 剧情正文序列（user 输入 + assistant 正式回复，过滤思考流/工具调用）+ 压缩摘要（若有）。
- 玩家剧情正文存档（`saveHistory`）保持现有语义不变（完整原文，给 UI 翻阅）。
- **存储决策（brainstorm 已定）**：统一到工作区模型，新建 `save/agents/master/context.json`（工作区文件，`RuntimeWorkspaceTransaction.write` 原地更新）。复用现有事务写入机制，与 `session.jsonl`（trace）/ `rawAirpHistoryTurn`（正文镜像）同目录聚合，不新增 IndexedDB 表，checkpoint 自动覆盖。
- **数据结构决策（brainstorm 已定）**：`context.json` 存结构化"剧情上下文段"（不存完整 messages，system/Workspace 上下文每 turn 现构建）：
  ```json
  {
    "schema": "tsian.agent.context.v1",
    "saveId": "...",
    "agentId": "master",
    "summary": null | "早期剧情摘要文本（压缩后产生）",
    "recentTurns": [
      { "turn": 12, "role": "user", "content": "玩家输入原文" },
      { "turn": 12, "role": "assistant", "content": "assistant 正式回复原文" }
    ],
    "lastCompressedTurn": null | 10,
    "updatedAt": "2026-06-19T..."
  }
  ```
  - `summary`：压缩摘要段（null = 尚未触发压缩）。
  - `recentTurns`：最近 K 轮正文（user+assistant 对，带 turn 索引，原文）。
  - `lastCompressedTurn`：上次压缩覆盖到第几轮（防重复压缩）。
- **delegated agent 不需要上下文生命周期**（勘察确认）：agent_call 子 agent 每次临时构建即弃，无状态，不持久化上下文。本任务只针对 master agent。

### R2 上下文源切换

- `runAgentRuntimeTurn` 的上下文从 master agent 会话上下文记录重建（而非 `saveHistory` 原文 + slice(-20)）。
- 构建的初始 messages = system + 上下文记录里的"1 摘要 + K 轮正文"形态。

### R3 压缩 + 持久化稳态

- 上下文累积到阈值 → 早期剧情正文调 model 摘要化（只压正文，过滤工具过程）→ 保持"1 摘要 + K 轮正文"稳态。
- 压缩结果持久化进 master agent 会话上下文记录（`context.json`）。
- 跨 turn / 跨加载从持久化记录恢复稳态。
- **压缩参数（brainstorm 已定）**：
  - 阈值 85% budget（复用 `tool-token-budget` 决策）。
  - budget = model.contextWindow（无配置 256k，复用 `tool-token-budget` 决策）。
  - K=5（最近保留 5 轮正文，复用 `tool-token-budget` 讨论结论）。
- **model 选择（brainstorm 已定）**：用 master agent 的 model（走 `capabilities.callModel`，`options.agentId="master"`，复用现有 `resolveAgentModelConfig` 机制）。
- **失败兜底（brainstorm 已定）**：**失败即温和报错，不强行继续**。下轮开头压缩调用失败 → 抛 `ContextCompressionFailedError` → AssistantView catch 显示单一温和提示"上下文压缩失败，无法继续本轮。请重试；若持续失败，请检查 Agent 模型配置或开始新会话。"理由（用户判断）：上下文塞满强行玩剧情质量劣化，不如明确告诉用户重试（重试时压缩可能恢复）；持续失败则提示修配置/开新会话。报错时当前 turn 回复尚未开始生成（压缩在 model 调用前），用户需重发。记 `context_compression_failed` trace 供诊断。不区分子类（网络/配置/model 拒绝）——当前 `generateAssistantReply` 不暴露可靠错误细分，单一提示覆盖重试+修配置+开新会话三种行动。
- **摘要 prompt（brainstorm 已定）**：**叙事梗概风格**。prompt 要点：保留情节推进/人物行动与状态变化/场景转换/未解决线索或伏笔；叙事梗概连贯可读（非要点列表）；不逐字复述不记具体台词；控制在 targetTokens 以内；旧 summary（若有）+ 被压缩的 recentTurns 正文一起送，实现"旧摘要二次浓缩"稳态循环。与记忆 agent 职责区分：记忆 agent 提取事实/设定（结构化存储供检索），压缩摘要浓缩情节流（一段梗概塞上下文）——不重复记忆 agent 职责。

### R4 turn 生命周期改造

- turn 结束时，本轮 user 输入 + assistant 正式回复追加进 master agent 会话上下文记录（`context.json` 的 `recentTurns`，原文形态）。**不在 turn 结束时压缩**（见 R3 时机决策）。
- 工具过程（思考流/toolCalls/observations）不追加进上下文记录（turn 内用完即弃）。
- **压缩时机决策（brainstorm 已定）**：**下个 turn 开头压缩**。`runAgentRuntimeTurn` 开头读 `context.json` → 估算 token → 超 85% 阈值则调 model 摘要（只压 `recentTurns` 早期轮次 + 旧 `summary`）→ 更新 `context.json`（新 summary + 最近 K 轮 recentTurns + lastCompressedTurn）→ 重建 messages。理由：用户感知更好（延迟并入下轮等回复期，不延迟本轮结束闭环）、失败回退简单（压缩失败则不压缩直接用全量 recentTurns 继续，本轮回复已产出不受影响）、与 R2 上下文源切换同处实现逻辑聚合。

## Acceptance Criteria

- [ ] master agent 上下文记录与 `saveHistory` 剧情正文存档分离，独立持久化。
- [ ] `runAgentRuntimeTurn` 从 master agent 上下文记录重建初始 messages（不从 `saveHistory` slice(-20)）。
- [ ] 上下文累积到阈值时触发摘要压缩（只压剧情正文，过滤工具过程），保持"1 摘要 + K 轮正文"稳态。
- [ ] 压缩结果持久化，跨 turn / 跨加载从持久化记录恢复稳态。
- [ ] turn 结束时本轮正文追加进上下文记录，工具过程不追加。
- [ ] 玩家 UI 翻阅剧情正文不受压缩影响（`saveHistory` 完整原文保持）。
- [ ] `npm run build`（含 contracts）通过。
- [ ] 真实 API 实测：多轮对话后 master agent 上下文保持稳态；关闭重开存档后 master agent 上下文从持久化记录恢复（不失忆）；超长对话触发压缩不崩。
- [ ] **2026-06-20 结构改造回归实测（待外部条件，见 `docs/active/pending-verification.md` PV-001）**：剧情正文独立 message 序列（含连续 user message）在真实 provider 的行为回归。本项依赖"有可游玩游戏卡"，暂缓登记到独立待验证清单（不随本任务归档消失）。

> **跨任务待验证清单**：`docs/active/pending-verification.md`（PV-001 本任务结构改造回归实测 + PV-002 子任务2 压剧情实测）。独立于任务文档，防止随任务归档被掩盖。

## Out of Scope

- 不做 token 精确计数（MVP 用字符数估算，同 `tool-token-budget` 方案）。
- 不做工具循环内 tool 交互体积兜底（归 `tool-token-budget`，在其上做）。
- 不做去 `maxToolRoundsPerAgent` 轮次限制（归 `tool-token-budget`）。
- 不做记忆 agent / 状态 agent 机制改造（它们已存在，本任务只确保 master agent 上下文能查工作区）。
- 不做玩家 UI 的历史翻阅改造（`saveHistory` 语义不变）。
- 不做 `agentSessionTranscript`（trace/审计）的改造——它保留现有 trace 职责，与 master agent 上下文记录是两份独立存储。

## Open Questions

- ~~master agent 会话上下文记录的存储位置与数据结构~~（已定：工作区 `save/agents/master/context.json`，summary+recentTurns+索引结构）。
- ~~上下文记录是否区分 master/delegated agent~~（已定：只 master agent，delegated 无状态）。
- ~~压缩阈值/K值/model选择/失败兜底/报错形态~~（已定：85%阈值、K=5、master model、失败即温和报错、单一提示）。
- ~~摘要 prompt 形态~~（已定：叙事梗概风格，保留情节推进/人物状态/场景/伏笔，旧summary+新正文二次浓缩）。

**所有 open questions 已决，可进入 design.md + implement.md 编写。**

## Notes

- 本任务是 `tool-token-budget` 的底层依赖。`tool-token-budget` 已搁置，待本任务完成后重写其 design/implement。
- 复杂任务，需 design.md + implement.md。
