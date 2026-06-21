# Implement: Workspace Storage Volume Abstraction

## Execution Checklist

### Step 1: card-frontend scope 定义
- [ ] `packages/contracts/src/runtime.ts:81-85`：`WorkspaceScope` 加 `"card-frontend"`。
- [ ] `workspace-operations.ts:93` `DEFAULT_SCOPE_ACCESS` 加 `"card-frontend": { readLevel: 0, editLevel: 2 }`。
- [ ] `scopeForPath` (270-278) 加 `frontend/` → `card-frontend` 分支。
- [ ] **验证**：`build:contracts && build:runtime-core` 通过。

### Step 2: WorkspaceVolume 接口 + 4 volume 实现
- [ ] 新模块 `platform-host/workspace-volumes.ts`（或 platform-host 内）：定义 `WorkspaceVolume` 接口（3 原语）。
- [ ] `CardContentVolume`（scope card-content，调子4 的 per-file API）。
- [ ] `SaveRuntimeVolume`（scope save-runtime，调 `listLocalWorkspaceFilesForSave`/`writeWorkspaceFileForSave`/`deleteWorkspacePathForSave`）。
- [ ] `SavePlatformMetaVolume`（scope platform-meta save-owned，调 `writePlatformWorkspaceFileForSave`）——或合并进 SaveRuntime（决策点）。
- [ ] `LocalAssistantVolume`（scope platform-meta local-assistant，调 `loadLocalAssistantFiles`/`saveLocalAssistantFiles`/`deleteLocalAssistantFile`）。
- [ ] `CardFrontendVolume`（scope card-frontend，enumerate 用 `listLocalGameCardFrontendFiles`+blob.text()；write/delete 占位 throw，待子3）。
- [ ] 统一 `inferMediaType` 回退（复用 `normalizeMediaType`）。
- [ ] **验证**：`build:web` 通过。

### Step 3: 单一 dispatch
- [ ] `platform-host`：加 `resolveVolumeForScope(scope, path, ownerContext)`（含 platform-meta 二级路由 isLocalAssistantPath）。
- [ ] 加 `resolveOwnerId(scope, ownerContext)`（card-scope → cardId；save-scope → saveId；local-assistant → 忽略）。
- [ ] 加 `executeWorkspaceMutation({scope, path, content?, mediaType?, ownerContext, operation})` 调 volume。
- [ ] **验证**：dispatch 路由表覆盖所有 scope×path 组合。

### Step 4: 3 路由点改造
- [ ] `executeWorkspaceOperationForActiveSave` (1059-1137)：mutations adapter 改调 `executeWorkspaceMutation`，ownerContext = {saveId, cardId}。保留 staged turn 策略检查（dispatch 前 assert）。
- [ ] `executeStudioWorkspaceOperation` (3188-3334)：resolvedPath → scope+ownerContext，mutations 调 dispatch。删 save-runtime/card-content 分支块。
- [ ] `executeLocalWorkspaceOperation` (3341-3416)：.tsian/ 路径 mutations 调 dispatch（platform-meta 二级路由）。
- [ ] `resolveStudioWorkspacePath` (698-750) 加 `frontend/` → card-frontend 解析。
- [ ] **验证**：`build:web` 通过。

### Step 5: run_script SDK 路径确认
- [ ] `browser-skill-script-executor.ts:441-493` `handleSdkRequest`：确认 workspace.* 经同一 `executeWorkspaceOperation`（runtime）→ mutations adapter（host）→ dispatch。SDK 不直接调 volume。
- [ ] 确认 SDK 默认 scope（read=effective, write=save-runtime）经 dispatch 正确路由。
- [ ] **验证**：SDK workspace.write 经 dispatch 落对的 volume。

### Step 6: CardFrontendVolume enumerate 接入（可选，决策点）
- [ ] 若选"前端只读可见"：把 `CardFrontendVolume.enumerate` 接入 `listStudioWorkspaceFilesForGameCard`/`listEffectiveWorkspaceFilesForSave`/`runAssistantChat` 工作区组装。
- [ ] 前端文件在 Explorer/助手 list 出现（只读，写 throw 友好提示待子3）。
- [ ] **验证**：Explorer 见 frontend/*（只读）。

### Step 7: build + 冲烟
- [ ] `npm run build:contracts && build:runtime-core && build:web` 三绿。
- [ ] dev 冲烟：Explorer 编辑 card-content（经 dispatch）→ 保存正常；助手 workspace_write save-runtime → 正常；Studio Explorer 编辑 save 文件 → 正常；.tsian/local/assistant 经 Explorer（若可达）→ 正常；SDK（若可触发）workspace.write → 正常。
- [ ] 确认路由键统一（全走 scope+path-prefix，无残留 ad-hoc 分支）。
- [ ] 现有功能不回归。
- [ ] **验证**：全过。

### Step 8: 收口
- [ ] spec 更新（state-management：WorkspaceVolume 接口 + 单一 dispatch + card-frontend scope + platform-meta 二级路由；type-safety：WorkspaceScope 新成员）。
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
- Step 3-4 后：git checkout platform-host 路由层（还原 3 路由点）。
- 纯路由收敛，无数据迁移，回滚安全。

## Review Gates

- Step 2 后 review 4 volume 实现正确性（enumerate/write/delete 映射到对的存储 API）。
- Step 4 后 review dispatch 路由表完整（无 scope×path 漏接）+ staged turn 策略保留。
- Step 7 三绿 + 冲烟全过是硬 gate。
- 关键验证：3 个原路由点的所有 scope×path 组合都经 dispatch 正确路由（无回归）。
