# Implement — 工具补全、命名统一与 schema 优化

> 执行顺序按 R 分块提交，每块完成后跑对应验证命令。回滚点 = 每个 commit。

## 前置确认

- [ ] 子1（tool-skill-decouple）已归档（确认 `use_skill`/`run_script` schema 在 `tool-schemas.ts:44-84` 已是新机制）——已勘察确认。
- [ ] 工作树干净，在 master 分支（或子任务指定 base branch）。

## Step 1 — 契约层先行（R2 glob 契约）

> contracts 是下游依赖根，先改先 build。

- [ ] `packages/contracts/src/runtime.ts:87-96` `WorkspaceOperationName` 加 `"glob"`。
- [ ] `packages/contracts/src/runtime.ts:98-110` `WorkspaceOperationRequest` 加 `pattern?: string`。
- [ ] `packages/contracts/src/runtime.ts` 新增 `WorkspaceGlobResult` 接口（scope/pattern/matches/truncated）。
- [ ] 验证：`npm run build:contracts` 通过。
- [ ] **Review gate**：contracts 编译过，类型导出无误。回滚点：此 commit 可单独 revert。

## Step 2 — operation 层加 glob（R2）

- [ ] `workspace-operations.ts:43-53` `WORKSPACE_OPERATION_NAMES` 加 `glob: "glob"`。
- [ ] `workspace-operations.ts` 新增 `globToRegExp(pattern: string): RegExp`（`**`→`.*`，`*`→`[^/]*`，`?`→`[^/]`，其余转义，`^...$` 锚定）。
- [ ] `workspace-operations.ts` 新增 `globWorkspaceFiles(files, scope, patternInput, limitInput, actorLevel)`：复用 `scopedReadableFiles`，逐个 `globToRegExp(pattern).test(file.path)`，排序 + limit（默认 50/最大 200，仿 `normalizeSearchLimit`）。
- [ ] `workspace-operations.ts:852-887` `executeWorkspaceOperation` 分发加 `if (operation === "glob") return globWorkspaceFiles(...)`。
- [ ] 验证：`npm run build:web` 通过（类型检查 + 编译）。回滚点。

## Step 3 — 工具名枚举重命名 + 网关改写（R1 核心，破坏性）

> 这是最大的破坏性改动块，集中提交。

- [ ] `workspace-tools.ts:31-44` `RUNTIME_WORKSPACE_TOOL_NAMES`：8 个 `workspace.*` 改短名（`workspaceRead`→`read: "read"` 等），删 `workspacePatch`/`workspaceValidate`（R3 顺带在此步摘除枚举），加 `glob: "glob"`。
- [ ] `workspace-tools.ts` 新增 `isWorkspaceOperationToolName(name: string): boolean` 辅助函数（判断 name ∈ `{read,list,search,glob,diff,write,move,delete}`）。
- [ ] `workspace-tools.ts:340` `emitWorkspaceToolTrace`：`call.name.startsWith("workspace.")` → `isWorkspaceOperationToolName(call.name)`。
- [ ] `workspace-tools.ts:1489` `workspaceOperationRequestFromToolCall`：`call.name.slice("workspace.".length)` → `call.name as WorkspaceOperationName`（配合 isWorkspaceOperationToolName 守卫，调用前已判断）。
- [ ] `workspace-tools.ts:1883` `executeRuntimeWorkspaceToolCall` 全量分支：`call.name.startsWith("workspace.")` → `isWorkspaceOperationToolName(call.name)`。
- [ ] `workspace-tools.ts:1952-1959` `PARALLEL_TOOL_NAMES`：更新引用为新 key（`RUNTIME_WORKSPACE_TOOL_NAMES.read` 等），加 `glob`，删 `workspaceValidate`（R3）。
- [ ] `workspace-tools.ts:1974` 陈旧注释更新（去掉 `workspace.read/list/...` 提法）。
- [ ] **不改** `browser-skill-script-executor.ts:449-450` 和 `platform-host/index.ts:843-848`（SDK RPC 路径，保持 `workspace.` 前缀 + slice）。
- [ ] 验证：`npm run build:web` 通过。回滚点。

## Step 4 — schema 层重命名 + glob schema + 移除 patch/validate schema（R1+R2+R3）

- [ ] `tool-schemas.ts` 所有 `name: RUNTIME_WORKSPACE_TOOL_NAMES.workspaceXxx` 引用改为新 key（`RUNTIME_WORKSPACE_TOOL_NAMES.read` 等）——因枚举 key 改了，引用必须同步。
- [ ] `tool-schemas.ts:195-222` 删 `workspacePatchSchema`（R3）。
- [ ] `tool-schemas.ts:324-352` 删 `workspaceValidateSchema`（R3）。
- [ ] `tool-schemas.ts` 新增 `workspaceGlobSchema`（参考 `workspaceListSchema`，含返回值描述 + pattern 参数说明 + `**`/`*`/`?` 示例）。
- [ ] `tool-schemas.ts:386-403` `buildEnabledToolSchemas`：`canReadWorkspace` 分支加 `workspaceGlobSchema`；`canWriteWorkspace` 分支删 `workspacePatchSchema`/`workspaceValidateSchema` 注册行。
- [ ] 验证：`npm run build:web` 通过。回滚点。

## Step 5 — permissions + prompt 示例（R1+R3 收尾）

> 前置：`buildWorkspaceToolInstructions`（`index.ts:702-777`）已 native/text 双模式分裂（`isNative` 分支 `:759-775`）。availableTools 数组（`:720-740`）被两分支共享，已有 use_skill/run_script/agent_call 示例（`:721-725`）。

