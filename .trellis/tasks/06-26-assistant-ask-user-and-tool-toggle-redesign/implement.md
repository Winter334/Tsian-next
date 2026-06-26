# Implement — ask_user 助手开关与工具开关体系重设计

## 实现顺序（自底向上，每步可独立验证）

### Step 1 权限层：ask_user 进常量 + 默认态派生
**文件**：`apps/platform-web/src/agent-runtime/permissions.ts`

1. `AGENT_PLATFORM_TOOL_NAMES` 加 `askUser: "ask_user"`。
2. 删 `DEFAULT_AGENT_PLATFORM_TOOLS` 单数组（仅本文件引用，已确认无外部依赖）。
3. 加 `DEFAULT_GAME_AGENT_PLATFORM_TOOLS`（agent_call + workspace_read + workspace_write）和 `DEFAULT_ASSISTANT_PLATFORM_TOOLS`（前者 + ask_user）。
4. 加 `defaultPlatformToolsForAgent(agent)`：`agent.id === ASSISTANT_CONTEXT_AGENT_ID`（从 `context-lifecycle.ts` import）判助手。
5. `enabledAgentPlatformTools` 默认回退改用 `defaultPlatformToolsForAgent(agent)`。

**验证**：`pnpm --filter @tsian/platform-web type-check`（或对应 lint 命令）。确认无对旧 `DEFAULT_AGENT_PLATFORM_TOOLS` 的悬空引用。

### Step 2 Runtime 层：schema 门控接入 ask_user
**文件**：`apps/platform-web/src/agent-runtime/tool-schemas.ts`

1. `buildEnabledToolSchemas` 起手数组改为 `[useSkillSchema, runScriptSchema]`（移除无条件的 askUserSchema）。
2. 加 `canAskUser = platformToolEnabled(options.enabledPlatformTools, AGENT_PLATFORM_TOOL_NAMES.askUser)`，true 时 push `askUserSchema`。

**验证**：type-check。grep 确认 `askUserSchema` 仍被引用、未被孤立。

### Step 3 助手路径 onAskUser 绑定 + abort 清理
**文件**：`apps/platform-web/src/platform-host/assistant-chat.ts`

1. import `emitInteractionRequest`、`rejectAllInteractionRequests`（从 `../interaction-events`）。
2. `runAgentRuntimeTurn` 调用对象加 `onAskUser: (requestId, request) => emitInteractionRequest(requestId, request.question, request.options, request.allowCustom)`。
3. 找到 assistant-chat 的 signal abort / error 路径，加 `rejectAllInteractionRequests(reason)` 调用（镜像游戏 host `index.ts:729` 的清理）。

**验证**：type-check。手动：助手 native 模式调 ask_user 时不再抛 ASK_USER_UNAVAILABLE（需配合 Step 6 的 UI 才能完整跑通，此处先确认绑定不报类型错）。

### Step 4 UI 共享：分组控件定义
**文件**：`apps/platform-web/src/agent-runtime/tool-controls.ts`（新建）

1. 定义 `PlatformToolControl`、`PlatformToolControlGroup` 接口。
2. 导出 `PLATFORM_TOOL_CONTROL_GROUPS`：3 组（协作与交互 / Workspace / 前端自检），含全部 6 个工具项（agent_call、ask_user、workspace_read、workspace_write、workspace_semantic_search、inspect_frontend）。描述文案从两面板现有定义合并，ask_user 描述见 design §4.1。

**验证**：type-check。

### Step 5 双面板接入分组控件
**文件**：
- `apps/platform-web/src/components/assistant/AssistantConfigPanel.vue`
- `apps/platform-web/src/views/StudioView.vue`

1. 两文件各自的局部 `platformToolControls` 扁平数组替换为 import `PLATFORM_TOOL_CONTROL_GROUPS`。
2. 模板 `<section>` 改为外层 `v-for="group in PLATFORM_TOOL_CONTROL_GROUPS"` 渲染组标题 + 内层 `v-for="tool in group.tools"` 渲染 checkbox。组标题样式沿用 `font-mono text-[11px] uppercase tracking-wider text-neon-muted`。
3. `togglePlatformTool` / `platformToolEnabled` 逻辑不变（仍按 tool.id 操作），只是数据源换成分组结构。

**效果**：AssistantConfigPanel 自动补齐 workspace_semantic_search；StudioView 自动补齐 ask_user。两面板开关集合一致。

