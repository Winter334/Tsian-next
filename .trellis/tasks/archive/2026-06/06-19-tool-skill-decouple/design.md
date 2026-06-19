# Design — 工具与 skill 解耦重构

> 子任务1 of `06-19-tool-runtime-performance`。本文件解决 PRD 留给 design 的 4 个开放问题，并定下实现边界、契约与权衡。

## 1. 架构与边界

### 1.1 涉及模块

| 层 | 文件 | 改动性质 |
|---|---|---|
| contracts | `packages/contracts/src/runtime.ts` | `SkillRegistryEntry` 增可选 `actions` 字段（R3） |
| runtime-core | `apps/platform-web/src/agent-runtime/workspace-tools.ts` | 重构核心：工具名常量、use_skill/run_script 实现、executor 分支裁剪、sessionState 注入追踪 |
| runtime-core | `apps/platform-web/src/agent-runtime/registry.ts` | `buildSkillRegistryEntry` 解析 `tsian-actions` 围栏（R3） |
| runtime-core | `apps/platform-web/src/agent-runtime/tool-schemas.ts` | `skillLoadSchema`→`useSkillSchema`、`actionCallSchema`→`runScriptSchema`、`buildEnabledToolSchemas` 列表 |
| runtime-core | `apps/platform-web/src/agent-runtime/index.ts` | prompt 文案重写（两步流程）、`formatSkillIndex` 展示 action、**两个工具循环注入 skill 全文** |
| platform-host | `apps/platform-web/src/platform-host/index.ts` | 移除 `runPlatformAction` capability 注入（R4）；`runBrowserScript` 保留供 run_script 复用 |
| platform-host | `apps/platform-web/src/platform-host/browser-skill-script-executor.ts` | 不动（run_script 复用现有 `createBrowserSkillScriptRunner`） |

### 1.2 不动的边界

- `agent_call` 机制、`createAgentCallRunner`、协作策略——不动（归子3 schema 澄清）。
- `playFrontendBridge.platform.runAction`（前端→平台通道，platform-host:1305）与 `normalizeWorkspaceActionRequest` 的前端调用路径（:1094）——不动。R4 只移除 **agent executor 路径** 的 `runPlatformAction`，前端通道独立。
- `browser-skill-script-executor.ts` 的 Web Worker 执行机制——不动。run_script 复用 `createBrowserSkillScriptRunner` 返回的 runner。
- `maxToolRoundsPerAgent`、token 预算——不动（归子2）。
- 工具命名 `workspace.read` 等、`glob`、patch/validate 移除——不动（归子3）。
- `actionExecutorPolicy` 接通——不动（归子4）。本任务只裁剪 executor 类型范围，policy 钩子保留接口、恒 enabled 行为不变。

## 2. 数据流与契约

### 2.1 新两步流程

```
模型: use_skill(name="prose-style")
  → 框架: resolveVisibleSkillByName → 解析 action 声明 → registerLoadedSkill(注入 sessionState)
  → observation: { skill, activated: true, actions: [{name, description, executorType, executable}] }
  → 框架(下一轮构建 messages 时): 检测 sessionState 新激活未注入的 skill → 注入 SKILL.md 全文 message

模型(下一轮, 上下文里已有 SKILL.md 全文): run_script(skill="prose-style", script="example_action", input={...})
  → 框架: findLoadedSkill → 找 script 对应 action → 校验 executor.type === browser_script
         → resolveBrowserScriptPath → context.runBrowserScript
  → observation: { skill, action, status, output }
```

### 2.2 工具名常量（workspace-tools.ts:33）

```ts
export const RUNTIME_WORKSPACE_TOOL_NAMES = {
  useSkill: "use_skill",       // 替换 skillLoad: "skill_load"
  runScript: "run_script",     // 替换 actionCall: "action_call"
  agentCall: "agent_call",
  workspaceRead: "workspace.read",
  // ... 其余不变
} as const
```

### 2.3 sessionState 契约扩展

`RuntimeWorkspaceToolSessionState`（workspace-tools.ts:172）新增注入追踪：

```ts
export interface RuntimeWorkspaceToolSessionState {
  loadedSkills: RuntimeLoadedSkill[]
  // 新增：记录已把 SKILL.md 全文注入到 messages 的 skill path，防同一 skill 重复注入
  injectedSkillPaths: string[]
}
```

`createRuntimeWorkspaceToolSessionState`（:254）同步初始化 `injectedSkillPaths: []`。

