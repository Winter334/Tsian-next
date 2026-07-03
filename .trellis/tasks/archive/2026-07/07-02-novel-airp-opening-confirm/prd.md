# 小说 AIRP 开局确认 Step 5

## Parent

- `.trellis/tasks/06-27-default-card-novel-reader-airp`

## Goal

实现开局向导最后一步"开局确认"（Step 5）：一个**纯过渡入口**确认屏，把设定摘要渲染成仪式感卡片（呼应 Step 3 CharacterConfirmed 的名片设计语言），其余空间放装饰元素。玩家点"进入故事"后触发烧蚀幕布过渡（复用 BurningReveal scroll 变体），翻转 `mode` 从 `wizard` → `play`，进入主游玩态。StoryView 首次渲染时把 `opening-narrative.json` 的叙事文本作为第一条消息特殊渲染。

Step 5 不做新设定工作、不重复展示开局叙事全文（叙事留给 StoryView）、不重复 Step 4 的确认流程——它是向导到游玩态的仪式感过渡。

## Background

开局向导 5 步：① 导入小说 → ② 初始理解 → ③ 角色设定 → ④ 游玩设定对话 → ⑤ 开局确认。

Step 1-4 已实现并归档。Step 4 `commit_play_setup` 脚本已写入：
- `save/playthrough/opening-narrative.json`（`{ narrative, createdAt }`）—— 开局叙事文本
- `save/playthrough/setup-summary.json`（`{ status: "complete", summary, createdAt }`）—— 完成信号
- `save/agents/master/context.json` recentTurns —— master 记忆层

## Confirmed Facts From Repository

### 向导断头点（需接通）
- `goToStep(5)`（useSetupState.ts:220-223）当前落 `subView="stub"`，需改为路由到真实 Step 5 视图。
- `SetupWizard.vue:358-360` stub 渲染块（`<StepStub title="即将开放" @back="goToStep(4)">`）需替换为 Step 5 组件。
- `SetupWizard.vue:214-224` stub actions 分支：secondary "返回"→goToStep(3)、primary "下一步" disabled。需替换为 Step 5 actions。
- `completedUntil`（SetupWizard.vue:73-79）：`playSetupStatus==="complete"` 返回 3（第 4 节点亮）。Step 5 进入后应返回 4（第 5 节点亮）。

### mode 翻转（wizard → play）
- `App.vue:24` `mode = ref<"wizard"|"play">("wizard")`，**从未被设为 "play"**——`@enterPlay` 未接线。
- `App.vue:73` `mode === "play"` 时挂载 `.stage-play`（含 AppHeader/AppNav/StoryView）；`mode === "wizard"` 时挂载 SetupWizard（:102）。
- `App.vue` 无 `@enterPlay` handler——SetupWizard 从未 emit 过该事件。
- 翻转后 SetupWizard 卸载、stage-play 挂载，StoryView 首次出现。

### openingNarrative（Step 4 已准备）
- `useTsian.ts:59` `openingNarrative = ref<string|null>(null)` 模块级单例，独立于 `stream`。
- `useTsian.ts:285-299` `loadOpeningNarrative()`：读 `save/playthrough/opening-narrative.json`，`narrative` 非空字符串则赋值。
- `useTsian.ts:213` 导出 `readonly(openingNarrative)`。
- **尚未在 StoryView 使用**——Step 4 只准备了 ref + loader。

### StoryView 渲染现状
- `StoryView.vue:137` `mergedStream` computed 渲染消息列表（:236 v-for）。
- `StoryView.vue:276` 空状态：`v-if="stream.length === 0 && !streaming"` → "故事尚未开始"。
- `StoryView.vue:142-145` 已有 prepend 先例（cp0 checkpoint push 到列表前）。
- 首次 `tsian.send` 产生 turn-000001（正常第一回合，写 turn + context）。

### setup-summary 完成信号
- `useSetupState.ts:562-566` startPlaySetupDialog 检查 setup-summary `status==="complete"` → `playSetupStatus="complete"`。
- `useSetupState.ts:649-655` handleAgentResponse 每次 invokeAgent resolve 后读 setup-summary 判断完成。
- Step 4 action bar primary "下一步" 在 `playSetupStatus==="complete"` 时启用（SetupWizard.vue:209），点击 → `goToStep(5)`。

### 重载恢复
- Step 4 已实现重载恢复：setup-summary complete 时 `startPlaySetupDialog` 直接设 complete，不重新对话（useSetupState.ts:562-566）。
- Step 5 需要类似的重载恢复：已有 complete 的 setup-summary 时，进入向导应直接到 Step 5（跳过 Step 4 对话）。

### 视觉 token
- 向导壳：720px 内容宽度 + 24px 侧 padding + body 滚动 + 底部 action bar。
- 烛火书卷风格：`--void-deep`/`--ember`/`--ember-bright`/`--prose`/`--prose-dim`/`--line`/`--line-strong`。
- `NarrativeMessage.vue`：agent 消息，左对齐 serif 1.05rem lh 1.8。
- `StoryView.vue:358-368` 空状态样式（empty-title/empty-hint）。

