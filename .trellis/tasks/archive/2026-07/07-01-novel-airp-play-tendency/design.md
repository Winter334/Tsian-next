# 小说 AIRP 游玩设定对话 Step 4 — Design

## 1. 架构总览

Step 4 是开局向导中"Agent ↔ 玩家对话式玩法设定"阶段。三层架构：

```
┌─ 前端（play-frontend-dev）─────────────────────────────────┐
│  PlaySetupDialog.vue                                        │
│    消息列表（NarrativeMessage + UserMessage + StoryOptions） │
│    Composer（简化版，发送玩家输入）                           │
│    等待态（心跳 orb + sweep bar）                            │
│  useSetupState.ts                                           │
│    playSetupStatus / playSetupMessages / 心跳监听            │
│    goToStep 路由 / 重载恢复                                  │
│  invokeAgent 驱动的对话循环                                  │
└──────────────────────────┬─────────────────────────────────┘
                           │ invokeAgent("world-architect", input, {contextSlot:"play-setup", persist:true})
                           ▼
┌─ Agent 层（platform-web）──────────────────────────────────┐
│  world-architect agent                                       │
│    skill: play-setup-dialog（新）                            │
│      SKILL.md：流程指导 + 基础 checklist + 收尾确认           │
│      action: commit_play_setup（新脚本）                     │
│    skill: world-state-maintenance（现有，增量写设定落点）      │
│    platformTools: workspace_read/write/semantic_search      │
└──────────────────────────┬─────────────────────────────────┘
                           │ workspace_write / apply_world_state_plan / commit_play_setup
                           ▼
┌─ Workspace 落点 ───────────────────────────────────────────┐
│  save/playthrough/player.json    ← persona/金手指/preferences │
│  save/playthrough/setup-summary.json ← 完成信号（新种子）     │
│  save/playthrough/opening-narrative.json ← 开局叙事（新种子） │
│  save/entities/*                 ← 新增实体（金手指/设定）    │
│  save/schema/current.md + changelog.md ← schema 增量          │
│  save/director/current-brief.md  ← 开局基调调整               │
│  save/agents/master/context.json ← master 记忆层（脚本写）    │
│  ~~save/playthrough/mode.json~~  ← 移除                       │
└─────────────────────────────────────────────────────────────┘
```

## 2. 前端对话循环数据流

### 2.1 循环流程

```
进入 Step 4 (goToStep(4) → subView="play-setup")
  │
  ├─ playSetupStatus === "idle"?
  │    └─ 构造初始 prompt → invokeAgent → status="running"
  │
  ▼
invokeAgent("world-architect", input, {contextSlot:"play-setup", persist:true})
  │
  ├─ await 期间：心跳 orb + sweep bar（onAgentActivity 驱动）
  │
  ├─ resolve: { response }
  │    ├─ parseStoryOptions(response) → { cleanText, options }
  │    ├─ push agent message { role:"agent", content:cleanText, options } → playSetupMessages
  │    ├─ 读 setup-summary.json → status === "complete"?
  │    │    ├─ yes → playSetupStatus="complete"，启用"下一步"
  │    │    └─ no → playSetupStatus="idle"，等待玩家输入
  │    └─ 渲染 NarrativeMessage + StoryOptions
  │
  └─ reject: playSetupStatus="failed"，显示错误卡片 + 重试
  │
  ▼
玩家操作：
  ├─ 点选项 → push player message { role:"user", content:option } → 作为下一轮 input
  └─ Composer 输入 → push player message { role:"user", content:text } → 作为下一轮 input
  │
  ▼ → 回到 invokeAgent 循环
```

### 2.2 DialogMessage 类型

```ts
interface DialogMessage {
  id: string          // 唯一标识
  role: "agent" | "user"
  content: string     // cleanText（agent）或原文（user）
  options?: string[]  // 仅 agent 消息，来自 parseStoryOptions
}
```

消息列表是前端内存状态（`playSetupMessages` ref），不持久化——重载时通过 setup-summary.json 判断是否已完成，已完成直接跳 Step 5，未完成重新开始对话。

### 2.3 初始 prompt 构造

前端构造第一条消息激活 agent + skill。prompt 需包含：
- 当前小说信息（从 understanding-summary.json 读取 title/summary）
- 玩家角色信息（从 runtime.json 读取 player.character，区分 canon/original）
- 引导 agent 使用 play-setup-dialog skill 开始对话

```
prompt 模板（示意）：
"小说《{title}》已导入并完成初始理解。玩家已选定角色：{character.name}（{canon|original}）。
现在进入游玩设定对话阶段，请按照 play-setup-dialog skill 引导玩家确定本次游玩的方向和设定。"
```

## 3. play-setup-dialog skill 设计

