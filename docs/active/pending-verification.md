# Pending Verification Register

> 跨任务的待验证事项登记。独立于任何 Trellis 任务存在——不随任务归档消失。
> 记录"代码/规划已完成，但真实环境验证待外部条件具备"的事项，防止被任务归档掩盖。

## 规则

- 每条有唯一编号 `PV-NNN`，不回收。
- 记录：验证什么、为什么暂缓、前置条件、步骤、通过标准、失败回退方案、关联任务（任务归档后仍可追溯）。
- 验证完成后划掉并标日期，保留条目作历史记录。

---

## PV-001 master agent 上下文独立 message 序列 + 连续 user message 真实 provider 验证

**状态**：待验证（2026-06-20 登记）

**关联任务**：`06-19-agent-session-context-lifecycle`（底层，归档）、`06-19-tool-token-budget`（子任务2，T2 依赖本项）

**背景**：2026-06-20 收尾底层任务 + 后续修正，对 master agent 上下文消息结构做了三处改动：
1. `buildEntryAgentMessages` 从"剧情正文塞一条 user message content"改成"独立 message 序列"（新增 `buildAgentContextMessages`）。
2. `appendTurnToContext` 从滑动窗口 K=5（超5丢早期）改为只追加不丢——修正压缩策略矛盾（原滑动窗口导致压缩失效 + 早期剧情未压缩就丢失）。
3. 消息顺序缓存优化：summary + recentTurns 放 system 之后（前缀稳定可缓存），回合号+Workspace+本轮输入放后面（缓存断点后移）。

`npm run build:web` 通过，但真实 API 行为未实测——当前没有可实际游玩的游戏卡，无法触发完整 master agent 对话链路。

**为什么暂缓**：没有可游玩的游戏卡（含 master agent + workspace），无法在 dev server 跑真实对话。这是外部条件依赖，非代码问题。

**前置条件**：
- 有一张可实际游玩的游戏卡。
- dev server 启动（`npm run dev`，默认 5173）。
- 配置好 provider API key（控制面板）。

**验证步骤**：
1. 进入存档，发一条消息触发 master agent 回复。
2. 用 Playwright `browser_network_requests` 抓发给 provider 的请求 body，确认 `messages` 数组结构（缓存优化后顺序）：
   - `system`(systemPrompt) → `user`(早期剧情摘要，若有) → `user`/`assistant` 交替(recentTurns) → `user`(当前回合 + Workspace 上下文) → `user`(玩家本轮输入)。
   - 即剧情正文（summary + recentTurns）是独立 message 序列，紧跟 system；回合号/Workspace/本轮输入在剧情之后。
3. 确认 provider 返回 HTTP 200 + 正常流式回复——**重点验证连续 user message（summary user → recentTurns 首 user；recentTurns 末 assistant → 框架信息 user）被 provider 接受**。
4. 多轮对话（6+ 轮）后检查 context.json（工作区 `save/agents/master/context.json`）：
   - recentTurns **累积不丢**（验证 appendTurn 修正：第 6 轮时 recentTurns 应有 6 轮而非滑动窗口的最近 5 轮）。
   - 未触发压缩时 summary 仍为 null（recentTurns 累积到 85% 阈值才压缩）。
5. 构造超长对话触发压缩（recentTurns 累积到 85% budget），确认：
   - compressContext 生效（summary 非空，早期轮次被摘要）。
   - recentTurns 回落到最近 K=5 轮（压缩后保留）。
6. 关闭重开存档，确认 master agent 上下文从 context.json 恢复（recentTurns + summary 在，不失忆）。
7. （可选，若 provider 支持前缀缓存）多轮对话观察缓存命中——剧情正文段（summary + recentTurns 前缀）应被缓存，每轮只重算回合号 + 本轮输入。

**通过标准**：
- 步骤 2 messages 结构符合缓存优化后的独立序列形态（剧情在前、框架信息在后）。
- 步骤 3 provider 返回 200 + 正常流式回复，不报连续 user 相关错误。
- 步骤 4 recentTurns 累积不丢（6 轮时有 6 轮非 5 轮）+ 未压缩时 summary 为 null。
- 步骤 5 压缩生效（summary 非空 + recentTurns 回落 K=5）。
- 步骤 6 context.json 持久化 + 跨加载恢复正常。

