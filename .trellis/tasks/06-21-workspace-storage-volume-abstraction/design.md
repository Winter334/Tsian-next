# Design: Workspace Storage Volume Abstraction

## Boundaries

改 host 层（`platform-host/index.ts`）+ agent-runtime 轻量（`workspace-operations.ts` 加 scope 定义）+ contracts 轻量（`runtime.ts` 的 `WorkspaceScope` 加成员）。不改运行时核心（`executeWorkspaceOperation`/adapter 接口）、不改存储后端实现（子4 已迁）。

## `WorkspaceVolume` Interface

位置：新模块 `apps/platform-web/src/platform-host/workspace-volumes.ts`（或 platform-host 内），保持 host 层归属。

```ts
export interface WorkspaceVolume {
  readonly scope: WorkspaceScope
  /** 列该 owner 下所有文件（runtime 在此做 list/glob/search/diff/validate）。 */
  enumerate(ownerId: string): Promise<WorkspaceFile[]>
  /** 单文件写，返回写入后的 WorkspaceFile（含时间戳）。 */
  write(ownerId: string, input: { path: string; content: string; mediaType?: string }): Promise<WorkspaceFile>
  /** 删前缀下所有文件，返回已删 path 列表（递归）。 */
  delete(ownerId: string, pathPrefix: string): Promise<string[]>
}
```

`ownerId` 语义：card-content/card-frontend volume 是 `cardId`；save-runtime/local-assistant volume 是 `saveId`。dispatch 负责从 operation context（active card/save）解析出 ownerId 传给 volume。

### 为什么 3 原语足够（勘察依据）

- `read` = `enumerate` 结果里 `find(path)`（运行时从快照读，与现状一致）。
- `move` = `write` + `delete` 循环（`workspace-operations.ts:829-842` 已是这模式）。
- `patch` = `write` + 快照 OCC 检查（`workspace-operations.ts:738-756`，无 host patch 回调）。
- `diff`/`validate`/`list`/`glob`/`search` = 纯快照计算（`workspace-operations.ts:690-717, 442-653, 877-917`）。
- 运行时层把 10 op 里 7 个自己算了，volume 只暴露 enumerate/write/delete。

## 4 Volumes

### `CardContentVolume`（scope: card-content，ownerId: cardId）

```ts
{
  scope: "card-content",
  enumerate: async (cardId) => (await listLocalGameCardContentFiles(cardId)).map(toWorkspaceFile),
  write: async (cardId, {path, content, mediaType}) => {
    const rec = await writeLocalGameCardContentFile(cardId, { path, content, mediaType: mediaType ?? inferMediaType(path) })
    await bumpCardUpdatedAt(cardId)   // 保持"卡 updatedAt 反映最近变更"约定
    return toWorkspaceFile(rec)
  },
  delete: async (cardId, prefix) => {
    const deleted = await deleteLocalGameCardContentPathForCard(cardId, prefix)
    await bumpCardUpdatedAt(cardId)
    return deleted
  },
}
```

子4 产出 per-file API。`inferMediaType` 统一按扩展名推断（修现有 card-content 不推断的不一致）。

### `CardFrontendVolume`（scope: card-frontend，ownerId: cardId）

本任务框架占位 + enumerate 可用：
```ts
{
  scope: "card-frontend",
  enumerate: async (cardId) => (await listLocalGameCardFrontendFiles(cardId)).map(async r => ({
    path: r.path, content: await r.data.text(), mediaType: r.mediaType, createdAt: r.updatedAt, updatedAt: r.updatedAt,
  })),
  write: async (cardId, {path, content, mediaType}) => {
    // 子3 补 writeLocalGameCardFrontendFile；本任务暂未接入写（Explorer/助手暂不写前端，待子3）
    throw new Error("card-frontend write not yet implemented (see task 06-21-game-card-data-fileification 的后继子3)")
  },
  delete: async (cardId, prefix) => { /* 同上，子3 补 */ throw ... },
}
```

