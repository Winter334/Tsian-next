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

**背景**：2026-06-20 收尾底层任务时，把 `buildEntryAgentMessages` 从"剧情正文（summary + recentTurns）塞进一条 user message content"改成"独立 message 序列"（新增 `buildAgentContextMessages`）。`npm run build:web` 通过，但真实 API 行为未实测——当前没有可实际游玩的游戏卡，无法触发完整 master agent 对话链路。

**为什么暂缓**：没有可游玩的游戏卡（含 master agent + workspace），无法在 dev server 跑真实对话。这是外部条件依赖，非代码问题。

**前置条件**：
- 有一张可实际游玩的游戏卡。
- dev server 启动（`npm run dev`，默认 5173）。
- 配置好 provider API key（控制面板）。

**验证步骤**：
1. 进入存档，发一条消息触发 master agent 回复。
2. 用 Playwright `browser_network_requests` 抓发给 provider 的请求 body，确认 `messages` 数组结构：
   - `system`(systemPrompt) → `user`(当前回合 + Workspace 上下文) → `user`(早期剧情摘要，若有) → `user`/`assistant` 交替(recentTurns) → `user`(玩家本轮输入)。
   - 即剧情正文是独立 message 序列，不是塞在一条 user content 里。
3. 确认 provider 返回 HTTP 200 + 正常流式回复——**重点验证连续 user message（框架信息 user → summary user → recentTurns 首 user，最多 3 条连续）被 provider 接受**。
4. 多轮对话后检查 context.json（工作区 `save/agents/master/context.json`）的 recentTurns 正确追加。
5. 关闭重开存档，确认 master agent 上下文从 context.json 恢复（recentTurns 在，不失忆）。

**通过标准**：
- 步骤 2 messages 结构符合独立序列形态。
- 步骤 3 provider 返回 200 + 正常流式回复，不报连续 user 相关错误。
- 步骤 4-5 context.json 持久化 + 跨加载恢复正常。

**失败回退方案**（若连续 user message 报错，按优先级）：
- **方案 A**：把框架信息 + summary 合并成一条 user message（减少连续 user 到 2 条）。改 `buildEntryAgentMessages` 的框架信息条，把 summary 拼进它的 content。
- **方案 B**：summary 改作 `system` message。注意 Gemini/Claude 适配器的 `splitSystemMessage` 会把它合并进 system 字段，与 systemPrompt 语义混淆，次选。
- **方案 C**：回退到"塞一条 user message"的旧结构（恢复 `formatAgentContextHistory`，放弃独立序列）。此时 `06-19-tool-token-budget` 子任务2 的 turn 内压剧情实现需从"slice + 替换 message"回退到"锚点拆分文本"方案。

**关联代码**：
- `apps/platform-web/src/agent-runtime/index.ts`：`buildAgentContextMessages`（新增）、`buildEntryAgentMessages`（改造）。
- `apps/platform-web/src/runtime-host/ai.ts`：provider 适配器（OpenAI :403 / Gemini :680 / Claude :871）对连续 user message 的处理。

**关联设计**：`06-19-agent-session-context-lifecycle/design.md` §2.2a（剧情正文层 message 结构）。

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
