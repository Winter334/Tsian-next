# PRD — 权限策略接通

> 父任务：`06-19-tool-runtime-performance`。**依赖子1（tool-skill-decouple）**——子1 精简 executor 后（移除 builtin/platform_action，保留 workspace_operation/browser_script），权限策略范围更清晰。本任务给 browser_script 执行权限粒度。

## 目标与用户价值

接通当前预留但未接通的 `actionExecutorPolicy` 钩子，给 `browser_script` 执行权限粒度——控制哪些 skill 的脚本可执行，而非当前"恒 enabled"的粗放状态。

用户价值：
- **安全收敛**：browser_script 起 Web Worker 执行 skill 目录下的脚本（可访问 workspace/fetch），当前任何可见 skill 声明的 browser_script 都被允许执行（仅靠 skill 是否对 agent 可见来限制）。接通策略后，可按 skill/action 维度控制脚本执行权限，减少"不可信 skill 脚本被随意执行"的风险。
- **权限粒度**：从"skill 可见即脚本可执行"细化到"skill 可见但脚本执行需策略允许"。

## 背景（来自勘察）

- `actionExecutorPolicy` 钩子已预留（`workspace-tools.ts:816-884` `checkActionExecutorPolicy`，`shouldCheckActionExecutorPolicy` `:809` 判定四类 executor 都过策略）。
- 但 platform-host **未注入** `actionExecutorPolicy`（grep `platform-host/index.ts` 无匹配），走 `defaultActionExecutorPolicy`（`:775-780`）恒返回 `{ enabled: true, source: "default" }`。
- 设计文档 `archive/06-18-agent-tool-permission-runtime-enforcement/prd.md:21` 明确把接通列为待办。
- 子1 精简 executor 后：builtin/platform_action 移除，只剩 workspace_operation（不经 run_script 执行）+ browser_script（经 run_script 执行）。**策略主要约束 browser_script**（workspace_operation 由顶层工具权限约束，不在这里）。

## 需求

### R1 接通 actionExecutorPolicy 注入

- platform-host 的 `createAgentRuntimeCapabilities`（或等价注入点）注入 `actionExecutorPolicy`，不再依赖 `defaultActionExecutorPolicy` 恒 enabled。
- 策略来源：从 agent 配置 / skill 配置 / 平台设置读取（具体来源 design.md 定，倾向从 agent 的权限配置或 skill 的 trust 标记派生）。

### R2 browser_script 执行权限粒度

- `run_script`（子1 新工具）执行 browser_script 前，过 `checkActionExecutorPolicy` 检查该 skill 的该 action 是否允许执行。
- 不允许时返回明确错误（如 `BROWSER_SCRIPT_NOT_PERMITTED` + 原因），不执行。
- **策略维度**：按 skill + action 维度判断（哪些 skill 的哪些 action 的 browser_script 可执行）。粗粒度可按 skill（整个 skill 的脚本可/不可），细粒度按 action（skill 内特定 action 可/不可）。**倾向按 skill 粒度**（MVP，design.md 定）。

### R3 策略配置来源

- **倾向方案**：从 agent 配置的权限配置（`deriveAgentRuntimePermissionProfile` 现有体系）派生——agent 的 permission profile 决定它可执行哪些 skill 的 browser_script。
- 或从 skill 的 trust 标记（skill frontmatter 加 `trusted: boolean`？）派生——可信 skill 的脚本可执行，不可信的不允许。
- 或从平台设置（玩家在控制面板配置"允许执行哪些 skill 的脚本"）派生。
- **MVP 倾向**：从 agent permission profile 派生（复用现有权限体系，不新增配置面）。design.md 评估并定。

## 验收标准

- [ ] `actionExecutorPolicy` 由 platform-host 注入，不再恒 enabled。
- [ ] `run_script` 执行 browser_script 前过策略检查；不允许时返回 `BROWSER_SCRIPT_NOT_PERMITTED` 错误，不执行。
- [ ] 策略按 skill（或 skill+action）维度判断，非全局开/关。
- [ ] 策略配置来源明确（agent permission profile / skill trust 标记 / 平台设置之一）。
- [ ] `npm run build`（含 contracts）通过。
- [ ] 真实 API 实测：不被允许的 skill 脚本执行时返回权限错误；被允许的正常执行。

## 明确不做

- 不做 workspace_operation 的执行权限（由顶层工具 read/write 等的权限约束，不在这里）。
- 不做 platform_action 的权限（子1 移除 platform_action executor）。
- 不做精细的脚本沙箱增强（browser_script 的 Web Worker 沙箱机制不动，只加执行许可判断）。
- 不做脚本执行审计日志（后续演进）。

## 依赖

- 上游：子1（tool-skill-decouple）——executor 精简后策略范围清晰（主要约束 browser_script）；run_script 新工具的执行路径。
- 下游：无。

## 开放问题

- 策略配置来源：agent permission profile / skill trust 标记 / 平台设置？MVP 倾向 agent permission profile，design.md 评估。
- 策略粒度：按 skill 还是按 skill+action？MVP 倾向按 skill，design.md 定。
- 策略默认值：默认允许（宽松，现状行为）还是默认拒绝（严格，需显式允许）？倾向默认允许（不破坏现有 skill 行为），design.md 定。
