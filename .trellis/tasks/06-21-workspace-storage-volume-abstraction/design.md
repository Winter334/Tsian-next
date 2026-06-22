# Design: Workspace Storage Volume Abstraction

## Boundaries

改 host 层（`platform-host/index.ts` + `platform-host/workspace-ops.ts`）+ agent-runtime 轻量（`workspace-operations.ts` 加 scope 定义）+ contracts 轻量（`runtime.ts` 的 `WorkspaceScope` 加成员）。不改运行时核心（`executeWorkspaceOperation`/adapter 接口）、不改存储后端实现（子4 已迁 contentFiles per-file；06-22 已把 mediaType 全删 + 引入二进制 Blob 存储）。

**模块结构现状**（勘察确认）：
- `platform-host/index.ts` — 主 host 入口，含 `executeWorkspaceOperationForActiveSave`（agent runtime 通道，L282-360）。
- `platform-host/workspace-ops.ts` — 已从 index.ts 拆出的 studio/local workspace 操作：`executeStudioWorkspaceOperation`（L361-507）、`executeLocalWorkspaceOperation`（L514-590）、`resolveStudioWorkspacePath`（L138-190）、`listStudioWorkspaceFilesForGameCard`（L116-136）。
- 新模块 `platform-host/workspace-volumes.ts` — 本任务新增：`WorkspaceVolume` 接口 + 4 volume 实现 + 单一 dispatch。保持 host 层归属，workspace-ops 和 index 都调它。

## 设计底层改动对齐（06-22 重构后）

子5 原 design 在 `06-22-storage-refactor-media-viewer`（已归档）之前写的，前提已过时。06-22 完成的破坏性重构：
- **mediaType 全删**：`WorkspaceFile`/`WorkspaceEntry`/`WorkspaceSearchResult`/`WorkspaceOperationRequest`/`LocalWorkspaceFileRecord`/`LocalGameCardContentFileRecord` 均无 `mediaType` 字段。`LocalGameCardFrontendFileRecord` 也删了 mediaType，SW 改读 `data.type`（Blob.type）。唯一保留 mediaType 的是外部 zip manifest 契约（`GameCardContentFile`/`GameCardPackageFileEntry`/`FrontendPackageFileEntry`），不在本任务路由层范围。
- **二进制 Blob 存储**：`WorkspaceFile.binary?: Blob`（与 content 互斥，content 对二进制文件是 placeholder 描述串）；`LocalWorkspaceFileRecord.data?: Blob`、`LocalGameCardContentFileRecord.data?: Blob`（均与 content 互斥）；`LocalGameCardFrontendFileRecord.data: Blob`（必需，无 content 字段，前端文件纯二进制）。
- **content 模型从 text-only 升级为 text + binary 双轨**：agent runtime 只读 `content`（string），不碰 `binary`——对 agent 透明。但 host 路由层必须正确传递 `data`（Blob）给存储 API。
- **`inferMediaTypeFromPath(path, { fallback })`** 已统一（`lib/media-type.ts:14-52`），`inferWorkspaceMediaType` 是其薄包装。`normalizeMediaType` 已删除。
- **DB 已 bump v8**，SW 同步。

本任务的 volume 接口和 dispatch 必须建立在这个双轨模型上。

## `WorkspaceVolume` Interface

位置：新模块 `apps/platform-web/src/platform-host/workspace-volumes.ts`。

```ts
export interface WorkspaceVolumeWriteInput {
  path: string
  /** Text content for text files. Mutually exclusive with `data`. */
  content?: string
  /** Binary payload for media files. Mutually exclusive with `content`. */
  data?: Blob
}

export interface WorkspaceVolume {
  readonly scope: WorkspaceScope
  /** 列该 owner 下所有文件（runtime 在此做 list/glob/search/diff/validate）。
   *  返回 WorkspaceFile 含 binary 字段（媒体文件填 binary，content 给 placeholder）。 */
  enumerate(ownerId: string): Promise<WorkspaceFile[]>
  /** 单文件写，返回写入后的 WorkspaceFile（含时间戳 + binary 若是媒体文件）。 */
  write(ownerId: string, input: WorkspaceVolumeWriteInput): Promise<WorkspaceFile>
  /** 删前缀下所有文件，返回已删 path 列表（递归）。 */
  delete(ownerId: string, pathPrefix: string): Promise<string[]>
}
```