## Requirements

### R1: Step 5 确认屏 UI（纯过渡入口 + 设定卡片）
- 新建 `step5/OpeningConfirm.vue`，在向导壳内展示仪式感过渡入口。
- **核心元素：设定卡片**——把 setup-summary.json 的 summary 文本渲染成仪式感卡片，呼应 Step 3 CharacterConfirmed 的名片设计语言（四角括号 + pulse-ring 脉冲 + serif 排版）。
- 卡片标题可用小说标题或"设定已成"等仪式性文案。
- 其余空间放装饰元素（烛火书卷风格氛围装饰，不承载功能）。
- **不展示开局叙事全文**——开局叙事只在 StoryView 作为第一条消息显示（见 R5）。
- 延续烛火书卷风格，720px 框架。

### R2: 路由接通
- `goToStep(5)` 改为路由到 `subView="opening-confirm"`（新增 SetupSubView 类型）。
- `SetupWizard.vue` stub 渲染块替换为 OpeningConfirm。
- `completedUntil` 更新：Step 5 进入后返回 4。

### R3: action bar
- secondary "返回" → goToStep(4)（回 Step 4 对话）。
- primary "进入故事" → 触发 enterPlay（翻转 mode + 烧蚀过渡）。
- primary 在 setup-summary complete 时即启用（openingNarrative 在 enterPlay 时 await 加载，不在确认屏等待）。

### R4: enterPlay 翻转 + 烧蚀过渡
- SetupWizard emit `enterPlay` 事件。
- App.vue 接线 `@enterPlay`：先 `await loadOpeningNarrative()` 确保 ref 就绪，再触发翻转。
- 翻转用 BurningReveal 烧蚀幕布过渡（复用 checkpoint restore 的 `variant="scroll"` 琥珀金火焰），与开屏 `variant="paper"` 区分，视觉统一：
  - `mode = "play"` + `phase = "burning"` → BurningReveal 挂载即燃烧，烧穿透明露出 stage-play/StoryView。
  - burning 期间 SetupWizard（wizard 模式）仍在幕布下，canvas shown 后移除向导层。
  - `@revealed` 后 `phase = "revealed"`，过渡完成。
- await loadOpeningNarrative() 在 mode 翻转前执行，确保 openingNarrative ref 就绪，StoryView 挂载时开局叙事零闪烁。

### R5: StoryView 开局叙事特殊渲染
- StoryView 模板在 `mergedStream` v-for 之前渲染 `<NarrativeMessage v-if="openingNarrative" :content="openingNarrative" />`。
- 空状态 guard 改为 `stream.length === 0 && !openingNarrative && !streaming`。
- openingNarrative 独立于 stream——reloadHistory/restore 替换 stream 时不被冲掉。

### R6: 重载恢复
- 向导初始化时检查 setup-summary `status==="complete"`：
  - complete → 直接路由到 Step 5（跳过 Step 4 对话）。
  - 非 complete → 停在当前步（Step 4 或更早）。
- 已在 Step 4 `startPlaySetupDialog` 处理 complete 检测（useSetupState.ts:562-566），Step 5 复用该信号做路由跳转。

## Acceptance Criteria

- [ ] AC1: Step 4 对话确认后点"下一步"进入 Step 5，显示设定卡片 + 装饰的过渡入口屏
- [ ] AC2: 设定卡片呼应 Step 3 名片设计语言（四角括号 + 脉冲 + serif），渲染 setup-summary 的 summary 文本
- [ ] AC3: action bar secondary "返回" 回 Step 4，primary "进入故事" 触发 enterPlay
- [ ] AC4: 点"进入故事"后 mode 翻转为 play，烧蚀幕布过渡（scroll 变体）后 SetupWizard 卸载，StoryView 挂载
- [ ] AC5: StoryView 首次渲染时开局叙事作为第一条消息显示在消息列表顶部
- [ ] AC6: StoryView 空状态不与开局叙事同时显示（有 openingNarrative 时不显示"故事尚未开始"）
- [ ] AC7: 重载恢复：已有 complete 的 setup-summary 时，进向导直接到 Step 5
- [ ] AC8: `play-frontend-dev` build 通过

## Out of Scope

- 不改 Step 4 对话逻辑 / commit_play_setup 脚本。
- 不改 useSetupState 的 Step 1-4 状态机逻辑。
- 不做 CheckpointView / SettingsView（App.vue:93-97 占位，后续任务）。
- 不做首回合回路验证（master 读 context.json → 输出剧情 → post-processing 维护）——那是游玩态首个 turn 的正常流程，不属于开局确认。

## Open Questions

无（brainstorm 已收敛所有决策）。
