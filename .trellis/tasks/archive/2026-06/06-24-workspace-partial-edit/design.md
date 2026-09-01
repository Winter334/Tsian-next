# Design: workspace 部分编辑能力

## 1. 范围（brainstorm 决议）

| 决策点 | 结论 |
|--------|------|
| 主能力 | 新增 `workspace.edit`——字符串精确替换，格式无关 |
| 范围边界 | A 方案：edit + 折乐观锁进 write + 完整退役 patch operation |
| JSON-Patch | 不做，字符串替换已覆盖需求 |
| patch 退役方式 | 不是直删——先把乐观锁（expectedContent）折进 write，再退役 patch op |
| edit 不唯一错误 | 带匹配次数，提示扩大上下文或设 replaceAll |
| WorkspacePatchResult | 改名 WorkspaceWriteResult，write/edit 共用 |

## 2. 架构与边界

### 2.1 操作语义终态

退役 patch 后，workspace 写操作收束为两个，职责清晰：

| 操作 | 语义 | 乐观锁 | 适用 |
|------|------|--------|------|
| `write` | 整文件替换（`content` = 完整新内容） | 可选 `expectedContent`：带则写前校验 | 小文件全量写、人类编辑器保存（带 expectedContent）、首次创建 |
| `edit` | 局部字符串替换（`oldString`→`newString`） | 隐式（oldString 不匹配即冲突信号） | 大文件局部改、前端 HTML/CSS/JS、MD 段落修改 |

**互补不互斥**：write 管全量，edit 管局部。agent 按文件大小和改动幅度自选。edit 的隐式冲突检测（文件被改了 oldString 匹配不上）替代了 patch 的显式 expectedContent——但只对局部替换有效，整文件覆盖仍需 write 的显式 expectedContent。

### 2.2 暴露面（两条路都加 edit，都删 patch）

```
LLM 工具面（workspace-tools.ts）          browser_script 面（browser-skill-script-executor.ts）
  RUNTIME_WORKSPACE_TOOL_NAMES              worker 的 workspace 对象
  ├─ read/list/search/glob/diff             ├─ read/list/search/glob/diff
  ├─ write   (+ expectedContent)            ├─ write    (+ expectedContent)
  ├─ edit    (新增)                          ├─ edit     (新增)
  ├─ move/delete                            ├─ move/delete
  └─ (patch 早已不在)                        └─ (patch   移除)
```

路由层（`browser-skill-script-executor.ts:576-577`）是 generic 的 `op.startsWith("workspace.")` → slice → `executeWorkspaceOperation`，**不用改**——只要 worker 侧加 `edit()` 方法、host 侧 `executeWorkspaceOperation` 认 `"edit"` 分支即可。

## 3. contracts 变更（packages/contracts/src/runtime.ts）

### 3.1 WorkspaceOperationName

```diff
 export type WorkspaceOperationName =
   | "list"
   | "search"
   | "read"
   | "glob"
   | "diff"
-  | "patch"
   | "write"
+  | "edit"
   | "move"
   | "delete"
   | "validate"
```

### 3.2 WorkspaceOperationRequest

```diff
 export interface WorkspaceOperationRequest {
   operation: WorkspaceOperationName
   scope?: WorkspaceScope
   path?: string
   targetPath?: string
   query?: string
   pattern?: string
   limit?: number
   offset?: number
   contextLines?: number
   ignoreCase?: boolean
   content?: string | Blob
   expectedContent?: string
+  /** edit: 要替换的精确字符串。必须在文件中唯一匹配，或设 replaceAll。 */
+  oldString?: string
+  /** edit: 替换后的内容。允许为空串（删除片段）。 */
+  newString?: string
+  /** edit: true 时替换所有匹配，跳过唯一性校验。默认 false。 */
+  replaceAll?: boolean
   validator?: "json" | "frontmatter"
   autoFix?: boolean
 }
```

### 3.3 WorkspacePatchResult → WorkspaceWriteResult