入参 `content`/`data` 双字段对齐 `WorkspaceOperationMutationAdapter.write`（`workspace-operations.ts:23-34`，已是 `{ scope, path, content?, data? }`）——runtime 层在 `workspace-operations.ts:774-789` 已把 `request.content: string | Blob` 拆成 `textContent`/`binaryData` 传给 adapter，dispatch 直接透传。

`ownerId` 语义：card-content/card-frontend volume 是 `cardId`；save-runtime/local-assistant volume 是 `saveId`（local-assistant 实际忽略，全局 meta）。dispatch 负责从 operation context（active card/save）解析出 ownerId 传给 volume。

### 为什么 3 原语足够（勘察依据，不变）

- `read` = `enumerate` 结果里 `find(path)`（运行时从快照读，与现状一致）。
- `move` = `write` + `delete` 循环（`workspace-operations.ts` 已是这模式）。
- `patch` = `write` + 快照 OCC 检查（无 host patch 回调）。
- `diff`/`validate`/`list`/`glob`/`search` = 纯快照计算。
- 运行时层把 10 op 里 7 个自己算了，volume 只暴露 enumerate/write/delete。

## 5 Volumes（4 后端 → 5 volume，save-scoped 拆两个）

### `CardContentVolume`（scope: card-content，ownerId: cardId）

```ts
{
  scope: "card-content",
  enumerate: async (cardId) => (await listLocalGameCardContentFiles(cardId)).map(toWorkspaceFileFromCardContent),
  write: async (cardId, { path, content, data }) => {
    const rec = await writeLocalGameCardContentFile(cardId, { path, content, data })
    // writeLocalGameCardContentFile 内部已 bump card updatedAt（game-cards.ts:498）
    return toWorkspaceFileFromCardContent(rec)
  },
  delete: async (cardId, prefix) => {
    const deleted = await deleteLocalGameCardContentPathForCard(cardId, prefix)
    // deleteLocalGameCardContentPathForCard 内部已 bump card updatedAt
    return deleted
  },
}
```

子4 产出 per-file API（`writeLocalGameCardContentFile: game-cards.ts:467-502`，支持 `data?: Blob`；`deleteLocalGameCardContentPathForCard: game-cards.ts:525-557`）。`toWorkspaceFileFromCardContent` 复用现有映射（`workspace.ts:1132-1151` 的 `toWorkspaceFileFromGameCardContent`，已含 binary 字段填充）。**无需 mediaType 推断**——mediaType 不再存储，消费点按需 `inferMediaTypeFromPath(path)` 派生。

### `CardFrontendVolume`（scope: card-frontend，ownerId: cardId）

本任务框架占位 + enumerate 可用：

```ts
{
  scope: "card-frontend",
  enumerate: async (cardId) => (await listLocalGameCardFrontendFiles(cardId)).map(r => ({
    path: r.path,
    content: "",                         // 前端文件纯二进制，content 给空 placeholder
    binary: r.data,                      // Blob（含 type，SW 用 data.type）
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  })),
  write: async (_cardId, { path }) => {
    // 子3 补 writeLocalGameCardFrontendFile 单文件 API；本任务暂未接入写
    throw new Error("card-frontend write not yet implemented (see task 06-21-game-card-data-fileification)")
  },
  delete: async (_cardId, _prefix) => { /* 同上，子3 补 */ throw ... },
}
```

`LocalGameCardFrontendFileRecord`（`db.ts:46-56`）`data: Blob` 必需、无 content、无 mediaType。enumerate 把 `data` 映射到 `WorkspaceFile.binary`，content 给空串（agent runtime 读 content 是空，不阻塞；前端文件本就不是 agent 读写对象）。

