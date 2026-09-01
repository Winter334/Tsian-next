# 开局向导多 Agent 编排 — 实施计划

## Validation Commands

```bash
npm run build:web         # platform-web 构建 + vue-tsc 类型检查（含模板 + 前端）
npm run build:contracts   # 契约层（本任务不改 contracts，但保持绿）
```

端到端验收（手动，需运行时会话）：
- 导入小说 → Step 2 understanding 完成 → 检查 `save/director/current-brief.md` 由导演写入（trace 里看到 agent_call director 事件）。
- Step 4 设定对话 → 流式文本逐字展示 → 收尾时检查 `save/playthrough/opening-narrative.json` 有内容 → enterPlay → StoryView 渲染开局正文。
- DebugView 检查 agent_call trace 事件（agent_step_started/completed for director/storyteller）。

## Implementation Steps

### 1. world-architect contacts 追加 storyteller

**文件**：`apps/platform-web/src/storage/workspace-templates.ts`
**位置**：world-architect agent.json block（`contacts: ["researcher", "stage-manager", "director"]`）
**改动**：追加 `"storyteller"` → `contacts: ["researcher", "stage-manager", "director", "storyteller"]`

### 2. world-architect AGENT.md 改职责描述

**文件**：`apps/platform-web/src/storage/workspace-templates.ts`
**位置**：world-architect AGENT.md content（`text([...])` 块）

改动：
- 删除/改写 `- 不写开局正文，不维护每回合 runtime。`
- 改为：
  - `- 不写开局正文；通过 agent_call 说书人生成开局正文，你负责把结果落盘到 save/playthrough/opening-narrative.json。`
  - `- 不维护每回合 runtime。`
  - `- 开局建模后通过 agent_call 导演写初始 brief；不自己代写 save/director/current-brief.md。`

### 3. world-architect Skill《开局建模》补编排指令

**文件**：`apps/platform-web/src/storage/workspace-templates.ts`
**位置**：`WORLD_ARCHITECT_OPENING_MODELING_SKILL_MD`（约 182-203 行）

改动：在末尾 `- 不写开局正文；不把导演 brief 写成世界建模报告。导演负责剧情指导文档。` 之后或替换为：
```
- 不写开局正文；不把导演 brief 写成世界建模报告。
- 建模完成后，agent_call 导演写初始 save/director/current-brief.md（导演负责剧情指导文档，你负责提供建模结果作为输入）。
- 设定收尾时，agent_call 说书人拿开局正文文本，你负责把文本写入 save/playthrough/opening-narrative.json（格式 { "narrative": "<文本>" }）。
```

### 4. director Skill 确认"被 call 写 initial brief"覆盖

**文件**：`apps/platform-web/src/storage/workspace-templates.ts`
**位置**：`DIRECTOR_BRIEF_SKILL_MD`（约 250-272 行）

检查：现有 triggers 已有 `- 开局建模后需要写初始剧情方向`，Brief 内容结构已定义。确认是否需补充"被 world-architect agent_call 调用时"的明确说明。若已有隐含覆盖，不改；若不够明确，追加一句：
```
- 被 world-architect 通过 agent_call 调用时：基于对方提供的建模结果写初始 brief，不需要自己重新读源文本。
```

### 5. 更新 prompt 构建函数

**文件**：`apps/play-frontend-dev/src/lib/source.ts`

**5a. `buildOpeningInitializationPrompt`（490-511 行）**：
- 改 `"3. 写入初始理解包、director brief、实体..."` 为：
  - `"3. 写入初始理解包、实体、候选原著角色、frontier，并按需初始化 scene/relationship/runtime/mode 骨架。"`
  - `"4. 建模完成后，agent_call 导演写初始 director brief（save/director/current-brief.md）；你不代写 brief。"`
  - 后续编号顺延。