`RuntimeLoadedSkill` 复用现有结构（`{ skill, actions }`），不改。`registerLoadedSkill`（:1256）逻辑不变（仍按 path 去重 upsert）。

### 2.4 use_skill 契约（替换 loadSkillByName）

`use_skill(name)` 实现（原 `loadSkillByName` :1770 改造）：

1. `resolveVisibleSkillByName`（复用现有 :1060）→ 得到 skill。
2. `loadSkillEntryFile`（复用 :1091）→ 得到 SKILL.md file。
3. `parseActionDeclarations`（复用 :1106）→ 得到 actions + errors。
4. `registerLoadedSkill`（复用 :1256）→ 注册进 sessionState。
5. **不再** 把 file.content 作 observation 返回。
6. observation 返回：
```ts
{
  skill: { name, title, scope, agentId? },
  activated: true,
  actions: actions.map(a => ({
    name: a.name,
    description: a.description,
    // executor 体系只剩 browser_script 一种；非 browser_script 的 action 在
    // registry/use_skill 解析时即被拒（见 §4），这里 executorType 恒为 "browser_script"
    executorType: a.executor.type,
    executable: a.executor.type === "browser_script",
  })),
  // 不含 file.content
}
```
7. 注入时机：use_skill 本轮只注册 + 返回确认；**全文注入发生在该轮 tool 执行后、下一轮 model 调用前**（见 §2.6）。

### 2.5 run_script 契约（替换 validateSkillActionCall）

`run_script(skill, script, input)` 实现（原 `validateSkillActionCall` :1811 改造）：

1. `normalizeRequiredString(skill)` / `normalizeRequiredString(script)`（复用现有）。
2. `findLoadedSkill(sessionState, skill)`（复用 :1275）→ 找不到抛 **`SKILL_NOT_ACTIVATED`**（替换原 `SKILL_ACTION_NOT_LOADED`）。
3. `findDeclaredAction(loadedSkill, script)`（复用 :1290）→ 找不到抛 `ACTION_NOT_FOUND`（沿用）。
4. **executor 类型校验（新）**：
   - `action.executor.type === BROWSER_SCRIPT_EXECUTOR_TYPE` → 继续。
   - 否则抛 `ACTION_NOT_BROWSER_SCRIPT`，message 说明"该 action 不是 browser_script 类型；workspace 操作请直接用 workspace.read/write 等顶层工具，或写一个 browser_script 脚本编排多步操作"。
5. `validateActionInputSchema`（复用 :1309）。
6. `checkActionExecutorPolicy`（复用 :816，policy 恒 enabled，子4 再接通）。
7. `executeSkillAction` 收窄：**只保留 browser_script 分支（:1699-1760）**，移除 builtin/workspace_operation/platform_action 三个分支。executor 体系只剩 browser_script 一种（见 §4）。
8. `validateActionOutputSchema`（复用 :1384）。
9. observation 返回结构与原 action_call 一致（`{ skill, action, executor, input, output, status }`）。

> **script 参数语义**：`script` = action name（PRD 开放问题 Q3 决议，见 §5.3）。run_script 内部从 action 声明取 `executor.path`，经 `resolveBrowserScriptPath`（复用 :1536）映射到脚本路径。模型用 use_skill 后看到的 action 列表里的 name 直接传入。

### 2.6 SKILL.md 全文注入机制（PRD R1 核心，开放问题 Q1 决议）

**注入位置**：独立 user message，紧跟该轮 observation message 之后。两种循环统一用 user message（不合并进 observation，便于 provider 上下文清晰且兼容所有 provider——native 模式下中途插 system message 部分 provider 不支持）。

**注入内容**：
```
已激活 Skill「{skill.name}」。以下是该 Skill 的完整说明；遵循其指导，并使用 run_script 执行其声明的 browser_script action：

<SKILL.md 全文>
```

**注入时机与去重**：在每轮 `executeRuntimeWorkspaceToolCalls` 返回后、push 完 assistant+observation message 后，扫描 sessionState.loadedSkills，对每个 `path` 不在 `sessionState.injectedSkillPaths` 里的 skill，注入一条上述 user message，并把 path 加入 `injectedSkillPaths`。这样：
- 同一 skill 即使被多次 use_skill（registerLoadedSkill upsert 去重），只注入一次。
- 跨轮新激活的 skill 在激活后那轮的末尾注入，下一轮 model 调用前已就位。