**验证**：type-check + dev server 目视：两面板都显示 3 组、6 个开关项；助手面板有 semantic_search、Studio 面板有 ask_user。

### Step 6 助手 ask 渲染 UI
**文件**：
- `apps/platform-web/src/composables/useAssistantTimeline.ts`
- `apps/platform-web/src/views/AssistantView.vue`

#### 6a. timeline 扩展 ask 节点
`useAssistantTimeline.ts`：
1. `AssistantTimelineNode` 联合加 `ask` 类型：
   ```ts
   | { type: "ask"; id: string; round: number; requestId: string; question: string; options?: string[]; allowCustom?: boolean; answer?: string; cancelled?: boolean; collapsed: boolean }
   ```
2. 导出一个 `pushAskNode(requestId, question, options, allowCustom, round)` 方法（或让视图直接 push，但放 composable 更内聚）。
3. 导出 `resolveAskNode(requestId, answer, cancelled)` 更新对应节点。
4. `finalize()` 对 ask 节点的 collapsed 处理：已回答的折叠，未回答的保持展开（或保持原样）。

#### 6b. AssistantView 订阅 + 渲染 + 回填
`AssistantView.vue`：
1. import `subscribeInteractionRequest`、`resolveInteractionRequest`（从 `@/interaction-events`）。
2. `onMounted` 订阅 `subscribeInteractionRequest`，回调里给当前 assistantMsg.timeline push 一个 ask 节点（用 useAssistantTimeline 暴露的方法），触发 `maybeScrollToBottom`。
3. `onBeforeUnmount` 调 unsubscribe。
4. 模板 timeline `v-for` 渲染加 `ask` 分支：问题文本 + 选项按钮（v-if options）+ 自定义输入框（v-if allowCustom）+ 取消按钮。已回答态（answer/cancelled 存在）转只读显示。
5. 选项点击 / 自定义提交 / 取消 → 调 `resolveInteractionRequest(requestId, answer, cancelled)`，并更新节点。

**验证**：dev server 手动——助手 native 模式触发 ask_user：提问卡片出现 → 点选项 → 卡片转只读 → 助手 turn 继续拿到答案。取消路径同理。

### Step 7 质量检查
1. `pnpm --filter @tsian/platform-web lint`（若有）。
2. `pnpm --filter @tsian/platform-web type-check`。
3. 既有测试：`pnpm --filter @tsian/platform-web test`（若有 agent-runtime / permissions 相关测试）。
4. 手动回归：
   - 游戏内 master（text 模式）`[[选项]]` 流程不受影响。
   - 游戏内 master（native 模式）默认看不到 ask_user；手动开后仍能走 interaction-request → game iframe ask-panel。
   - 助手默认有 ask_user 开关且启用；关闭后 schema 不含 ask_user。
   - 两面板开关集合一致（6 项 / 3 组）。

## 验证命令汇总

```bash
pnpm --filter @tsian/platform-web type-check
pnpm --filter @tsian/platform-web lint
pnpm --filter @tsian/platform-web test
```

（具体脚本名以 platform-web package.json scripts 为准，实现时确认）

## 风险与回滚点

| 风险 | 缓解 |
|---|---|
| 默认态派生改变游戏 agent 行为（ask_user 从永远可见变默认不可见） | 预期修正（D2/D4）；若需还原，回滚 Step 1+2 恢复单 DEFAULT 数组 + 无条件 push |
| 助手 ask UI 与流式 timeline 状态冲突 | ask 节点独立类型，不与 thought/tool/interim 节点逻辑交叉；6a 隔离改动 |
| interaction-events 等待表悬空（助手 abort 未清理） | Step 3 在 abort 路径加 rejectAllInteractionRequests；测试覆盖取消/中断路径 |
| 两面板分组控件渲染样式分叉 | Step 4 共享定义统一数据源；Step 5 两面板共用同一 import |

**回滚**：各 Step 独立。权限+schema（Step 1-2）回滚恢复原行为；UI（Step 4-6）回滚不影响数据兼容；Step 3 onAskUser 绑定移除则助手 ask_user 回到抛 ASK_USER_UNAVAILABLE（不破坏其它路径）。

## 实现前最后核查（task.py start 前）

- [ ] 确认 platform-web package.json 的 type-check/lint/test 脚本名
- [ ] 确认 `ASSISTANT_CONTEXT_AGENT_ID` 从 context-lifecycle.ts import 路径无循环依赖风险
- [ ] design.md + implement.md 用户已评审
