# Implement: 工作区路径支持 `.` 与相对路径段

## 执行顺序总览

```
Step 1 共享核心 lib/workspace-path.ts
→ Step 2 接入 storage/workspace.ts
→ Step 3 接入 workspace-operations.ts
→ Step 4 接入 workspace-tools.ts
→ Step 5 tool-schemas.ts 文案
→ Step 6 AI-facing 文本 grep 验证
→ Step 7 构建验证
```

Step 1 是新增零依赖纯函数,可独立 build 验证。Step 2-4 是三处接入,每处删一份副本、改为调核心,各自可 build 验证。Step 5 文案。Step 6 是 AI-Facing guide 强制的两层 grep 质量门。Step 7 全量构建。

## Step 1: 共享核心(`apps/platform-web/src/lib/workspace-path.ts`)

- [ ] 新建文件,导出 `NormalizePathOptions`、`NormalizePathResult`(= `NormalizePathOk | NormalizePathError`)、`normalizeWorkspacePath(value, options)`。
- [ ] 实现 design.md "共享核心契约" 算法(伪代码逐行落地),顺序严格:类型检查 → trim/折叠 → NUL 检查 → 空检查 → rejectTrailingSlash 检查 → 段规整(栈算法)→ 结果空检查。
- [ ] 无 import(纯函数,零依赖)。

**验证**:`cd apps/platform-web && npx tsc --noEmit src/lib/workspace-path.ts`(或等价),确认类型无误。也可直接进 Step 2 后随全量 build 一起验。

**Review gate**:核心算法是三处收敛的单一来源,改完先用 design 用例表逐条手推(或写个临时 console.log 跑用例),确认 16 条用例全部符合预期再往下。

## Step 2: 接入 `storage/workspace.ts`

- [ ] 顶部加 `import { normalizeWorkspacePath } from "@/lib/workspace-path"`(确认 `@/` alias,当前文件已 import `@/lib/media-type`)。
- [ ] 删 `normalizePathBase`(L935-980)。
- [ ] 改 `normalizeDirectoryPath`(L982-987)→ 调 `normalizeWorkspacePath(value ?? "", {allowEmpty:true, rejectTrailingSlash:false})` + `throw new WorkspaceStorageError(result.code, result.message)`。
- [ ] 改 `normalizeWorkspaceFilePath`(L989-994)→ 同上 `{allowEmpty:false, rejectTrailingSlash:true}`。
- [ ] 改 `normalizeWorkspaceTargetPath`(L996-1001)→ 同上 `{allowEmpty:false, rejectTrailingSlash:false}`。
- [ ] **绝不改** `MEMORY_MAINTENANCE_SCRIPT_JS` 内的 `normalizePath`(L171-196 字符串字面量)。
- [ ] 确认 `WorkspaceStorageError` class(L46-54)仍被引用(三个包裹函数都抛它)。

**验证**:`grep -n "normalizePathBase" storage/workspace.ts` 应零命中。`grep -n "normalizeWorkspacePath" storage/workspace.ts` 应见 import + 三处调用。

## Step 3: 接入 `agent-runtime/workspace-operations.ts`

- [ ] 顶部加 `import { normalizeWorkspacePath } from "@/lib/workspace-path"`。
- [ ] 删 `normalizePathBase`(L156-208)。
- [ ] 改 `normalizeWorkspaceOperationFilePath`(L210-215)→ 调核心 `{allowEmpty:false, rejectTrailingSlash:true}` + `throw workspaceOperationError(result.code, result.message)`。
- [ ] 改 `normalizeWorkspaceOperationTargetPath`(L217-222)→ `{allowEmpty:false, rejectTrailingSlash:false}`。
- [ ] 改 `normalizeWorkspaceOperationDirectoryPath`(L224-229)→ `{allowEmpty:true, rejectTrailingSlash:false}`(注意 `value ?? ""` 入参)。
- [ ] 确认 `workspaceOperationError`(L148-154)仍被引用。

**验证**:`grep -n "normalizePathBase" workspace-operations.ts` 零命中。三处导出函数形态正确。

**Review gate**:这是模型工具命中的主层。改完确认 `list` 路径经 `normalizeWorkspaceOperationDirectoryPath(".")` → 核心 → `ok("")` → `listWorkspaceEntries(files, scope, "", actorLevel)` → 列根。逻辑链手动走一遍。

## Step 4: 接入 `agent-runtime/workspace-tools.ts`

- [ ] 顶部加 `import { normalizeWorkspacePath } from "@/lib/workspace-path"`。
- [ ] 删 `NormalizePathOptions` 接口(L211-214,本地私有类型,核心已导出同名)。
- [ ] 删 `normalizePathBase`(L284-326)。
- [ ] 改 `normalizeWorkspaceFilePath`(L328-333)→ 调核心 `{allowEmpty:false, rejectTrailingSlash:true}` + `throw toolError(result.code, result.message)`(注意 `toolError` 返回对象,`throw` 它保持原 catch 路径)。

