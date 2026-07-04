# 开局向导多 Agent 编排 — 技术设计

## Scope

将开局向导从 world-architect 一人包揽改为 agent_call 自编排：world-architect 作为编排者通过 `agent_call` 调度导演写 brief、说书人写开局正文。同时让访谈 UI 接入 `onAgentInvocation` 流式 delta。平台层零改动，改动集中在 Agent 模板指令 + 前端消费端。

## Architecture · 编排结构

### 当前流程（world-architect 包揽）

```
Step 2: invokeAgent("world-architect", buildOpeningInitializationPrompt)
        └─ world-architect 自己读源文本、建 schema/entities/runtime
        └─ world-architect 自己写 save/director/current-brief.md        ← 代写
        └─ 心跳: onAgentActivity（脉冲动画）

Step 4: invokeAgent("world-architect", buildPlaySetupPrompt) × N 轮
        └─ world-architect 与玩家对话，补齐设定
        └─ world-architect 自己写 opening-narrative.json                ← 代写
        └─ 心跳: onAgentActivity（脉冲动画）
        └─ 等 Promise resolve → 一次性渲染 result.response
```

### 目标流程（agent_call 自编排）

```
Step 2: invokeAgent("world-architect", buildOpeningInitializationPrompt)
        └─ world-architect 读源文本、建 schema/entities/runtime
        └─ agent_call("director") → 导演写 save/director/current-brief.md
        └─ world-architect 汇总反馈给前端
        └─ 流式: onAgentInvocation delta（world-architect 输出）

Step 4: invokeAgent("world-architect", buildPlaySetupPrompt) × N 轮
        └─ world-architect 与玩家对话，补齐设定
        └─ 收尾时 agent_call("storyteller") → 说书人写开局正文
        └─ 流式: onAgentInvocation delta（world-architect + delegated 说书人输出）
```

前端仍是**一次 invokeAgent 调用**，不改为串行多次。编排逻辑在 Agent 指令层（AGENT.md / Skill / prompt），不在前端代码。

### agent_call 在 invokeAgent 中的可用性

已验证（`agent-runtime/index.ts:1113-1255` `createAgentCallRunner`）：
- `invokeAgent` 复用 `runAgentRuntimeTurn`，agent_call 工具在运行时可用。
- 被叫 Agent（delegated）共享调用方的 `workspaceTransaction` 和 `workspaceFiles`。
- 被叫方的 `workspace_write` 权限由其自身 `agent.json` 的 `platformTools` 决定，不是继承调用方。
- delegated agent 的 delta/round-end/tool 事件通过同一 `invocationId` 转发（`onDelta`/`onRoundEnd`/`onTool` 透传，`index.ts:1236-1238`）。

## Design Decisions

### D1: 落盘责任 — 代写 vs 自写

**事实约束**（来自模板 `workspace-templates.ts`）：

| Agent | `workspace_write` | 当前是否代写 |
|---|---|---|
| world-architect | ✅ 有 | 代写 brief + opening-narrative |
| director | ✅ 有 | （被 call 时可自写 brief） |
| storyteller | ❌ 无（只有 `workspace_read`） | 无法自写 opening-narrative |

**两条路**：

**(a) 全自写**：导演自写 brief（可行，有 write 权限）；说书人自写 opening-narrative（**需给 storyteller 加 `workspace_write`**）。
- 优点：符合数据权威（谁负责谁写）；各 Agent 只关心自己的文件格式。
- 缺点：给 storyteller 开 write 权限——但它同时是玩家正式回合入口，开 write 后它在正式回合也有写权限，可能误写非开局文件。需评估权限收敛。

**(b) 导演自写 brief + world-architect 代写 opening-narrative**：导演被 call 后自写 brief；说书人被 call 后返回正文文本，world-architect 拿到后写入 opening-narrative.json。
- 优点：不给 storyteller 开 write 权限，权限面最小；world-architect 代写时可做一次内容校验（非空、格式合法）。
- 缺点：world-architect 仍代写一个文件，但只是"落盘代理"，不是"内容作者"——内容作者是说书人。

