# PRD — 子代理/助手任务压缩 + 兜底改造（消息序列化 + 多次压缩 + 时长兜底）

> 父任务：`06-19-tool-runtime-performance`。
> **依赖子2（tool-token-budget，R1-R4 已落地，C3-C6 待 PV-002）+ 子代理并发（agent-call-concurrency，R1-R4 已落地，C3-C6 待实测）**——本任务在两者基础上建立"任务型 agent 的上下文压缩"范式，与 master 的"剧情压缩"并列；并修正 tool-token-budget 遗留的"delegated 跳过压缩、只走预算兜底"缺口 + 把"一次压缩 + ContextBudgetExhaustedError"兜底升级为"多次压缩 + 时长兜底 + 压缩无效早退"。
>
> 方向已与用户对齐（2026-06-20 多轮讨论，见本会话记录）。**本任务建立 Tsian 的第二种压缩模式**——根因：两种 agent 压缩对象不同，决定压缩次数策略不同。

---

## 背景与现状（勘察确认）

### 两种 agent，两种压缩范式（本任务的根本依据）

| | master（叙事，已有剧情压缩） | 子代理/助手（任务型，本任务建立任务压缩） |
|---|---|---|
| 压缩对象 | 剧情正文（user 输入 + assistant 正文），过滤工具 | **整个上下文**（工具调用 + 返回 + 思考） |
| 压缩次数 | **一次** | **多次**（反复压，每次都腾空间） |
| 兜底 | 第二次达预算 = 异常（ContextBudgetExhaustedError） | **时长兜底**（超时 = 异常） |
| 为什么 | 第一次压剧情腾工具空间，期间不产新剧情→第二次压不动→第二次即异常 | 压整个上下文，每次都有东西压→能反复腾→但需防死循环→时长限 |
| 跨 turn 持久化 | context.json（底层 agent-session-context-lifecycle 已交付） | 子代理无（turn 内即弃）；助手待后续任务 C |

### 现状缺口（本任务要补）

1. **delegated agent 当前无压缩能力**：tool-token-budget R2 里 delegated 路径因无 `agentContextSnapshot` 跳过压缩、只走预算兜底（达 85% 直接抛 ContextBudgetExhaustedError）。一个记忆 agent 读 10 个文件总结记忆，可能 6 个文件就撑爆兜底——本该压缩工具记录继续，却直接报错。这是 R2 留的明确 TODO。
2. **delegated/助手 messages 是单条大 user message**：`buildDelegatedAgentMessages`（index.ts）把"当前回合 + historyMode + 上下文 + 请求 + 历史窗口 + 玩家输入"全塞 index 1 一条 user message。助手经 `runAssistantChat` 装配也是类似形态。**单条 message 无法做基于 message 边界的 slice+替换压缩**（只能字符串切片，脆弱，master 改造时已放弃这条路）。任务压缩的前提是 messages 改成独立序列。
3. **"一次压缩 + ContextBudgetExhaustedError"对任务型 agent 不合理**：tool-token-budget R2 的兜底是为 master 设计的（一次够）。任务型 agent 需要多次压缩 + 时长兜底——Codex/Claude Code 的做法。
4. **无时长兜底机制**：当前只有 `AbortSignal`（用户点停止），无自动超时。任务型 agent 长时间运行需时限防死循环。

## 讨论结论沉淀（2026-06-20，供 design 依据）

### 核心决策（已对齐）

