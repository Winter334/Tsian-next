# 工作区路径级 scope 重构 Implementation Plan

## Phase 1: contracts + 类型层

- `packages/contracts/src/runtime.ts`：`WorkspaceMoveResult`/`WorkspaceCopyResult` 把 `scope: WorkspaceScope` 改为 `fromScope: WorkspaceScope` + `toScope: WorkspaceScope`（删 `scope`，不向后兼容）。
- `apps/platform-web/src/agent-runtime/workspace-operations-types.ts`：`WorkspaceOperationMutationAdapter` 的 `write` input 加 `ownerContext: WorkspaceVolumeOwnerContext`，`delete` input 同样加。`WorkspaceVolumeOwnerContext` 从 `platform-host/workspace-volumes.ts` 导入或提升到 contracts（避免 agent-runtime 依赖 platform-host，考虑放 contracts）。
- `npm run build:contracts` 验证。

## Phase 2: runtime 层 path-level scope

- `apps/platform-web/src/agent-runtime/workspace-operations.ts`：
  - 导出 `scopeForPath`（供 host 复用，合并掉 host 的重复实现）。
  - `writeWorkspaceFile`/`editWorkspaceFile`/`deleteWorkspacePath`：mutation 调用改为传 `scopeForPath(path)`（而非入参 scope）作为 mutation input.scope；ownerContext 字段留空或由 host 填（runtime 层不知 cardId/saveId，传 undefined，host 闭包覆盖）。入参 `scope` 降为可选显式约束：传了具体 scope 且非 effective 时，断言 `pathMatchesScope(path, scope)`；传 effective 或省略则跳过断言。
  - `moveWorkspacePath`/`copyWorkspacePath`：移除 `pathMatchesScope(fromPath, scope)` 断言，改为纯 fromScope/toScope 双路径（已用 `scopeForPath` 派生，只需删断言 + 调整 result）。result 用 `fromScope`/`toScope`。
  - read/list/search/glob：本就支持 `effective`，无需改 runtime 层；仅需 host 层不再硬编码单 scope（Phase 3）。
- `npm run build:web` 验证（此 Phase 后 host 还没改，可能有类型错误暴露 ownerContext 必填，预期）。

## Phase 3: host 层统一

- `apps/platform-web/src/platform-host/workspace-ops.ts`：
  - 删 `scopeForPlatformWorkspacePath`，改用从 `workspace-operations.ts` 导入的 `scopeForPath`。
  - `executeLocalWorkspaceOperation`：read/list/search 改 `scope: "effective"`（修隐患1）；write/delete/move/copy 的 adapter 闭包按 `input.scope` 填 ownerContext（card-scope→activeCardId，save-scope→saveId，platform-meta→saveId）。
  - `executeStudioWorkspaceOperation`：adapter 闭包 ownerContext 按 `input.scope` 填（删 target-derived saveId 错配，修隐患4）；card-content/save-runtime 两分支的 ownerContext 推导统一为"按 input.scope 决定"。
  - `executeCrossRootWorkspaceOperation`：adapter 闭包 ownerContext 按 `input.scope` 填。
  - `movePlatformWorkspacePath`/`copyPlatformWorkspacePath`：分支按 fromScope/toScope scope 集合重写（修隐患3）：涉及 save 且跨 store → crossRoot；都在 local .tsian → local；都在同 card → studio。
  - studio 结果映射（477-489）改用 fromScope/toScope。
- `apps/platform-web/src/platform-host/index.ts`：`executeWorkspaceOperationForActiveSave` 的 adapter 闭包 ownerContext 按 `input.scope` 填（staged 路径保留 `writePlatformFile`/`transaction.write` 特殊处理，仅 ownerContext 填充统一）。
- `npm run build:web` 验证。

## Phase 4: observation + 验证

- `apps/platform-web/src/agent-runtime/workspace-tools.ts`：`formatNativeToolObservationContent`/`formatRuntimeWorkspaceToolObservationMessage` 的 move/copy observation 改用 fromScope/toScope（若有引用 result.scope 的地方）。
- `npm run build:web` + `npm run build:contracts`。
- 手动验证：
  - 同 scope move/copy 行为不变
  - 跨 scope move/copy（save→card-content 需 level≥2）正常工作或被权限拦截
  - local .tsian read + move 视野一致（读得到才移得动，修隐患1）
  - staged-turn 写限制保留（不能写 card-content）
  - crossRoot save 跨 store 禁令保留

## 风险与回退

- 改动面：contracts(2 类型) + workspace-operations.ts(核心) + workspace-ops.ts(host) + index.ts(adapter) + workspace-tools.ts(observation)。约 5 文件。
- 无测试，靠 build + 手动。每个 Phase 后 build 一次。
- 回退点：Phase 2/3 各自可 git revert，contracts 改动小且独立。
- ownerContext 类型位置风险：若放 contracts 则 contracts 依赖 volume 层类型；若在 agent-runtime 本地定义则 host 要适配。倾向于在 contracts 定义 `WorkspaceVolumeOwnerContext`（它本就是跨层契约），volume 层改用 contracts 的定义。
