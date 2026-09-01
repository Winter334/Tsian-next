# Design — 工具补全、命名统一与 schema 优化

> 父任务：`06-19-tool-runtime-performance`。上游依赖子1（`06-19-tool-skill-decouple`）已归档完成，`use_skill`/`run_script` 机制已定稿，本任务可完整推进 R4 的 use_skill/run_script schema 部分。

## 边界与约束

- **只改 agent-facing 工具名**（模型看到的 `workspace.read` → `read`）。
- **不改 browser_script SDK 线协议**：`tsian.workspace.read(...)` 等 SDK RPC 字符串（`browser-skill-script-executor.ts:172-196`）保持 `workspace.` 前缀不变。SDK 是脚本调用的稳定 API 面，重命名它会破坏所有已写 browser_script；工具名是模型调用面，两者解耦。
- **保留底层 workspace operation**（`patch`/`validate` operation 保留在 `workspace-operations.ts` + contracts），只摘除工具层暴露。理由：`patchPlatformWorkspaceFile`/`validatePlatformWorkspaceFile` + `WorkspaceEditorView.vue` 保存即校验/patch 流程 + browser_script SDK 仍依赖底层 operation（详见 R3 耦合分析）。
- **不引入第三方 glob 库**：自写 `pattern → RegExp` 转换器。
- **破坏性变更**：工具名变了，旧对话历史失配——原型期可接受（PRD R1 已声明）。

## 前置任务对工具体系的影响（勘察修正）

本任务依赖的已归档前置任务对工具体系已有改动，本设计基于当前真实代码状态（非勘察 agent 二手报告）：

- **`06-19-tool-skill-decouple`（子1，已归档）**：`skill_load`→`use_skill`、`action_call`→`run_script`，移除 builtin/platform_action executor。当前 `tool-schemas.ts:44-84` 已是新机制 schema。本任务 R4 在其定稿基础上补 use_skill/run_script schema 文案。
- **`06-19-native-tool-calling`（已归档，R5）**：**已把 tool-schemas.ts 的 description 重写为精简声明式风格**。当前状态：
  - `use_skill` description 已含 "Returns a lightweight confirmation plus the action list"（`tool-schemas.ts:47`）。
  - `agent_call` description 已含 "never directly to the player" 定位澄清（`:89`），且已新增 `timeoutMs` 参数（`:119-123`，agent-call-concurrency 加）。
  - `list`/`search` 已含返回值描述（"Returns entries without file contents" / "return scored previews"）。
  - **仍缺失**：`read`/`write`/`move`/`delete`/`diff` 没有明确 "Returns ..." 句；所有工具 description 无调用示例（`Example: ...`）；`run_script` 未显式化 `SKILL_NOT_ACTIVATED` 错误码。
  - → 本任务 R4 是**查漏补缺**，不是从零重写。
- **`06-19-native-tool-calling`（R3-R5）**：引入 `toolCallMode`（native/text）字段挂 `BrowserAiModelConfig`。`buildWorkspaceToolInstructions`（`index.ts:702-777`）已 **native/text 双模式分裂**：native 分支（`:759-766`）不教写 `<tsian-tool-call>` 块，只给"工具用途参考"+ availableTools 示例 + 并行提示；text 分支（`:767-775`）保留 `<tsian-tool-call>` 块格式教学。**availableTools 数组（`:720-740`）被两分支共享**，且已有 use_skill/run_script/agent_call 调用示例（`:721-725`）。
  - → 本任务重命名后，native 模式的 tools 数组（`buildEnabledToolSchemas` 生成）tool name 自动跟随枚举变 `read` 等；text 模式 prompt 示例插值 `${...workspaceRead}` 自动更新。两模式都跟随枚举，无需为 toolCallMode 做特殊处理。
- **`06-20-agent-call-concurrency`（已归档）**：`agent_call` 移出串行组，用**独立 `agentCallGroup`**（`workspace-tools.ts:1986` `agentCallIndices`、`:1991` 按 name 匹配、`:2015` Promise.all）并行执行，**不加入 `PARALLEL_TOOL_NAMES`**。三分组：parallelGroup（只读）+ agentCallGroup（agent_call 独立并发）+ serialGroup（写/run_script）。`PARALLEL_TOOL_NAMES`（`:1952-1959`）仍只含 useSkill + read/list/search/diff/validate。
  - → 本任务 glob 加入 `PARALLEL_TOOL_NAMES`（只读组）正确，不动 agent_call 的 agentCallGroup 机制。移除 validate 时从 `PARALLEL_TOOL_NAMES` 删 `workspaceValidate`（`:1958`）。
- **`06-20-agent-task-compression` / `06-20-assistant-context-persistence`（已归档）**：改的是压缩/持久化机制（messages 序列化、context.json），**不碰工具命名/schema/operation**，与本任务无冲突。