**失败回退方案**（若连续 user message 报错，按优先级）：
- **方案 A**：把 summary 并进 recentTurns 之前的框架信息区或合并相邻 user（减少连续 user）。注意保持剧情正文在 system 之后（缓存优化不回退）。
- **方案 B**：summary 改作 `system` message。注意 Gemini/Claude 适配器的 `splitSystemMessage` 会把它合并进 system 字段，与 systemPrompt 语义混淆，次选。
- **方案 C**：回退消息顺序（框架信息回到剧情之前），但保留独立 message 序列 + appendTurn 累积修正（这两个是正确性修复，不回退）。此时缓存优化放弃，但压缩机制仍正确。仅当连续 user 问题且 A/B 都不行时用。
- **方案 D**：极端情况回退到"塞一条 user message"的旧结构（恢复 `formatAgentContextHistory`，放弃独立序列 + 缓存优化）。此时 `06-19-tool-token-budget` 子任务2 的 turn 内压剧情实现需从"slice + 替换 message"回退到"锚点拆分文本"方案。**appendTurn 累积修正不回退**（那是正确性修复）。

**关联代码**：
- `apps/platform-web/src/agent-runtime/index.ts`：`buildAgentContextMessages`（新增）、`buildEntryAgentMessages`（改造 + 缓存优化顺序）。
- `apps/platform-web/src/agent-runtime/context-lifecycle.ts`：`appendTurnToContext`（滑动窗口→累积修正）。
- `apps/platform-web/src/runtime-host/ai.ts`：provider 适配器（OpenAI :403 / Gemini :680 / Claude :871）对连续 user message 的处理。

**关联设计**：`06-19-agent-session-context-lifecycle/design.md` §2.2a（独立 message 序列）/ §2.2b（appendTurn 修正）/ §2.2c（缓存优化顺序）。

---

## PV-002 tool-token-budget turn 内压剧情 + 兜底实测

**状态**：待验证（2026-06-20 登记，依赖 PV-001 通过）

**关联任务**：`06-19-tool-token-budget`（子任务2，收尾 C3-C6）

**背景**：子任务2 规划完成（prd/design/implement 重写），实现待激活。收尾实测 C3-C6 需要真实 API 环境，且依赖 PV-001 确认结构正确 + provider 兼容。

**为什么暂缓**：同 PV-001——没有可游玩游戏卡；且子任务2 实现代码尚未编写（处于 planning，待 1.4 激活）。

**前置条件**：
- PV-001 通过（结构正确 + provider 兼容连续 user）。
- 子任务2 实现完成（R1-R4 代码落地）。
- 同 PV-001 的游戏卡 + dev server + API key 环境。

**验证步骤**（对应子任务2 implement.md 收尾）：
- C3：多步探索不被卡死——模型探索 6+ 轮（list→read→list→read）不报 round limit。
- C4：turn 内压缩——构造超长上下文（多次大文件 read 累积），确认压缩触发（trace `context_compressed_in_turn`）、压缩后继续探索不重复、tool 交互保留。
- C5：兜底——构造极端场景（压缩后仍增长到第二次达预算），确认"有 text 返回 finalText / 无 text 温和报错上下文已满"且已流式 thought 保留。
- C6：回归——普通短对话不误触压缩；abort 行为不变；跨加载恢复正常。

**通过标准**：C3-C6 全部符合子任务2 implement.md 描述。

**失败影响**：若 PV-001 回退到方案 C（旧结构），子任务2 压剧情实现需从 slice+替换改为锚点拆分（design §2.4 / implement R1.3 对应调整）。

---

## PV-003 agent-call-concurrency 同轮多 agent_call 并行 + 事件 agentId 实测

**状态**：待验证（2026-06-20 登记，依赖 PV-001 通过）

**关联任务**：`06-20-agent-call-concurrency`（子任务，R1-R4 已落地，收尾 C3-C6）

**背景**：agent-call-concurrency 代码层已完成（R1 移除 maxCallsPerTurn + R2 agent_call 并行组 + R3+R4 事件层 agentId + delegated 过程可见 + spec 同步）。真实 API 行为未实测——依赖可游玩游戏卡 + API key + dev server 环境。

**为什么暂缓**：同 PV-001/PV-002——没有可游玩游戏卡（含 master agent + contacts + workspace），无法在 dev server 触发 master 并行调多子代理的链路。外部条件依赖，非代码问题。

