# Implement — 工具与 skill 解耦重构

> 执行计划。按 R 顺序实施，每个 R 是独立提交单元。design.md 是技术依据，本文件是有序清单 + 验证 + 回滚点。

## 验证命令

| 用途 | 命令 |
|---|---|
| contracts 构建 | `npm run build:contracts` |
| platform-web 构建（含 vue-tsc 类型检查） | `npm run build:web` |
| 全量构建（本任务验收） | `npm run build:contracts && npm run build:web` |

> 无单元测试套件（仓库无 test 脚本）。类型安全靠 `vue-tsc -b`；行为正确性靠真实 API 实测（§验收）。

## 风险文件

| 文件 | 风险 | 回滚锚 |
|---|---|---|
| `workspace-tools.ts` | 工具名常量 + executor 三分支裁剪（builtin/workspace_operation/platform_action）+ sessionState，改动最密集 | 按 R 分段提交，单 R 回滚不破坏其它 |
| `index.ts` | 两个工具循环注入逻辑，注入 bug 导致模型上下文错乱 | R1 注入逻辑独立函数 `injectActivatedSkillMessages`，可单独回滚 |
| `registry.ts` + `contracts/runtime.ts` | R3 跨包类型扩展，contracts 先于 platform-web 构建 | contracts 先提交，platform-web 后提交 |
| `platform-host/index.ts` | R4 移除 runPlatformAction capability + runAgentRuntimeStagedPlatformAction，遗漏引用导致类型错 | 全量构建兜底；runBrowserScript 保留 |

## 执行清单

### R3 — registry 阶段解析 action 声明（先做，contracts 先行）

> 先做 R3：它是纯增量（加 actions 字段），不破坏现有 skill_load/action_call 路径，可独立验收 + 为 R1/R2 提供可见的 action 列表。

- [ ] **R3.1** `packages/contracts/src/runtime.ts`：新增 `SkillActionSummary` 接口；`SkillRegistryEntry` 加可选 `actions?: SkillActionSummary[]` 与 `actionDeclarationErrors?: string[]`。
- [ ] **R3.2** `apps/platform-web/src/agent-runtime/registry.ts`：新增 `parseSkillActionSummaries(body)`——用 `SKILL_ACTIONS_FENCE_PATTERN`（复制常量或抽 util）扫描 body 围栏，提取每个 action 的 name/description/executor.type；executor.type **只接受 `browser_script`**，`builtin`/`platform_action`/`workspace_operation` 均计 errors 不产出（"executor type no longer supported: {type}"）；JSON 解析失败计 errors 不抛。
- [ ] **R3.3** `registry.ts` `buildSkillRegistryEntry`（:353）：调 `parseSkillActionSummaries(parsed.body)`，结果挂到 entry 的 `actions` / `actionDeclarationErrors`（空数组时不挂，保持 entry 精简）。
- [ ] **R3.4** `apps/platform-web/src/agent-runtime/index.ts` `formatSkillIndex`（:343）：`skill.actions?.length` 时追加 `actions:` 子列表，每行 `    - {name} (browser_script, 用 run_script 执行)`（executorType 恒为 browser_script）；`actionDeclarationErrors?.length` 时追加警告行。
- [ ] **R3.5** 验证：`npm run build:contracts && npm run build:web` 通过。

### R4 — 移除 builtin / platform_action / workspace_operation executor（先做裁剪，再做工具改名）

> R4 先于 R1/R2：executor 裁剪是 use_skill/run_script 收窄 executor 范围的前提，且独立于工具改名。**workspace_operation 也彻底移除**（design §4 升级决议）——executor 体系只剩 browser_script 一种，编排由 browser_script 脚本承担。

