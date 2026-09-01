# Design: 工作区路径支持 `.` 与相对路径段

## Boundaries

改四处(三处规整器收敛 + 一处 AI-facing 文案):

- **新增** `apps/platform-web/src/lib/workspace-path.ts`:共享路径规整核心,返回 discriminated result(不抛错)。
- **改** `apps/platform-web/src/storage/workspace.ts:935-1001`:删 `normalizePathBase`,三个导出函数(`normalizeWorkspaceFilePath`/`normalizeDirectoryPath`/`normalizeWorkspaceTargetPath`)改为调核心 + 抛 `WorkspaceStorageError`。
- **改** `apps/platform-web/src/agent-runtime/workspace-operations.ts:156-229`:删 `normalizePathBase`,三个导出函数(`normalizeWorkspaceOperationFilePath/TargetPath/DirectoryPath`)改为调核心 + 抛 `workspaceOperationError`。
- **改** `apps/platform-web/src/agent-runtime/workspace-tools.ts:284-333`:删 `normalizePathBase`,`normalizeWorkspaceFilePath` 改为调核心 + 抛 `toolError`。
- **改** `apps/platform-web/src/agent-runtime/tool-schemas.ts:154`:`list` path 描述加 `.` 提示。

**不改**:

- `agent-runtime/context.ts:21-44`(authored-config 域,null 语义,见 prd R4)。
- `storage/workspace.ts:171-196` maintenance script 内嵌 `normalizePath`(字符串字面量,运行在 skill 脚本沙箱,不属本代码库规整链路)。
- scope 路由、权限矩阵、scopeForPath、写操作事务、contracts。

## 共享核心契约(`lib/workspace-path.ts`)

### 类型

```ts
export interface NormalizePathOptions {
  /** 允许规整结果为空(根目录)。目录路径用 true,文件路径用 false。 */
  allowEmpty: boolean
  /** 拒绝尾斜杠(文件路径用 true,目录/目标路径用 false)。 */
  rejectTrailingSlash: boolean
}

export interface NormalizePathOk {
  ok: true
  path: string
}

export interface NormalizePathError {
  ok: false
  code:
    | "WORKSPACE_PATH_REQUIRED"
    | "WORKSPACE_PATH_INVALID"
    | "WORKSPACE_FILE_PATH_REQUIRED"
  message: string
}

export type NormalizePathResult = NormalizePathOk | NormalizePathError

export function normalizeWorkspacePath(
  value: unknown,
  options: NormalizePathOptions,
): NormalizePathResult
```

**为何返回 result 而非抛错**:三份副本各自抛不同错误类型(`WorkspaceStorageError` / `workspaceOperationError(...)` 返回结构 / `toolError(...)` 返回结构)。让核心只做"算 + 判",把"包成什么错误"留给调用域,避免核心依赖三个域的错误构造器,也避免循环 import(核心在 `lib/`,比 `storage`/`agent-runtime` 都低层)。

### 算法(伪代码,对应 prd R1 步骤 1-7)

```ts
function normalizeWorkspacePath(value, options) {
  if (typeof value !== "string") {
    return err("WORKSPACE_PATH_REQUIRED", "Workspace path must be a string.")
  }
  const raw = value.trim()
  const hadTrailingSlash = /[\\/]$/.test(raw)
  const collapsed = raw
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/+$/, "")

  if (collapsed.includes("\0")) {
    return err("WORKSPACE_PATH_INVALID", "Workspace path must not contain NUL bytes.")
  }

  // 空输入(原 "."/"./" 已被尾斜杠 strip 折叠,此处纯空)
  if (!collapsed) {
    if (options.allowEmpty) return ok("")
    return err("WORKSPACE_PATH_REQUIRED", "Workspace path is required.")
  }

  // 尾斜杠检查在段规整之前:先判 hadTrailingSlash,再规整段。
  // 注意:"a/." 的 hadTrailingSlash=false,不会误判;"./" 的 hadTrailingSlash=true
  // 且 collapsed="" 已在上面处理。此处 collapsed 非空 + hadTrailingSlash = 真"目录式尾斜杠"。
  if (options.rejectTrailingSlash && hadTrailingSlash) {
    return err("WORKSPACE_FILE_PATH_REQUIRED", "Workspace file path must not end with a slash.")
  }

  // 段规整:栈算法
  const segments = collapsed.split("/")
  const stack: string[] = []
  for (const seg of segments) {
    if (seg === "" || seg === ".") {
      continue
    }
    if (seg === "..") {
      stack.pop()  // 栈空时 pop() 返回 undefined,无操作 = clamp 根
      continue
    }
    stack.push(seg)
  }

  const path = stack.join("/")
  if (!path) {
    if (options.allowEmpty) return ok("")
    return err("WORKSPACE_PATH_REQUIRED", "Workspace path is required.")
  }
  return ok(path)
}
```