## 命名映射表（R1）

| 当前工具名 | 新工具名 | 枚举 key（`RUNTIME_WORKSPACE_TOOL_NAMES`） |
|---|---|---|
| `workspace.read` | `read` | `workspaceRead` → `read`（key 也改短为 `read`） |
| `workspace.list` | `list` | `workspaceList` → `list` |
| `workspace.search` | `search` | `workspaceSearch` → `search` |
| `workspace.diff` | `diff` | `workspaceDiff` → `diff` |
| `workspace.write` | `write` | `workspaceWrite` → `write` |
| `workspace.move` | `move` | `workspaceMove` → `move` |
| `workspace.delete` | `delete` | `workspaceDelete` → `delete` |
| `workspace.glob`（R2 新增） | `glob` | 新增 `glob` |
| `use_skill` | `use_skill` | 不变 |
| `run_script` | `run_script` | 不变 |
| `agent_call` | `agent_call` | 不变 |
| `workspace.patch` | — | 移除（R3） |
| `workspace.validate` | — | 移除（R3） |

**枚举 key 命名约定**：重命名后 key 直接用工具名（`read`/`list`/...），去掉 `workspace` 前缀语义。`useSkill`/`runScript`/`agentCall` 保持 camelCase key 不变（它们本就是 snake_case 工具名）。

**权限名空间不动**：`permissions.ts:7-11` 的 `AGENT_PLATFORM_TOOL_NAMES = { agentCall: "agent_call", workspaceRead: "workspace_read", workspaceWrite: "workspace_write" }` 是权限配置名（下划线格式），不是工具调用名，PRD 未要求改，保持不变。

## 关键代码改动点

### A. 工具名枚举 — `workspace-tools.ts:31-44`

```ts
export const RUNTIME_WORKSPACE_TOOL_NAMES = {
  useSkill: "use_skill",
  runScript: "run_script",
  agentCall: "agent_call",
  read: "read",
  list: "list",
  search: "search",
  glob: "glob",          // R2 新增
  diff: "diff",
  write: "write",
  move: "move",
  delete: "delete",
  // workspacePatch / workspaceValidate 移除（R3）
} as const
```

### B. `startsWith("workspace.")` 网关改写（4 处）

重命名后工具名不再有 `workspace.` 前缀，需改为"判断是否 workspace 类工具"的显式集合判断：

1. **`workspace-tools.ts:340`** `emitWorkspaceToolTrace`：改用 `isWorkspaceOperationToolName(call.name)` 判断（新加辅助函数，检查 name 是否在 `{read,list,search,glob,diff,write,move,delete}` 集合里）。
2. **`workspace-tools.ts:1883`** `executeRuntimeWorkspaceToolCall` 全量分支：同上，用集合判断。
3. **`browser-skill-script-executor.ts:449`**：**此处的 `op` 是 SDK RPC 字符串（`"workspace.read"` 等），保持 `startsWith("workspace.")` 不变**——SDK 线协议不改。注意区分：agent 工具名 vs SDK RPC op 是两条路径。
4. **`platform-host/index.ts:843`** `normalizeWorkspaceActionRequest`：同 3，`request.action` 来自 SDK RPC，保持 `workspace.` 前缀判断不变。

### C. `slice("workspace.")` operation 映射改写（3 处）

1. **`workspace-tools.ts:1489`** `workspaceOperationRequestFromToolCall`：工具名重命名后 == operation 名，直接 `const operation = call.name as WorkspaceOperationName`（配合集合守卫）。不再 slice。
2. **`browser-skill-script-executor.ts:450`**：SDK RPC 路径，保持 `op.slice("workspace.".length)` 不变（SDK op 仍是 `workspace.read` 格式）。
3. **`platform-host/index.ts:848`**：SDK RPC 路径，保持 slice 不变。

**关键区分**：agent 工具调用走路径 1（工具名 == operation 名，不 slice）；browser_script SDK 调用走路径 2/3（op == `workspace.<operation>`，仍 slice）。两条路径的 input 来源不同，改法不同。

### D. glob 工具实现（R2）

**契约层**（`packages/contracts/src/runtime.ts`）：
- `WorkspaceOperationName` 加 `"glob"`（`:87-96`）。
- `WorkspaceOperationRequest` 加 `pattern?: string`（`:98-110`）。
- 新增 `WorkspaceGlobResult`：
  ```ts
  export interface WorkspaceGlobResult {
    scope: WorkspaceScope
    pattern: string
    matches: string[]   // 匹配的文件 path 列表（已排序，不含内容）
    truncated: boolean  // 是否因 limit 截断
  }
  ```