### 3.1 SKILL.md 结构

```yaml
---
name: 游玩设定对话
description: 当玩家完成角色设定后，通过对话与玩家共同确定本次存档的游玩方向和特殊设定，最终组装开局。
appliesTo:
  - world-architect
---
```

正文结构（参考 opening-initialization）：

```
# 游玩设定对话

## 何时使用
当玩家完成角色设定、进入游玩设定对话阶段时使用本 Skill。
这是开局向导的一次性对话，不是游玩中世界维护——后者用 world-state-maintenance。

## 对话原则
- 根据玩家回答动态决定接下来聊什么，不机械走固定步骤
- 每个维度不必都覆盖——玩家不感兴趣的跳过
- 用 [[选项]] 提供常见模板，但允许玩家自由输入
- 玩家只表达"想要什么"，你负责"怎么实现"——不让玩家写剧情
- 达成决定后可用 workspace_write / apply_world_state_plan 即时写入

## 基础 checklist（必须全部补齐）
1. 怎么进入故事（必问，形态因角色而异）
   - 原创角色：是否参与原著当前剧情事件？以什么身份介入？
   - 原著角色：确认从哪段原著剧情开场。
2. 金手指/特殊设定（要问，可以没有）
3. 特殊玩法机制（要问，可以没有）
- 没提到就主动追问，直到补齐
- 开局基调不问（与小说同基调，玩家有需求自行说出）
- 游玩模式不问（不由开局硬选，由选择自然体现）

## 收尾阶段
当所有基础项补齐后：
1. 向玩家展示完整设定汇总
2. 用 [[选项]] 请求确认（确认/还要调整）
3. 玩家确认后组装开局叙事文本
4. 调用 commit_play_setup 提交

## 落点写入指引
- 对话中增量写：player.json（persona/preferences）、entities（金手指/设定）、schema（如需新字段）、director brief（基调调整）
- 安全 schema 变更直接写 current.md + changelog.md
- 收尾时调用 commit_play_setup（脚本写 context.json + opening-narrative.json + setup-summary.json）

## spoiler-safe
只使用开局窗口内已知的事实。不剧透未来剧情。
```

### 3.2 commit_play_setup 脚本

```json tsian-actions
[
  {
    "name": "commit_play_setup",
    "description": "提交游玩设定对话成果：写入 master 记忆层、开局叙事展示数据、完成信号。",
    "inputSchema": {
      "type": "object",
      "required": ["openingNarrative", "summary"],
      "properties": {
        "openingNarrative": { "type": "string" },
        "summary": { "type": "string" }
      }
    },
    "outputSchema": { "type": "object" },
    "executor": {
      "type": "browser_script",
      "path": "scripts/commit-play-setup.js",
      "timeoutMs": 10000
    }
  }
]
```

脚本逻辑：
1. 校验 `openingNarrative` 非空
2. 读现有 `save/agents/master/context.json`（若不存在则新建）
3. 写 context.json：recentTurns 追加 `{ turn: 1, role: "assistant", content: openingNarrative }`
4. 写 `save/playthrough/opening-narrative.json`：`{ narrative: openingNarrative, createdAt: <ISO> }`
5. 写 `save/playthrough/setup-summary.json`：`{ status: "complete", summary, createdAt: <ISO> }`
6. 返回 `{ status: "ok" }` 或错误

脚本参考 `commit-opening-understanding.js` 的写法（OPENING_SCRIPT_COMMON, :700+）：共用 `isRecord`/`fail`/`parseJson` 工具函数模式。

## 4. 前端组件设计

### 4.1 PlaySetupDialog.vue

```
<template>
  <div class="play-setup-dialog">
    <!-- 消息列表滚动区 -->
    <div ref="scrollRef" class="dialog-scroll">
      <div class="dialog-inner">
        <template v-for="msg in playSetupMessages" :key="msg.id">
          <NarrativeMessage v-if="msg.role === 'agent'" :content="msg.content" />
          <UserMessage v-else :content="msg.content" />
          <StoryOptions
            v-if="msg.options && msg.options.length > 0"
            :options="msg.options"
            :disabled="playSetupStatus === 'running'"
            @select="onSelectOption"
          />
        </template>
        <!-- 等待态 -->
        <div v-if="playSetupStatus === 'running'" class="thinking-indicator">
          <!-- 心跳 orb + sweep bar -->
        </div>
        <!-- 错误态 -->
        <div v-if="playSetupStatus === 'failed'" class="error-card">
          <!-- blood-bordered 卡片 + 重试 -->
        </div>
      </div>
    </div>
    <!-- Composer -->
    <SetupComposer
      :disabled="playSetupStatus === 'running' || playSetupStatus === 'complete'"
      @send="onSend"
    />
  </div>
</template>
```