**前置条件**：
- PV-001 通过（结构正确 + provider 兼容）。
- 游戏卡含 master agent + 至少 2 个 contacts（如 memory + state/narrative），让 master 能一轮发多个 agent_call。
- dev server + API key。

**验证步骤**（对应 agent-call-concurrency implement.md 收尾）：
- C3：同轮多 agent_call 并行——模型一轮发 agent_call(memory)+agent_call(state)，确认并行执行（trace 事件 agentId 交错/时间戳）、等待时间短于串行、observation 按原 index 回填、master 下一轮看到正确 observation 顺序。
- C4：delegated 过程可见——游戏前端收到带 agentId="memory"/"state" 的 turn-delta/turn-tool 事件，能区分是哪个子代理。
- C5：不回归——单 agent_call 串行行为同改造前（除事件带 agentId）；嵌套 agent_call depth=2 仍拒（AGENT_CALL_UNAVAILABLE）；maxCallsPerTurn 移除后发 5+ agent_call 不再被拒。
- C6：master 兜底不回归——master turn 内压缩 + ContextBudgetExhaustedError 行为不变（tool-token-budget R2 逻辑未被破坏）。

**通过标准**：C3-C6 全部符合 agent-call-concurrency implement.md 描述。

**失败影响**：若并行 observation 回填错位，native 循环 toolCalls[index].id 配对失败 → 检查 Map-by-index 回填逻辑。若 delegated 事件未带 agentId → 检查 createAgentCallRunner 透传 + native 循环 emit 点。

---

## PV-004 agent-task-compression 子代理/助手任务压缩 + 时长兜底实测

**状态**：待验证（2026-06-20 登记，依赖 PV-001/PV-003 通过）

**关联任务**：`06-20-agent-task-compression`（子任务，R1-R4 代码已落地，收尾 G1-G8 实测）

**背景**：agent-task-compression 代码层已完成（阶段 A-F：`compressTaskContext` + `TaskTimeoutError`/`TaskCompressionStalledError` + `RuntimeCompressionMode` 分流 + delegated task 模式 + timeoutController/compositeSignal + assistant task 模式 + `agent_call.timeoutMs` + AssistantView catch + spec 同步）。`npm run build:contracts && npm run build:web` 通过。真实 API 行为未实测——依赖可游玩游戏卡 + API key + dev server 环境。

**为什么暂缓**：同 PV-001/PV-003——没有可游玩游戏卡（含 master agent + contacts + workspace），无法在 dev server 触发 delegated agent 长任务链路。外部条件依赖，非代码问题。

**前置条件**：
- PV-001 通过（master 消息结构正确 + provider 兼容）。
- PV-003 通过（agent_call 并行 + 事件 agentId 正常）。
- 游戏卡含 master agent + 至少 1 个 contact（如 memory），让 master 能发 agent_call 触发 delegated 任务压缩。
- 游戏卡 workspace 含足够多文件（10+），让 delegated memory agent 能读多文件撑爆 token 触发压缩。
- dev server + API key。

**验证步骤**（对应 agent-task-compression implement.md 阶段 G）：
- G1：delegated 任务压缩——master 发 agent_call(memory, request="读10个文件总结记忆")，memory 工具循环读 6+ 文件后 token > 85%，确认触发任务压缩（trace `context_compressed_in_turn` mode:"task"）、压缩后继续不报错、不重复探索已读文件、最终返回记忆结论。
- G2：delegated 多次压缩——构造超长任务（读 20+ 文件），确认 compressedCount ≥ 2（trace 多次 `context_compressed_in_turn`），每次压缩后继续，最终完成或走兜底。
- G3：delegated 时长兜底——master 发 agent_call(memory, timeoutMs=10000) 跑长任务，确认 10s 后 TaskTimeoutError → master 收 AGENT_CALL_FAILED observation（details.timeout=true）→ master 继续自己循环（不中断）。
- G4：delegated 压缩无效早退——master 发 agent_call(memory) 读超大单文件撑爆，确认压缩后 token 下降 <10% → TaskCompressionStalledError → AGENT_CALL_FAILED observation（details.stalled=true）。
- G5：assistant 任务压缩 + 超时 + 早退——桌面助手长对话（多轮工具探索）触发任务压缩继续；超时温和提示"任务超时，已中止"；早退温和提示"上下文持续膨胀且压缩无效，已中止"；不落盘（重开会话从 recentHistory 兜底）。
- G6：master 剧情压缩不回归——master turn 内一次压缩 + 第二次达预算 ContextBudgetExhaustedError 行为不变；context.json 落盘正常（summary + recentTurns 稳态）。
- G7：并行多子代理各自压缩——master 同轮发 agent_call(memory)+agent_call(state)，各自独立压缩/超时/早退，observation 按原 index 回填，互不影响（一个超时不影响另一个完成）。
- G8：用户 abort vs 超时区分——用户点停止 → AbortError（assistant 走"已停止"分支）；超时 → TaskTimeoutError（assistant 走"任务超时"分支）；两者提示文案不同。