本任务定义 scope + volume 框架，让子3 只需补 write/delete 实现 + 接入。enumerate 已可让前端文件在 list 出现（但写要等子3）——决策点：本任务是否让 enumerate 接入 list（让前端可见但只读），还是完全等子3。倾向"框架就绪 + enumerate 接入 list（只读可见）"，写留子3。

### `SaveRuntimeVolume`（scope: save-runtime，ownerId: saveId）

```ts
{
  scope: "save-runtime",
  enumerate: async (saveId) => (await listLocalWorkspaceFilesForSave(saveId)).map(toWorkspaceFile),
  write: async (saveId, {path, content, mediaType}) => {
    const rec = await writeWorkspaceFileForSave(saveId, { path, content, mediaType: mediaType ?? inferMediaType(path) })
    return toWorkspaceFile(rec)
  },
  delete: async (saveId, prefix) => await deleteWorkspacePathForSave(saveId, prefix),
}
```

### `LocalAssistantVolume`（scope: platform-meta 子集，ownerId: saveId—but 实际是全局）

local-assistant 文件不在 save 内（跨卡持久），ownerId 语义特殊。`saveLocalAssistantFiles`/`loadLocalAssistantFiles`/`deleteLocalAssistantFile` 不取 ownerId（操作全局 `assistant-local-files` meta key）。

```ts
{
  scope: "platform-meta",   // 但仅 .tsian/local/assistant/ 路径
  enumerate: async (_ownerId) => (await loadLocalAssistantFiles()).map(toWorkspaceFile),
  write: async (_ownerId, {path, content, mediaType}) => { await saveLocalAssistantFiles({[path]: {content, mediaType: mediaType ?? "text/plain"}}); return {...} },
  delete: async (_ownerId, path) => { await deleteLocalAssistantFile(path); return [path] },
}
```

## platform-meta 二级路由（方案 A）

`platform-meta` scope 跨两个 volume：`.tsian/local/assistant/` → `LocalAssistantVolume`（meta 表）；其它 `.tsian/` save-owned → 实际是 `SaveRuntimeVolume` 的 platform-meta 子集（`workspaceFiles` 表，`writePlatformWorkspaceFileForSave`）。

dispatch 的 `resolveVolumeForScope`：
```ts
function resolveVolume(scope, path, ctx): WorkspaceVolume {
  if (scope === "platform-meta") {
    return isLocalAssistantPath(path) ? localAssistantVolume : saveRuntimePlatformMetaVolume
  }
  if (scope === "card-content") return cardContentVolume
  if (scope === "card-frontend") return cardFrontendVolume
  if (scope === "save-runtime") return saveRuntimeVolume
}
```

`saveRuntimePlatformMetaVolume` 复用 `SaveRuntimeVolume` 但 write 走 `writePlatformWorkspaceFileForSave`（允许 `.tsian/` 路径）。或拆成 `SaveRuntimeVolume`（save/）+ `SavePlatformMetaVolume`（.tsian/ save-owned）两个 volume。决策点，倾向拆两个（scope 清晰）。

## Single Dispatch

```ts
async function executeWorkspaceMutation(input: {
  scope: WorkspaceScope, path: string, content?: string, mediaType?: string,
  ownerContext: { cardId?: string; saveId?: string },
  operation: "write" | "delete",
}): Promise<WorkspaceFile | string[]> {
  const volume = resolveVolumeForScope(input.scope, input.path, input.ownerContext)
  const ownerId = resolveOwnerId(volume.scope, input.ownerContext)
  if (input.operation === "write") {
    return volume.write(ownerId, { path: input.path, content: input.content!, mediaType: input.mediaType })
  }
  return volume.delete(ownerId, input.path)
}
```

### 3 路由点改造

