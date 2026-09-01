# 工作区路径级 scope 重构

## Goal

把 workspace 操作的 scope 模型从"操作级单 scope"重构为"路径级 scope"：scope 是路径的派生属性（`scopeForPath(path)`），不是操作的属性。一次操作涉及的每个路径各自走自己的 scope 派生，跨 scope copy/move 成为自然能力而非打补丁。修掉 `6284a8a` 引入的 5 个隐患，并为后续新增 scope/store 扫清地基。

## Background

`6284a8a`（fix workspace copy and assistant interruption UI）给 copy/move 加跨 scope 支持时，在"单 scope 地基"上盖"双 scope 楼"，导致：

- **隐患1（严重）**：local 路径 `executeLocalWorkspaceOperation` 的 read/list/search 硬编码 `scope: "platform-meta"`（workspace-ops.ts:576/583/590），write/delete/move/copy 却放开 scope（595-597）。同一 `save/xxx` 路径，read 用 platform-meta → `findScopedFile` 因 `scopeForPath("save/xxx")=save-runtime ≠ platform-meta` 找不到；move 用 operationScope(save-runtime) → 能找到。**读不到但移得动**。
- **隐患2（严重）**：跨 scope 时 `assertEditAccess(toPath)` 按 `accessForPath(toPath)=DEFAULT_SCOPE_ACCESS[scopeForPath(toPath)]` 校验，不同 scope editLevel 不同（save-runtime=1, card-content=2, platform-meta=4）。local read 用 platform-meta 硬编码，access level 体系错配。
- **隐患3（中）**：`movePlatformWorkspacePath`（workspace-ops.ts:797）分支：`targetCardId = input.targetCardId ?? input.cardId`，当只传 cardId 时 `targetCardId === cardId`，第一个分支 `targetCardId && (isTsian...)` 为真就走 crossRoot——同卡 .tsian 操作误走 crossRoot，而 crossRoot 禁止 save 路径，合法操作被拒。
- **隐患4（中）**：`assertCompatibleStudioMove` 删掉 scope-mismatch 禁令后，studio card-content 分支的 mutation ownerContext 仍按 `targetResolvedPath` 推导 saveId（workspace-ops.ts:528-541），delete 源文件时 `mutations.delete({scope: fromScope})` 用了 target 的 saveId。被 `resolveOwnerId` 对 card-scope 忽略 saveId 掩盖，但语义错配。
- **隐患5（轻）**：`copyWorkspacePath` target-exists 检查 `findScopedFile(files, toScope, nextPath)`，files 是调用方传入的快照，studio 路径 files 可能只含部分 scope，target-exists 漏判导致覆盖。

## Requirements

- `R1` scope 路径化：`scopeForPath(path)` 是 scope 的唯一真相源。operation 级 `scope` 参数降为可选的显式约束（防御性，校验 path 属于该 scope），不再作为 mutation 路由的主依据。
- `R2` 读/写视野统一：read/list/search 在合并多 scope 文件的上下文里用 `effective`（能看到所有 scope），不再硬编码单 scope。write/edit/delete/move/copy 按 path 派生 scope 路由。
- `R3` 跨 scope copy/move 显式双路径校验：`assertReadAccess(fromPath)` + `assertEditAccess(toPath)`，source 过滤用 `scopeForPath(fromPath)`，write mutation 用 `scopeForPath(toPath)`，delete 源用 `scopeForPath(fromPath)`。不再依赖操作级 scope 做 source-mismatch 断言。
- `R4` ownerContext 按 mutation input 的 scope 推导：mutation adapter 的 write/delete input 带 `ownerContext`，由 host adapter 闭包按 `input.scope` 填 cardId/saveId（card-scope→activeCardId，save-scope→saveId）。volume 层不动。
- `R5` host 三条路径分支按"涉及 scope 集合"统一：合并 `scopeForPlatformWorkspacePath` 到 `scopeForPath`（补 temp 分支）。分支条件从"cardId/isTsianPath 字符串特征"改为"操作涉及的 scope 是否单一 + 是否需跨 store"。
- `R6` 结果类型直接改（不向后兼容）：`WorkspaceMoveResult`/`WorkspaceCopyResult` 的 `scope` 字段改为 `fromScope` + `toScope`，所有消费方一并改。项目开发期间不留兼容包袱。
- `R7` staged-turn 边界保留：`executeWorkspaceOperationForActiveSave` 的 staged 事务限制（只写 platform-meta/save-runtime，不写 card-content）保持不动。
- `R8` 行为兼容：单 scope 内的 read/write/edit/delete/move/copy 行为不变。跨 scope 操作在 actor 权限足够时正常工作，不足时由 `assertEditAccess(toPath)` 自然拦截（editLevel 跨 scope 差异是真实权限屏障，保留）。

## Non-Goals

- 不改 tool-schemas（模型仍只传 path/targetPath，scope 由路径推导，无需 schema 变动）。
- 不引入测试框架（项目无测试体系，验证用 build + 手动）。
- 不重构 volume 层（`resolveVolumeForScope`/`resolveOwnerId` 已基本路径驱动，保持）。
- 不改 `DEFAULT_SCOPE_ACCESS` 权限表（跨 scope editLevel 差异是特性）。

## Acceptance Criteria

- [ ] `scopeForPath` 是 scope 唯一真相源；operation 级 `scope` 仅作可选显式约束
- [ ] local 上下文 read/list/search 用 `effective`，与 write 视野一致（隐患1 修复）
- [ ] copy/move 用 `scopeForPath(fromPath)`/`scopeForPath(toPath)` 显式双路径校验，不再用操作级 scope 做 source-mismatch 断言（隐患2/3 修复）
- [ ] mutation adapter write/delete input 带 `ownerContext`，host 闭包按 input.scope 填充（隐患4 修复）
- [ ] `scopeForPlatformWorkspacePath` 合并到 `scopeForPath`，host 分支按 scope 集合统一（隐患5 + 重复消除）
- [ ] `WorkspaceMoveResult`/`WorkspaceCopyResult` 改为 `fromScope`+`toScope`，消费方同步更新
- [ ] `build:web` + `build:contracts` 通过

## Open Decisions

- 暂无。ownerContext 推导位置（mutation adapter input）、结果类型兼容策略（不向后兼容）已确认。

## Decisions

- `D1` ownerContext 在 mutation adapter 的 write/delete input 里带，host adapter 闭包按 `input.scope` 填充 cardId/saveId。volume 层 `executeWorkspaceMutation` 不变。理由：最小侵入，保留 staged-turn 特殊路径，volume 层职责不扩大。
- `D2` 结果类型不向后兼容：`WorkspaceMoveResult`/`WorkspaceCopyResult` 直接把 `scope` 改为 `fromScope`+`toScope`，所有消费方一并改。项目开发期间不留兼容字段，避免堆积包袱。
- `D3` operation 级 `scope` 参数保留为可选显式约束（方案 A），不废弃。内部所有 scope 决策走 `scopeForPath(path)`；`scope` 传具体值时校验 path 属于该 scope，传 `effective` 或省略时跨 scope。
