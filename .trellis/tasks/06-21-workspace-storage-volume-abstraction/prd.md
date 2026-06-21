# Workspace Storage Volume Abstraction

## Parent

- `.trellis/tasks/06-20-content-generation-foundation`

## Goal

在 host 层引入 `WorkspaceVolume` 接口，把现有 4 个存储后端包成 volume 适配器，并把 3 个 ad-hoc 路由点（`executeWorkspaceOperationForActiveSave`/`executeStudioWorkspaceOperation`/`executeLocalWorkspaceOperation`）收敛为单一 dispatch。统一路由抽象 + 修掉路由键混用（scope/path 前缀/resolved 对象三套），不改用户可见行为、不改运行时层。

这是"全数据文件化"理念的地基：让存储后端对运行时和路由层透明，后续子3 加 `card-frontend`/`manifest` volume 时只需实现接口插入 dispatch，不再碰路由点。

## Background

勘察结论：运行时层（agent-runtime）已是干净统一模型（一个 `WorkspaceFile[]` + 一个 `WorkspaceOperationMutationAdapter` + 一个 `executeWorkspaceOperation` 入口），后端无关。碎片化全在 host 层：
- **4 个物理后端**：`gameCardContentFiles`（子4 迁移后的 per-file 表）/ `gameCardFrontendFiles`（Blob 表）/ `workspaceFiles`（save-runtime + save-scoped platform-meta）/ `meta`（local-assistant 单行 JSON）。
- **3 个 ad-hoc 路由点**，各自 if/else 分支，路由键不统一（有的看 scope、有的看 path 前缀、有的看 resolved 对象）。
- 运行时层只通过 `WorkspaceOperationMutationAdapter`（`{write, delete}`）回调 host，不知道后端——这层不该动。

## Requirements

### `WorkspaceVolume` 接口

3 原语（勘察确认运行时把 10 op 里 7 个自己算了，volume 只需这 3 个）：

```ts
interface WorkspaceVolume {
  scope: WorkspaceScope                 // 该 volume 服务的 scope
  enumerate(cardIdOrSaveId: string): Promise<WorkspaceFile[]>   // 列该 scope 所有文件（runtime 在此基础上做 list/glob/search/diff/validate）
  write(id: string, input: { path, content, mediaType? }): Promise<WorkspaceFile>   // 单文件写
  delete(id: string, pathPrefix: string): Promise<string[]>     // 删前缀下所有文件，返回已删 path
}
```

- `read` 不是 volume 原语——运行时从 `enumerate` 返回的快照里 `find`（与现状一致）。
- `move`/`patch`/`diff`/`validate`/`list`/`glob`/`search` 都不是 volume 原语——运行时层计算（勘察 §1-4 确认）。
- content 是 `string`（与现状一致，text-only contentModel；Blob 前端在子3 经 `await blob.text()` 适配进 string）。

### 4 个后端包成 volume

| Volume | 后端 | scope | enumerate | write | delete |
|---|---|---|---|---|---|
| `CardContentVolume` | `gameCardContentFiles`（子4 产出） | `card-content` | `listLocalGameCardContentFiles` | `writeLocalGameCardContentFile` | `deleteLocalGameCardContentPathForCard` |
| `CardFrontendVolume` | `gameCardFrontendFiles`（Blob） | （新 `card-frontend`，但本任务只包现有数据，scope 定义见下） | `listLocalGameCardFrontendFiles` + `blob.text()` | `writeLocalGameCardFrontendFile`（子3 才补单文件 API，本任务先用现有整批或占位） | `deleteLocalGameCardFrontendFile`（同） |
| `SaveRuntimeVolume` | `workspaceFiles`（save-scoped） | `save-runtime` | `listLocalWorkspaceFilesForSave` | `writeWorkspaceFileForSave` | `deleteWorkspacePathForSave` |
| `LocalAssistantVolume` | `meta`（单行 JSON） | `platform-meta`（local-assistant 子集） | `loadLocalAssistantFiles` | `saveLocalAssistantFiles` | `deleteLocalAssistantFile` |

**platform-meta 的特殊性**：勘察确认 `platform-meta` scope 跨两个物理存储——`.tsian/` save-owned 路径在 `workspaceFiles` 表，`.tsian/local/assistant/` 在 `meta` 单行 JSON。两种处理：
- **方案 A**：`SaveRuntimeVolume` 同时服务 `save-runtime` + save-scoped `platform-meta`（内部按 path 前缀 `.tsian/` 区分，仍走 `workspaceFiles`）；`LocalAssistantVolume` 服务 `.tsian/local/assistant/`（走 `meta`）。dispatch 时 `platform-meta` scope 按 path 前缀二次路由到这两个 volume 之一。
- **方案 B**：合并成一个 `SaveScopedVolume` 服务 save-scoped 所有（含 `.tsian/` + `.tsian/local/`），内部按 path 前缀选存储。
- 倾向方案 A（保留 scope 区分清晰，dispatch 做二级路由），见 design。