**`executeWorkspaceOperationForActiveSave` (1059-1137)** 的 `mutations` adapter：
```ts
mutations: {
  write: (writeInput) => executeWorkspaceMutation({
    scope: writeInput.scope, path: writeInput.path, content: writeInput.content, mediaType: writeInput.mediaType,
    ownerContext: { saveId: activeSaveId, cardId: activeCardId },
    operation: "write",
  }),
  delete: (deleteInput) => executeWorkspaceMutation({
    scope: deleteInput.scope, path: deleteInput.path,
    ownerContext: { saveId: activeSaveId, cardId: activeCardId },
    operation: "delete",
  }),
}
```
删除原有 staged/immediate 的 if/else 分支（staged turn 的约束——runtime turn 不能改 card-content——保留为 dispatch 上层的策略检查，不进 volume）。

**`executeStudioWorkspaceOperation` (3188-3334)**：`resolvedPath` 解析出 scope + ownerContext，mutations 调 dispatch。删除 save-runtime/card-content 两个分支块。

**`executeLocalWorkspaceOperation` (3341-3416)**：.tsian/ Explorer 路径，mutations 调 dispatch（platform-meta scope，二级路由到 local-assistant 或 save-platform-meta）。

### staged turn 策略保留

`executeWorkspaceOperationForActiveSave` 现有 staged turn 约束（runtime turn 不能改 card-content，`platform-host:1094`）是**策略**不是路由——保留在 dispatch 调用前做检查（`assertMutableInStagedTurn(scope)`），不进 volume。

## `card-frontend` Scope 定义

`packages/contracts/src/runtime.ts:81-85`：
```ts
export type WorkspaceScope =
  | "effective" | "card-content" | "save-runtime" | "platform-meta" | "card-frontend"
```

`workspace-operations.ts:93`：
```ts
const DEFAULT_SCOPE_ACCESS = {
  "card-content":  { readLevel: 0, editLevel: 2 },
  "save-runtime":  { readLevel: 0, editLevel: 1 },
  "platform-meta": { readLevel: 4, editLevel: 4 },
  "card-frontend": { readLevel: 0, editLevel: 2 },   // 新，和 card-content 同级
}
```

`scopeForPath` (270-278) 加 `frontend/` → `card-frontend` 分支。`resolveStudioWorkspacePath` 加 `frontend/` → card-frontend 解析。

## Timestamp / mediaType 约定

- **timestamp**：volume enumerate/write 返回各自后端时间戳。CardContent（子4 后）真实 per-file；SaveRuntime 真实；LocalAssistant `createdAt:0/updatedAt:now`（文档化为已知约定）；CardFrontend 借 Blob 行 updatedAt。不强制统一（timestamp 对 agent 决策非关键）。
- **mediaType**：volume write 统一 `mediaType ?? inferMediaType(path)`（按扩展名），修现有 card-content/local-assistant 不推断的不一致。`inferMediaType` 复用 `normalizeMediaType`（`workspace.ts:1006`）。

## Tradeoffs

- **方案 A（platform-meta 二级路由）vs B（合并 save-scoped volume）**：倾向 A，scope 区分清晰，二级路由在 dispatch 内显式。
- **CardFrontendVolume enumerate 接入 vs 完全等子3**：倾向接入（前端只读可见，写留子3），让本任务可独立验证 list 路径。
- **拆 SaveRuntime + SavePlatformMeta 两个 volume vs 一个 volume 内分支**：倾向拆（scope 清晰），但都走 `workspaceFiles` 表，实现差异小，决策点。

## Compatibility / Rollback

- 纯路由收敛，不改存储、不改运行时。回滚 = git checkout platform-host 路由层 + 还原 scope 定义。
- staged turn 策略、权限矩阵、UI 行为全保留。

## 为子3 铺路

子3 在本任务产出上：
- 补 `writeLocalGameCardFrontendFile`/`deleteLocalGameCardFrontendFile` 单文件 API（storage）→ 填 `CardFrontendVolume.write/delete` 实现。
- 加 `ManifestVolume`（合成 game-card.json，write 回写 manifest）→ 插 dispatch。
- 内置卡不可见 + fallback rework（A）。
子3 不再碰 host 路由点（已统一），只加 volume 实现 + 插 dispatch。