```diff
-export interface WorkspacePatchResult {
+export interface WorkspaceWriteResult {
   path: string
   scope: WorkspaceScope
   file: WorkspaceFile
   changed: boolean
 }
```

write/edit 都返回 `WorkspaceWriteResult`。全仓库 `WorkspacePatchResult` 引用点跟着 rename（见 §6 影响面）。

## 4. workspace-operations.ts 变更

### 4.1 合并 patch 进 write（writeWorkspaceFile）

现状 `writeWorkspaceFile` 有 `options.checkExpectedContent` 开关，patch 调用时传 true。合并后：**write 主路径统一检查 `expectedContent`**——`request.expectedContent` 是 string 就校验，不是就跳过。去掉 `checkExpectedContent` 开关。

```ts
async function writeWorkspaceFile(
  files, scope, request, context,
): Promise<WorkspaceWriteResult> {
  // ... 路径/scope/access 校验不变 ...

  const existing = findScopedFile(files, scope, path)
  // expectedContent 校验：带就查，不带就跳过（原 patch 的乐观锁折进这里）
  if (typeof request.expectedContent === "string"
      && existing?.content !== request.expectedContent) {
    throw workspaceOperationError(
      "WORKSPACE_EXPECTED_CONTENT_MISMATCH",
      `Workspace file changed before write: ${path}`,
      { scope, path },
    )
  }

  // ... 后续 write 逻辑不变 ...
}
```

### 4.2 新增 editWorkspaceFile

```ts
async function editWorkspaceFile(
  files: WorkspaceFile[],
  scope: WorkspaceScope,
  request: WorkspaceOperationRequest,
  context: WorkspaceOperationExecutionContext,
): Promise<WorkspaceWriteResult> {
  assertMutableScope(scope)
  const path = normalizeWorkspaceOperationFilePath(request.path)
  assertEditAccess(path, resolveWorkspaceActorLevel(context))
  if (!pathMatchesScope(path, scope)) { /* throw SCOPE_PATH_MISMATCH */ }

  const oldString = request.oldString
  const newString = request.newString ?? ""
  const replaceAll = request.replaceAll === true

  if (typeof oldString !== "string" || oldString.length === 0) {
    throw workspaceOperationError(
      "WORKSPACE_EDIT_OLD_STRING_REQUIRED",
      `workspace.edit requires a non-empty oldString: ${path}`,
      { scope, path },
    )
  }

  const existing = findScopedFile(files, scope, path)
  if (!existing) {
    throw workspaceOperationError(
      "WORKSPACE_FILE_NOT_FOUND",
      `Cannot edit a non-existent file: ${path}`,
      { scope, path },
    )
  }
  if (existing.binary) {
    throw workspaceOperationError(
      "WORKSPACE_EDIT_BINARY_UNSUPPORTED",
      `workspace.edit cannot edit binary files: ${path}`,
      { scope, path },
    )
  }

  const content = existing.content
  // 统计匹配次数
  const matchCount = countOccurrences(content, oldString)
  if (matchCount === 0) {
    throw workspaceOperationError(
      "WORKSPACE_EDIT_NO_MATCH",
      `oldString not found in ${path}. The file may have changed, or the oldString does not exactly match (check indentation/whitespace).`,
      { scope, path },
    )
  }
  if (matchCount > 1 && !replaceAll) {
    throw workspaceOperationError(
      "WORKSPACE_EDIT_NOT_UNIQUE",
      `oldString matches ${matchCount} occurrences in ${path}. Expand oldString context (include surrounding lines) to locate uniquely, or set replaceAll: true to replace all matches.`,
      { scope, path, matchCount },
    )
  }

  const nextContent = replaceAll
    ? content.split(oldString).join(newString)
    : content.replace(oldString, newString)

  if (nextContent === content) {
    return { path, scope, file: existing, changed: false }
  }

  // 复用 write 路径落盘 + staged transaction 语义
  const file = await assertMutationAdapter(context.mutations).write({
    scope, path, content: nextContent,
  })
  return { path, scope, file, changed: true }
}
```