**已定：接入**。本任务让 enumerate 接入 list（前端只读可见，写留子3）。这让本任务可独立验证 list 路径，子3 只补 write/delete。

### `SaveRuntimeVolume`（scope: save-runtime，ownerId: saveId）

```ts
{
  scope: "save-runtime",
  enumerate: async (saveId) => (await listLocalWorkspaceFilesForSave(saveId)).map(toWorkspaceFile),
  write: async (saveId, { path, content, data }) => {
    const rec = await writeWorkspaceFileForSave(saveId, { path, content, data })
    return toWorkspaceFile(rec)
  },
  delete: async (saveId, prefix) => (await deleteWorkspacePathForSave(saveId, prefix)).deletedPaths,
}
```

`writeWorkspaceFileForSave`（`workspace.ts:1685-1692`，支持 `data?: Blob`，仅 save-runtime 路径）；`deleteWorkspacePathForSave`（`workspace.ts:1703-1726`，返回 `{ deletedPaths }`）。`toWorkspaceFile`（`workspace.ts:1111-1130`，已含 binary 填充）。

### `SavePlatformMetaVolume`（scope: platform-meta save-owned，ownerId: saveId）

```ts
{
  scope: "platform-meta",
  enumerate: async (saveId) => (await listLocalWorkspaceFilesForSave(saveId))
    .filter(r => isPlatformMetadataPath(r.path))
    .map(toWorkspaceFile),
  write: async (saveId, { path, content, data }) => {
    const rec = await writePlatformWorkspaceFileForSave(saveId, { path, content, data })
    return toWorkspaceFile(rec)
  },
  delete: async (saveId, prefix) => (await deleteWorkspacePathForSave(saveId, prefix)).deletedPaths,
}
```

`writePlatformWorkspaceFileForSave`（`workspace.ts:1694-1701`，允许 `.tsian/` 路径）。与 `SaveRuntimeVolume` 共用 `workspaceFiles` 表，但走 platform-meta 路径校验。**已定拆成独立 volume**（scope 清晰），虽共用表，实现差异在路径校验。

### `LocalAssistantVolume`（scope: platform-meta local-assistant，ownerId: saveId—but 全局忽略）

local-assistant 文件不在 save 内（跨卡持久），ownerId 语义特殊。`saveLocalAssistantFiles`/`loadLocalAssistantFiles`/`deleteLocalAssistantFile` 不取 ownerId（操作全局 `assistant-local-files` meta key）。

```ts
{
  scope: "platform-meta",   // 但仅 .tsian/local/assistant/ 路径
  enumerate: async (_ownerId) => (await loadLocalAssistantFiles()).map(toWorkspaceFileFromLocalAssistant),
  write: async (_ownerId, { path, content, data }) => { await saveLocalAssistantFiles({[path]: {content, data}}); return {...} },
  delete: async (_ownerId, path) => { await deleteLocalAssistantFile(path); return [path] },
}
```

## platform-meta 二级路由（方案 A）

`platform-meta` scope 跨两个 volume：`.tsian/local/assistant/` → `LocalAssistantVolume`（meta 表）；其它 `.tsian/` save-owned → `SavePlatformMetaVolume`（workspaceFiles 表）。

dispatch 的 `resolveVolumeForScope`：
```ts
function resolveVolumeForScope(scope: WorkspaceScope, path: string, ctx: OwnerContext): WorkspaceVolume {
  if (scope === "platform-meta") {
    return isLocalAssistantPath(path) ? localAssistantVolume : savePlatformMetaVolume
  }
  if (scope === "card-content") return cardContentVolume
  if (scope === "card-frontend") return cardFrontendVolume
  if (scope === "save-runtime") return saveRuntimeVolume
  // effective 不进 dispatch（runtime 在快照层算，不调 mutations）
  throw new Error(`unsupported scope for mutation: ${scope}`)
}
```