**通过标准**：
- G1：delegated 任务压缩触发且继续不报错，返回结论。
- G2：多次压缩（≥2）不限次，最终完成或兜底。
- G3：超时 → AGENT_CALL_FAILED(details.timeout) → master 继续。
- G4：早退 → AGENT_CALL_FAILED(details.stalled)。
- G5：assistant 三类温和提示正确（压缩继续/超时/早退），不落盘。
- G6：master 剧情压缩 + context.json 落盘不回归。
- G7：并行子代理各自独立压缩/超时/早退，互不影响。
- G8：用户 abort 与超时提示文案区分正确。

**失败回退方案**（按问题类型）：
- **任务压缩不触发**：检查 delegated toolOptions 是否传了 `compressionMode:"task"` + `contextTokenBudget` + `compressCallModel` + `taskStartedAt`/`taskTimeoutMs`（index.ts `createAgentCallRunner` 闭包）。delegated 预算用 `resolveTokenBudget(undefined)` = 256k，85% = 217k——若目标 agent contextWindow 小于此，压缩会晚触发或 Provider 先报窗口错误。回退：让 host 在 `callModelNative` 闭包把目标 agent 真实 contextWindow 透传给 runtime（需扩 `AgentRuntimeModelCallOptions` 或 `capabilities`）。
- **`locateTaskInteractionSpan` 定位错误**：检查 text 模式框架 user 是否含 `<tsian-tool-observation>` 子串（formatHistory 是 recentHistory 对话，应不含；若含则扫描停在错误位置）。回退：给框架 user 加明确边界标记或改用框架段长度已知的方式定位。
- **`AbortSignal.any` 兼容性**：旧浏览器/Electron 不支持 → 回退手写 composite（addEventListener 转发 input.signal + timeoutController.signal 到 composite controller）。
- **任务压缩摘要质量差**（模型重复探索）：调整 `TASK_COMPRESSION_SYSTEM_PROMPT`（加更强约束）或 `TASK_KEEP_RECENT_TOOL_ROUNDS`（增大 N 保留更多上下文）。
- **master 回归**：narrative 分支代码 = 现有 R2 + `compressionMode === "narrative"` 前置——若回归检查前置条件是否正确、master 路径是否传了 narrative。

**关联代码**：
- `apps/platform-web/src/agent-runtime/context-lifecycle.ts`：`compressTaskContext` + `TaskTimeoutError`/`TaskCompressionStalledError` + 任务压缩常量 + `TASK_COMPRESSION_SYSTEM_PROMPT`。
- `apps/platform-web/src/agent-runtime/index.ts`：`RuntimeCompressionMode` + `WorkspaceToolLoopOptions.compressionMode` + `locateTaskInteractionSpan` + 两处循环按模式分流 + `createAgentCallRunner` timeoutController/compositeSignal + `buildDelegatedAgentMessages` section 排序。
- `apps/platform-web/src/agent-runtime/workspace-tools.ts`：`RuntimeAgentCallArguments.timeoutMs` + `normalizeAgentCallArguments` 透传。
- `apps/platform-web/src/agent-runtime/tool-schemas.ts`：agent_call schema `timeoutMs`。
- `apps/platform-web/src/platform-host/index.ts`：`runAssistantChat` task 模式 + timeoutController；`interaction.sendMessage` narrative。
- `apps/platform-web/src/views/AssistantView.vue`：catch 识别 `TaskTimeoutError`/`TaskCompressionStalledError`。

**关联设计**：`06-20-agent-task-compression/design.md`（§0 两种压缩范式 / §1.3 约束 / §2 数据契约 / §3 数据流 / §4 权衡）。

