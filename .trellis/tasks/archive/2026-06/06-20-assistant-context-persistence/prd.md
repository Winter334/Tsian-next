# PRD — 助手 agent 跨 turn 持久化（.tsian/local/assistant/context.json 任务摘要稳态）

> 父任务：`06-19-tool-runtime-performance`。
> **依赖 `06-20-agent-task-compression`（任务压缩机制，待实现）**——本任务复用其任务压缩机制，给桌面助手加跨 turn 持久化层，实现类似 master 的 context.json 稳态但存任务摘要。
>
> 方向已与用户对齐（2026-06-20 讨论）。本任务是把桌面助手从"内存 history 无持久化"升级到"跨 turn/跨加载上下文稳态"。

---

## 背景与现状（勘察确认）

- **桌面助手当前无跨 turn 持久化**：`runAssistantChat`（platform-host:1716）每轮从 AssistantView 传的内存 `history`（messages 数组）做上下文，无 context.json，无跨加载恢复。关闭重开浏览器/刷新页面 → 助手对话上下文丢失（靠 saveHistory 恢复可见消息，但 agent 的压缩稳态不在）。
- **master 已有 context.json 稳态**：底层 `agent-session-context-lifecycle`（已交付，commit 05d9da2）给 master 建了 `agents/master/context.json`，存"1 摘要 + 最近 K 轮正文"，跨 turn/跨加载保持上下文不膨胀不失忆。
- **助手与 master 的区别**：master 压剧情正文（叙事梗概），助手压任务记录（已做工作+结论）——压缩对象不同，但持久化/稳态/跨加载恢复的**机制同构**。本任务复用 master 的持久化骨架，换压缩内容为任务摘要（任务压缩机制由 `06-20-agent-task-compression` 建立）。
- **助手文件存储位置**：助手是 platform-local（`.tsian/local/assistant/`，spec 记载"assistant agent identity is platform-local"），其 context.json 应放 `.tsian/local/assistant/context.json`（非游戏卡内容、非存档 save runtime，是平台本地元数据）。

## 讨论结论沉淀（2026-06-20，供 design 依据）

### 用户价值

桌面助手是多轮连续对话（用户问一句、答一句，跨多轮）。当前无持久化导致：①长对话上下文持续膨胀无压缩稳态（撑爆 token）；②关闭重开丢失 agent 上下文（失忆）。加跨 turn 持久化让助手像 master 一样保持"任务摘要 + 最近 K 轮对话"稳态，跨加载不膨胀不失忆。

### 核心决策（已对齐）

1. **复用任务压缩机制**（`06-20-agent-task-compression` 建立）：助手是任务型 agent，用任务压缩（压整个上下文含工具调用+返回），非剧情压缩。
2. **持久化路径**：`.tsian/local/assistant/context.json`（platform-local 元数据，非 save runtime、非游戏卡内容）。
3. **schema**：类似 master 的 `tsian.agent.context.v1`，但存任务摘要（已做工作+结论）+ 最近 K 轮对话。design 定具体 schema（可能复用 master schema 或新建 `tsian.assistant.context.v1`）。
4. **稳态循环**：turn 开头检查 context.json token，超 85% 压任务记录（任务压缩）；turn 结束追加本轮对话；host 落盘。跨加载从 context.json 恢复。
5. **不跨 turn 后台**：仍是阻塞式 turn（玩家/用户发一句→等回复），只是上下文跨 turn 持久化。不引入非阻塞玩家输入模型。

### 明确不做（本任务边界）

- **不引入非阻塞玩家输入**：助手仍是"用户发一句→等助手回复"的阻塞模型，只是上下文持久化。Claude Code 式"后台任务+用户继续对话"需打破阻塞模型，是更大的产品级改动，不在本任务。
- **不改任务压缩机制本身**：复用 `06-20-agent-task-compression` 的任务压缩函数，只加持久化层。
- **不改 master 的 context.json**：master 持久化不动，本任务只给助手建独立的 context.json。
- **不做助手 agent_call 并行**：助手是单 agent 对话，不涉及 agent_call 并行（agent-call-concurrency 的并行执行对助手无意义）。