`isLocalAssistantPath` 复用现有 helper（`executeLocalWorkspaceOperation` 已用，`workspace-ops.ts` 内）。

## Single Dispatch

```ts
async function executeWorkspaceMutation(input: {
  scope: WorkspaceScope
  path: string
  content?: string
  data?: Blob
  ownerContext: { cardId?: string; saveId?: string }
  operation: "write" | "delete"
}): Promise<WorkspaceFile | string[]> {
  const volume = resolveVolumeForScope(input.scope, input.path, input.ownerContext)
  const ownerId = resolveOwnerId(volume, input.ownerContext)
  if (input.operation === "write") {
    return volume.write(ownerId, { path: input.path, content: input.content, data: input.data })
  }
  return volume.delete(ownerId, input.path)
}
```

`resolveOwnerId`：card-scope volume → `ownerContext.cardId`；save-scope/platform-meta volume → `ownerContext.saveId`；local-assistant → 忽略（传 saveId 但 volume 不用）。

### 3 路由点改造

**`executeWorkspaceOperationForActiveSave`（`index.ts:282-360`）** 的 `mutations` adapter：
```ts
mutations: {
  write: ({ scope, path, content, data }) => executeWorkspaceMutation({
    scope, path, content, data,
    ownerContext: { saveId: activeSaveId, cardId: activeCardId },
    operation: "write",
  }),
  delete: ({ scope, path }) => executeWorkspaceMutation({
    scope, path,
    ownerContext: { saveId: activeSaveId, cardId: activeCardId },
    operation: "delete",
  }),
}
```
删除非 staged 分支的 if/else（原 L320-357 的 card-content/platform-meta/save-runtime 三分支）。**staged turn 路径保留在上层**（见下节"staged turn 保留上层处理"），不进 dispatch。

**`executeStudioWorkspaceOperation`（`workspace-ops.ts:361-507`）**：`resolveStudioWorkspacePath` 解析出 scope + ownerContext，mutations 调 dispatch。删除 save-runtime/card-content 两个分支块（L417-504）。`StudioResolvedPath` union（`workspace-ops.ts:64-77`）要扩 card-frontend 分支。

**`executeLocalWorkspaceOperation`（`workspace-ops.ts:514-590`）**：`.tsian/` Explorer 路径，mutations 调 dispatch（platform-meta scope，二级路由到 local-assistant 或 save-platform-meta）。删除 `isLocalAssistantPath` 的 if/else（L551-585）。

### staged turn 保留上层处理（已定）

`executeWorkspaceOperationForActiveSave` 的 staged turn 路径（`workspaceTransaction` 存在时）**保留在上层，不进 dispatch**。理由：transaction 是"攒变更到事务、turn 结束落盘"的语义，和 dispatch 解决的"路由到哪个后端"是正交问题；塞进 dispatch 会让 volume 接口感知 transaction，复杂度上升，且 staged 时 platform-meta 直接写 vs save-runtime 攒的不一致要在 volume 内部区分，污染 volume 的单一职责。

具体保留：
- staged 时 `scope === "save-runtime"` → `transaction.write`（攒到事务，不变）。
- staged 时 `scope === "platform-meta"` → `writePlatformFile`（直接写，不变）。
- staged 时其它 scope（card-content / card-frontend）→ throw "Runtime turn staging cannot mutate card-content."（原 L317 语义不变，card-frontend 同样禁止）。
- **非 staged 分支**的 if/else（原 L320-357 的 card-content/platform-meta/save-runtime 分支）收敛进 dispatch。

即 `mutations.write` 形态：
```ts
write: ({ scope, path, content, data }) => {
  if (workspaceTransaction) {
    // staged turn：保留上层特殊路径，不进 dispatch
    if (scope === "save-runtime") return transaction.write(...)
    if (scope === "platform-meta") return writePlatformFile(...)
    throw new Error("Runtime turn staging cannot mutate card-content.")
  }
  // 非 staged：走统一 dispatch
  return executeWorkspaceMutation({ scope, path, content, data, ownerContext: {saveId, cardId}, operation: "write" })
}
```
dispatch 职责单一（路由到后端），staged 策略保留在上层。studio/local 两个路由点无 staged 概念，全走 dispatch。

