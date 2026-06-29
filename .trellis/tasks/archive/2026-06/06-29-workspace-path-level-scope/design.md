# 工作区路径级 scope 重构 Design

## Overview

把 workspace 操作的 scope 模型从"操作级单 scope"重构为"路径级 scope"。`scopeForPath(path)` 已存在且是权限检查（`accessForPath`→`scopeForPath`，`assertEditAccess`/`assertReadAccess`）的真相源——operation 级 `scope` 在权限层本就是冗余的，只在 mutation 路由（`resolveVolumeForScope`）和文件过滤（`pathMatchesScope`）用。本重构把 mutation 路由也改成路径派生，让 `scope` 退为可选显式约束。

copy/move 已经在内部用 `scopeForPath` 派生 fromScope/toScope 路由 mutation（workspace-operations.ts:1125-1126/1192-1193），但 gate（`pathMatchesScope(fromPath, scope)` 断言）和 result（只回 source scope）还停在单 scope 模型。本重构把这两处也摆正。

## 核心抽象转变

**现状**：`executeWorkspaceOperation(request, context)` 入参 `request.scope` 是单数，所有 handler 用它过滤文件 + 校验 + 路由 mutation。

**目标**：`scope` 仍是入参（可选显式约束），但内部所有 scope 决策都走 `scopeForPath(path)`。`scope === "effective"` 表示跨 scope 视野（读操作 + 跨 scope copy/move 的文件聚合），具体 scope 仅用于"调用方声明我只动这个 scope"的防御性断言。

## 层级职责

- **runtime 层**（`workspace-operations.ts`）：`scopeForPath` 是唯一派生源。read/list/search/glob 接受 `effective` 看全 scope。write/edit/delete 用 `scopeForPath(path)` 路由 mutation + 校验显式 scope（若传了且非 effective）。copy/move 用 fromScope/toScope 双路径，mutation 各走各的 scope。
- **mutation adapter**（`workspace-operations-types.ts`）：`write`/`delete` input 新增 `ownerContext: WorkspaceVolumeOwnerContext`。runtime 层不填 ownerContext（它不知 cardId/saveId），由 host adapter 闭包按 `input.scope` 填。
- **host 层**（`workspace-ops.ts` + `platform-host/index.ts`）：3 条路径的 adapter 闭包统一按 `input.scope` 推导 ownerContext（card-scope→`getPlatformActiveGameCardId()`，save-scope→saveId，platform-meta save-owned→saveId，local-assistant→忽略）。分支按"涉及 scope 集合"而非字符串特征。
- **volume 层**（`workspace-volumes.ts`）：不动。`executeWorkspaceMutation` 仍收 `{scope, path, ownerContext}`，`resolveVolumeForScope`/`resolveOwnerId` 已路径驱动。

## ownerContext 推导（host adapter 闭包统一）

adapter 闭包按 `input.scope` 填 ownerContext：
- `card-content` / `card-frontend` → `cardId = await getPlatformActiveGameCardId()`，saveId undefined
- `save-runtime` → `saveId = activeSaveId`，cardId undefined
- `platform-meta` → savePlatformMetaVolume 需 saveId（local-assistant/local-config 子路由忽略 ownerId，但 save-owned 需），传 `saveId = activeSaveId`
- `temp` → sessionId（附件 volume，本任务不涉及）

staged-turn 路径（`executeWorkspaceOperationForActiveSave` 的 `input.workspaceTransaction` 分支）保留原特殊处理（`writePlatformFile`/`transaction.write`），仅 ownerContext 填充方式统一。

## host 分支统一

合并 `scopeForPlatformWorkspacePath`（workspace-ops.ts:661-666，漏 temp 分支）→ `scopeForPath`（workspace-operations.ts:333-347，完整）。host 改用导出的 `scopeForPath`。

`movePlatformWorkspacePath`/`copyPlatformWorkspacePath` 分支改为按 fromScope/toScope 的 scope 集合判定：
1. 算 `fromScope = scopeForPath(path)`、`toScope = scopeForPath(targetPath)`
2. 涉及 `save/` 且跨 store（local ↔ card）→ crossRoot（保留 save 跨 store 禁令）
3. 都在 local .tsian（fromScope/toScope 均为 platform-meta 且无 cardId）→ local
4. 都在同 card（有 cardId 且非 crossRoot）→ studio
5. 不再以 `targetCardId ?? cardId` 误判（修隐患3）

## 结果类型（不向后兼容）

```ts
WorkspaceMoveResult  { fromScope, toScope, fromPath, toPath, movedPaths }
WorkspaceCopyResult  { fromScope, toScope, fromPath, toPath, copiedPaths }
```

消费方：
- `workspace-ops.ts:477-489` studio 结果映射改用 fromScope/toScope
- runtime observation formatter（`formatNativeToolObservationContent`/`formatRuntimeWorkspaceToolObservationMessage`）同步

## 权限边界（保留）

`DEFAULT_SCOPE_ACCESS` 跨 scope editLevel 差异是真实权限屏障：

| Scope | readLevel | editLevel |
|-------|-----------|-----------|
| card-content | 0 | 2 |
| save-runtime | 0 | 1 |
| platform-meta | 4 | 4 |
| card-frontend | 0 | 2 |
| temp | 0 | 0 |

跨 scope move/copy 时 `assertEditAccess(toPath)` 按 toScope 校验——level-1 actor（常见 agent runtime）能写 save-runtime 但被 card-content(2)/platform-meta(4) 拦截。这是特性，重构保留，不额外放行。

## Validation

- `npm run build:contracts`（Phase 1 后）
- `npm run build:web`（Phase 2/3/4 后）
- 手动验证：
  - 同 scope move/copy 行为不变
  - 跨 scope move/copy（save→card-content 需 level≥2）正常工作或被权限拦截
  - local .tsian read + move 视野一致（读得到才移得动）
  - staged-turn 写限制保留（不能写 card-content）