> **PV-004 G5 更正**：原 G5 写"assistant 不落盘（重开会话从 recentHistory 兜底）"——这是 agent-task-compression 交付时的状态（无跨 turn 持久化）。`06-20-assistant-context-persistence`（PV-005）已实现助手跨 turn 持久化，assistant 现在落盘到 `.tsian/local/assistant/sessions/<id>/context.json`，重开会话从快照恢复。PV-004 G5 的"assistant 任务压缩 + 超时 + 早退温和提示"行为仍需实测（不落盘→落盘的转变由 PV-005 覆盖）。

---

## PV-005 assistant-context-persistence 助手跨 turn 持久化 + 虚拟文件系统实测

**状态**：待验证（2026-06-20 登记，依赖 PV-001/PV-004 通过）

**关联任务**：`06-20-assistant-context-persistence`（子任务，阶段 A-F 代码已落地，收尾 G1-G9 实测）

**背景**：assistant-context-persistence 代码层已完成（阶段 A-F：contracts `AgentContextSnapshot` 类型放宽 + `context-lifecycle.ts` 参数化 + `ASSISTANT_CONTEXT_SCHEMA`/`ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT` + `local-assistant-files.ts` `assistantContextPath`/`deleteLocalAssistantFile` + `assistant-conversations.ts` 会话删除清理 + runtime entry turn-start compression guard 放宽（task 模式用任务摘要 prompt）+ host `runAssistantChat` 读快照注入/写回虚拟文件 + `AssistantChatInput.sessionId` + AssistantView 传 sessionId + spec 同步）。`npm run build:contracts && npm run build:web` 通过。真实 API 行为未实测——依赖 API key + dev server 环境。

**为什么暂缓**：没有 API key 环境 + dev server 实测条件（同 PV-001/PV-004 的外部条件依赖，非代码问题）。

**前置条件**：
- PV-001 通过（master 消息结构正确 + provider 兼容——助手复用同一 runtime 入口路径）。
- PV-004 通过（task 压缩模式 + 时长兜底正常——助手 task 模式依赖其机制）。
- dev server（`npm run dev`）+ 配置好 provider API key（控制面板）。
- 助手 agent 配置好 model（`.tsian/local/assistant/agent.json` 或 provider preset）。

**验证步骤**（对应 implement.md 阶段 G）：
- G1：跨 turn 持久化——助手多轮对话（≥3 轮），每轮后检查 `.tsian/local/assistant/sessions/<sessionId>/context.json`（Dexie Inspector 或 workspace_read）recentTurns 累积；关闭重开浏览器后助手从快照恢复（知道之前聊过什么，不失忆）。
- G2：文件系统可视化——助手对话后，让助手用 `workspace_read .tsian/local/assistant/sessions/<sessionId>/context.json` 读自己的 context 快照（验证 summary + recentTurns 可见）；`workspace.list .tsian/local/assistant/sessions/` 能列出会话 context 文件。
- G3：长对话稳态——构造长对话（多轮 + 大量工具探索撑爆 85%），确认快照触发 turn-start 压缩（trace `context_compressed` mode:"task"），summary 滚动浓缩（越早越淡），recentTurns 保持最近 5 轮，不膨胀。
- G4：多会话隔离——创建会话 A 和 B，各自对话几轮，切换 A↔B 验证 agent 上下文不串（A 的 agent 不知 B 的对话，各自读各自 `sessions/<id>/context.json`）。
- G5：会话删除清理——删除会话后，`workspace.list .tsian/local/assistant/sessions/` 不列已删会话的 context（`deleteLocalAssistantFile` 孤儿清理生效）；Dexie Inspector 确认 map 里该 path 已移除。
- G6：旧会话迁移——有可见消息但无 context 虚拟文件的旧会话（新代码前创建的，或手动删了 context 文件），首次发消息后 context 从 history 兜底初始化（`createInitialAgentContext`），后续正常持久化。
- G7：turn 失败不写回——助手 turn 中途 abort（点停止）/ timeout（超 300s 或调小 timeoutMs 测试），`readAssistantContextFromFiles` 读出的 recentTurns 不含失败轮（磁盘快照停留在 turn 开头状态）。
- G8：master 不回归——master turn 开头剧情压缩（trace `context_compressed` mode:"narrative"，用默认剧情梗概 prompt）+ `agents/master/context.json` 落盘 + 跨加载恢复行为不变（玩一局游戏多轮 + 重开验证）。
- G9：turn 号递增——多轮对话后 `readAssistantContextFromFiles` 读出的 recentTurns 的 turn 号单调递增（1,2,3,...），`lastCompressedTurn` 正确去重（压缩后不再重复压已压轮次）——验证 `nextAssistantTurnNumber` 修复了 turn=1-always 缺陷。