**实现位置**：新增 `injectActivatedSkillMessages(messages, sessionState, workspaceFiles)` 辅助函数，在两个循环（native :1181 区段、text :1342 区段）push observation 后调用。函数读 `loadSkillEntryFile` 取全文（workspaceFiles 已在 context）。

**native 循环注入点**（index.ts:1181-1193 之后）：
```ts
// push assistant + tool messages 后
injectActivatedSkillMessages(runtimeMessages, workspaceToolSession, input.workspaceFiles!)
```

**text 循环注入点**（index.ts:1342-1352 之后）：
```ts
nextMessages = injectActivatedSkillMessages(nextMessages, workspaceToolSession, input.workspaceFiles)
```

> 注入函数返回新数组（text 模式保持不可变风格）或原地 push（native 模式 runtimeMessages 已是可变数组）。为统一，函数签名 `(messages: T[], state, files) => T[]`，native 侧 `runtimeMessages = injectActivatedSkillMessages(runtimeMessages, ...)`。

## 3. R3 registry 阶段解析 action 声明

### 3.1 contracts 扩展（runtime.ts:175）

```ts
export interface SkillActionSummary {
  name: string
  description: string
  executorType: string      // 恒为 "browser_script"（executor 体系只剩一种，见 §4）
  executable: boolean       // 恒为 true（registry 只产出 browser_script action）
}

export interface SkillRegistryEntry {
  // ... 现有字段
  actions?: SkillActionSummary[]          // 新增可选
  actionDeclarationErrors?: string[]      // 新增可选：围栏解析错误摘要（不抛，供 diagnostics）
}
```

### 3.2 registry.ts 改造

`buildSkillRegistryEntry`（:353-389）在现有 frontmatter 解析后，对 `parsed.body` 调 action 解析。但 `parseActionDeclarations` 当前在 workspace-tools.ts 且依赖 Runtime 类型——为避免 registry（contracts 层邻接）反向依赖 workspace-tools（runtime 层），采用以下分层：

- **registry.ts 内**新增轻量 `parseSkillActionSummaries(body: string): { actions: SkillActionSummary[], errors: string[] }`，只提取 name/description/executor.type，不做完整 Runtime 校验（不做 inputSchema/outputSchema 校验、不做 executor path 校验——那些在 use_skill 真正加载时由 workspace-tools 的 `parseActionDeclarations` 严格校验）。
- 该函数用同样的 `SKILL_ACTIONS_FENCE_PATTERN` 正则（在 registry.ts 内复制常量，或抽到共享 util）。围栏 JSON 解析失败的 action 计入 errors，不阻断 registry 构建。
- executor.type **只接受 `browser_script`**；`builtin` | `platform_action` | `workspace_operation` 均计入 errors（"executor type no longer supported: {type}"），该 action 不进 actions 列表（与 §4 彻底移除一致）。编排类需求由 browser_script 脚本承担（skill 脚本内串 workspace SDK 调用）。

**性能（开放问题 Q2 决议）**：在 `buildSkillRegistryEntry` 阶段就解析（构建时一并完成），因为 registry 构建已遍历所有 SKILL.md 且 body 已在内存，多一次 O(n) 正则扫描 + 围栏 JSON.parse，skill 数 < 50、文件 < 10KB，增量 < 1ms。不做跨 turn 缓存（registry 本就是 per-turn 一次性构建，跨 turn 需文件版本号比对，MVP 不值）。只解析 visible skill 范围由 `filterSkillsForAgent` 在 registry 构建后过滤，构建阶段全解析成本仍可忽略，代码更简单。

### 3.3 formatSkillIndex 改造（index.ts:343）

展示每个 skill 的 action 列表。registry 只产出 browser_script action，所以展示统一为：

```
- prose-style [shared]: 文风改写 skill。 triggers=...
    actions:
    - example_action (browser_script, 用 run_script 执行)
```

实现：`skill.actions?.length` 时追加 `actions:` 子列表，每行 `    - {name} ({executorType}, 用 run_script 执行)`（executorType 恒为 browser_script，文案固定为"用 run_script 执行"）。`skill.actionDeclarationErrors?.length` 时追加一行警告（供调试，不阻断；非 browser_script 的 action 声明会出现在这里，提示 skill 作者该 executor 已废弃）。

## 4. R4 移除 builtin / platform_action / workspace_operation executor