1. **建立"任务压缩"模式，与"剧情压缩"并列**：子代理/助手是任务型 agent，压缩对象 = 整个上下文（工具调用 + 返回 + 思考，全压）。摘要风格 = 任务摘要（已做工作 + 结论），非叙事梗概。
2. **压缩连工具调用 + 工具返回一起压**：光压工具名+参数没价值（体积小），真正占体积的是工具返回的大段内容（文件正文、search 结果、agent_call 回复）。压缩必须把"调用 + 返回"作为一对工作单元一起摘要。这是压缩的价值所在。
3. **多次压缩**：任务型 agent 可反复达阈值多次压缩，每次都腾空间（与 master 一次压缩不同）。用**时长兜底**防死循环，不用压缩次数限制。
4. **时长兜底（非次数兜底）**：子代理/助手超时视为异常，和 Codex 一致。master **不加时长**（它一次压缩够，时长会误杀叙事深思）。
5. **时长配额由主 agent 调用时传**：`agent_call` 参数加可选 `timeoutMs`（有默认值，通常不需要改）。主 agent 需要给子代理更长时间时可显式传。
6. **压缩无效早退**：多次压缩时，若压缩后 token 下降幅度 < 阈值（如 <10%），说明压不动了（recentTurns 已剩极少 + tool 交互还在涨），提前抛错终止，不傻等超时烧钱。
7. **子代理/助手 messages 改独立消息序列**：任务压缩的前提。统一构建 helper（子代理 + 助手共用，避免造两套）。
8. **助手 agent 与子代理统一**：助手像 Codex 这类任务 agent，用同一种任务压缩机制。助手跨 turn 持久化是后续独立任务（本任务只统一压缩机制 + 消息序列，助手仍用内存 history 无持久化）。
9. **agent_call 结果走 tool 通道**：不包装成剧情 user message（Claude Code 那套在 Tsian 明确不做——污染正文 + 破坏剧情压缩）。
10. **修正 master 兜底共存**：master 保持"一次压缩 + ContextBudgetExhaustedError"（tool-token-budget R2 不动其逻辑），但本任务的新机制（任务压缩 + 时长兜底）要与之共存不冲突。可能需微调 master 兜底代码以和新机制共享部分基础设施（design 定）。

### 明确不做（本任务边界）

- **不做助手跨 turn 持久化**：`.tsian/local/assistant/context.json` 任务摘要稳态是后续独立任务（`06-20-assistant-context-persistence`）。本任务助手仍用内存 history，无跨加载恢复。
- **不改 master 剧情压缩机制本身**：`compressContext` / `appendTurnToContext` / 剧情摘要 prompt 不改。master 的"一次压缩"逻辑保持（design §0 已论证一次够）。本任务只加任务压缩作为第二种模式，并确保两者共存。
- **不做跨 turn 后台子代理**：受 turn 原子性约束，当前玩家阻塞式 turn 模型下是过度设计。
- **不改 agent_call 并行执行**：agent-call-concurrency 已落地。本任务在并行执行基础上加压缩能力（并行多子代理各自独立压缩各自的 messages）。
- **不做精确 token 计数**：复用底层 `estimateTokenCount`（`charCount*0.4 + utf8Bytes*0.25`）。

## 需求

### R1 子代理/助手 messages 改独立消息序列（统一构建 helper）

- `buildDelegatedAgentMessages`（index.ts）拆成独立 message 序列：`[system] [user: 请求+调用方+期望输出] [user: historyMode 历史窗口] [user: 目标 Agent 上下文]`，让任务压缩能定位"工具交互段"做 slice+替换。
- 助手经 `runAssistantChat`（platform-host）的 messages 装配同样改序列化。
- **统一构建 helper**：子代理 + 助手共用消息序列构建逻辑（避免两套）。design 定 helper 位置与签名。
- 兜底路径（无 context 快照）保持兼容。

### R2 任务压缩机制（多次压缩，压整个上下文）

- 新增任务压缩函数（复用底层 `estimateTokenCount` / `compressContext` 的 model 调用能力，但摘要 prompt 是任务型，压缩对象是整个上下文含工具调用+返回）。
- **定位 + 替换**：任务压缩定位"工具交互段"（框架信息之后到 messages 末尾），把早期 tool 轮次摘要成"已完成工作"的 user/assistant message，保留最近 N 轮 tool 交互 + system + 最初请求。
- **多次压缩**：达 85% 阈值 → 压缩 → 继续；再达 → 再压；不限次数，靠时长兜底。
- **接入点**：子代理/助手工具循环每轮调 model 前检查 token（对称 tool-token-budget R2 的 master 接入点，但压缩对象/摘要/次数不同）。
- delegated 路径从"跳过压缩、只走预算兜底"升级为"达阈值任务压缩、继续"。

### R3 时长兜底 + 压缩无效早退

- 子代理/助手加**时长兜底**：整个 delegated 生命周期（agent_call 发起到返回）的 wall-clock 时长，超时抛 TimeoutError（或复用 AbortController + setTimeout.abort）。
- **时长配额**：`agent_call` 参数加可选 `timeoutMs`（有默认值，如 120s）；主 agent 不传时用默认。
- master **不加时长**（一次压缩够，靠用户 abort + 压缩无效早退）。
- **压缩无效早退**：多次压缩时，压缩后 token 下降 < 阈值（如 <10%）→ 提前抛错终止（不傻等超时烧钱）。
- AssistantView catch 适配：TimeoutError + 压缩无效错误走温和提示（与 ContextBudgetExhaustedError 同路径，非失败的中止）。

