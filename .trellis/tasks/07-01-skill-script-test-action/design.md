# Design — Skill 脚本测试工具 + 错误信息透传

## 架构总览

```
助手 agent
  │  tool call: test_skill_script({ skillName, actionName, input })
  ▼
workspace-tools.ts executeRuntimeWorkspaceToolCalls()
  │  分支: call.name === "test_skill_script"
  │  → context.runTestSkillScript(normalizeTestSkillScriptArguments(call.arguments))
  ▼
platform-host/index.ts runTestSkillScript()
  │  ① 从 workspaceFiles 定位 Skill（skills/<skillName>/SKILL.md）
  │  ② 解析 SKILL.md tsian-actions block，找 actionName 对应的 action 声明
  │  ③ 解析 executor.path → scriptPath（相对 skill 目录）
  │  ④ 校验 scriptPath 在 skill 目录内 + 文件存在
  │  ⑤ 调 context.runBrowserScript({ skillName, skillPath, actionName, scriptPath, input, timeoutMs })
  ▼
browser-skill-script-executor.ts createBrowserSkillScriptRunner()
  │  现有链路不变：读脚本源码 → resolveAndInlineImportScripts → Worker 执行
  │  改造点：errorPayload() 错误分层透传
  ▼
返回 PlatformActionResult → test_skill_script observation
```

## 变更清单

### 1. `browser-skill-script-executor.ts` — errorPayload 错误分层

Worker 源码内的 `errorPayload(error)` 函数（line 81-95）改造：

```js
function errorPayload(error) {
  if (isRecord(error)) {
    var name = typeof error.name === "string" ? error.name : "Error";
    var message = typeof error.message === "string" ? error.message : "Browser script failed.";
    var stack = typeof error.stack === "string" ? error.stack.slice(0, 1000) : null;
    var details = error.details === undefined ? null : toJsonValue(error.details);
    // 分层：有 .code 的自定义错误（脚本 fail()）→ 原始 code 透传
    if (typeof error.code === "string" && error.code) {
      return { code: error.code, name: name, message: message, stack: stack, details: details };
    }
    // SyntaxError → 专属 code（new AsyncFunction parse 失败）
    if (name === "SyntaxError") {
      return { code: "BROWSER_SCRIPT_SYNTAX_ERROR", name: name, message: message, stack: stack, details: details };
    }
    // 普通 Error → 运行时错误
    return { code: "BROWSER_SCRIPT_RUNTIME_ERROR", name: name, message: message, stack: stack, details: details };
  }
  return { code: "BROWSER_SCRIPT_RUNTIME_ERROR", name: "Error", message: String(error), stack: null, details: null };
}
```

主线程 `script-result` 错误处理（line 778-794）也透传 `stack`：

```ts
const error = isRecord(message.error) ? message.error : {}
settle(actionError(
  typeof error.code === "string" ? error.code : "BROWSER_SCRIPT_FAILED",
  typeof error.message === "string" ? error.message : "Browser script failed.",
  {
    scriptPath: request.scriptPath,
    ...(error.name === undefined ? {} : { name: toJsonValue(error.name) }),
    ...(error.stack === undefined ? {} : { stack: toJsonValue(error.stack) }),
    ...(error.details === undefined ? {} : { details: toJsonValue(error.details) }),
  },
))
```

`worker.onerror`（line 732-742）补充 stack：

```ts
worker.onerror = (event) => {
  const errorEvent = event.error
  settle(actionError(
    "BROWSER_SCRIPT_WORKER_ERROR",
    event.message || "Browser script worker failed.",
    {
      scriptPath: request.scriptPath,
      line: event.lineno,
      column: event.colno,
      ...(errorEvent && typeof errorEvent.stack === "string"
        ? { stack: errorEvent.stack.slice(0, 1000) }
        : {}),
    },
  ))
}
```

### 2. `workspace-tools-types.ts` — 注册工具名

```ts
export const RUNTIME_WORKSPACE_TOOL_NAMES = {
  read: "read",
  list: "list",
  // ...existing...
  testSkillScript: "test_skill_script",  // NEW
} as const
```

`RuntimeWorkspaceToolExecutionContext` 加能力注入：

```ts
runTestSkillScript?: (input: {
  skillName: string
  actionName: string
  input: Record<string, unknown>
}) => Promise<PlatformActionResult>
```

### 3. `tool-schemas.ts` — 工具 schema

