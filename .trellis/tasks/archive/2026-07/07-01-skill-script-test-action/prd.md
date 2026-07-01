# Skill 脚本测试工具 + 错误信息透传

## Goal

让桌面助手 agent 能在项目中直接测试 Skill 的 browser_script action 并获得结构化错误反馈，形成"写脚本→跑脚本→看错误→改脚本"的闭环。当前助手只能通过 `use_skill` + `run_script` 间接跑脚本，失败时只看到笼统的 `BROWSER_SCRIPT_ERROR` / `BROWSER_SCRIPT_FAILED`，无法定位是语法错误、运行时 throw、SDK 调用失败还是超时。

## Background

- 脚本主要由助手 agent 在项目中通过虚拟文件系统在线创建和编辑（`workspace.write`）。
- 现有执行链：`use_skill` 激活 → `run_script` 调用 → `createBrowserSkillScriptRunner` → Worker 内 `new AsyncFunction(source)` 执行。
- 错误在 `errorPayload()`（Worker 内）中被统一归为 `BROWSER_SCRIPT_ERROR`，不区分 SyntaxError / TypeError / 脚本自定义 `fail()` / SDK RPC 失败。`worker.onerror` 只给 `message + lineno + colno`，无 stack。
- `run_script` 的 `toolError` 把原始 `scriptError` 放在 details 里，但顶层 code/message 是泛化的，agent 难以据此判断失败原因和修正方向。
- 助手 agent 已有 `run_script` 能力（runtime tool，非 platformTools 网关），但需要先 `use_skill` 激活 Skill 才能调用。

## Confirmed Facts From Repository

- 平台工具注册模式（`inspect_frontend` 先例）：`RUNTIME_WORKSPACE_TOOL_NAMES`（`workspace-tools-types.ts`）注册名字 → `tool-schemas.ts` 加 schema → `workspace-tools.ts` 加 dispatch 分支 → `AGENT_PLATFORM_TOOL_NAMES`（`permissions.ts`）加名字 → `platform-host/index.ts` 注入 runner 能力。
- `createBrowserSkillScriptRunner` 签名：`({ workspaceTransaction, signal?, emitTrace? })` → `(request, executorContext?) → Promise<PlatformActionResult>`。request 含 `skillName/skillPath/actionName/scriptPath/input/timeoutMs/configItems`。
- 脚本执行器已有完整 RPC 回路（Worker → 主线程 → workspace 操作 → 返回），`test_skill_script` 可直接复用。
- `errorPayload()` 位于 `browser-skill-script-executor.ts` Worker 源码内（line 81-95），是所有脚本 throw 的统一出口。
- 主线程 `script-result` 错误处理在 line 778-794，`worker.onerror` 在 line 732-742。
- `run_script` 错误转 toolError 在 `workspace-tools.ts` line 1655-1664。
- 助手 agent 的 `platformTools` 在 `local-assistant-files.ts` 的 `defaultAssistantConfig` 中配置。

## Requirements

### R1: 错误信息透传（`browser-skill-script-executor.ts`）

- `errorPayload()` 区分错误类型：SyntaxError（`new AsyncFunction` parse 失败）→ `BROWSER_SCRIPT_SYNTAX_ERROR` + line/col；脚本自定义 throw（有 `.code`）→ 原始 code 透传；普通 Error → `BROWSER_SCRIPT_RUNTIME_ERROR` + error.name。
- 所有错误返回截断的 `errorStack`（复用 `TRACE_ERROR_STACK_LIMIT` 模式，上限 1000 字符）。
- `worker.onerror` 错误也带 stack（如果 event.error 有 stack）。
- SDK RPC 失败错误透传原始 op + code（已有，确认不丢）。

### R2: `test_skill_script` 平台工具

- 新增 `test_skill_script` 平台工具，注册到 `AGENT_PLATFORM_TOOL_NAMES`。
- 工具入参：`{ skillName: string, actionName: string, input: object }`。
- 不要求先 `use_skill` 激活——直接从 workspace 文件中定位 Skill + Action + 脚本路径。
- 复用当前 turn 的 workspace 事务（与 `run_script` 一致：脚本写入走 staged transaction，turn 成功才 commit）。
- 返回结构化结果：`{ ok: true, output }` 或 `{ ok: false, error: { code, message, name?, stack?, line?, column?, details? } }`。
- 错误信息直接来自 R1 的透传改造，不二次泛化。
- 助手 agent 默认启用此工具（`defaultAssistantConfig` 的 `platformTools.enabled` 加入 `test_skill_script`）。

### R3: 工具 schema 和 description

- `tool-schemas.ts` 加 `testSkillScriptSchema`，description 面向 agent：说明用途是测试 Skill 的 browser_script action、不需要先 use_skill、返回结构化错误用于调试。
- 工具 description 要引导 agent：脚本失败时根据 error.code 判断是语法错误（改脚本语法）、运行时错误（改脚本逻辑）、SDK 错误（检查 SDK 调用参数）还是超时（优化脚本性能或增加 timeoutMs）。

## Acceptance Criteria

- [ ] `errorPayload` 对 SyntaxError 返回 `BROWSER_SCRIPT_SYNTAX_ERROR` + line/col + stack
- [ ] `errorPayload` 对有 `.code` 的自定义错误返回原始 code（不覆盖为 `BROWSER_SCRIPT_ERROR`）
- [ ] `errorPayload` 对普通 Error 返回 `BROWSER_SCRIPT_RUNTIME_ERROR` + error.name + stack
- [ ] 所有错误包含截断的 `errorStack`（≤1000 字符）
- [ ] `test_skill_script` 工具可被助手 agent 调用，不需要先 `use_skill`
- [ ] `test_skill_script` 成功时返回 `{ ok: true, output }`
- [ ] `test_skill_script` 失败时返回结构化错误（code/message/name/stack/details），agent 能据此判断失败类型
- [ ] 助手 agent 默认配置含 `test_skill_script`
- [ ] `npm run build --workspace platform-web` 通过
- [ ] `npm run build --workspace contracts` 通过（如有 contract 变更）

## Out Of Scope

- 执行器架构替换（AsyncFunction → ES Module Worker）——不做
- esbuild 构建管线 for 脚本——不做
- `tsian.llm.call` / `tsian.fetch` / `tsian.cache` SDK 扩展——不做，等真实需求验证后再加
- 错误分层的大重构——只做 errorPayload 透传 + test_skill_script 结构化返回
- 现有内置脚本迁移——不受影响，错误透传对现有脚本自动生效

## Open Questions

（无——范围已在对话中明确）