### R4 修正 master 兜底共存

- master 的"一次压缩 + ContextBudgetExhaustedError"保持（tool-token-budget R2 逻辑不动其语义）。
- 确保新机制（任务压缩 + 时长兜底）与 master 兜底共享基础设施时不冲突（如 `compressContext` 被两种模式复用，调用参数区分）。
- 可能需把 tool-token-budget R2 的"第二次达预算 = ContextBudgetExhaustedError"逻辑限定到 master 路径，delegated 走新多次压缩+时长路径。design 定如何分层。

## 验收标准

- [ ] 子代理/助手 messages 改独立消息序列（统一 helper，兜底路径兼容）。
- [ ] 任务压缩机制：达 85% 阈值压整个上下文（工具调用+返回+思考），多次压缩不限次，摘要任务型（已做工作+结论）。
- [ ] delegated 路径从"跳过压缩只走兜底"升级为"达阈值任务压缩继续"（tool-token-budget R2 缺口补上）。
- [ ] 时长兜底：子代理/助手超时抛温和错误；`agent_call` 可传 `timeoutMs`（有默认）；master 不加时长。
- [ ] 压缩无效早退：压缩后 token 下降 <10% 提前终止，不傻等超时。
- [ ] agent_call 结果走 tool 通道，不包装成剧情 user message（不破坏 master 剧情压缩）。
- [ ] master 的"一次压缩 + ContextBudgetExhaustedError"行为不回归。
- [ ] `npm run build:contracts && npm run build:web` 通过。
- [ ] 真实 API 实测：记忆 agent 读多文件总结，中途撑爆触发任务压缩继续不报错；超时兜底生效；压缩无效早退生效；master 剧情压缩不回归；并行多子代理各自独立压缩。

## 依赖

- 上游：子2（tool-token-budget，R1-R4 已落地）——复用 `estimateTokenCount` / `compressContext` 的 model 调用 / `CONTEXT_COMPRESS_TRIGGER_RATIO` / `resolveTokenBudget`；修正其 delegated 缺口 + 兜底升级。
- 上游：agent-call-concurrency（R1-R4 已落地）——本任务在并行执行基础上加压缩能力（并行多子代理各自压缩各自 messages）。
- 下游：助手跨 turn 持久化（`06-20-assistant-context-persistence`）——复用本任务的任务压缩机制，加持久化层。

## 关联后续任务（不在本任务范围）

- **助手 agent 跨 turn 持久化**（`06-20-assistant-context-persistence`）：`.tsian/local/assistant/context.json` 任务摘要稳态。复用本任务的任务压缩机制，加跨 turn 持久化 + 跨加载恢复 + 稳态循环。

## 开放问题（待 design 决议）

- **任务压缩的定位 + 替换逻辑**：子代理 messages 序列化后，"工具交互段"边界如何判定（框架信息 user 之后到末尾）？摘要后替换成几条 message（1 条"已完成工作摘要" user/assistant）？保留最近 N 轮 tool 交互的 N 值？（design 定）
- **任务压缩摘要 prompt**：叙事梗概 prompt（master 用）显然不适用。任务摘要 prompt 怎么写（保留已做工作 + 结论，丢弃工具调用细节）？（design 定）
- **任务压缩函数与 `compressContext` 的关系**：复用 `compressContext` 的 model 调用部分但换 prompt + 压缩对象？还是新建 `compressTaskContext` 函数？倾向新建（职责分明，剧情压缩 vs 任务压缩是两种模式）。（design 定）
- **时长兜底的实现形态**：AbortController + setTimeout，还是独立 TimeoutError + 循环内检查 elapsed？影响 abort 语义（时长到是否等同用户 abort）。（design 定）
- **master 兜底与新机制如何分层**：tool-token-budget R2 的"第二次达预算 = ContextBudgetExhaustedError"是 master 专用还是通用？若通用需拆分——master 保留一次+ContextBudgetExhaustedError，delegated 走多次+时长。（design 定）
- **统一构建 helper 的位置**：放 index.ts 还是新建模块？子代理 + 助手 + 兜底路径共用。（design 定）