> **决议升级**：原 design 保留 workspace_operation 作"描述标签"，经讨论后改为**彻底移除**。executor 体系只剩 `browser_script` 一种。编排类需求（多步 workspace 操作）由 browser_script 脚本承担——skill 脚本内串 workspace SDK 调用（`tsian.workspace.read` → `tsian.workspace.write`），模型 `run_script` 一次调用完成编排。单次 workspace 操作仍由顶层 `workspace.read`/`workspace.write` 工具直接做，不经 skill action 绕一层。理解 B（声明式宏操作 DSL）不立项——agent 多几次调用比引入编排引擎更简单。

### 4.1 workspace-tools.ts 裁剪

- 移除 `BUILTIN_ACTION_EXECUTORS`（:1570-1582）、`DEFAULT_ACTION_EXECUTOR`（:223）。
- `executeSkillAction`（:1610-1768）**只保留 browser_script 分支（:1699-1760）**，移除 builtin（:1616-1630）、workspace_operation（:1632-1651）、platform_action（:1653-1697）三个分支。函数体收窄为单一 browser_script 路径 + 末尾 `ACTION_EXECUTOR_UNSUPPORTED` 兜底。
- `normalizeActionExecutorReference`（:641-755）移除 builtin 默认分支（:748）、workspace_operation 分支（:676-726）、platform_action 校验（:666-672）。**只接受 `BROWSER_SCRIPT_EXECUTOR_TYPE`**；对其它 type 抛 `ACTION_EXECUTOR_INVALID`（"executor type no longer supported: {type}, only browser_script is supported"）。`value === undefined` 时不再返回 `DEFAULT_ACTION_EXECUTOR`（builtin 默认已移除），改为抛 `ACTION_EXECUTOR_INVALID`（action 声明必须显式指定 `executor.type="browser_script"`）。
- `shouldCheckActionExecutorPolicy`（:809-814）移除 builtin/platform_action/workspace_operation 判断项，**只保留 browser_script**（供子4 接通）。
- `workspaceOperationRequestFromExecutor`（:1584-1598）移除（只服务已删的 workspace_operation 分支）；`workspaceOperationRequestFromToolCall`（:1600-1608）保留（仍服务顶层 workspace.* 工具）。

### 4.2 platform-host capability 裁剪

- 移除 `createAgentRuntimePlatformActionRunner`（:1216-1234）的 agent 注入点（:1586, :1875）。
- `runAgentRuntimeStagedPlatformAction`（:1183-1214）：grep 确认仅 `createAgentRuntimePlatformActionRunner` 调用 → 一并移除。
- `RuntimeWorkspaceToolExecutionContext.runPlatformAction`（:162, :191）字段移除；native/text 循环传参（:1156, :1325）移除。
- `capabilities.runBrowserScript` **保留**（run_script 的核心执行路径，复用 `createBrowserSkillScriptRunner`）。
- **保留** `normalizeWorkspaceActionRequest`（:713）——它仍服务 `playFrontendBridge.platform.runAction`（:1094 前端通道），与 agent executor 路径无关。

### 4.3 actionExecutorPolicy 接口保留

`RuntimeActionExecutorPolicy` 类型、`checkActionExecutorPolicy`、`defaultActionExecutorPolicy` 保留（子4 接通）。本任务后 policy 检查范围只剩 browser_script（其它 executor 已移除）。

## 5. 开放问题决议（PRD §开放问题）

### 5.1 Q1 — skill 全文注入下一轮的具体位置

**决议**：独立 user message，紧跟该轮 observation message 之后。统一用 user message（兼容所有 provider，避免 native 模式插 system message 的 provider 兼容问题）。内容前缀说明"已激活 Skill「X」，遵循其指导用 run_script 执行"，后接 SKILL.md 全文。去重靠 `sessionState.injectedSkillPaths`。

**未选 system message 的理由**：native function-calling 循环里 messages 已含 assistant/tool role，中途插 system message 在部分 provider（如某些 OpenAI 兼容端点）会被拒或忽略；user message 语义上也可表达"框架给模型的补充上下文"，且当前 text 协议本就用 user message 传 observation，行为一致。

### 5.2 Q2 — registry 解析 action 的性能影响

**决议**：在 `buildSkillRegistryEntry` 构建时一并解析（不延后到 filter 后），增量 < 1ms 可忽略。不做跨 turn 缓存。详见 §3.2。

### 5.3 Q3 — run_script 的 script 参数语义

**决议**：`script` = action name。run_script 内部从已激活 skill 的 action 声明里按 name 找到 action，取其 `executor.path`，经 `resolveBrowserScriptPath` 映射到脚本路径。模型用 use_skill observation 里看到的 action name 直接传入，最自然，且与"registry 阶段 action 对模型可见"（R3）闭环。