布局适配向导 720px 框架：
- `.dialog-scroll`：`flex: 1; overflow-y: auto; min-height: 0`（flex 滚动键）
- `.dialog-inner`：`max-width: 720px; margin: 0 auto; padding: 20px 24px`
- 消息间距复用 `margin: 32px 0`（与 StoryView 一致）

### 4.2 SetupComposer.vue（简化版）

基于 Composer.vue 简化：
- 720px 宽（vs StoryView 的 52em）
- textarea + ember 基线（.ink-line）+ 发送按钮
- 无 stop 按钮、无 streaming 态
- Enter 发送，Shift+Enter 换行
- disabled 时 opacity 0.5

### 4.3 useSetupState 新增

```ts
// 新增类型
type PlaySetupStatus = "idle" | "running" | "complete" | "failed"
interface DialogMessage { id: string; role: "agent" | "user"; content: string; options?: string[] }

// 新增状态
const playSetupStatus = ref<PlaySetupStatus>("idle")
const playSetupMessages = ref<DialogMessage[]>([])
const playSetupError = ref<string>("")

// 新增函数
async function startPlaySetupDialog(): Promise<void>  // 构造初始 prompt + 第一次 invokeAgent
async function sendPlaySetupMessage(input: string): Promise<void>  // 玩家发送 → invokeAgent
function resetPlaySetupDialog(): void  // 重置状态
async function loadSetupSummary(): Promise<void>  // 读 setup-summary.json 判断完成态

// goToStep 修改
function goToStep(target: SetupStep): void {
  // ...
  if (target === 4) {
    subView.value = "play-setup"
    step.value = 4
    if (playSetupStatus.value === "idle") {
      void startPlaySetupDialog()
    }
    return
  }
  // target === 5 保持 stub
}
```

## 5. mode.json 移除

workspace-templates.ts 三处改动：
- `:29`：从 workspace 文件列表移除 `"save/playthrough/mode.json"`
- `:1579`：README 中移除 `- \`mode.json\`：游玩模式与偏好。` 行
- `:1583`：移除 mode.json 种子模板对象

零爆炸半径：无代码读写、无 agent contextPaths 引用、无脚本校验。

## 6. setup-summary.json + opening-narrative.json 种子

workspace-templates.ts 新增两个种子文件：

```ts
{ path: "save/playthrough/setup-summary.json", content: json({ status: "pending", summary: null }) },
{ path: "save/playthrough/opening-narrative.json", content: json({ narrative: null, createdAt: null }) },
```

文件列表（:12-30 区域）也需添加这两个路径。

## 7. 重载恢复逻辑

```
进入 Step 4 (goToStep(4))
  → loadSetupSummary()
    → 读 setup-summary.json
      → status === "complete" → playSetupStatus="complete"，直接显示"下一步"启用
      → status === "pending" → playSetupStatus="idle"，开始对话
      → 文件不存在 → 同 pending
```

对话中途刷新（未完成）：重新开始对话（消息列表不持久化）。这是可接受的——对话是设定阶段，不是游玩内容，重走成本低。`persist: true` 的 context slot 仍在，agent 有之前对话的记忆，玩家不会完全从头来。

## 8. 边界与风险

### 8.1 与 Step 5 的边界
- 本任务打通 goToStep(5) 路由（目标仍是 stub）
- enterPlay 接线 + mode='play' 翻转 + StoryView 完整开局渲染 = Step 5 任务
- 本任务准备 useTsian 的 openingNarrative ref + loadOpeningNarrative 函数（供 Step 5 使用），但不实现完整的 StoryView 渲染和 enterPlay 接线

### 8.2 agent 指令遵循风险
- skill 流程指导依赖 agent 正确理解并执行 checklist 补齐 + 收尾确认
- 如果 agent 指令遵循不稳，可能出现：不追问基础项、不展示汇总就擅自 commit、不调用 commit_play_setup
- 缓解：SKILL.md 写明确的收尾流程约束 + commit_play_setup 是唯一完成路径（不调用脚本不会产生 complete 信号）

### 8.3 contextSlot 残留
- `context-play-setup.json` 在对话完成后留在 workspace，不清理
- 与 Step 2 的 `context-understanding.json`（persist: false，不留）不同——Step 4 用 persist: true
- 可接受：存档级文件，不增加复杂度。如需清理可后续补

### 8.4 对话消息不持久化
- playSetupMessages 是前端内存状态，刷新后丢失
- agent 上下文通过 contextSlot persist 保留，玩家不会完全从头来
- setup-summary.json complete 后跳过对话直接 Step 5
- 未完成时刷新 = 重走对话，但 agent 有记忆，成本可接受