### `card-frontend` scope 定义

本任务在 `workspace-operations.ts:93` `DEFAULT_SCOPE_ACCESS` 加 `"card-frontend": { readLevel: 0, editLevel: 2 }`（read 0 / edit 2，和 card-content 同级；运行时 agent level 1 不能编辑，助手 level 4 能）。`WorkspaceScope` 类型（contracts `runtime.ts:81-85`）加 `"card-frontend"`。这是为子3 的 `CardFrontendVolume` 铺路——本任务定义 scope + 包 volume 框架，子3 补单文件前端 API + 实际接入。

### 单一 dispatch

替换 3 个 ad-hoc 路由点为单一 dispatch 函数：

```ts
async function executeWorkspaceMutation(input: {
  scope: WorkspaceScope, path: string, content?, mediaType?,
  context: { cardId?, saveId? },   // 解析 volume 所需的 owner id
  operation: "write" | "delete",
}): Promise<...> {
  const volume = resolveVolumeForScope(input.scope, input.path, input.context)
  return input.operation === "write"
    ? volume.write(volume.ownerId(input.context), { path: input.path, content, mediaType })
    : volume.delete(volume.ownerId(input.context), input.path)
}
```

`resolveVolumeForScope` 按 `(scope, path-prefix)` 选 volume（含 platform-meta 的二级路由）。3 个原路由点（`executeWorkspaceOperationForActiveSave`/`executeStudioWorkspaceOperation`/`executeLocalWorkspaceOperation`）的 `mutations` adapter 改为调这个 dispatch，删除各自 ad-hoc 分支。

### 保持不变

- 运行时层（`executeWorkspaceOperation`/`WorkspaceOperationMutationAdapter`/scope 校验/权限矩阵）不动——它已经统一。
- 存储后端实现不动（子4 已迁 contentFiles；本任务只"包"成 volume，不改存储代码）。
- 用户可见行为不变（纯 host 路由收敛）。

## Acceptance Criteria

- [ ] `WorkspaceVolume` 接口定义（3 原语），位置合理（platform-host 或新模块）。
- [ ] 4 个后端实现为 volume（CardContent/CardFrontend/SaveRuntime/LocalAssistant）。
- [ ] `card-frontend` scope 加入 `WorkspaceScope` 类型 + `DEFAULT_SCOPE_ACCESS`（read 0/edit 2）。
- [ ] 单一 dispatch 函数 `executeWorkspaceMutation` 按 `(scope, path-prefix)` 路由到 volume。
- [ ] 3 个原 ad-hoc 路由点的 `mutations` adapter 改调 dispatch，删除重复分支。
- [ ] 路由键统一（全部走 `(scope, path-prefix)`，不再混用 resolved 对象/裸 path）。
- [ ] 助手 `workspace_read`/`workspace_write` card-content/save-runtime/platform-meta 正常（经 dispatch）。
- [ ] run_script SDK `tsian.workspace.*` 正常（经同一 dispatch）。
- [ ] Studio Explorer 编辑/删除/移动正常（经 dispatch）。
- [ ] 现有功能不回归（库/详情/前端/play/助手/save）。
- [ ] `npm run build:web` 通过。
- [ ] dev server 冲烟：Explorer 编辑 card-content、助手 workspace_write save-runtime、SDK workspace.write 全经 dispatch 正常。

## Constraints

- 不改运行时层（agent-runtime 的 `executeWorkspaceOperation`/adapter 接口/scope 校验）。
- 不改存储后端实现（子4 已迁 contentFiles；本任务只包 volume）。
- 不实现 card-frontend 单文件 API / manifest 文件化（子3 范围）——本任务只定义 scope + volume 框架 + CardFrontendVolume 占位（enumerate 可用，write/delete 待子3 补 API）。
- content 仍是 string（text-only）。
- timestamp 约定：volume 的 `enumerate`/`write` 返回 WorkspaceFile 带各自后端的时间戳（子4 后 content per-file 真实时间戳；local-assistant 仍 0/now 约定，文档化）。
- mediaType 回退：volume write 统一按扩展名推断（修掉现有 card-content/local-assistant 不推断的不一致）。

## Out Of Scope

- card-frontend 单文件读写 API + 实际接入（子3）。
- manifest 文件化 + `game-card.json`（子3）。
- 内置卡不可见 + fallback rework（子3-A）。
- 二进制 content 支持（text-only）。
- contentFiles 存储迁移（子4 已做）。

## Dependencies

- 强依赖子4：`CardContentVolume` 实现取决于 contentFiles 已是 per-file 表（子4 产出 `listLocalGameCardContentFiles`/`writeLocalGameCardContentFile` 等 API）。
- 是子3 的接口前置：子3 的 `CardFrontendVolume`/`ManifestVolume` 实现 + 插入 dispatch 依赖本任务的 volume 框架 + `card-frontend` scope 定义。
- 执行顺序：子1（完成）→ 子4 → **子5** → 子3 → 子2。