**5b. `buildPlaySetupPrompt`（460-486 行）**：
- 改 `"6. 玩家确认后写入 save/playthrough/setup-summary.json，并把开局叙事文本写入 save/playthrough/opening-narrative.json。"` 为：
  - `"6. 玩家确认后写入 save/playthrough/setup-summary.json。"`
  - `"7. agent_call 说书人拿开局正文文本，你把结果写入 save/playthrough/opening-narrative.json（格式 { "narrative": "<文本>" }）。"`
  - 后续编号顺延。

### 6. useSetupState 访谈流式接入

**文件**：`apps/play-frontend-dev/src/composables/useSetupState.ts`

**6a. 新增流式状态 + 订阅**：
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

**6b. `startPlaySetupDialog`（559-605 行）**：
- 生成 invocationId：`const invocationId = play-setup-${Date.now().toString(36)}`
- 传入 invokeAgent options：`{ invocationId, contextSlot: "play-setup", persist: true }`
- 调用前：`activeInvocationId = invocationId; playSetupStreamingText.value = ""; ensurePlaySetupInvocationSubscription(tsian)`
- `handleAgentResponse` 后清空：`playSetupStreamingText.value = ""; activeInvocationId = null`

**6c. `sendPlaySetupMessage`（608-641 行）**：同 6b 模式，生成新 invocationId + 订阅 + 落定清空。

**6d. 暴露 `playSetupStreamingText`**：在 `useSetupState` 返回对象中加 `playSetupStreamingText: readonly(playSetupStreamingText)`。

**6e. 旧心跳**：Step 4 的 `startPlaySetupHeartbeat` / `stopPlaySetupHeartbeat` 移除（被 onAgentInvocation 替代）。Step 2 的 `startHeartbeat`/`stopHeartbeat` + `agentHeartbeat` ref——若 Step 2 事件驱动方案（步骤 8）不需要心跳脉冲则移除；若魔法阵动画仍需脉冲计数器则保留。实施时确认 `agentHeartbeat` 的所有消费者。

### 7. PlaySetupDialog 流式渲染

**文件**：`apps/play-frontend-dev/src/components/setup/step4/PlaySetupDialog.vue`

改动：
- 从 `useSetupState` 解构 `playSetupStreamingText`。
- `status === "running"` 时：
  - 若 `playSetupStreamingText` 非空 → 展示**轻量流式文本块**（serif 字体 + 渐入动画），不复用 `NarrativeMessage`（避免半截 `[[选项]]` 未闭合排版异常）。
  - 若 `playSetupStreamingText` 为空 → 保留 EmberForge 等待动画（刚启动、delta 未到的过渡）。
- delta 开始后 EmberForge 淡出或保留为底部微脉冲（保持简洁）。
- `completed` 后 `handleAgentResponse` 清空 `playSetupStreamingText`，把完整文本 push 为 `NarrativeMessage` 落定消息——流式和落定是两套渲染。

### 8. UnderstandingRunning 事件驱动阶段文案

**文件**：`apps/play-frontend-dev/src/components/setup/step2/UnderstandingRunning.vue` + `useSetupState.ts`

**8a. useSetupState 新增 understanding 事件订阅**：
```ts
let understandingInvocationSubscribed = false
function ensureUnderstandingInvocationSubscription(tsian): void {
  if (understandingInvocationSubscribed) return
  understandingInvocationSubscribed = true
  tsian.onAgentInvocation((event) => {
    if (!understandingActiveInvocationId || event.invocationId !== understandingActiveInvocationId) return
    if (event.type === "tool") {
      understandingStage.value = Math.max(understandingStage.value, mapToolToStage(event))
    }
    // completed/failed 由 understandingStatus 驱动，不在此处理
  })
}
```

**8b. 工具→阶段映射**（单调推进）：
```ts
function mapToolToStage(event: { name: string; status: string }): number {
  if (event.status !== "success" && event.status !== "running") return understandingStage.value
  const name = event.name
  if (name === "agent_call") return 3          // 或 4（导演校准）
  if (name.includes("write")) return 2         // 整理/写入
  if (name.includes("read")) return 1          // 阅读
  return understandingStage.value              // 未知工具不推进
}
```
实施时根据真实 tool name 细化映射（`workspace_read`/`workspace_write`/`agent_call`）。

