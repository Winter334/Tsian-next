# Implement: Workspace Storage Volume Abstraction

## 实现状态（2026-06-22）

✅ Step 1-7 代码完成，三绿通过（contracts + runtime-core + web）。
✅ ad-hoc 残留检查：3 路由点非 staged 分支全走 dispatch，staged 路径保留上层（符合决策）。
✅ dead code 清理：`writeCardContentFileForCard`/`deleteCardContentPathForCard`/`writeWorkspaceFileForSave`/`deleteWorkspacePathForSave`/`writeCardContentFileForActiveCard`/`deleteCardContentPathForActiveCard` 的 dead import 已删（assistant-chat.ts 的 staged 路径仍用这些 helper，定义保留）。
⏳ dev 冲烟：留给用户手动验证（清单见下方 Step 7）。
✅ spec 更新：state-management.md 加 "Workspace Volume Abstraction And Single Dispatch" scenario；type-safety.md L321/L333 过时引用更新为 dispatch 描述。
⏳ commit：留给用户确认。
⏳ 移交子3：volume 框架就绪，子3 补 CardFrontendVolume.write/delete + ManifestVolume + 内置卡不可见。

## Execution Checklist

### Step 1: card-frontend scope 定义
- [ ] `packages/contracts/src/runtime.ts:87-91`：`WorkspaceScope` 加 `"card-frontend"`。
- [ ] `workspace-operations.ts:93-106` `DEFAULT_SCOPE_ACCESS` 加 `"card-frontend": { readLevel: 0, editLevel: 2 }`。
- [ ] `normalizeWorkspaceScope`（`workspace-operations.ts:213-235`）加 `"card-frontend"` 到合法值集合 + supportedScopes 错误详情。
- [ ] `scopeForPath`（`workspace-operations.ts:270-278`）加 `frontend/` → `card-frontend` 分支 + `isCardFrontendPath(path)` helper。
- [ ] **验证**：`npm run build:contracts && npm run build:runtime-core` 通过。

### Step 2: WorkspaceVolume 接口 + 5 volume 实现
- [ ] 新模块 `platform-host/workspace-volumes.ts`（已定位置）：定义 `WorkspaceVolume` 接口（3 原语，write 入参 `{ path, content?, data? }`）+ `WorkspaceVolumeWriteInput`。被 index.ts 和 workspace-ops.ts 共同 import。
- [ ] `CardContentVolume`（scope card-content，调 `writeLocalGameCardContentFile: game-cards.ts:467-502` 支持 `data?: Blob`；`deleteLocalGameCardContentPathForCard: game-cards.ts:525-557`；enumerate 用 `listLocalGameCardContentFiles` + `toWorkspaceFileFromGameCardContent: workspace.ts:1132-1151` 已含 binary）。
- [ ] `SaveRuntimeVolume`（scope save-runtime，调 `writeWorkspaceFileForSave: workspace.ts:1685-1692`；`deleteWorkspacePathForSave: workspace.ts:1703-1726`；enumerate 用 `listLocalWorkspaceFilesForSave` + `toWorkspaceFile: workspace.ts:1111-1130`）。
- [ ] `SavePlatformMetaVolume`（scope platform-meta save-owned，调 `writePlatformWorkspaceFileForSave: workspace.ts:1694-1701`；enumerate 过滤 `isPlatformMetadataPath`；delete 复用 `deleteWorkspacePathForSave`）。
- [ ] `LocalAssistantVolume`（scope platform-meta local-assistant，调 `loadLocalAssistantFiles`/`saveLocalAssistantFiles`/`deleteLocalAssistantFile`；ownerId 忽略）。
- [ ] `CardFrontendVolume`（scope card-frontend，enumerate 用 `listLocalGameCardFrontendFiles: game-cards.ts:571-584`，map 到 `{ path, content: "", binary: r.data, createdAt, updatedAt }`；write/delete 占位 throw，待子3）。
- [ ] **无需 mediaType 推断步骤**（06-22 已统一 `inferMediaTypeFromPath`，mediaType 不再存储，消费点按需派生）。
- [ ] **验证**：`npm run build:web` 通过。

### Step 3: 单一 dispatch
- [ ] `workspace-volumes.ts`：加 `resolveVolumeForScope(scope, path, ownerContext)`（含 platform-meta 二级路由 `isLocalAssistantPath`）。
- [ ] 加 `resolveOwnerId(volume, ownerContext)`（card-scope → cardId；save-scope/platform-meta → saveId；local-assistant → 忽略）。
- [ ] 加 `executeWorkspaceMutation({ scope, path, content?, data?, ownerContext, operation })` 调 volume。
- [ ] **验证**：dispatch 路由表覆盖所有 scope×path 组合（card-content / card-frontend / save-runtime / platform-meta×[local-assistant | save-owned]）。

