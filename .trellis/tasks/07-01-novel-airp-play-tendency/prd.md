# 小说 AIRP 游玩设定对话 Step 4

## Parent

- `.trellis/tasks/06-27-default-card-novel-reader-airp`

## Goal

实现开局向导第 4 步"游玩设定对话"：玩家与 world-architect 通过多轮 Agent 对话共同确定本次存档的玩法与基调——怎么进入故事、金手指/特殊设定、特殊玩法机制等。agent 按 skill 流程引导，补齐基础信息后经玩家确认，组装开局叙事并写入 workspace。前端在向导内提供轻量对话 UI，对话完成后推进 Step 5 纯确认。

这是确定玩法与基调的核心阶段，不是单纯选择题 UI。涉及 schema 扩展、entities 新增、开局组装等多个 workspace 落点。

## Background

开局向导 5 步：① 导入小说 → ② 初始理解 → ③ 角色设定 → ④ 游玩设定对话 → ⑤ 开局确认。

Step 1-3 已实现并归档。Step 3 末尾 `CharacterConfirmed` 确认后 emit `next` → `goToStep(4)`，但 `goToStep` 对 target 4/5 统一落到 `subView="stub"`（useSetupState.ts:193-196）——向导在此断头。

Step 2 的 `commit_opening_understanding` 在玩家选角色/设定玩法**之前**就写了开局 scene/brief/entities，这些资料还没结合"玩家扮演谁、想怎么玩"。Step 4 的对话需要把这些玩家选择反馈给世界配置。

## Confirmed Facts From Repository

### 向导与前端基础设施
- `goToStep(target)`（useSetupState.ts:171-197）：target===4 或 5 → `subView="stub"`，需改为路由到真实 Step 4 视图。
- `SetupWizard.vue` 模板按 `subView` 渲染子屏（:279-341），stub 是链末兜底块（:340）；`actions` computed 按 subView/branch/status 返回按钮配置（:88-218）。
- `CharacterConfirmed` 确认屏 `@next="goToStep(4)"`（SetupWizard.vue:321）是当前进入 Step 4 的唯一入口。
- 向导内**无任何 chat UI**——`setup/` 下只有 UI 卡片表单和状态展示组件；唯一 chat UI 是 `StoryView.vue`（主游玩态，含 UserMessage/NarrativeMessage/Composer/StoryOptions）。
- 向导壳：720px 内容宽度 + 24px 侧 padding + body 级滚动 + 底部 secondary/primary action bar（SetupWizard.vue:381-477）。无 header/title 条，顶部 SetupStepper。
- `mode` ref（App.vue:24）初始化 `"wizard"`，但**从未被设为 `"play"`**——`@enterPlay` 未接线（App.vue:19 注释 vs 实际无绑定）。StoryView 仅在 `mode === "play"` 时挂载（App.vue:72-98）。
- `useTsian` 是模块级单例，`stream`/`ready`/`historyLoaded` 等跨组件共享（useTsian.ts:32-62）。

### Agent 调用机制
- `tsian.invokeAgent(agentId, input, options)` 是**纯 Promise**，返回 `{ response: string }`，**不流式、不写 history、不推进 turn**（tsian-api.ts:302-314；contracts/runtime.ts:675-694）。是旁路调用。
- `onAgentActivity(agentId, kind)` 只发心跳信号（`delta`/`tool`/`round-end`），**不携带文本内容**（tsian-api.ts:88-89,115-117）。
- `InvokeAgentOptions`：`injection?` / `contextSlot?` / `persist?`（tsian-api.ts:41-48）。`persist: true` + `contextSlot` 让 agent 在同一 slot 内保留多轮上下文。
- Step 2 理解是 fire-and-watch：invokeAgent resolve 后前端再读 `understanding-summary.json` 判断完成（useSetupState.ts:248-283）。
- `tsian.send` 会流式输出但**推进 play turn + 写 history**，语义不适合 setup 对话。
- injection 机制不可用于持久化：InjectionMessage 是"本轮有效，不落盘"（contracts/runtime.ts:656-659）。