**(c) 全代写**：world-architect call 两者拿结果，自己写两个文件。
- 优点：world-architect 有统一校验机会。
- 缺点：最不符合数据权威；world-architect 要知道两个文件的格式约定。

**决策：选 (b)**。

理由：
1. **不给 storyteller 开 `workspace_write`**——它是正式回合入口（`entryMode: "persistent"`，每轮都跑），开 write 的风险面远大于开局一次性的代写成本。说书人在正式回合只需 `workspace_read`（读 brief/runtime）+ `agent_call`（call 资料员），不需要写 workspace。
2. **导演自写 brief**——它有 write 权限，brief 是它的职责文件，自写符合数据权威。
3. **world-architect 代写 opening-narrative 是可接受的"落盘代理"**——说书人被 call 时只返回正文文本（它的核心能力是写叙事），world-architect 把文本写入 `{ narrative: string }` 结构是机械落盘，不需要理解叙事内容。world-architect 可校验文本非空后落盘。
4. 未来若 storyteller 需要写 workspace（如行动裁定结果落盘），再按那个任务的需求单独开 write，不在此处预借。

**实施影响**：
- world-architect AGENT.md / Skill 指令：建模后 `agent_call("director")` 让导演写 brief；设定收尾时 `agent_call("storyteller")` 拿正文文本，world-architect 自己写入 opening-narrative.json。
- 不改 storyteller 的 `platformTools`。
- director AGENT.md / Skill：确认"被 call 时写 initial brief"职责（模板可能已有，需检查 Skill 内容）。

### D2: 开局正文文件 — 沿用独立 `opening-narrative.json`

**决策**：沿用 `save/playthrough/opening-narrative.json`（`{ narrative: string }`），不进 turn 历史。

理由：
- 开局正文没有"玩家输入"，硬塞 turn 文件破坏 user→assistant 对称性。
- checkpoint turn 归属以正式回合为准（turn-1 = 第一次玩家输入），开局正文游离于 turn 编号外更干净。
- StoryView 已有特殊渲染路径（`StoryView.vue:348-353`），不改。
- 正式 turn 从玩家第一次输入开始编号，restore/checkpoint 语义不变。

### D3: 开局文件格式 — 本任务纯文本，记录富渲染扩展方向

**决策**：本任务保持 `{ narrative: string }` 纯文本结构；记录未来扩展为 `segments` 富渲染 schema 的方向，但不实现。

未来扩展方向（仅记录，不实施）：
```jsonc
{
  "narrative": "纯文本兜底",
  "segments": [
    { "type": "text", "content": "…" },
    { "type": "options", "items": ["…", "…"] },
    { "type": "html", "content": "<div class='scene-intro'>…</div>" }
  ]
}
```
富渲染需配套 StoryView 渲染组件、Agent 指令约定、HTML 安全策略，是独立前端 UX 任务。

### D4: 访谈流式接入 — Step 4 消费 onAgentInvocation delta

**决策**：Step 4 `useSetupState` 订阅 `onAgentInvocation`，按 `invocationId` 过滤，把 `delta`（`kind: "content"`）累积为流式文本推给 `PlaySetupDialog` 渲染。`completed` 事件驱动落定（清洗选项块 + 检查 setup-summary）；`failed` 事件驱动错误态。

**流式累积器**（`useSetupState` 新增）：
```ts
const playSetupStreamingText = ref("")
let activeInvocationId: string | null = null
let playSetupInvocationSubscribed = false

function ensurePlaySetupInvocationSubscription(tsian): void {
  if (playSetupInvocationSubscribed) return
  playSetupInvocationSubscribed = true
  tsian.onAgentInvocation((event) => {
    if (!activeInvocationId || event.invocationId !== activeInvocationId) return
    if (event.type === "delta" && event.kind === "content") {
      playSetupStreamingText.value += event.delta
    }
    // completed/failed 由 Promise resolve/reject 驱动，不在此处理
  })
}
```

**流式渲染方式**：流式过程中用**轻量流式文本块**（serif 字体 + 渐入），不复用 `NarrativeMessage`——后者为落定消息设计（含选项块清洗、完整排版），渲染半截文本可能在 `[[选项]]` 未闭合时排版异常。`completed` 后清空流式块，由 `handleAgentResponse` 把完整文本 push 成 `NarrativeMessage` 落定消息。流式和落定是两套渲染，避免半截文本排版问题。