## `card-frontend` Scope 定义

`packages/contracts/src/runtime.ts:87-91`：
```ts
export type WorkspaceScope =
  | "effective" | "card-content" | "save-runtime" | "platform-meta" | "card-frontend"
```

`workspace-operations.ts:93-106` `DEFAULT_SCOPE_ACCESS`：
```ts
const DEFAULT_SCOPE_ACCESS = {
  "card-content":  { readLevel: 0, editLevel: 2 },
  "save-runtime":  { readLevel: 0, editLevel: 1 },
  "platform-meta": { readLevel: 4, editLevel: 4 },
  "card-frontend": { readLevel: 0, editLevel: 2 },   // 新，和 card-content 同级
}
```

`normalizeWorkspaceScope`（`workspace-operations.ts:213-235`）加 `"card-frontend"` 到合法值集合 + supportedScopes 错误详情。

`scopeForPath`（`workspace-operations.ts:270-278`）加 `frontend/` → `card-frontend` 分支（在 platform-meta/save-runtime 之后、card-content 默认之前）。加 `isCardFrontendPath(path)` helper（`path === "frontend" || path.startsWith("frontend/")`）。

`resolveStudioWorkspacePath`（`workspace-ops.ts:138-190`）加 `frontend/` → card-frontend 解析分支，`StudioResolvedPath` union 加 `{ scope: "card-frontend", displayPath, storagePath, cardId }`。

## Timestamp 约定

- volume 的 `enumerate`/`write` 返回 WorkspaceFile 带各自后端时间戳。CardContent（子4 后）真实 per-file；SaveRuntime 真实；LocalAssistant `createdAt:0/updatedAt:now`（文档化为已知约定）；CardFrontend 借 Blob 行 updatedAt。
- timestamp 对 agent 决策非关键，不强制统一。

## Tradeoffs

- **方案 A（platform-meta 二级路由）vs B（合并 save-scoped volume）**：已定 A，scope 区分清晰，二级路由在 dispatch 内显式。
- **CardFrontendVolume enumerate 接入 vs 完全等子3**：已定接入（前端只读可见，写留子3），让本任务可独立验证 list 路径。
- **拆 SaveRuntime + SavePlatformMeta 两个 volume vs 一个 volume 内分支**：已定拆（scope 清晰），共用 workspaceFiles 表，差异在路径校验。
- **volume 模块位置**：已定新模块 `workspace-volumes.ts`，被 index.ts 和 workspace-ops.ts 共同调用（不放进 workspace-ops.ts 避免该模块膨胀）。
- **staged turn transaction 透传**：已定保留 staged 上层处理，dispatch 只收敛非 staged（见"staged turn 保留上层处理"节）。

## Compatibility / Rollback

- 纯路由收敛，不改存储、不改运行时。回滚 = git checkout platform-host 路由层 + 还原 scope 定义 + 删 workspace-volumes.ts。
- staged turn 策略、权限矩阵、UI 行为全保留。
- binary 传递是新引入的路径，但存储 API 已支持 `data?: Blob`（06-22 完成），dispatch 只做透传。

## 为子3 铺路

子3 在本任务产出上：
- 补 `writeLocalGameCardFrontendFile`/`deleteLocalGameCardFrontendFile` 单文件 API（storage）→ 填 `CardFrontendVolume.write/delete` 实现。
- 加 `ManifestVolume`（合成 game-card.json，write 回写 manifest）→ 插 dispatch。
- 内置卡不可见 + fallback rework（A）。
子3 不再碰 host 路由点（已统一），只加 volume 实现 + 插 dispatch + scopeForPath/resolveStudioWorkspacePath 的 manifest 分支。