### 5.4 Q4 — workspace_operation action 声明的处理

**决议（升级）**：workspace_operation **彻底移除**，不再保留作"描述标签"。registry 解析时 `workspace_operation` 与 `builtin`/`platform_action` 同等处理——计 `actionDeclarationErrors`（"executor type no longer supported: workspace_operation"），不进 actions 列表。run_script 只执行 browser_script。编排类需求由 browser_script 脚本承担（skill 脚本内串 workspace SDK 调用），单次 workspace 操作由顶层工具直接做。这是对原"保留类型标签"方案的简化——更干净的 executor 体系（只剩一种）比"保留一个不执行的类型"更易理解。

## 6. 兼容性与迁移

- **无 SKILL.md 数据迁移**：仓库内无 runtime SKILL.md 声明 `tsian-actions` 围栏（grep 确认），builtin/platform_action executor 无实际数据依赖。玩家 save / card-content 里的 SKILL.md 若声明了 builtin/platform_action executor，registry 解析时计 `actionDeclarationErrors`，use_skill 时 `parseActionDeclarations` 抛 `ACTION_EXECUTOR_INVALID`——明确报错而非静默。
- **向前兼容**：旧 session transcript（含 skill_load/action_call 工具名）是历史记录，不重放，无需迁移。
- **prompt 文案**：`buildWorkspaceToolInstructions`（index.ts:419-499）大量引用 skill_load/action_call，全部重写为两步流程（use_skill → run_script）说明。这是用户可见行为变化，需在实测验收时确认模型理解新流程。

## 7. 权衡

| 决策 | 选择 | 权衡 |
|---|---|---|
| 注入载体 | user message | 牺牲一点"指令性上下文属 system"的语义纯洁性，换 provider 兼容性 + 与 text 协议 observation 一致 |
| registry 解析时机 | 构建时全解析 | 牺牲对 disabled skill 的无谓解析（极小成本），换代码简单 + filter 后无需二次遍历 |
| script 参数 | action name | 模型需先 use_skill 看 action 列表才能 run_script（两步），但这是 B 方案本意（声明意图后框架展开） |
| workspace_operation 彻底移除 | 只留 browser_script 一种 executor | 牺牲结构化"workspace 操作意图"声明，换最干净的 executor 体系；编排需求由 browser_script 脚本承担（脚本内串 SDK 调用），单次操作用顶层工具 |
| 声明式宏操作 DSL（理解 B）| 不立项 | agent 多几次工具调用比引入编排引擎更简单；若未来编排需求高频再立独立项 |
| SkillRegistryEntry.actions 进 contracts | 进 | 跨包（contracts 被 platform-web 消费），registry 返回类型需 contracts 定义；解析逻辑留 registry.ts 不反向依赖 workspace-tools |

## 8. 运维与回滚

- **回滚点**：每个 R 独立提交，回滚单 R 不破坏其它（R1/R2/R3/R4 有序，见 implement.md）。最危险是 R1+R2 同时改工具循环注入——若注入逻辑有 bug 导致模型上下文错乱，回滚到 R3/R4 完成的中间态（registry 已解析 action、executor 已裁剪，但工具仍是 skill_load/action_call 旧名）可临时止血。
- **验收**：`npm run build`（含 contracts）通过；真实 API 实测 use_skill 后下一轮模型能看到 SKILL.md 全文（检查 transcript/messages），run_script 执行 browser_script 成功。
- **diagnostics**：`skill_loaded`/`action_called` trace 事件类型保留（run_script 复用 action_called 语义或新增 `script_run`，倾向复用 action_called 减少前端改动——子3 再统一 trace 事件命名）。

## 9. 与下游子任务的接口

- **子3（tool-rename-and-glob）**：依赖本任务定稿的 use_skill/run_script schema。本任务产出 schema 后，子3 在此基础上补返回值描述 + 示例。
- **子4（tool-executor-policy）**：依赖本任务精简后的 executor 范围（**只剩 browser_script**）。本任务保留 policy 接口，子4 接通 platform-host 注入实际 policy——约束哪些 skill 的 browser_script 可执行。browser_script 承担编排职责后是重权限路径，子4 的权限粒度更必要。
- **子2（tool-token-budget）**：与本任务无直接依赖，但本任务的注入机制会增加单轮 message 体积（SKILL.md 全文），子2 的 token 预算需把注入体积纳入估算。