**复用边界**：
- 复用：`NarrativeMessage`（落定消息）、`StoryOptions`（选项渲染）、`EmberForge`（delta 未到达时的过渡等待）— 均已复用，保持。
- 不复用：`useTsian.streamingText`（绑定主回合 `onMessage` 通道，与 `onAgentInvocation` 是不同流）。Step 4 用自己的 `playSetupStreamingText`。
- 流式文本块是 Step 4 专用轻量渲染，不进 StoryView。

**agent_call delegated 事件处理**：world-architect agent_call 说书人时，说书人的 delta 事件带同一 `invocationId`（`agentId: "storyteller"`）。MVP 只展示 `agentId === "world-architect"` 的 content delta（编排者输出）；delegated agent 的 delta 过滤掉，其过程通过 `tool` 事件（`name: "agent_call"`）隐含感知。不做 delegated 分流 UI（未来层）。

**EmberForge 与流式文本共存**：delta 未到达时 EmberForge 作为过渡等待；delta 开始后 EmberForge 淡出或保留为底部微脉冲（实施时定，保持简洁）。

### D5: Step 2 understanding — 事件驱动阶段文案（映射美化）

**决策**：Step 2 接入 `onAgentInvocation` 的 `tool`/`round-end` 事件，映射成 `STAGES` 文案，替代现有按 12 秒硬切的 `STAGE_INTERVAL` 时间猜进度。去掉底部固定提示行（`正在处理开局资料… ●●●`）——事件驱动的阶段文案已足够。魔法阵动画保留。

**不展示**：
- `delta`（reasoning/content）— 建模过程不是玩家可见叙事，有 spoilers 风险。
- 工具名列表（`workspace.read ch-001` 等）— 太 IDE 调试面板，破坏沉浸感。

**映射方案**（面向玩家的术式阶段文案，单调推进不倒退）：

| 事件信号 | 目标阶段 | STAGES 文案 |
|---|---|---|
| `started` + 首个 `tool`（read manifest/chapter） | 0 | 正在观察导入结构… |
| `tool`（read ch-NNN，连续多个） | 1 | 正在阅读开头剧情… |
| `tool`（write schema/entities/scenes/runtime） | 2 | 正在整理开局资料… |
| `tool`（write）收尾 / `agent_call` director | 3 | 正在写入… |
| `completed` | — | （组件切走，由 understandingStatus 驱动） |

**单调推进**：`currentStage = Math.max(currentStage, mapEventToStage(event))`。agent 读写交替时文案只往前不倒退，避免闪烁。

**agent_call director 阶段**：world-architect 建模后 agent_call 导演写 brief，可在 stage 3 后追加可选阶段"导演正在校准剧情方向…"（STAGES[4]）。若 agent_call 事件能被 `onAgentInvocation` 的 `tool` 事件（`name: "agent_call"`）捕获则展示；若 agent_call 不产生 invocation 级 tool 事件则不展示该阶段（实施时确认事件可达性）。

**旧心跳**：Step 2 的 `onAgentActivity` 旧心跳在事件驱动方案下不再驱动阶段文案，但魔法阵动画由 CSS 驱动不依赖心跳。`agentHeartbeat` ref 若无其他消费者可一并移除；若有（如脉冲计数器）则保留，实施时确认。

### D6: 旧心跳处理边界

**决策**：本任务在 Step 4 和 Step 2 路径都用 `onAgentInvocation` 替代 `onAgentActivity` 驱动核心逻辑（Step 4 流式文本 / Step 2 阶段文案）。Step 2 的 `agentHeartbeat` ref 若无其他消费者则移除；魔法阵动画由 CSS 驱动不依赖心跳。全局 `onAgentActivity` API 删除（bridge event + platform-web 事件总线 + play-bridge `onAgentActivity`）若确认无其他引用则在本任务一并完成，否则留给 `setup-invoke-agent-streaming`。

理由：Step 2 和 Step 4 是 `onAgentActivity` 的主要消费者；本任务接入 `onAgentInvocation` 后，若两者都已切换，旧心跳 API 已无引用，可一并清理。implement 阶段搜索 `onAgentActivity` 全部引用确认。