### Step 4: 3 路由点改造
- [ ] `executeWorkspaceOperationForActiveSave`（`index.ts:282-360`）：mutations adapter 改造——**staged turn 路径保留在上层**（`workspaceTransaction` 存在时：save-runtime→`transaction.write`、platform-meta→`writePlatformFile`、card-content/card-frontend→throw，原 L301-318 语义不变）；**非 staged 分支**收敛进 `executeWorkspaceMutation`，ownerContext = {saveId, cardId}，删除原 L320-357 的 card-content/platform-meta/save-runtime 三分支。详见 design "staged turn 保留上层处理" 节。
- [ ] `executeStudioWorkspaceOperation`（`workspace-ops.ts:361-507`）：`resolveStudioWorkspacePath` → scope+ownerContext，mutations 调 dispatch。删 save-runtime/card-content 两个分支块（L417-504）。
- [ ] `executeLocalWorkspaceOperation`（`workspace-ops.ts:514-590`）：`.tsian/` 路径 mutations 调 dispatch（platform-meta 二级路由）。删 `isLocalAssistantPath` if/else（L551-585）。
- [ ] `resolveStudioWorkspacePath`（`workspace-ops.ts:138-190`）加 `frontend/` → card-frontend 解析分支；`StudioResolvedPath` union（`workspace-ops.ts:64-77`）加 `{ scope: "card-frontend", displayPath, storagePath, cardId }`。
- [ ] **验证**：`npm run build:web` 通过。staged turn 路径行为不回归（runtime turn 改 card-content 仍 throw）。

### Step 5: run_script SDK 路径确认
- [ ] `browser-skill-script-executor.ts` `handleSdkRequest`：确认 workspace.* 经同一 `executeWorkspaceOperation`（runtime）→ mutations adapter（host）→ dispatch。SDK 不直接调 volume。
- [ ] 确认 SDK 默认 scope（read=effective, write=save-runtime）经 dispatch 正确路由。
- [ ] 确认 binary 写入路径：SDK 若传 Blob content → runtime 拆成 data → adapter → dispatch → volume.write(data) → 存储 API。
- [ ] **验证**：SDK workspace.write 经 dispatch 落对的 volume（含 binary 情形）。

### Step 6: CardFrontendVolume enumerate 接入 list（已定：接入）
- [ ] `listStudioWorkspaceFilesForGameCard`（`workspace-ops.ts:116-136`）：注入 `CardFrontendVolume.enumerate(cardId)` 结果（前端文件只读可见）。
- [ ] `listEffectiveWorkspaceFilesForSave`（`workspace.ts:1363-1381`）：注入前端文件 enumerate（save 视角也见前端）。
- [ ] `runAssistantChat` 工作区组装：确认前端文件出现在助手工作区文件集。
- [ ] 前端文件在 Explorer/助手 list 出现（只读，write throw 友好提示待子3）。
- [ ] **验证**：Explorer 见 frontend/*（只读），点开走媒体查看器或文本查看器（按 binary 是否是媒体）。

### Step 7: build + 冲烟
- [ ] `npm run build:contracts && build:runtime-core && build:web` 三绿。
- [ ] dev 冲烟：
  - Explorer 编辑 card-content 文本文件（经 dispatch）→ 保存正常。
  - Explorer 编辑 card-content 媒体文件（经 dispatch，binary 路径）→ 保存正常，媒体查看器能看。
  - 助手 workspace_write save-runtime（文本 + binary）→ 正常。
  - Studio Explorer 编辑 save 文件 → 正常。
  - `.tsian/local/assistant` 经 Explorer（若可达）→ 正常。
  - SDK（若可触发）workspace.write（文本 + binary）→ 正常。
  - Explorer 见 frontend/*（只读），写触发友好提示。
- [ ] 确认路由键统一（全走 scope+path-prefix，无残留 ad-hoc 分支）。
- [ ] 现有功能不回归（库/详情/前端/play/助手/save/媒体查看器）。
- [ ] **验证**：全过。

### Step 8: 收口
- [ ] spec 更新：
  - state-management：WorkspaceVolume 接口（3 原语，content/data 双字段）+ 单一 dispatch + card-frontend scope + platform-meta 二级路由 + binary 透传约定。
  - type-safety：WorkspaceScope 新成员 + StudioResolvedPath 扩 card-frontend。
- [ ] commit（用户确认后）。
- [ ] 移交子3（volume 框架就绪，子3 补 CardFrontendVolume.write/delete + ManifestVolume + 内置卡不可见）。

## Validation Commands

```bash
npm run build:contracts
npm run build:runtime-core
npm run build:web
npm run dev:web   # 冲烟
```

## Rollback Points

- Step 1-2 后：还原 scope 定义 + 删 volume 模块。
- Step 3-4 后：git checkout platform-host 路由层（还原 3 路由点）+ 还原 StudioResolvedPath。
- 纯路由收敛，无数据迁移，回滚安全。

## Review Gates

- Step 2 后 review 5 volume 实现正确性（enumerate/write/delete 映射到对的存储 API；binary 字段正确填充；SaveRuntime 与 SavePlatformMeta 路径校验分流正确）。
- Step 4 后 review dispatch 路由表完整（无 scope×path 漏接）+ staged turn 路径保留在上层未回归（runtime turn 改 card-content/card-frontend 仍 throw；transaction.write 攒变更语义不变）。
- Step 7 三绿 + 冲烟全过是硬 gate。
- 关键验证：
  - 3 个原路由点的所有 scope×path 组合都经 dispatch 正确路由（无回归）。
  - binary 文件（媒体）经 dispatch 正确透传 data → 存储 API（新增维度，06-22 引入）。
  - 前端文件 enumerate 接入 list 不破坏现有 save/card-content 合并逻辑。