### 用例验证表(算法正确性闭环)

| 输入 | options | 现行为 | 新行为 | 路径 |
|------|---------|--------|--------|------|
| `"."` | dir(allowEmpty T) | INVALID | ok `""` | 列根 |
| `"."` | file(allowEmpty F) | INVALID | err REQUIRED | read(".") 报必填 |
| `"./"` | dir | INVALID | ok `""` | 列根 |
| `"a/.."` | dir | INVALID | ok `""` | 列根 |
| `"a/../b"` | dir/file | INVALID | ok `"b"` | list/read |
| `"../.."` | dir | INVALID | ok `""` | clamp 根 |
| `"a/./b/.."` | file | INVALID | ok `"a"` | |
| `"a/b/c"` | file | ok `"a/b/c"` | ok `"a/b/c"` | 不变 |
| `"save/x.md"` | file | ok | ok `"save/x.md"` | 不变 |
| `"a\b"` | file | ok `"a/b"` | ok `"a/b"` | `\`→`/` 不变 |
| `"/a"` | file | ok `"a"` | ok `"a"` | strip leading `/` 不变 |
| `"a/"` | file(rejectSlash T) | FILE_PATH_REQUIRED | FILE_PATH_REQUIRED | 不变 |
| `"a/"` | dir(rejectSlash F) | ok `"a"` | ok `"a"` | 不变 |
| `"a/b/../../../c"` | file | INVALID | ok `"c"` | clamp: a,b pop,pop(空无操作),push c |
| 含 `\0` | any | #1/#3 放行,#2 INVALID | 三份均 INVALID | NUL 统一增强 |

关键边界确认:

- **`hadTrailingSlash` 与段规整的顺序**:`"a/."` → collapsed `"a/."`(尾无 `/`)→ hadTrailingSlash=false → 不触发 rejectTrailingSlash → 段规整 `["a","."]`→`["a"]`→`"a"`。正确(`.` 丢弃,非尾斜杠)。`"./"` → collapsed `""`(尾 `/` strip)→ 走空分支 → dir 返回 `""`。正确。`"a/"` → collapsed `"a"`(尾 `/` strip)→ hadTrailingSlash=true → file 触发 rejectTrailingSlash。正确(保持原"文件路径不能尾斜杠")。
- **`..` clamp 安全性**:栈空时 `pop()` 返回 undefined 且不抛错(JS 语义)。`"../.."` → 第一段 `..` pop 空栈(无操作)→ 第二段 `..` pop 空栈(无操作)→ join 得 `""`。不可逃越根。安全性质保持。

## 调用方改动

### `storage/workspace.ts`

```ts
import { normalizeWorkspacePath } from "@/lib/workspace-path"

// 删 normalizePathBase(L935-980)

function normalizeDirectoryPath(value: unknown): string {
  const result = normalizeWorkspacePath(value ?? "", { allowEmpty: true, rejectTrailingSlash: false })
  if (!result.ok) {
    throw new WorkspaceStorageError(result.code, result.message)
  }
  return result.path
}

export function normalizeWorkspaceFilePath(value: unknown): string {
  const result = normalizeWorkspacePath(value, { allowEmpty: false, rejectTrailingSlash: true })
  if (!result.ok) {
    throw new WorkspaceStorageError(result.code, result.message)
  }
  return result.path
}

function normalizeWorkspaceTargetPath(value: unknown): string {
  const result = normalizeWorkspacePath(value, { allowEmpty: false, rejectTrailingSlash: false })
  if (!result.ok) {
    throw new WorkspaceStorageError(result.code, result.message)
  }
  return result.path
}
```

`@/` alias:确认 `storage/workspace.ts` 是否已用 `@/`。当前它 import `@/lib/media-type`(L8-11)——已用 alias,一致。

### `agent-runtime/workspace-operations.ts`

```ts
import { normalizeWorkspacePath } from "@/lib/workspace-path"