```ts
const testSkillScriptSchema: ToolSchema = {
  name: RUNTIME_WORKSPACE_TOOL_NAMES.testSkillScript,
  description: "Test a browser_script action from any Skill without activating it first. " +
    "Use this to verify scripts you authored or debug failures. " +
    "Returns { ok: true, output } on success or { ok: false, error: { code, message, name?, stack?, details? } } on failure. " +
    "Error codes: BROWSER_SCRIPT_SYNTAX_ERROR (fix script syntax), BROWSER_SCRIPT_RUNTIME_ERROR (fix script logic), " +
    "BROWSER_SCRIPT_SDK_ERROR (check tsian.workspace.* call arguments), BROWSER_SCRIPT_TIMEOUT (optimize or increase timeout), " +
    "or the script's own error code (e.g. OPENING_ENTITY_ID_INVALID — fix the input).",
  parameters: {
    type: "object",
    required: ["skillName", "actionName", "input"],
    properties: {
      skillName: { type: "string", description: "Skill name (matches SKILL.md frontmatter name)" },
      actionName: { type: "string", description: "Action name from the Skill's tsian-actions block" },
      input: { type: "object", description: "Input object passed to the script's execute function" },
    },
  },
}
```

Schema 注入条件：与 `inspect_frontend` 一样，只在 `AGENT_PLATFORM_TOOL_NAMES.testSkillScript` 被启用时 push。

### 4. `workspace-tools.ts` — dispatch 分支

在 `executeRuntimeWorkspaceToolCalls` 的 tool dispatch 链中加分支：

```ts
} else if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.testSkillScript) {
  if (!context.runTestSkillScript) {
    throw toolError(
      "TEST_SKILL_SCRIPT_UNAVAILABLE",
      "test_skill_script is not available in this Agent step.",
    )
  }
  observation = {
    index,
    name: call.name,
    ok: true,
    result: await context.runTestSkillScript(
      normalizeTestSkillScriptArguments(call.arguments),
    ),
  }
}
```

`normalizeTestSkillScriptArguments` 手写校验（镜像 `normalizeInspectFrontendArguments` 模式）：
- `skillName` 非空 string
- `actionName` 非空 string
- `input` 是 object

### 5. `permissions.ts` — 注册平台工具名

```ts
export const AGENT_PLATFORM_TOOL_NAMES = {
  agentCall: "agent_call",
  workspaceRead: "workspace_read",
  workspaceWrite: "workspace_write",
  inspectFrontend: "inspect_frontend",
  workspaceSemanticSearch: "workspace_semantic_search",
  askUser: "ask_user",
  testSkillScript: "test_skill_script",  // NEW
} as const satisfies Record<string, AgentPlatformToolName>
```

### 6. `platform-host/index.ts` — 注入 runTestSkillScript 能力

在 `sendMessage` 和 `invokeAgent` 的 `runAgentRuntimeTurn` capabilities 中注入 `runTestSkillScript`。

实现核心：从 workspaceFiles 中定位 Skill → 解析 action → 调 `runBrowserScript`。

```ts
async function runTestSkillScript(input: {
  skillName: string
  actionName: string
  input: Record<string, unknown>
}): Promise<PlatformActionResult> {
  // ① 在 workspaceFiles 中找 skills/<dir>/SKILL.md，其 frontmatter name 匹配 skillName
  // ② 解析 SKILL.md 的 tsian-actions block，找 actionName
  // ③ 校验 executor.type === "browser_script"，取 executor.path
  // ④ resolveBrowserScriptPath(skill, executor) → scriptPath
  // ⑤ 校验 scriptPath 在 skill 目录内 + workspaceFiles 含该文件
  // ⑥ 取 executor.timeoutMs（默认 10000）
  // ⑦ 调 runBrowserScript({ skillName, skillPath, actionName, scriptPath, input, timeoutMs })
  //    — runBrowserScript 已由 createBrowserSkillScriptRunner 创建，复用当前事务
}
```

Skill 定位 + action 解析复用现有 registry 函数（`buildSkillRegistry` / `loadSkillDetail`）——不需要重新实现解析逻辑。

### 7. `local-assistant-files.ts` — 助手默认配置

`defaultAssistantConfig` 的 `platformTools.enabled` 加入 `"test_skill_script"`。

## 不变的部分

- `run_script` 现有流程不变（错误透传自动对 `run_script` 生效）
- `use_skill` 不变
- Worker 执行模型不变（仍是 `new AsyncFunction`）
- `createBrowserSkillScriptRunner` 签名不变
- 脚本源码不需要改（错误透传对现有脚本自动生效）
- `importScripts` 预拼接逻辑不变

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| Skill 定位失败（name 不匹配） | 返回 `SKILL_NOT_FOUND` + 已知 skill names 列表 |
| Action 不存在或非 browser_script | 返回 `ACTION_NOT_FOUND` / `ACTION_NOT_BROWSER_SCRIPT` |
| 脚本文件不存在 | 返回 `BROWSER_SCRIPT_NOT_FOUND`（已有错误码） |
| 助手用 test_skill_script 做破坏性写入 | 写入走当前 turn 的 staged transaction，turn 失败则丢弃；与 run_script 一致 |