**operation 层**（`workspace-operations.ts`）：
- `WORKSPACE_OPERATION_NAMES` 加 `glob: "glob"`（`:43-53`）。
- 新增 `globToRegExp(pattern: string): RegExp` 工具函数（自写，支持 `**`/`*`/`?`）：
  - `**` → `.*`（跨目录通配）
  - `*` → `[^/]*`（单层不跨 `/`）
  - `?` → `[^/]`（单字符不跨 `/`）
  - 其余字符转义为正则字面量
  - 整体锚定 `^...$`
- 新增 `globWorkspaceFiles(files, scope, patternInput, limitInput, actorLevel): WorkspaceGlobResult`：
  - 复用 `scopedReadableFiles(files, scope, actorLevel)` 拿候选（已含 scope + actorLevel 读权限过滤）。
  - 对每个 `file.path` 跑 `globToRegExp(pattern).test(file.path)`。
  - 排序：按 path 字典序；`limit` 默认 50、最大 200（仿 `normalizeSearchLimit` `:233-239`）。
  - 返回 `{ scope, pattern, matches, truncated }`。
- `executeWorkspaceOperation` 分发（`:852-887`）加 `if (operation === "glob") return globWorkspaceFiles(...)`。

**schema 层**（`tool-schemas.ts`）：
- 新增 `workspaceGlobSchema`（参考 `workspaceListSchema` 结构）：
  ```ts
  const workspaceGlobSchema: ToolSchema = {
    name: RUNTIME_WORKSPACE_TOOL_NAMES.glob,
    description: "Recursively match workspace file paths by glob pattern and return the matching path list (no file contents). Use this to locate files by name pattern without walking directories one level at a time. Returns an array of matching file paths; empty array if no matches.",
    parameters: {
      type: "object",
      required: ["pattern"],
      properties: {
        scope: { type: "string", enum: WORKSPACE_SCOPE_ENUM, description: "..." },
        pattern: { type: "string", description: "Glob pattern supporting ** (cross-directory), * (single-level, no /), ? (single char, no /). Examples: **/agent.json, skills/**/*.md, *.md" },
        limit: { type: "integer", description: "Max matches to return. Default 50, max 200." },
      },
    },
  }
  ```
- `buildEnabledToolSchemas`（`:386-392`）：在 `canReadWorkspace` 分支推入 `workspaceGlobSchema`（与 read/list/search 同组，只读）。

**并行组**（`workspace-tools.ts:1952-1959` `PARALLEL_TOOL_NAMES`）：加入 `RUNTIME_WORKSPACE_TOOL_NAMES.glob`（只读可并行）。

**prompt 示例**（`index.ts:720-740`）：在 availableTools 数组加一行 glob 示例：
```
- ${...glob} arguments={"scope":"effective","pattern":"**/agent.json","limit":50}
```

### E. 移除 patch/validate 工具暴露（R3，最小方案：保留底层）

**摘工具层**（6 处 × 2 工具）：
- `tool-schemas.ts`：删 `workspacePatchSchema`（`:195-222`）、`workspaceValidateSchema`（`:324-352`）；删 `buildEnabledToolSchemas` 里 `canWriteWorkspace` 分支的注册行（`:397` patch、`:401` validate）。
- `workspace-tools.ts`：删 `RUNTIME_WORKSPACE_TOOL_NAMES.workspacePatch`（`:39`）、`.workspaceValidate`（`:43`）；**删 `PARALLEL_TOOL_NAMES` 里的 `workspaceValidate`**（`:1958`，patch 不在并行组无需动）。
- `permissions.ts`：从 `WORKSPACE_WRITE_OPERATIONS`（`:25-32`）删 `"patch"`（`:27`）、`"validate"`（`:31`）。
- `index.ts`：删 patch prompt 示例（`:737`）；validate 无 prompt 示例，无需动。

**保留底层**：`WORKSPACE_OPERATION_NAMES`、`AUTHORING_WORKSPACE_OPERATIONS`、`EDIT_OPERATIONS`、`executeWorkspaceOperation` 的 patch/validate 分发分支、contracts `WorkspaceOperationName`/`WorkspacePatchResult`/`WorkspaceValidationResult` 全部保留。理由：`patchPlatformWorkspaceFile`/`validatePlatformWorkspaceFile` + `WorkspaceEditorView.vue` 保存即校验流程 + browser_script SDK `tsian.workspace.patch/validate` 仍依赖底层 operation。

**耦合面确认**：保留底层后，`platform-host/index.ts:3271-3277`（studio write|patch 分支）、`:3299-3311`（studio validate 分支）、`:3490-3515`（patchPlatformWorkspaceFile）、`:3556-3575`（validatePlatformWorkspaceFile）、`browser-skill-script-executor.ts:183/195`（SDK patch/validate）全部不动。

### F. schema 优化（R4，查漏补缺）