// 删 normalizePathBase(L156-208)

export function normalizeWorkspaceOperationFilePath(value: unknown): string {
  const result = normalizeWorkspacePath(value, { allowEmpty: false, rejectTrailingSlash: true })
  if (!result.ok) {
    throw workspaceOperationError(result.code, result.message)
  }
  return result.path
}

function normalizeWorkspaceOperationTargetPath(value: unknown): string {
  const result = normalizeWorkspacePath(value, { allowEmpty: false, rejectTrailingSlash: false })
  if (!result.ok) {
    throw workspaceOperationError(result.code, result.message)
  }
  return result.path
}

function normalizeWorkspaceOperationDirectoryPath(value: unknown): string {
  const result = normalizeWorkspacePath(value ?? "", { allowEmpty: true, rejectTrailingSlash: false })
  if (!result.ok) {
    throw workspaceOperationError(result.code, result.message)
  }
  return result.path
}
```

确认 `workspace-operations.ts` 是否用 `@/`:当前 import 全是 `@tsian/contracts`(L1-17),无 `@/`。但 `workspace-tools.ts`(同目录)用了相对 import `./trace`(L13)。**决策**:用 `@/lib/workspace-path`——`@/` 是 platform-web 全局 alias(vite/tsconfig),同包跨目录 import 用 alias 是项目约定(directory-structure spec L27:"Use `@/` for local platform-web imports when the file already uses alias style")。`agent-runtime` 模块 import `lib/` 是跨目录,用 `@/` 比相对 `../lib/` 更清晰。

### `agent-runtime/workspace-tools.ts`

```ts
import { normalizeWorkspacePath } from "@/lib/workspace-path"

// 删 normalizePathBase(L284-326) + NormalizePathOptions 接口(L211-214)

function normalizeWorkspaceFilePath(value: unknown): string {
  const result = normalizeWorkspacePath(value, { allowEmpty: false, rejectTrailingSlash: true })
  if (!result.ok) {
    throw toolError(result.code, result.message)  // toolError 返回结构,非抛
  }
  return result.path
}
```

注意 `workspace-tools.ts` 的 `toolError(...)` **返回** `RuntimeWorkspaceToolError` 对象(非抛),原 `normalizePathBase` 用 `throw toolError(...)`。包裹函数沿用 `throw toolError(...)` 保持调用方 catch 路径不变。

`NormalizePathOptions` 接口(L211-214)在本文件是私有局部类型,核心已有同名导出类型——删本地接口,避免重复。

## tool-schemas.ts 文案改动

`workspaceListSchema`(L154):

```
"Optional directory path to list. Empty or omitted means the workspace root."
→
"Optional directory path to list. Empty, omitted, or `.` means the workspace root."
```

仅 `list` 改。其余工具 path 描述(read L130 / diff L244 / move L264,268 / delete L284)不动——按 AI-Facing guide,`.` 对文件操作无意义,加了是噪声。

## 数据流

```
agent 调 list(".")
  → parseRuntimeWorkspaceToolCall
  → executeWorkspaceOperation({operation:"list", path:"."})
  → normalizeWorkspaceOperationDirectoryPath(".")   [workspace-operations.ts]
      → normalizeWorkspacePath(".", {allowEmpty:T, rejectTrailingSlash:F})  [lib/workspace-path.ts]
      → ok("")  (. 规整为空)
      → 返回 ""
  → listWorkspaceEntries(files, scope, "", actorLevel)
      → prefix="" → 列根条目
  → observation → agent

agent 调 list("a/../b")
  → normalizeWorkspacePath("a/../b", {allowEmpty:T})
      → 栈 [a] → pop(遇 ..) → [] → push b → [b] → ok("b")
  → listWorkspaceEntries(files, scope, "b", actorLevel) → 列 b 子项

agent 调 read(".")
  → normalizeWorkspaceOperationFilePath(".")  [allowEmpty:F, rejectTrailingSlash:T]
      → "." 规整为空 → !allowEmpty → err WORKSPACE_PATH_REQUIRED
  → 抛 workspaceOperationError → observation error "is required"
  (比 INVALID 更准确:. 对文件路径无意义,规整后空 = 没给路径)