**countOccurrences**：朴素 `split(oldString).length - 1`，oldString 非空已校验。不引入正则（oldString 是字面串，正则的 `.*` 之类会误匹配）。

**单次替换**用 `String.prototype.replace`（第一参数为字符串时只替换首个匹配）——`replaceAll:false` 且 matchCount===1 的安全路径。

### 4.3 operation 分发

```diff
   if (operation === "list") { ... }
   if (operation === "search") { ... }
-  if (operation === "patch") {
-    return writeWorkspaceFile(..., { checkExpectedContent: true })
-  }
   if (operation === "write") {
-    return writeWorkspaceFile(..., { checkExpectedContent: false })
+    return writeWorkspaceFile(...)
+  }
+  if (operation === "edit") {
+    return editWorkspaceFile(...)
   }
```

`EDIT_OPERATIONS` set（L113-118）加 `"edit"`，移除 `"patch"`。

## 5. 暴露面变更

### 5.1 LLM 工具面（workspace-tools.ts）

`RUNTIME_WORKSPACE_TOOL_NAMES` 加 `edit: "edit"`。`WORKSPACE_OPERATION_TOOL_NAMES` set 加 `"edit"`。patch 本来就不在这个 set 里，无需删。

`tool-schemas.ts` 新增 `workspaceEditSchema`：

```ts
const workspaceEditSchema: ToolSchema = {
  name: RUNTIME_WORKSPACE_TOOL_NAMES.edit,
  description:
    "Edit a workspace file by replacing a unique oldString with newString. Use for localized changes to large files (frontend HTML/CSS/JS, long MD, big JSON) to avoid rewriting the whole file. oldString must match exactly once unless replaceAll is set. Fails on binary files.",
  parameters: {
    type: "object",
    required: ["path", "oldString", "newString"],
    properties: {
      path: { type: "string", description: "Target workspace file path." },
      oldString: { type: "string", description: "The exact string to find. Must match once unless replaceAll. Include surrounding lines for uniqueness." },
      newString: { type: "string", description: "The replacement string. Empty string deletes the matched fragment." },
      replaceAll: { type: "boolean", description: "Replace all occurrences. Default false." },
    },
  },
}
```

write schema 加 `expectedContent` 可选属性。

### 5.2 browser_script 面（browser-skill-script-executor.ts）

worker 的 `workspace` 对象（L150-184）：

```diff
     patch(input) {              // 移除
-      return rpc("workspace.patch", input);
-    },
     write(input) {
       return rpc("workspace.write", input).then(...)
     },
+    edit(input) {
+      return rpc("workspace.edit", input).then((result) => isRecord(result) && isRecord(result.file) ? result.file : result);
+    },
```

host 侧 `executeWorkspaceOperation` 已认 generic operation，edit 走 §4.3 分发。mutations adapter 只需 `write`（edit 内部复用它落盘），**无需新增 mutation adapter 方法**。

### 5.3 人类前端编辑器迁移

`WorkspaceEditorView.vue:321-333` 现调 `patchPlatformWorkspaceFile({content, expectedContent})`。改走 `writePlatformWorkspaceFile`（新增或复用 `workspace-ops.ts` 的 write 封装，带 `expectedContent`）。

`workspace-ops.ts`：
- `patchPlatformWorkspaceFile`（L684-709）→ 改名/合并为 `writePlatformWorkspaceFile`，`operation: "write"` + `expectedContent`。
- 内部 `executeStudioWorkspaceOperation` / `executeLocalWorkspaceOperation` 调用从 `operation:"patch"` 改 `"write"`。

## 6. 影响面（全仓库 rename/引用清理）

### 6.1 WorkspacePatchResult → WorkspaceWriteResult 引用点

