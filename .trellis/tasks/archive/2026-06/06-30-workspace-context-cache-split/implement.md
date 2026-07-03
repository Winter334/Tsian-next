# Implement — workspace.context 逐文件拆分优化前缀缓存

## 实现检查清单（有序）

### Step 1: 重构 formatAgentRuntimeContext → buildAgentContextMessages_split

**文件**：`apps/platform-web/src/agent-runtime/index.ts`

- [ ] 新增 `buildAgentContextMessages_split(context, label)` 函数，返回 `RuntimeChatMessage[]`：
  - [ ] 元信息段：`{ role: "user", content: "<label>（元信息）：\n" + meta }`，meta 含 header（Agent id/title/summary/path）+ notesFile + missingContextPaths + skillIndex。复用现有 `formatAgentRuntimeContext` 的非 contextFiles 部分逻辑（`formatOptionalWorkspaceFile`、`formatMissingContextPaths`、`formatSkillIndex`）。
  - [ ] 逐文件段：对 `context.contextFiles` 按 contextPaths 声明顺序，每个产 `{ role: "user", content: "Workspace 文件 " + file.path + "：\n" + formatWorkspaceFile(file) }`。
  - [ ] 空 contextFiles：不产逐文件段，元信息段仍含"（暂无已加载 contextPaths 文件）"提示（移入元信息段头部或 missingContextPaths 区）。
- [ ] 保留旧 `formatAgentRuntimeContext` 函数（若有其他调用点）或确认无其他调用点后删除。grep 确认：`rg -n "formatAgentRuntimeContext" apps/platform-web/src/`。

### Step 2: 调整 buildEntryAgentMessages

**文件**：`apps/platform-web/src/agent-runtime/index.ts:897`

- [ ] 把 `{ role: "user", content: "Workspace Agent 上下文：\n" + formatAgentRuntimeContext(context) }` 替换为 `...buildAgentContextMessages_split(context, "Workspace Agent 上下文")`。
- [ ] 确认序列顺序：system → history → [元信息] → [file…] → 当前回合 → beforeInputInjection → 玩家输入 → afterInputInjection。

### Step 3: 调整 buildDelegatedAgentMessages

**文件**：`apps/platform-web/src/agent-runtime/index.ts:1059`

- [ ] 把 `{ role: "user", content: "目标 Agent 上下文：\n" + formatAgentRuntimeContext(targetContext) }` 替换为 `...buildAgentContextMessages_split(targetContext, "目标 Agent 上下文")`。
- [ ] 确认 delegated 序列顺序：system → 调用方 Agent → 最近对话窗口 → [元信息] → [file…] → 当前回合 → 玩家输入 → 调用请求。

### Step 4: 显示层标签识别（PRD R3 必需，服务 AC1/AC2 验证）

**文件**：`apps/platform-web/src/runtime-host/ai.ts:53-73`

- [ ] `inferMessageSegmentLabel` 加识别：
  - text 以 `"Workspace Agent 上下文（元信息）"` 或 `"目标 Agent 上下文（元信息）"` 开头 → 返回 `"workspace.meta"`。
  - text 以 `"Workspace 文件 "` 开头 → 返回 `"workspace.file"`。
- [ ] `segmentStability`：`workspace.meta` 和 `workspace.file` → `"semi-stable"`。

### Step 5: 类型检查与构建

- [ ] `npm run build --workspace platform-web`（含 `vue-tsc -b` 类型检查 + `vite build`）。
- [ ] 若 contracts 包被改动（本任务不应改）：`npm run build --workspace @tsian/contracts` 先行。

### Step 6: 手动验证（DebugView）

- [ ] 启动 `npm run dev:web`，进入游戏跑 master 连续两轮（确保 agent 写了 runtime.json、没动 docs/schema-guide）。
- [ ] DebugView 打开最新 AI 调用记录，检查 `messageSegments`：
  - [ ] `docs/novel-airp-schema-guide.md` 对应一条 `workspace.file` 段，连续两轮 `charLength` 相同。
  - [ ] `runtime.json` 对应一条 `workspace.file` 段，连续两轮 `charLength` 不同。
  - [ ] 元信息段 `workspace.meta` 存在，连续两轮 `charLength` 相同（agent 定义未编辑时）。
- [ ] 观察连续两轮 `usage.input`（prompt_tokens）变化量是否只对应 runtime.json 那条的体积（粗略验证未命中区收窄）。

### Step 7: 压缩路径验证

- [ ] 跑一个会触发 `compressTaskContext` 的长任务（助手多轮工具调用超阈值）。
- [ ] 确认任务压缩正常完成、不报错（`locateTaskInteractionSpan` 正确定位工具交互段，不被新 workspace 文件段干扰）。
- [ ] 若方便，跑一个会触发剧情压缩（`compressContext`）的 master 长会话，确认 history 段定位正常。

### Step 8: delegated agent 验证

- [ ] 触发一次 `agent_call`（如 master 调 retrieval/post-processing）。
- [ ] DebugView 确认 delegated agent 的 messages 含 `目标 Agent 上下文（元信息）` + 逐文件段，结构正确。

## 验证命令汇总

```bash
# 类型检查 + 构建（主验证）
npm run build --workspace platform-web

# 确认无其他调用点（Step 1 前置）
rg -n "formatAgentRuntimeContext" apps/platform-web/src/

# 确认边界锚定不被破坏（Step 2-3 后置 review）
rg -n "当前回合：|当前问答轮次：|locateHistorySpan|locateTaskInteractionSpan" apps/platform-web/src/agent-runtime/index.ts
```

## 风险文件与回滚点

- **主要改动文件**：`apps/platform-web/src/agent-runtime/index.ts`（核心）、`apps/platform-web/src/runtime-host/ai.ts`（显示标签）。
- **高风险点**：`buildEntryAgentMessages` 和 `buildDelegatedAgentMessages` 的消息序列顺序——错位会导致 `locateHistorySpan` 扫不到"当前回合："返回 {-1,-1}，压缩静默跳过（不报错但失效）。Step 6/7 验证覆盖。
- **回滚**：`git revert <commit>`，无数据迁移、无 schema 变更、无残留状态。

## review gates

- Step 1 完成后自审：`buildAgentContextMessages_split` 产出顺序与 design §2.2 一致。
- Step 2-3 完成后自审：两条路径序列顺序与 design §3 一致，`当前回合：` 仍在 workspace 文件段之后。
- Step 5 类型检查必须通过才能进 Step 6。