### `[[选项]]` 机制（复用于 Step 4 对话）
- master agent 用文本格式 `[[选项]]...[[/选项]]` 输出选项（agent-runtime/index.ts:121）。
- `parseStoryOptions(text)` 是纯函数 regex 解析器，已从 `@tsian/play-bridge` 导出（packages/play-bridge/src/story-options.ts:60，index.ts:25），返回 `{ options: string[], cleanText: string }`。
- invokeAgent 返回的 `{ response }` 是原始文本，`[[选项]]` 块原样保留（host 对 invokeAgent 不做剥离、不触发 turn-options 事件，platform-host/index.ts:1055-1301）。前端调用 `parseStoryOptions(response)` 即可提取 cleanText + options。
- StoryOptions.vue：竖向选项按钮栈，void-deep 背景 + line 边框 + ember hover 高亮 + 2 角括号伪元素（StoryOptions.vue:37-101）。

### world-architect 现有能力
- agent.json（workspace-templates.ts:1474-1485）：contacts=[master,retrieval,post-processing]；skills=[opening-initialization, world-state-maintenance]；platformTools=[workspace_read, workspace_write, workspace_semantic_search, agent_call]；workspaceAccess.level=1。
- `commit_opening_understanding`（:690）——一次性提交开局包，**不支持增量更新**。
- `apply_world_state_plan`（world-state-maintenance skill，:326-335）——**增量写路径**，支持 replace/edit(oldString+newString) 模式；appliesTo 含 world-architect + post-processing。
- 可写落点（world-state-maintenance allow-list，:309-320）：entities、schema(current.md/changelog.md/patches/pending)、playthrough/*.json、scenes、relationships、source、director/*.md+*.json。
- level 1 = save-runtime editLevel 1 → **所有 save/ 文件均可写**（workspace-operations.ts:90-112）。
- skill 写作规范：YAML frontmatter（name/description/triggers/appliesTo）+ 正文（产出落点 → 工作步骤 → 具体指引 → spoiler-safe 护栏）+ ```json tsian-actions``` 块（定义脚本 action）。参考 opening-initialization（:547-698）和 world-state-maintenance（:287-337）。

### context.json 与 turn 文件（两层独立）
- **turn 文件**（展示层）：`save/history/turns/turn-NNNNNN.json`，schema `tsian.airp.history.turn.v2`（history-turns.ts:47-82）。StoryView reloadHistory 从 turn 文件加载渲染（history-turns.ts:257-277）。turn 文件**不进 AI 上下文**。
- **context.json**（记忆层）：`save/agents/master/context.json`，schema `tsian.agent.context.v1`（runtime.ts:165-183）。`recentTurns: AgentContextTurnEntry[]`（runtime.ts:142-153），每项 `{ turn, role, content }`，role 为 `"user"|"assistant"`。master 第一回合从 context.json 读取历史上下文。
- 两层独立：reloadHistory 替换 `stream.value`（useTsian.ts:318）不影响 context.json；context.json 不影响 StoryView 渲染。

### StoryView 渲染与注入点
- StoryView 用 `mergedStream` computed 渲染消息列表（StoryView.vue:137-194,236），已有 prepend 先例（cp0 checkpoint 在 :142-145 push 到列表前）。
- 空状态：`v-if="stream.length === 0 && !streaming"`（StoryView.vue:276-279）。
- `loadHistory` 受模块级 `historyLoaded` flag 保护，至多执行一次（useTsian.ts:62,269-274），在 `watch(ready)` immediate 触发（StoryView.vue:70-75）。
- `tsian.workspace.read(path, scope?)` 返回 `WorkspaceReadResult | null`（tsian-api.ts:135-136,390-396），可读 opening-narrative.json。
- `tsian.workspace.write(path, content, scope?)` 返回 `WorkspaceWriteResult`（tsian-api.ts:139,420-421）。

### 数据落点现状
- `mode.json`：模板 `{ mode: null, notes: "..." }`（:1583），**无代码读写、无 agent contextPaths 引用、无脚本校验**——空壳文件。
- `player.json`：模板 `{ viewpoint, character, preferences }`（:1582），Step 3 把角色写进了 runtime.json.player.character 而非 player.json，player.json 留空。
- `setup-summary.json`：不存在，需新建种子模板。
- `opening-narrative.json`：不存在，需新建种子模板。
- Step 2 已写：entities、scene、relationships、director brief、frontier、understanding-summary、runtime.activeSceneIds。

## Requirements

### R1: 前端对话 UI（PlaySetupDialog）
- 在向导壳内新建 `step4/PlaySetupDialog.vue`，合成轻量对话界面，适配向导 720px 框架。
- 消息列表滚动区：复用 `NarrativeMessage.vue`（agent 消息，左对齐 serif 1.05rem lh 1.8）+ `UserMessage.vue`（玩家消息，右对齐 "─ 你 ─" ember 标签）+ `StoryOptions.vue`（竖向选项卡片）。
- 等待态：invokeAgent await 期间显示心跳 orb + ember sweep bar（复用 UnderstandingRunning.vue 的 .heartbeat-orb / .loading-bar 视觉，:95-178）。
- 错误态：invokeAgent reject 时显示 blood-bordered 卡片（复用 UnderstandingFailed.vue 样式），含重试按钮。
- 新建简化版 Composer（720px 宽，textarea + ember 基线 + 发送按钮，无 stop/streaming 态）。Enter 发送，Shift+Enter 换行。
- Composer 与 action bar 分层保留：Composer 在上负责对话发送，action bar 在下负责向导导航（secondary "返回" / primary "下一步"）。
- 延续烛火书卷风格（--void-deep/--ember/--ember-bright/--prose/--prose-dim/--line/--line-strong tokens）。

### R2: 对话循环驱动
- 进入 Step 4 时前端构造初始 prompt 调用 `invokeAgent("world-architect", prompt, { contextSlot: "play-setup", persist: true })`，激活 agent + skill。
- agent 按 skill 回复开场白 + `[[选项]]`，前端 `parseStoryOptions(response)` 提取 cleanText + options，渲染 NarrativeMessage + StoryOptions。
- 玩家点选项或 Composer 自由输入 → 渲染 UserMessage → 作为下一轮 invokeAgent input → 循环。
- `persist: true` + `contextSlot: "play-setup"`：agent 在同一 slot 内保留多轮上下文记忆。
- 不流式：invokeAgent 返回整段 response，前端显示等待态后整段出现。

### R3: useSetupState 状态管理
- 新增状态字段：`playSetupStatus: "idle" | "running" | "complete" | "failed"`、`playSetupMessages: DialogMessage[]`（agent/player/options 消息列表）、`selectedMode` 等。
- `SetupSubView` 类型新增 `"play-setup"`。
- `goToStep(4)` 改为路由到 `subView="play-setup"`，不再落 stub。`goToStep(5)` 保持 stub（Step 5 实现是后续任务，但路由先打通）。
- 心跳监听：play-setup scope 的 `onAgentActivity`，复用 useSetupState 的 startHeartbeat 模式（:73-89）。
- 重载恢复：已有 `setup-summary.json` 的 `status === "complete"` 时跳过对话，直接推进 Step 5。
- `completedUntil` computed 更新：对话完成后推进 stepper 第 4 节点亮。

### R4: 新 skill `play-setup-dialog`
- 挂到 world-architect，仅用于开局设定对话阶段。
- 描述明确限定范围："当玩家完成角色设定、进入游玩设定对话阶段时使用。这是开局向导的一次性对话，不是游玩中世界维护——后者用 world-state-maintenance。"
- 不需要 `triggers:` 字段——前端构造第一条消息直接引导 agent 使用本 skill。
- 阶段指导性（非固定顺序）：开场 → 基础 checklist 补齐 → 收尾确认。
- 用 `[[选项]]` 提供常见模板但允许玩家自由输入。
- 不暴露 world-architect 名称（与 Step 2 UnderstandingRunning 一致，:12 "不暴露 world-architect"）。

### R5: skill 基础 checklist
- skill 定义一组基础必填项，agent 需确认每个都有答案，没提到就主动追问，直到补齐。
- 基础项：
  1. **怎么进入故事**（必问，形态因角色而异）：
     - 原创角色：是否参与原著当前剧情事件？以什么身份/角度介入？
     - 原著角色：通常以某段原著剧情开场，确认从哪段/哪个节点开始。
     - agent 根据 runtime.json.player.character 的 ref 前缀 `original-` 区分角色类型 + 小说题材动态决定怎么问。
  2. **金手指/特殊设定**（要问，可以没有）。
  3. **特殊玩法机制**（要问，可以没有）。
- 开局基调不问：通常与小说世界观同基调，玩家有需求自行说出。
- 游玩模式不问：不由开局硬选，由玩家一步步选择自然体现。
- 核心边界：玩家只表达"想要什么"，agent 负责"怎么实现"。不让玩家写剧情——这是 agent 的职责。

### R6: 对话中增量写设定落点
- 对话过程中：architect 用现有 `workspace_write` / `apply_world_state_plan` 增量写设定落点（player.json/entities/schema/brief 等）。玩家改主意用 edit 模式改回。
- schema 更新：architect 自主判断，安全变更直接写 current.md + changelog.md，风险变更写 patches/pending/*.md。不打断对话流，不让玩家确认 schema 实现细节。
- 移除 mode.json：种子模板（workspace-templates.ts:1583）+ 文件列表引用（:29）+ README 提及（:1579）。

### R7: 收尾确认流程
- 所有基础项补齐后，agent 展示完整设定汇总 + `[[选项]]`（确认/还要调整）。
- 玩家未确认不能进下一步。选"还要调整"回到对话继续。
- 玩家确认后 agent 组装开局叙事文本，调用 `commit_play_setup` 脚本。

### R8: `commit_play_setup` 脚本
- 新建 skill action `commit_play_setup`（browser_script），挂到 play-setup-dialog skill。
- input：`{ openingNarrative: string, summary: string }`（agent 只提供文本，不碰文件格式）。
- 脚本写入：
  1. `save/agents/master/context.json`（schema `tsian.agent.context.v1`，recentTurns `[{ turn: 1, role: "assistant", content: openingNarrative }]`）——master 记忆层。
  2. `save/playthrough/opening-narrative.json`（新文件，存开局叙事文本）——前端展示数据。
  3. `save/playthrough/setup-summary.json`（`{ status: "complete", summary, ... }`）——完成信号。
- 校验 openingNarrative 非空，返回成功/错误。
- 格式正确性由脚本保证，agent 只产出文本。与 commit_opening_understanding 的 agent 产出 + 脚本写入模式同构。

### R9: 完成判定 + Step 5 路由
- 种子创建：`save/playthrough/setup-summary.json`，初始 `{ status: "pending", summary: null }`。
- 前端检测：每次 invokeAgent resolve 后读 setup-summary.json，`status === "complete"` 时启用 action bar primary "下一步"。
- "下一步"推进 Step 5（当前 stub，路由先打通）。
- action bar secondary "返回" 回 Step 3 确认屏。
- setup-summary.json 永久保留，不清理——是存档设定记录的一部分，后续 master/post-processing 可读它了解玩家选了什么设定。

### R10: StoryView 开局特殊渲染
- `useTsian.ts` 新增模块级 `openingNarrative` ref + `loadOpeningNarrative()`（读 `save/playthrough/opening-narrative.json`），独立于 `stream` ref。
- Step 5 确认 / enterPlay 时调 `loadOpeningNarrative()`。
- StoryView 模板在 `mergedStream` v-for 之前渲染 `<NarrativeMessage v-if="openingNarrative" :content="openingNarrative" />`。
- 空状态 guard 改为 `stream.length === 0 && !openingNarrative && !streaming`。
- `openingNarrative` 独立于 stream——reloadHistory/restore 替换 stream 时不会被冲掉。
- 玩家第一次 `tsian.send` 产生 turn-000001（正常第一回合，走正常流程写 turn + context）。

### R11: mode.json 移除
- 移除种子模板（workspace-templates.ts:1583）、文件列表引用（:29）、README 提及（:1579）。
- 游玩方向不由开局硬选，由玩家一步步选择自然体现。方向追踪有替代：branch.json divergenceLevel + director brief + setup-summary.json。

## Acceptance Criteria

- [ ] Step 3 角色确认后点"下一步"进入 Step 4，显示 agent 对话界面（消息列表 + Composer + action bar）
- [ ] 进入 Step 4 时前端自动发起第一次 invokeAgent，agent 回复开场白 + `[[选项]]` 选项
- [ ] agent 消息用 NarrativeMessage 渲染（左对齐 serif），玩家消息用 UserMessage 渲染（右对齐 "─ 你 ─"）
- [ ] 选项用 StoryOptions 渲染，点击选项即作为下一轮输入发送
- [ ] 玩家可在 Composer 自由输入发送
- [ ] invokeAgent await 期间显示心跳 orb + ember sweep 等待态
- [ ] invokeAgent reject 时显示错误卡片 + 重试
- [ ] agent 按 skill 引导补齐基础 checklist（进入方式 + 金手指 + 特殊玩法），没提到就追问
- [ ] 对话过程中 architect 增量写设定落点（player.json/entities/schema/brief）
- [ ] 基础项补齐后 agent 展示设定汇总 + 确认选项，玩家未确认不能进下一步
- [ ] 玩家确认后 architect 调用 `commit_play_setup`，写入 context.json + opening-narrative.json + setup-summary.json
- [ ] setup-summary.json `status === "complete"` 后 action bar "下一步"启用
- [ ] "下一步"推进 Step 5（stub），"返回"回 Step 3
- [ ] mode.json 从 workspace-templates 移除（种子模板 + 文件列表 + README）
- [ ] `play-setup-dialog` skill 创建并挂到 world-architect，含 SKILL.md + commit_play_setup 脚本 action
- [ ] 重载恢复：已有 complete 的 setup-summary 时跳过对话推进 Step 5
- [ ] `play-frontend-dev` 构建通过

## Out Of Scope

- Step 5 开局确认 UI（后续任务，本任务只打通路由到 stub）
- 向导 → 主游玩态 `mode='play'` 翻转 + enterPlay 接线（Step 5 任务，本任务只准备 openingNarrative ref + loadOpeningNarrative）
- StoryView 开局特殊渲染的完整实现（本任务准备 useTsian ref + 注入点，完整渲染归 Step 5 或 handoff 任务）
- onAsk/answer 循环接通（play-frontend onAsk 是 no-op 占位，本任务不用）
- 流式文本（invokeAgent 不流式，本任务不扩展 SDK）
- `player.json` 的 viewpoint/preferences 完整设计（本任务只写 architect 对话中确定的字段）
- 玩家自由备注 / 改写节点选择（第一版不收集）

## Design Decisions

1. **多轮 invokeAgent 链式调用**（D1）：不动 SDK/运行时，纯前端 + 现有 invokeAgent + parseStoryOptions。不流式可接受——agent 回复整段出现。
2. **纯 Agent 对话，不用 UI 卡片分段**（D2）：流程节奏由 skill 控制，agent 动态决定聊什么。第一句话可预设选项发送。
3. **skill 描述明确限定范围**（D3）：正文首句限定"玩家完成角色设定后的一次性对话"，避免游玩中误触发。不需要 triggers 字段。
4. **对话中增量写 + 收尾脚本写**（D4）：对话过程中组合不确定，用现有工具增量写；收尾时格式严格（context.json + turn schema），用脚本保证格式正确性。agent 只产出文本。
5. **所有 agent 工作收拢到 Step 4**（D6）：Step 5 纯确认，不做新设定工作。
6. **不写 turn 文件，特殊渲染开局**（D7）：开局叙事不伪造回合结构。context.json 提供 master 记忆层，opening-narrative.json 提供前端展示数据，StoryView 特殊渲染。turn 文件只由正常 tsian.send 产生。
7. **移除 mode.json**（D8）：空壳文件，游玩方向不由开局硬选。零爆炸半径移除。
8. **基础 checklist 三项**（D9）：进入方式 + 金手指 + 特殊玩法。开局基调和游玩模式不问。
9. **Composer 与 action bar 分层**（D10/A 方案）：Composer 负责对话发送，action bar 负责向导导航。
