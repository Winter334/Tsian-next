# PRD: 助手上下文模型 — 工具调用跨 turn 保留

## 背景

桌面助手 agent 定位为代码工具型 agent（参照 ZCode 类 agent）。当前 `AgentContextSnapshot.recentTurns` 只存 user/assistant **正文对**，工具调用（workspace_read/agent_call/inspect_frontend 等）的 observation 只在 turn 内对 agent 可见，turn 结束即丢——下一 turn agent 看不到上一 turn 读过的文件内容、子代理回复等工作产物，长任务里可能反复读同一文件或忘掉之前探索的细节。

参照 ZCode 的上下文模型：工具调用是上下文一等公民，跨 turn 保留，agent 后续 turn 仍可直接引用之前工具返回的信息，不必重读。

## 目标 / 用户价值

- 助手 agent 跨 turn 保留工具调用 + 结果，减少重复工具调用（重读同一文件、重查同一信息）
- 长任务连续性提升：agent 能引用之前探索的细节做决策，而非只靠 assistant 正文结论间接推断
- 向"代码工具型 agent"定位靠拢，与剧情型 master agent 的上下文模型分化（master 不变）

## 确认事实（代码已核实）

- `AgentContextSnapshot`（contracts/runtime.ts:55）：`summary + recentTurns(AgentContextTurnEntry[]) + lastCompressedTurn`。`AgentContextTurnEntry` 只有 `{turn, role, content}`，不含工具调用
- `appendTurnToContext`（context-lifecycle.ts:625）：turn 结束只追加 `{turn, role:"user", content}` + `{turn, role:"assistant", content}`，工具 observation 不进 recentTurns
- `buildAgentContextMessages`（index.ts:429）：从 recentTurns 重建消息序列，summary 做前言 + recentTurns 展开 user/assistant message。无工具调用
- `callAgentModelWithWorkspaceTools` 返回 `{text, usage}`（index.ts:1481/1614/1706 等），turn 内完整 messages 数组（含 tool_call + tool_result）不回传，turn 结束即丢
- `contextUpdate`（index.ts:2104）只回传 `{turn, user, assistant}` 正文对 → host `stageAssistantContextFile` → `appendTurnToContext` 只存正文
- turn 内已有 `compressTaskContext`（context-lifecycle.ts:551）压工具交互段（单 turn 内工具太多爆 token），但只解决单 turn 内，不跨 turn
- 压缩循环：`recentTurns` 只增不减累积 → token > 85% budget 触发 `compressContext`（index.ts:1987）一次性保留最近 K=5 轮 + 早期轮次+旧summary 送 model 生成新 summary
- 助手压缩 prompt（`ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT`，context-lifecycle.ts:350）：任务日志风格，已明确"丢弃工具调用的技术细节"
- 两种 toolCallMode：native（结构化 toolCalls + tool result message）、text（工具调用嵌在 assistant 文本 tool-call blocks，结束 stripRuntimeWorkspaceToolCallBlocks 剥离）
- master/助手复用同一 `AgentContextSnapshot` 类型，schema/agentId 值层面区分（contracts 注释明写"结构同构"）
- **两层存储已存在**：① 会话消息存储（`assistant-conversations.ts`，`ConversationMessageRecord[]`，不压缩、截到 `MAX_STORED_MESSAGES=200` 条）= UI 渲染源；② context.json（`AgentContextSnapshot`，压缩后稳态 summary+最近K轮）= agent 上下文源。两层都不含工具调用
- `ConversationMessageRecord`（contracts/runtime.ts:22）：`{role, content, attachments?}`，无工具调用字段
- UI 渲染上下文 ≠ agent 上下文（与 ZCode 一致：UI 完整历史、agent 压缩管理）。工具调用保留需双层分别存

## 作用范围（已确认）

- **仅助手**（task 模式）。master（narrative）不变——剧情型 agent 工具调用少、正文是真相，不需要跨 turn 保留工具结果
- 结构改动：**扩展 recentTurns 存工具调用**（不新增独立字段），改动集中在 contracts + rebuild/append/compress 逻辑

## 需求

### R1 双层结构扩展（contracts）
- **agent 层**：`AgentContextTurnEntry` 增加可选 `toolCalls?: AgentContextToolCall[]`（跟正文同寿命压缩，master 不填）
- **UI 层**：`ConversationMessageRecord` 增加可选 `toolCalls?: AgentContextToolCall[]`（挂在 assistant 消息上，不增加消息条数，随消息截到 200 条保留/丢弃）
- `AgentContextToolCall`：`{id, name, arguments, observation, truncated?, failed?}`。observation 直接存工具返回层结果（不持久化层截断），truncated 来自工具返回层
- master 的两种结构都不填 toolCalls，行为不变
- 不做向后兼容（无实际数据）

### R2 turn 结束双层写入
- `callAgentRuntimeTurn` 的 `contextUpdate` 带回本轮工具调用记录（截断后）
- **agent 层写入**：`stageAssistantContextFile` → `appendTurnToContext` 把 toolCalls 连同正文追加进 context.json（压缩后稳态）
- **UI 层写入**：`saveAssistantSessionMessages` 把 toolCalls 挂在 assistant 消息上存入会话消息存储（不压缩、截到 200 条）
- native + text 两种模式都要覆盖