- [ ] `permissions.ts:25-32` `WORKSPACE_WRITE_OPERATIONS`：删 `"patch"`、`"validate"`（R3，这两个 operation 不再作工具暴露，无需写入权限归类）。
- [ ] `index.ts:720-740` availableTools 数组（native/text 两模式共享）：
  - 删 patch 示例（`:737`）。
  - 加 glob 示例：`- ${...glob} arguments={"scope":"effective","pattern":"**/agent.json","limit":50}`（放在 read/list/search 示例后，canReadWorkspace 分支内）。
  - 其余 `${...workspaceRead}` 等插值引用改为新 key（`${...read}` 等）——因枚举 key 改名，插值必须同步。
- [ ] `index.ts:743-776` 散文规则：`${...workspaceRead}` 等插值引用改新 key（插值自动更新值，但 key 名要改对才能编译）。
  - `:746-747` `workspaceRead`→`read`、`workspaceList`→`list`、`workspaceSearch`→`search` 引用。
  - `:750` `workspaceRead`/`workspaceWrite` 引用改新 key。
  - text 分支 `:772` `<tsian-tool-call>` 块示例用 `useSkill` 插值（不变，use_skill 名不改）。
  - 检查自由文本里有无 `workspace.` 风格提法，改为新短名。
- [ ] 验证：`npm run build:web` 通过。回滚点。

## Step 6 — schema 优化文案（R4，查漏补缺）

> 前置：`06-19-native-tool-calling` R5 已重写所有 description 为精简声明式风格。本步只补遗漏，不重写已有文案。

- [ ] 补返回值描述（description 追加 "Returns ..." 句）：
  - `workspaceReadSchema`（`tool-schemas.ts:131`）：追加 "Returns the file content as a string. Returns an error if the path does not exist in the given scope."
  - `workspaceWriteSchema`（`:227`）：追加 "Returns the written file metadata. Returns an error if the path is not writable in the given scope."
  - `workspaceMoveSchema`（`:281`）：追加 "Returns the moved file paths. Returns an error if the source or target path is invalid."
  - `workspaceDeleteSchema`（`:306`）：追加 "Returns the deleted file paths. Returns an error if the path is not deletable in the given scope."
  - `workspaceDiffSchema`（`:256`）：追加 "Returns the diff between current and expected content, including whether content changed."
  - （`use_skill`/`agent_call`/`list`/`search`/`glob` 已有返回值描述，不动。）
- [ ] 补调用示例（description 末尾追加 "Example: ..."）：
  - `useSkillSchema`（`:47`）：追加 "Example: use_skill with name=\"prose-style\"."
  - `runScriptSchema`（`:64`）：追加 "Example: run_script with skill=\"prose-style\", script=\"example_action\", input={...}."
  - `agentCallSchema`（`:89`）：追加 "Example: agent_call with agentId, request, and optional historyMode/timeoutMs."
- [ ] 补依赖失败后果：
  - `runScriptSchema`（`:64`）：追加 "Calling run_script before activating the skill with use_skill returns a SKILL_NOT_ACTIVATED error."（错误码 `workspace-tools.ts:1700-1707`）。
- [ ] 命名同步：grep description 里残留的 `workspace.read` 等旧名引用，改为新短名（当前 description 多用动词开头不引用工具名，但逐条核对）。
- [ ] 验证：`npm run build:web` 通过。回滚点。

## Step 7 — 全量验证 + 实测

- [ ] `npm run build:contracts` 通过。
- [ ] `npm run build:web` 通过。
- [ ] `npm run build:runtime-core` 通过（确认 runtime-core 无残留引用）。
- [ ] grep 残留检查：`rg "workspace\.(read|list|search|glob|diff|write|move|delete|patch|validate)" apps/platform-web/src --type ts -g '!browser-skill-script-executor.ts'`——agent 工具链路应无残留（SDK 文件 `browser-skill-script-executor.ts` 保留 `workspace.` 前缀是预期）。
- [ ] grep 枚举旧 key 残留：`rg "workspaceRead|workspaceList|workspaceSearch|workspaceDiff|workspaceWrite|workspaceMove|workspaceDelete|workspacePatch|workspaceValidate" apps/platform-web/src --type ts`——应无 `RUNTIME_WORKSPACE_TOOL_NAMES.workspaceXxx` 引用残留。
- [ ] 真实 API 实测：模型在多步探索场景用 `glob` 定位 `**/agent.json` 成功；工具列表里 patch/validate 消失；命名简短后调用顺畅。
- [ ] **Review gate**：全量 build 绿 + 实测通过，进入 check 阶段。

## 验证命令汇总

```bash
npm run build:contracts
npm run build:web
npm run build:runtime-core
```

## 回滚点

每个 Step 一个 commit，任一 Step 出问题可 `git revert <commit>`。底层 operation 保留意味着 R3 回滚后 patch/validate 工具可快速恢复（重新加 schema + 枚举）。

## 风险点

- **Step 3 最危险**：枚举 key 改名会触发所有引用处的编译错误，需逐处修正（IDE 跳转辅助）。建议 Step 3 后立即 build 确认所有引用已同步。
- **SDK 线协议边界**：Step 3 明确不改 `browser-skill-script-executor.ts` 和 `platform-host/index.ts` 的 SDK 路径——混淆 agent 工具名与 SDK op 是最大误改风险，design.md 已用"两条路径"区分。
- **glob 正则转义**：`globToRegExp` 需正确转义 `.`/`+`/`(`等正则元字符，否则 pattern 误匹配。测试用例覆盖 `**/agent.json`、`skills/**/*.md`、`*.md`。