storage 层 (platform-host import #1):
  studio resolvePath(".") → normalizeWorkspaceFilePath(".") [storage]
      → normalizeWorkspacePath → ok/err → 抛 WorkspaceStorageError 或返回
```

## Tradeoffs

- **共享 helper 返回 result vs 抛统一错误**:选 result。三域错误类型不同(Storage error class / operation error object / tool error object),核心抛任一种都会引入对该域的依赖或循环 import。result 让核心零依赖,调用方一行 `if (!result.ok) throw <域错误>` 包裹。代价是每个包裹函数 5 行样板——但消除了三份 ~45 行重复算法,净减重。
- **`.` 合法 vs 提示词禁用**:选合法。模型训练里 `.`=根 是强先验,提示词"别用 ."是对抗先验,不稳且占 token。让行为符合先验是一劳永逸。
- **`..` clamp vs 禁用**:选 clamp。虚拟 FS 根定,clamp 天然安全;禁用只增加模型踩坑面。AIRP agent 理论上不会主动写 `..`(无场景),但支持它让规整器"正确"而非"半正确"。
- **`read(".")` 报 REQUIRED vs INVALID**:选 REQUIRED。`.` 规整成空后,"路径必填"比"含非法段"更准确——`. ` 不是非法字符,是对文件路径无意义的输入。语义清晰度优先。
- **NUL 检查提升到核心 vs 保留 #2 独有**:选提升。三份统一防护是纯增强,#1/#3 此前放行 NUL 是潜在缺陷(虽 NUL 在 JSON path 里极少见)。零回归风险。
- **抽 helper vs 三处就地改**:选抽。Code Reuse guide 明确"同代码 3+ 处 → 抽";quality-guidelines Known Tech Debt 给了同类先例(`lib/workspace-search.ts`)。三处算法要变复杂(从检查升级到规整),继续三份同步是维护隐患。

## Compatibility / Rollback

- **可观察行为变化**:`.`/`..` 从报错变为合法解析。此前任何依赖 `list(".")` 报错的代码/逻辑——经勘察无(grep `WORKSPACE_PATH_INVALID` 仅四处定义点,无消费方 catch 该码做特殊分支)。`..` 同理。
- **错误码兼容**:`WORKSPACE_PATH_REQUIRED`/`WORKSPACE_FILE_PATH_REQUIRED` 不变。`WORKSPACE_PATH_INVALID` 仍存在但仅 NUL 触发——此前 catch `INVALID` 并假定是 `.`/`..` 的代码会改变行为,但勘察无此类 catch(grep 确认)。
- **NUL 增强**:此前 #1/#3 放行 NUL,现在报错。含 NUL 的路径在 storage 层此前会生成一条 path 含 `\0` 的记录——这是缺陷而非功能,修正是对的。无已知合法 path 含 NUL。
- **无 contracts 改动**:规整是 platform-web 内部,不跨包。
- **回滚**:`git checkout lib/workspace-path.ts(删) storage/workspace.ts agent-runtime/workspace-operations.ts agent-runtime/workspace-tools.ts tool-schemas.ts`。纯内部重构 + 行为放宽,无数据迁移,回滚零风险。

## 与 AI-Facing Content Changes guide 的合规

按 guide 要求的两层 grep(改完执行):

1. **代码层**:确认无消费方 catch `WORKSPACE_PATH_INVALID` 并假定 `.`/`..`。
2. **AI-facing 文本层**:grep "current, or parent directory segments" / "parent directory" 在 `description:` 和 prompt 字符串——要求零命中。`list` 描述加 `.` 是替换概念(从"空/省略=根"扩为"空/省略/.=根"),非机制噪声。

## 风险点

- **`hadTrailingSlash` 早判顺序**:必须确认 `"a/."`(尾无 `/`)不误触 rejectTrailingSlash。算法伪代码已验证(collapsed 非空 + hadTrailingSlash=false → 不触发)。实现时保持顺序:空检查 → rejectTrailingSlash 检查 → 段规整。
- **maintenance script 字面量误改**:`MEMORY_MAINTENANCE_SCRIPT_JS`(workspace.ts:155-279)是字符串数组 join 成的 JS 源码,内含独立 `normalizePath`(L171-196)。**绝不改它**——它运行在 skill 脚本沙箱,不 import 本代码库。实现时只改 `normalizePathBase`(L935-980),不动 L171-196。
- **`context.ts` 误纳入**:它在同 `agent-runtime/` 目录,易被扫进重构范围。**明确排除**(prd R4)。它的 `.`/`..` 严格拒绝是 authored-config 域的正确行为。