### R3 agent rebuild 还原工具调用
- `buildAgentContextMessages`（助手路径）把 context.json recentTurns 里的工具调用还原为 tool_call + tool_result message
- native 模式还原为结构化 message；text 模式还原为 tool-call blocks 嵌入 assistant content
- master 路径不变（忽略 toolCalls）

### R4 压缩策略适配工具调用（agent 层）
- 跨 turn 压缩（`compressContext`）现在要压含工具调用的 recentTurns，压缩 prompt 调整（工具结果是工作产物，不能"丢弃工具调用技术细节"）
- 保留最近 K 轮（含工具）原文，早期轮次（含工具）+ 旧 summary 送 model 摘要
- token 估算计入工具调用量（`estimateContextTokens`）
- UI 层不压缩，不受影响

### R5 UI 从会话消息存储重建历史 tool 节点
- 加载会话时从**会话消息存储**（`getAssistantSessionMessages`，完整不压缩）读 toolCalls，重建历史 tool 节点到 timeline（折叠态可展开）
- **不从 context.json 重建**——context.json 是压缩后稳态，早期工具调用已进 summary 原文丢失，无法重建完整历史
- 刷新/重进会话后历史工具调用仍在 UI 可见，与 ZCode 客户端跨会话保留行为一致
- 当前 turn 流式过程节点逻辑不变，历史节点从会话消息存储静态重建
- 历史节点 id 与流式节点不冲突（前缀区分）

## 验收标准

- [ ] 助手 native 模式：turn A 用 workspace_read 读文件 X → turn B 开头 agent 上下文（context.json）里能见到 turn A 的 tool_call + 文件内容 observation（无需重读）
- [ ] 助手 text 模式：同上，tool-call blocks 跨 turn 保留
- [ ] master agent 行为完全不变（recentTurns 仍只正文对、压缩仍叙事梗概、ConversationMessageRecord 不填 toolCalls）
- [ ] agent 层：跨 turn 压缩触发后，被压缩轮次工具调用进入 summary，最近 K 轮工具调用原文保留
- [ ] UI 层：会话消息存储保留完整工具调用（不压缩，截到 200 条随消息保留）
- [ ] token 估算正确计入工具调用量，压缩阈值触发时机合理
- [ ] UI：刷新/重进会话后，历史 tool 节点从会话消息存储重建到 timeline（折叠态可展开），早期工具调用也可见（不受 agent 压缩影响），与 ZCode 客户端跨会话保留行为一致
- [ ] 工具 observation 直接存工具返回层结果（不持久化层截断）；workspace_read 等有分页的工具返回层已截断 + 带元数据，agent 续读靠 offset（现状不变）
- [ ] build:web 通过

## 持久化语义（双层确认）

**agent 层（context.json）**：压缩后稳态，工具调用与正文同寿命
- turn 开头：读 context.json → token > 85% budget 触发 compressContext（早期轮次含工具进 summary，留最近 K=5 轮含工具原文）→ compressedContext
- turn 结束：stageAssistantContextFile 用 `base = compressedContext ?? fallbackContext`，appendTurnToContext 追加本轮含工具，落盘
- 早期工具调用原文压缩后丢弃，只留 summary 摘要

**UI 层（会话消息存储）**：不压缩，完整保留
- turn 结束：saveAssistantSessionMessages 把 toolCalls 挂在 assistant 消息上存入（与正文一起截到 200 条）
- 加载会话：getAssistantSessionMessages 读回完整历史含工具调用，UI 重建历史 tool 节点
- 不受 agent 压缩影响——UI 能见到 agent 已压缩丢弃的早期工具调用原文

两层分离与 ZCode 一致：UI 渲染上下文（完整）≠ agent 上下文（压缩管理）

## 不在范围

- master agent 上下文模型改动
- 助手 UI 新增独立"工具历史"面板（用 timeline 重建即可，不开新入口）

## 待确认问题

1. ~~【压缩策略 + observation 体积】~~ **已确认**：工具 observation 直接存工具返回层结果，**持久化层不截断**。workspace_read 等有分页机制的工具返回层已截断（DEFAULT_READ_LIMIT=2000 行 / MAX=5000 行 + truncated 元数据），agent 续读靠 offset（现状不变）。agent_call/inspect_frontend 等无分页工具当前不截断——无分页是工具自身缺陷，后续补齐分页机制后自然解决。保留 K=5 轮不变。
2. ~~【UI 回看】~~ **已确认**：UI 不变。实测 ZCode 客户端本身也不在 UI 上持久化工具调用（离开会话再回来即消失）。工具调用跨 turn 保留只服务 agent 上下文（context.json），UI timeline 维持现状（当前 turn 过程节点、刷新即丢）。与 ZCode 客户端行为对齐。

## 已全部确认，无待决问题