- [ ] **R4.1** `workspace-tools.ts`：移除 `BUILTIN_ACTION_EXECUTORS`（:1570）、`DEFAULT_ACTION_EXECUTOR`（:223）。
- [ ] **R4.2** `workspace-tools.ts` `normalizeActionExecutorReference`（:641）：移除 builtin 默认分支（:748）、workspace_operation 分支（:676-726）、platform_action 校验（:666）。**只接受 `BROWSER_SCRIPT_EXECUTOR_TYPE`**；对其它 type 抛 `ACTION_EXECUTOR_INVALID`（"executor type no longer supported: {type}, only browser_script is supported"）。`value === undefined` 抛同错（action 声明必须显式 `executor.type="browser_script"`）。
- [ ] **R4.3** `workspace-tools.ts` `executeSkillAction`（:1610）：移除 builtin（:1616-1630）、workspace_operation（:1632-1651）、platform_action（:1653-1697）三分支；**只保留 browser_script（:1699-1760）** + 末尾 `ACTION_EXECUTOR_UNSUPPORTED` 兜底。
- [ ] **R4.4** `workspace-tools.ts` `shouldCheckActionExecutorPolicy`（:809）：移除 builtin/platform_action/workspace_operation 判断项，只保留 browser_script。
- [ ] **R4.4b** `workspace-tools.ts` `workspaceOperationRequestFromExecutor`（:1584）移除（只服务已删分支）；`workspaceOperationRequestFromToolCall`（:1600）保留（服务顶层 workspace.* 工具）。
- [ ] **R4.5** `workspace-tools.ts` `RuntimeWorkspaceToolExecutionContext`（:162, :191）：移除 `runPlatformAction` 字段。
- [ ] **R4.6** `platform-host/index.ts`：移除 `createAgentRuntimePlatformActionRunner`（:1216）、`runAgentRuntimeStagedPlatformAction`（:1183，确认无其它调用方后）、两处 capability 注入（:1586, :1875）。
- [ ] **R4.7** `index.ts` AgentRuntimeCapabilities 类型：移除 `runPlatformAction` 字段；native/text 循环传参（:1156, :1325）移除。
- [ ] **R4.8** 验证：`npm run build:contracts && npm run build:web` 通过（类型系统兜底捕获遗漏引用）。

### R1 — skill_load → use_skill（模型声明意图，框架下轮注入全文）

- [ ] **R1.1** `workspace-tools.ts` `RUNTIME_WORKSPACE_TOOL_NAMES`（:33）：`skillLoad: "skill_load"` → `useSkill: "use_skill"`。
- [ ] **R1.2** `workspace-tools.ts` `RuntimeWorkspaceToolSessionState`（:172）：加 `injectedSkillPaths: string[]`；`createRuntimeWorkspaceToolSessionState`（:254）初始化。
- [ ] **R1.3** `workspace-tools.ts`：`loadSkillByName`（:1770）改造为 `activateSkillByName`——保留 resolve/loadSkillEntryFile/parseActionDeclarations/registerLoadedSkill，**移除** observation 里的 `file.content`；observation 改为 `{ skill, activated: true, actions: [{name, description, executorType, executable}] }`；trace 事件 `skill_loaded` 保留。
- [ ] **R1.4** `workspace-tools.ts`：新增 `injectActivatedSkillMessages` 导出函数——签名 `(messages, sessionState, workspaceFiles) => messages`；扫描 `sessionState.loadedSkills`，对 `path` 不在 `injectedSkillPaths` 的 skill，`loadSkillEntryFile` 取全文，push 一条 user message（内容见 design §2.6），把 path 加入 `injectedSkillPaths`。无新激活时原样返回。
- [ ] **R1.5** `index.ts` native 循环（:1193 observation push 后）：调 `injectActivatedSkillMessages(runtimeMessages, workspaceToolSession, input.workspaceFiles!)`。
- [ ] **R1.6** `index.ts` text 循环（:1352 nextMessages 赋值后）：`nextMessages = injectActivatedSkillMessages(nextMessages, workspaceToolSession, input.workspaceFiles)`。
- [ ] **R1.7** `index.ts` `executeRuntimeWorkspaceToolCall`（:1968）：`call.name === RUNTIME_WORKSPACE_TOOL_NAMES.skillLoad` → `useSkill`，调 `activateSkillByName`。
- [ ] **R1.8** `workspace-tools.ts` `PARALLEL_TOOL_NAMES`（:2066）：`skillLoad` → `useSkill`（use_skill 只读 sessionState 注册 + 不改 workspace，并行安全）。
- [ ] **R1.9** `tool-schemas.ts`：`skillLoadSchema`（:44）→ `useSkillSchema`，name 用 `RUNTIME_WORKSPACE_TOOL_NAMES.useSkill`，description 重写为"声明使用某 skill 的意图；框架下一轮注入该 skill 全文并注册其 action，返回 action 列表"，parameters 不变（`{name}`）；`buildEnabledToolSchemas`（:375）引用改名。
- [ ] **R1.10** `index.ts` prompt 文案 `buildWorkspaceToolInstructions`（:419-499）：所有 `skillLoad` 引用改为 `useSkill`；重写说明为两步流程（use_skill 声明意图 → 框架下轮注入全文 → 用 run_script 执行 browser_script action）；移除"不要用 workspace.read 读 SKILL.md，用 skill_load"的旧指引（改为"用 use_skill 激活后框架自动注入全文，不要手动 workspace.read SKILL.md"）。
- [ ] **R1.11** 验证：`npm run build:contracts && npm run build:web` 通过。