**8c. UnderstandingRunning.vue 改动**：
- 从 `useSetupState` 解构 `understandingStage`（替代本地 `currentStage` computed）。
- 移除 `STAGE_INTERVAL` / `elapsedMs` / `tickTimer` 时间硬切逻辑。
- 保留魔法阵动画 + `stage-fade` 切换动画。
- 移除底部固定提示行（`.duration-hint` / `正在处理开局资料… ●●●`）。
- `STAGES` 可追加 `"导演正在校准剧情方向…"` 作为可选 stage 4（agent_call director 时）。

**8d. startUnderstanding 接入**：
- 生成 invocationId 传入 `invokeAgent` options。
- `understandingActiveInvocationId = invocationId; ensureUnderstandingInvocationSubscription(tsian)`。
- 旧心跳 `startHeartbeat()` 移除（若 `agentHeartbeat` 无其他消费者）。

### 9. 旧心跳全局清理评估

搜索 `onAgentActivity` 全部引用：
```bash
grep -rn "onAgentActivity\|agent-activity\|agentActivity" apps/ packages/ --include="*.ts" --include="*.vue"
```
- 若步骤 6e + 8d 后 `onAgentActivity` 已无消费者，则一并清理：bridge event、platform-web 事件总线、play-bridge `onAgentActivity` API、相关文档。
- 若仍有其他消费者（非 setup 路径），则只清理 setup 路径引用，全局清理留给 `setup-invoke-agent-streaming`。

### 10. 构建验证

```bash
npm run build:contracts
npm run build:web
```

两者全通过。

### 11. 端到端验收（手动）

如条件允许：
- 导入小说 → Step 2 → 确认阶段文案随 agent 工具调用切换（非时间硬切）→ DebugView 确认 agent_call director 事件 → brief 文件存在。
- Step 4 对话 → 确认流式文本逐字出现 → 收尾 → opening-narrative.json 存在 → enterPlay → StoryView 渲染开局正文。
- 失败路径：模拟 agent 失败 → 确认 failed 态 + 重试可用。

## Risky Files & Rollback Points

| 文件 | 风险 | 回滚 |
|---|---|---|
| `workspace-templates.ts` | Agent 指令改动可能影响 agent 行为质量 | 恢复旧 AGENT.md / Skill 文本 |
| `useSetupState.ts` | 流式接入可能引入状态竞争（invocationId 过滤） | 移除流式订阅，回退到 Promise resolve 一次性渲染 |
| `source.ts` prompt | prompt 改动可能影响 agent 编排行为 | 恢复旧 prompt |
| `PlaySetupDialog.vue` | UI 改动 | 恢复 EmberForge-only 等待态 |
| `UnderstandingRunning.vue` | 事件驱动阶段映射可能不准确 | 恢复 STAGE_INTERVAL 时间硬切 |

**回滚锚点**：三条独立改动线——agent_call 编排（模板/prompt）、Step 4 流式、Step 2 事件驱动。任一出问题可独立回退。

## Review Gates

- [ ] world-architect contacts 含 storyteller。
- [ ] world-architect AGENT.md 不再说"不写开局正文"，改为 agent_call 说书人 + 落盘。
- [ ] world-architect AGENT.md 不再代写 brief，改为 agent_call 导演。
- [ ] storyteller platformTools 不变（无 workspace_write）。
- [ ] Step 4 流式 delta 按 invocationId 过滤，不串扰。
- [ ] Step 4 流式用轻量文本块，落定后 push 为 NarrativeMessage，不混用。
- [ ] 落定后 playSetupStreamingText 清空，不残留到下一轮。
- [ ] Step 2 阶段文案由 onAgentInvocation tool 事件驱动（单调推进），不再用 STAGE_INTERVAL 时间硬切。
- [ ] Step 2 底部固定提示行（正在处理开局资料…）已移除。
- [ ] Step 2 魔法阵动画保留。
- [ ] 旧心跳 onAgentActivity 在 setup 路径已替代；全局清理状态已记录。
- [ ] build:contracts + build:web 通过。