> 前置：`06-19-native-tool-calling` R5 已把所有 description 重写为精简声明式风格。本节只补其遗漏部分，不重写已有文案。

**已完成（native-tool-calling R5，无需重做）**：
- `use_skill` 已含返回值描述（"Returns a lightweight confirmation plus the action list"）。
- `agent_call` 已含定位澄清（"never directly to the player"）+ `timeoutMs` 参数。
- `list`（"Returns entries without file contents"）、`search`（"return scored previews"）已含返回值描述。

**待补 —— 返回值描述（description 追加 "Returns ..." 句）**：
- `read`：当前 description（`tool-schemas.ts:131`）无明确返回值句，追加 "Returns the file content as a string. Returns an error if the path does not exist in the given scope."
- `write`（`:227`）：追加 "Returns the written file metadata. Returns an error if the path is not writable in the given scope."
- `move`（`:281`）：追加 "Returns the moved file paths. Returns an error if the source or target path is invalid."
- `delete`（`:306`）：追加 "Returns the deleted file paths. Returns an error if the path is not deletable in the given scope."
- `diff`（`:256`）：追加 "Returns the diff between current and expected content, including whether content changed."
- `glob`：新工具，description 已含返回值（见 D）。

**待补 —— 调用示例（description 末尾追加 "Example: ..."）**：
- `use_skill`（`:47`）：追加 "Example: use_skill with name=\"prose-style\"."
- `run_script`（`:64`）：追加 "Example: run_script with skill=\"prose-style\", script=\"example_action\", input={...}."
- `agent_call`（`:89`）：追加 "Example: agent_call with agentId, request, and optional historyMode/timeoutMs."
- （注：prompt 的 availableTools 数组已有这三个工具的调用示例 `index.ts:721-725`，此处是补 **schema description 内**的示例，供 native 模式 API 直接暴露给模型。）

**待补 —— 依赖失败后果显式化**：
- `run_script`（`:64`）：当前说 "activated via use_skill"，追加显式错误码 "Calling run_script before activating the skill with use_skill returns a SKILL_NOT_ACTIVATED error."（错误码来自 `workspace-tools.ts:1700-1707`）。

**命名同步**：重命名后检查所有 description 里的 `workspace.read` 风格自引用，改为新短名。当前 description 文案多用动词开头（"Read one..."/"List direct..."）不引用工具名，需逐条核对是否有 `workspace.` 残留（grep 确认）。`agent_call` description 里 "use_skill"/"run_script" 引用是工具名，保持不变（这两个名字不改）。

## 数据流

```
模型调用 read 工具
  → executeRuntimeWorkspaceToolCall (workspace-tools.ts:1883)
    → isWorkspaceOperationToolName("read") = true  [新集合判断，替代 startsWith]
    → workspaceOperationRequestFromToolCall: operation = "read"  [直接用 name，不 slice]
    → executeWorkspaceOperation (workspace-operations.ts:852)
      → readWorkspaceFile → 返回 WorkspaceFile

模型调用 glob 工具
  → executeRuntimeWorkspaceToolCall
    → isWorkspaceOperationToolName("glob") = true
    → workspaceOperationRequestFromToolCall: operation = "glob"
    → executeWorkspaceOperation → globWorkspaceFiles
      → scopedReadableFiles (scope + actorLevel 过滤)
      → globToRegExp(pattern).test(file.path) 逐个匹配
      → 排序 + limit 截断 → WorkspaceGlobResult

browser_script 调 tsian.workspace.read (SDK，不改)
  → handleSdkRequest (browser-skill-script-executor.ts:449)
    → op.startsWith("workspace.") = true  [保持]
    → operation = op.slice("workspace.".length) = "read"  [保持]
    → executeWorkspaceOperation → readWorkspaceFile
```

## 兼容性与回滚

- **破坏性**：工具名变更，旧对话历史里的 `workspace.read` 调用会匹配不到新工具。原型期可接受（PRD 已声明）。无迁移脚本。
- **回滚点**：每个 R（R1 命名 / R2 glob / R3 移除 / R4 schema）可独立提交，任一 R 出问题可单独 revert。
- **回滚策略**：git revert 对应 commit；底层 operation 保留意味着回滚工具层后 patch/validate 工具可快速恢复。

## 验证命令

- `npm run build:contracts`（contracts 改了 WorkspaceOperationName/Request/GlobResult）
- `npm run build:web`（platform-web 改了工具链路）
- `npm run build:runtime-core`（若 runtime-core 有引用——勘察未发现，但跑一次确认）
- 真实 API 实测：模型用 `glob` 定位 `**/agent.json` 成功；命名简短后工具调用顺畅；patch/validate 不再出现在工具列表。

## 开放问题

- 无。命名方案、SDK 线协议不改、patch/validate 保留底层只摘工具、glob 自写、权限名空间不动——均已收敛。