**通过标准**：
- G1：跨 turn 持久化 + 跨加载恢复，不失忆。
- G2：context 虚拟文件 agent 可 workspace_read/list（文件系统可视化哲学落地）。
- G3：长对话压缩稳态，不膨胀。
- G4：多会话隔离，不串上下文。
- G5：会话删除清理 context 虚拟文件，无孤儿。
- G6：旧会话迁移从 history 兜底初始化。
- G7：turn 失败不写回 context。
- G8：master 剧情压缩 + context.json 落盘 + 跨加载恢复不回归。
- G9：turn 号单调递增 + lastCompressedTurn 去重正确。

**失败回退方案**（按问题类型）：
- **跨加载失忆**（重开后助手不知之前对话）：检查 `loadLocalAssistantFiles` 是否加载了 `sessions/<id>/context.json`（map 里是否有该 path）+ `readAssistantContextFromFiles` 是否 find 到。回退：检查 `saveLocalAssistantFiles` 合并落盘是否正确包含 context path（`isLocalAssistantPath` 前缀匹配）。
- **多会话串上下文**：检查 `assistantContextPath(sessionId)` 是否按 sessionId 拼路径（每会话独立）+ `runAssistantChat` 是否传了正确 sessionId。回退：确认 AssistantView `send()` 传的 `activeSessionId.value` 在切换会话时更新。
- **turn 号不递增**（仍恒为 1）：检查 `nextAssistantTurnNumber` 逻辑 + `snapshot.state.turn = nextTurn - 1` 是否生效 + `currentRuntimeTurnNumber` 是否读 `input.snapshot.state.turn + 1`。回退：确认 `runAssistantChat` 传的 snapshot 用了 `nextAssistantTurn - 1` 而非硬编码 0。
- **压缩不触发或用错 prompt**：检查 entry turn-start compression guard 是否放宽（`estimateContextTokens(agentContext) > triggerThreshold` 无 mode 前置）+ task 模式是否传了 `ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT`。回退：检查 `compressOptions` 的 mode 分流。
- **会话删除孤儿**：检查 `deleteAssistantSession` 是否调了 `deleteLocalAssistantFile(assistantContextPath(id))`。回退：确认 import 正确。
- **master 回归**：检查 master 路径（`interaction.sendMessage`）是否仍传 `compressionMode: "narrative"` + 不传 systemPrompt/userLabel/assistantLabel（用默认剧情梗概 prompt）+ `agents/master/context.json` 路径不变。回退：revert 阶段 C（guard 放宽）回到 narrative-only。

**关联代码**：
- `packages/contracts/src/runtime.ts`：`AgentContextSnapshot` 类型放宽（agentId: string, schema 联合）。
- `apps/platform-web/src/agent-runtime/context-lifecycle.ts`：`ASSISTANT_CONTEXT_SCHEMA`/`ASSISTANT_CONTEXT_AGENT_ID`/`ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT` + 参数化 `createEmptyAgentContext`/`createInitialAgentContext`/`parseAgentContext`/`compressContext`/`buildCompressionPrompt`。
- `apps/platform-web/src/agent-runtime/index.ts`：entry turn-start compression guard 放宽 + 按 mode 选 prompt。
- `apps/platform-web/src/platform-host/index.ts`：`AssistantChatInput.sessionId` + `readAssistantContextFromFiles`/`nextAssistantTurnNumber`/`stageAssistantContextFile` + `runAssistantChat` 读快照注入/写回。
- `apps/platform-web/src/storage/local-assistant-files.ts`：`assistantContextPath`/`deleteLocalAssistantFile`。
- `apps/platform-web/src/storage/assistant-conversations.ts`：`deleteAssistantSession` 清理 context。
- `apps/platform-web/src/views/AssistantView.vue`：`send()` 传 sessionId。

**关联设计**：`06-20-assistant-context-persistence/design.md`（§0 核心机制 / §1.3 约束 / §2 数据契约 / §3 数据流 / §4 权衡 / §4.1 虚拟文件系统方案）。