## Data Flow · Step 4 流式接入后

```
sendPlaySetupMessage(input)
  ├─ activeInvocationId = <new id>
  ├─ playSetupStreamingText = ""
  ├─ status = "running"
  ├─ ensureInvocationSubscription(tsian)      # 订阅 onAgentInvocation（幂等）
  ├─ tsian.invokeAgent("world-architect", input, { invocationId, persist: true })
  │    └─ onAgentInvocation delta (content) → playSetupStreamingText += delta
  │    └─ world-architect 内部 agent_call("storyteller") → 说书人写正文
  │    └─ onAgentInvocation completed → (Promise resolve 触发 handleAgentResponse)
  ├─ handleAgentResponse(result.response)
  │    └─ parseStoryOptions → push agent message
  │    └─ playSetupStreamingText = ""         # 清空流式累积
  │    └─ 检查 setup-summary → status = complete | idle
  └─ catch → status = "failed"
```

## Contracts · 改动点

### 1. `apps/platform-web/src/storage/workspace-templates.ts`
- world-architect `contacts`：追加 `"storyteller"`。
- world-architect AGENT.md：改"不写开局正文"为"通过 agent_call 说书人写开局正文，world-architect 负责落盘 opening-narrative.json"。
- world-architect AGENT.md：改"自己写 director brief"为"agent_call 导演写 brief"。
- world-architect Skill《开局建模》：补充编排指令（建模后 call 导演）。
- director AGENT.md / Skill《剧情指导维护》：确认"被 call 时写 initial brief"职责（检查现有内容是否已覆盖）。
- 不改 storyteller `platformTools`（不加 workspace_write，D1 决策）。

### 2. `apps/play-frontend-dev/src/composables/useSetupState.ts`
- 新增 `playSetupStreamingText` ref + `activeInvocationId` + `ensureInvocationSubscription`。
- `startPlaySetupDialog` / `sendPlaySetupMessage`：生成并传入 `invocationId`，订阅流式 delta。
- `handleAgentResponse`：落定后清空 `playSetupStreamingText`。
- 暴露 `playSetupStreamingText` 供 `PlaySetupDialog` 渲染。
- 旧心跳 `startPlaySetupHeartbeat` / `stopPlaySetupHeartbeat`：Step 4 路径移除或保留为兜底（implement 评估）；Step 2 保留。

### 3. `apps/play-frontend-dev/src/components/setup/step4/PlaySetupDialog.vue`
- `status === "running"` 时展示 `playSetupStreamingText`（流式文本），与现有 EmberForge 等待动画共存或替代（UI 决策，implement 确定）。

### 4. `apps/play-frontend-dev/src/lib/source.ts`
- `buildPlaySetupPrompt`：更新指令——收尾时 agent_call 说书人拿正文，world-architect 落盘。
- `buildOpeningInitializationPrompt`：更新指令——建模后 agent_call 导演写 brief。

### 5. 不改平台层
- `packages/contracts/**`、`apps/platform-web/src/platform-host/**`、`apps/platform-web/src/bridge/**` 零改动。

## Compatibility & Rollback

- **向后兼容**：前端调用方式不变（一次 invokeAgent）；StoryView 渲染逻辑不变；turn 编号语义不变。
- **回滚**：若 agent_call 编排在实践中不稳定（如 world-architect 不按指令 call），可回退到 world-architect 代写（改回 AGENT.md 指令 + prompt），前端流式接入独立保留。
- **数据迁移**：无需迁移。`opening-narrative.json` 格式不变。

## Out of Scope

- 不实现开局富渲染（HTML/segments schema）。
- 不改 storyteller 的 `platformTools`（不加 workspace_write）。
- 不改 Step 2 understanding 的等待态展示（保留魔法阵动画 + 旧心跳）。
- 不全局删除 `onAgentActivity` 旧心跳 API（留给 setup-invoke-agent-streaming 或后续）。
- 不实现行动裁定玩法系统（独立任务 `action-resolution-system`）。
- 不改平台层 checkpoint / invokeAgent / agent_call 机制。