**验证**:`grep -n "normalizePathBase\|NormalizePathOptions" workspace-tools.ts` 零命中(接口和函数都删)。`grep -n "normalizeWorkspacePath" workspace-tools.ts` 见 import + 一处调用。

## Step 5: tool-schemas.ts 文案

- [ ] `workspaceListSchema`(L154)path 描述:"Empty or omitted means the workspace root." → "Empty, omitted, or `.` means the workspace root."。
- [ ] 其余工具 path 描述(read L130 / diff L244 / move L264,268 / delete L284)**不动**。

**验证**:读 `tool-schemas.ts` L144-158 确认 `list` 描述更新,其余未动。

## Step 6: AI-Facing 文本 grep 验证(强制质量门)

按 AI-Facing Content Changes guide,对删除的"current/parent directory segments"概念做两层 grep:

- [ ] **代码层**:`grep -rn "WORKSPACE_PATH_INVALID" apps/platform-web/src` —— 确认仅剩核心 `lib/workspace-path.ts` 的 NUL 分支定义,无消费方 catch 该码并假定 `.`/`..`。
- [ ] **AI-facing 文本层**:`grep -rn "current, or parent directory\|parent directory segments\|current.*directory segment" apps/platform-web/src` —— 要求零命中(核心新文案是 "must not contain NUL bytes")。
- [ ] **`list` 描述 `.` 确认**:`grep -n '`.\`' tool-schemas.ts`(或读 L154)确认 `.` 已加入。
- [ ] **`..` 机制噪声检查**:`grep -rn "clamp\|resolve.*\.\.\|parent.*segment" tool-schemas.ts apps/platform-web/src/agent-runtime/index.ts` —— 确认未向模型描述 clamp/resolve 机制(guide:不向模型解释自动机制)。

## Step 7: 构建验证

- [ ] `cd apps/platform-web && npm run build`(含 `vue-tsc` 类型检查 + `vite build`)。
- [ ] 类型检查通过:核心 result 类型 + 三处包裹函数 + `toolError`/`workspaceOperationError`/`WorkspaceStorageError` 签名匹配。
- [ ] 构建产物生成无报错。

**验证命令**:
```bash
cd apps/platform-web && npm run build
```

## 回滚点

- **Step 1** 核心算法若用例不符:回退算法,重点查 `hadTrailingSlash` 早判顺序与段规整栈逻辑。
- **Step 2-4** 接入若类型/构建报错:检查 result 解构(`if (!result.ok)`)与各域错误构造器签名。
- **Step 7** 构建失败:按报错定位到具体 Step,`git checkout <file>` 单文件回退。
- **全量回滚**:`git checkout apps/platform-web/src/storage/workspace.ts apps/platform-web/src/agent-runtime/workspace-operations.ts apps/platform-web/src/agent-runtime/workspace-tools.ts apps/platform-web/src/agent-runtime/tool-schemas.ts && rm apps/platform-web/src/lib/workspace-path.ts`。纯内部重构 + 行为放宽,无数据迁移,回滚零风险。

## 已知行为变化(写进 spec / journal)

- `.`/`..` 在三份运行时规整器中从 `WORKSPACE_PATH_INVALID` 变为合法解析(`.`→丢弃/根,`..`→pop/clamp)。此前依赖这些段报错的逻辑——经勘察无消费方 catch 该码做特殊分支。
- `read(".")` / `write(".")` 等文件路径用 `.` 从 `WORKSPACE_PATH_INVALID` 变为 `WORKSPACE_PATH_REQUIRED`(`.` 规整成空,走"必填"分支,语义更准确)。
- NUL 字节检查从仅 `workspace-operations.ts` 独有,扩展到三份规整器统一防护(`storage`/`workspace-tools` 此前放行 NUL,现在报 `WORKSPACE_PATH_INVALID`)。
- `WORKSPACE_PATH_INVALID` 错误信息从 "must not contain empty, current, or parent directory segments" 改为 "must not contain NUL bytes"(AI-facing 文本零残留旧概念)。
- `context.ts`(authored-config)与 maintenance script 的校验器**不变**,仍严格拒绝 `.`/`..`。

## 与其他在途任务的协调

- 本任务改 `workspace-operations.ts`/`workspace-tools.ts`/`storage/workspace.ts` 的**路径规整入口**(各操作最早一步),与任何改 scope 路由/事务/存储表/UI 的任务函数不重叠。
- 若同期有改同文件其他函数的任务,合并冲突预期仅在 imports 区(加 `@/lib/workspace-path` import),低风险。
- 无硬依赖,执行顺序自由。建议本任务独立完成、build 通过后再看是否有其他在途任务需 rebase。