## 需求

### R1 助手 context.json 持久化骨架

- 新增助手 context 生命周期模块（类似 `context-lifecycle.ts` 但服务助手，存任务摘要）。
- 持久化路径 `.tsian/local/assistant/context.json`，schema 标记（复用 `tsian.agent.context.v1` 或新建 `tsian.assistant.context.v1`）。
- 序列化/反序列化/初始化/跨加载恢复（对称 master 的 `serializeAgentContext`/`parseAgentContext`/`createEmptyAgentContext`）。
- host `runAssistantChat` turn 开头读 context.json 注入、turn 结束写回（对称 master 的 `stageAgentContextFile`）。

### R2 助手 turn 开头压缩 + 稳态循环

- turn 开头检查助手 context.json token，超 85% 触发任务压缩（复用 `06-20-agent-task-compression` 的任务压缩函数）。
- turn 结束追加本轮对话（user 输入 + assistant 回复）到 context recentTurns。
- 稳态：累积到阈值 → 压缩一次性摘要早期 + 保留最近 K 轮。

### R3 跨加载恢复

- 关闭重开浏览器/刷新页面后，助手对话从 context.json 恢复上下文（任务摘要 + 最近 K 轮）。
- saveHistory 仍承载可见消息（UI 展示），context.json 承载 agent 上下文稳态（压缩/摘要），两者分离（对称 master）。

## 验收标准

- [ ] 助手 context.json 持久化到 `.tsian/local/assistant/context.json`，schema 标记正确。
- [ ] turn 开头检查 token，超 85% 触发任务压缩（复用任务压缩机制），turn 结束追加本轮 + host 落盘。
- [ ] 跨加载恢复：关闭重开后助手从 context.json 恢复上下文（任务摘要 + 最近 K 轮），不失忆。
- [ ] 长对话稳态：多轮对话后 context.json 保持"任务摘要 + 最近 K 轮"不膨胀。
- [ ] master 的 context.json 不受影响（独立路径）。
- [ ] `npm run build:contracts && npm run build:web` 通过。
- [ ] 真实实测：桌面助手多轮对话后关闭重开，上下文恢复；长对话触发压缩稳态不撑爆。

## 依赖

- 上游：`06-20-agent-task-compression`（任务压缩机制）——复用其任务压缩函数。
- 上游：底层 `agent-session-context-lifecycle`（已交付）——参考其 context.json 持久化骨架（`serializeAgentContext`/`parseAgentContext`/`stageAgentContextFile`），换压缩内容为任务摘要。
- 下游：无。

## 开放问题（待 design 决议）

- **schema 复用 vs 新建**：复用 `tsian.agent.context.v1`（master schema）还是新建 `tsian.assistant.context.v1`？复用省代码但语义混淆（master 存剧情摘要、助手存任务摘要）；新建清晰但重复。倾向新建（语义分明）。（design 定）
- **助手 context 模块位置**：放 `agent-runtime/context-lifecycle.ts` 内（加助手分支）还是新建 `assistant-context-lifecycle.ts`？倾向新建（职责分明，助手是 platform-local 非 agent-runtime 核心）。（design 定）
- **.tsian/local/assistant/ 存储机制**：当前 `.tsian/local/assistant/` 用什么存（IndexedDB？Dexie 表？）？需勘察 local-assistant-files.ts 现状。（design 勘察）
- **context.json 与 saveHistory 的关系**：助手对话的 saveHistory（可见消息）与 context.json（agent 上下文）如何分工？是否都存？symmetric master（master 的 saveHistory 是剧情正文存档、context.json 是 agent 上下文，两者分离）。（design 定）