### R2 — action_call → run_script（直接执行 browser_script）

- [ ] **R2.1** `workspace-tools.ts` `RUNTIME_WORKSPACE_TOOL_NAMES`（:33）：`actionCall: "action_call"` → `runScript: "run_script"`。
- [ ] **R2.2** `workspace-tools.ts`：`validateSkillActionCall`（:1811）改造为 `executeRunScript`——参数 `skill`/`script`/`input`（`action` → `script`）；`findLoadedSkill` 找不到抛 `SKILL_NOT_ACTIVATED`（替换 `SKILL_ACTION_NOT_LOADED`）；`findDeclaredAction` 找不到沿用 `ACTION_NOT_FOUND`；**新增** executor 类型校验：非 browser_script 抛 `ACTION_NOT_BROWSER_SCRIPT`（message 提示"workspace 操作用顶层 workspace 工具，或写 browser_script 脚本编排多步操作"）；其余 validateActionInputSchema/checkActionExecutorPolicy/executeSkillAction(browser_script 分支)/validateActionOutputSchema 保留。
- [ ] **R2.3** `index.ts` `executeRuntimeWorkspaceToolCall`（:1975）：`call.name === RUNTIME_WORKSPACE_TOOL_NAMES.actionCall` → `runScript`，调 `executeRunScript`。
- [ ] **R2.4** `workspace-tools.ts` `PARALLEL_TOOL_NAMES`（:2066）：确认 `runScript` **不**加入并行集（browser_script 有副作用/超时，保持 serial，与原 actionCall 一致）。
- [ ] **R2.5** `tool-schemas.ts`：`actionCallSchema`（:61）→ `runScriptSchema`，name 用 `runScript`，description 重写为"执行已激活 skill 的 browser_script action"，parameters 改为 `{skill, script, input}`（`action` → `script`，description 说明 script 是 use_skill 返回的 action name）；`buildEnabledToolSchemas`（:375）引用改名。
- [ ] **R2.6** `index.ts` prompt 文案：所有 `actionCall` 引用改为 `runScript`；重写说明为"用 run_script 执行已 use_skill 激活的 skill 的 browser_script action；单次 workspace 操作用顶层 workspace 工具，多步编排写 browser_script 脚本"；移除"内置/platform_action/workspace_operation executor"的旧说明。
- [ ] **R2.7** 验证：`npm run build:contracts && npm run build:web` 通过。

### 收尾

- [ ] **C1** 全量 grep 残留：`grep -rn "skill_load\|action_call\|skillLoad\|actionCall\|BUILTIN_ACTION_EXECUTORS\|runPlatformAction\|SKILL_ACTION_NOT_LOADED\|workspaceOperationRequestFromExecutor\|WORKSPACE_OPERATION_EXECUTOR_TYPE" apps/platform-web/src packages/contracts/src` 应只剩注释/历史 trace 事件名（若有）。确认 `WORKSPACE_OPERATION_EXECUTOR_TYPE` 常量与 workspace_operation executor 分支已删（顶层 workspace.* 工具的 workspaceOperationRequestFromToolCall 保留）。
- [ ] **C2** `npm run build:contracts && npm run build:web` 最终通过。
- [ ] **C3** 真实 API 实测：构造一个声明 `tsian-actions` browser_script action 的 runtime SKILL.md（放测试 save 的 skills/ 下），模型 use_skill 后检查下一轮 messages 含 SKILL.md 全文，run_script 执行 browser_script 返回 output。
- [ ] **C4** 回归实测：模型在不需 skill 的普通对话里不误调 use_skill；workspace 读写顶层工具正常。

## task.py start 前检查

- [ ] design.md 已完成（4 开放问题已决议）。
- [ ] implement.md 已完成（有序清单 + 验证命令）。
- [ ] implement.jsonl / check.jsonl 已配 spec 引用（1.3）。
- [ ] 用户审查通过 design.md + implement.md。