需 rename 的引用（grep 确认）：
- `packages/contracts/src/runtime.ts`（定义处）
- `apps/platform-web/src/agent-runtime/workspace-operations.ts`（返回类型）
- `apps/platform-web/src/platform-host/workspace-ops.ts`（L460-466 patch/write 分支、L681-682、patchPlatformWorkspaceFile 返回类型）
- `apps/platform-web/src/platform-host/browser-skill-script-executor.ts`（如引用）
- 其他 import 点（build:web 会报错指引逐个修）

### 6.2 operation: "patch" / workspace.patch 引用清理

- `workspace-operations.ts:1242` patch 分支删除
- `browser-skill-script-executor.ts:169-171` worker `patch()` 删除
- `workspace-ops.ts:463` `if (write || patch)` → 只剩 `write`；L693/702 `operation:"patch"` → `"write"`
- `WorkspaceEditorView.vue:322` `patchPlatformWorkspaceFile` → `writePlatformWorkspaceFile`
- `tool-schemas.ts` 无 patch schema（早已移除）
- spec `.trellis/spec/platform-web/frontend/type-safety.md` L576/626/665/1094/1109 `workspace.patch` → `workspace.write`

### 6.3 EDIT_OPERATIONS / 权限归类

`workspace-operations.ts:113-118` `EDIT_OPERATIONS` set：移除 `"patch"`，加 `"edit"`。
权限归类（`permissions.ts` 若有 `WORKSPACE_WRITE_OPERATIONS` 等）：`"patch"` 若在则移除，`"edit"` 加入。

## 7. 回滚与 staged transaction

edit 落盘走 `mutations.write` → `workspaceTransaction.write`，与 write 共享 staged transaction 语义：
- 回合成功：transaction 落盘，edit 生效。
- 回合失败：transaction 丢弃，edit 自动回滚（整个文件回到回合前状态）。
- **无需特殊回滚处理**——edit 在 transaction 层等价于一次 write（写的是替换后的完整内容）。

checkpoint/restore 也不受影响：checkpoint 存的是完整 workspace 文件快照，edit 改完落盘后就是新完整内容，restore 全量替换。

## 8. 兼容性

- **旧存档**：无 schema version 影响。edit/patch 是操作语义，不改变存储格式。旧存档的 workspace 文件不变。
- **导出/导入**：*.tsian-card.zip 不受影响（只含文件，不含操作历史）。
- **破坏性变更**：contracts 移除 `"patch"` 是 breaking change——任何外部消费者若调 `operation:"patch"` 会失败。项目内消费者已全部迁移（§6）。外部消费者不在本项目控制范围，spec 注明即可。
- **browser_script SDK**：移除 `workspace.patch` 是 SDK breaking——但全仓库零 skill 脚本调用，项目内零迁移成本。第三方 skill 若用了会失败，需改用 `workspace.write` 或 `workspace.edit`。

## 9. 取舍

- **字符串替换 vs JSON-Patch**：取字符串替换。牺牲了 JSON 字段级编辑的结构校验，换取格式无关（前端 HTML/CSS/JS 一把覆盖）。JSON-Patch 解决不了 studio-assistant 改前端这个核心痛点，post 改小 JSON 用字符串替换也够。
- **折乐观锁进 write vs 保留 patch**：取折进 write。多一个可选参数，少一个误导性 op，命名诚实。代价是 write 的签名复杂了一点，但比维持双轨制清晰。
- **edit 不带 expectedContent**：取隐式冲突检测（oldString 不匹配即冲突信号）。edit 本就是局部改，文件被改了 oldString 大概率匹配不上，显式 expectedContent 多余。整文件覆盖才需显式乐观锁（走 write）。

## 10. 开放点（design 已定，implement 前确认）

- edit 是否需要 `validate` 后置（替换后若文件是 JSON 可选 autoFix）？**倾向不加**——edit 是通用文本操作，不假设格式，校验留给 agent 自己调 validate。保持 edit 单一职责。
