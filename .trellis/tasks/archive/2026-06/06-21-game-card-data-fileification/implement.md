# Implement: Game Card Data Fileification

> **重写于 2026-06-22**。原 implement 的行号和部分 step 已由子5 完成（enumerate 接入、frontend/ 路径解析、card-frontend scope 定义）。本次重写基于当前代码现状，去掉已完成项，加漂移适配。

## 执行顺序总览

```
Phase A (builtin 隐形 + fallback) → Phase B (manifest + 前端写) → Phase 收口
```

A 是用户可见行为变化（库不显示 builtin、自动创建默认卡），B 是数据文件化能力。A/B 相对独立但共享 `createDefaultEditableCard` helper（A1/A3 共用）。建议 A 先做（行为简单、验证快），B 后做（涉及 volume + storage + 路由）。

## Phase A: Builtin Invisible + Fallback Rework

### Step A1: `createDefaultEditableCard` helper（前置）

- [ ] `platform-host/internal.ts` 或 `game-cards.ts` 加 `createDefaultEditableCard(): Promise<LocalGameCardRecord>`：内联复制 builtin（内容 + 前端）→ `putLocalGameCard({source:"local"})` → 返回 record。
- [ ] id 生成：`crypto.randomUUID()` 或复用 `createDefaultPlatformGameCard` 内部的 id 生成逻辑（核查 `game-cards.ts:986` 附近）。
- [ ] manifest：`{ ...builtin.manifest, id: newId, name: "我的游戏" }`（保留 schema/frontend/cover，换 id + name）。
- [ ] contentFiles：`listLocalGameCardContentFiles(builtin.id)` → map 回 `GameCardContentFile` 形态（path + content，不含 data——builtin 模板无 binary）。
- [ ] frontendFiles：`listLocalGameCardFrontendFiles(builtin.id)` → map `{path, data: f.data}`。
- [ ] **验证**：`build:web` 通过；手动调一次确认返回 local 卡 record。

### Step A2: `ensureActiveGameCardId` rework（`internal.ts:63-81`）

- [ ] fallback 分支（L77-78 的 `getBuiltinBlankGameCard()`）改为：
  - 先 `listLocalGameCards()` → filter `source !== "builtin"` → 有则选第一个 → `setActiveGameCardId` → return
  - 无 local 卡 → `createDefaultEditableCard()` → `setActiveGameCardId` → return
- [ ] 不调 `createDefaultPlatformGameCard`（避免递归）。
- [ ] **验证**：清 Dexie 后首次 `ensureActiveGameCardId` 返回 local 卡 id（非 builtin id）。

### Step A3: `ensureActiveSave` rework（`game-cards.ts:92-104`）

- [ ] L99 `createLocalSave()` 改为绑定活跃卡：先 `getPlatformActiveGameCard()`（经 A2 返回 local 卡）→ `createLocalSaveFromGameCard(activeCard)` 或 `createLocalSave({gameCardId: activeCard.id})`。
- [ ] L101 `setActiveGameCardId(created.gameCardId ?? builtin)` 改为 `setActiveGameCardId(activeCard.id)`。
- [ ] 确认 `createLocalSave` 可接 cardId（查 `saves.ts`）；若不可则加重载或新函数。
- [ ] **验证**：第一条助手消息创建的 save 绑定活跃 local 卡（非 builtin）。

### Step A4: `deletePlatformGameCard` fallback（`game-cards.ts:401-402`）

- [ ] L401-402 `remainingCards[0]?.id ?? builtin.id` 改为：
  - `remainingLocal = remainingCards.filter(c => c.source !== "builtin")`
  - `remainingLocal.length > 0 ? setActiveGameCardId(remainingLocal[0].id) : setActiveGameCardId((await createDefaultEditableCard()).id)`
- [ ] **验证**：删完所有 local 卡后活跃卡是新建默认卡（非 builtin）。

### Step A5: `getPlatformActiveGameCard` stale fallback（`internal.ts:178-196`）

- [ ] L187 `return getBuiltinBlankGameCard()` 改为 `return null`。
- [ ] L192 同改 `return null`。
- [ ] 确认所有调用方处理 null（grep `getPlatformActiveGameCard()` 调用点）。
- [ ] **验证**：stale active save 不暴露 builtin。

### Step A6: 库过滤（`GameCardLibraryView.vue:246`）

- [ ] L246 `cards.value = loadedCards` 改为 `cards.value = loadedCards.filter(c => c.source !== "builtin")`。
- [ ] `listPlatformGameCards` 保持 `ensureBuiltinBlankGameCard`（不动）。
- [ ] **验证**：库不显示 builtin 卡；`listPlatformGameCards` 仍返回 builtin（确保模板源存在）。

### Step A7: build + 冲烟（A 阶段）

- [ ] `npm run build:contracts && npm run build:web`。
- [ ] dev 冲烟：清 Dexie（DevTools → Application → IndexedDB → 删 tsian-agent-runtime-v8）→ 刷新 → 库只见一张 local 默认卡（无 builtin）→ /play 加载前端 → 删该卡 → 自动重建默认卡。
- [ ] **验证**：A 阶段全过。**Review gate**：A 行为正确再进 B。

## Phase B: Full Data Fileification

### Step B1: 导出 `normalizeGameCardManifest`（`game-card-packages.ts`）

- [ ] L233 `function normalizeGameCardManifest` 改为 `export function normalizeGameCardManifest`。
- [ ] 确认 `GAME_CARD_MANIFEST_SCHEMA` 常量已 export（grep）。
- [ ] **验证**：`build:web` 通过。

### Step B2: storage 单文件前端 API（`game-cards.ts`）

- [ ] 加 `writeLocalGameCardFrontendFile(cardId, {path, data})`：复用 `normalizeFrontendFile`（L198-218）+ `localDb.gameCardFrontendFiles.put` + bump card updatedAt（仿 `writeLocalGameCardContentFile` L467 事务模式）。
- [ ] 加 `deleteLocalGameCardFrontendFile(cardId, path)`：`normalizePackageFilePath` + `gameCardFrontendFileId` + `localDb.gameCardFrontendFiles.delete` + bump card updatedAt。
- [ ] 加 `deleteLocalGameCardFrontendPathForCard(cardId, pathPrefix)`：仿 `deleteLocalGameCardContentPathForCard`（L525）——列前缀下所有 → 逐个 delete → 返回已删 path 列表。
- [ ] `normalizeTemplateFiles`（L158-173）加 reject `game-card.json`（在 L165-169 的 if 链加一条）。
- [ ] **验证**：`build:web` 通过。

### Step B3: `ManifestVolume` + dispatch 路由（`workspace-volumes.ts`）

- [ ] 新 `manifestVolume: WorkspaceVolume`：
  - `scope: "card-content"`
  - `enumerate(cardId)`: `getLocalGameCard(cardId)` → `[{path:"game-card.json", content: JSON.stringify(normalizeGameCardManifest(card.manifest), null, 2), createdAt: card.createdAt, updatedAt: card.updatedAt}]`
  - `write(cardId, {path, content})`: 调 `writeGameCardManifestFileForCard(cardId, content)`（B5 实现）
  - `delete()`: throw "manifest cannot be deleted"
- [ ] `resolveVolumeForScope`（L269）改：`scope === "card-content"` 时若 `path === "game-card.json"` → return `manifestVolume`，否则 `cardContentVolume`。
- [ ] `manifestVolume` 的 enumerate 需 import `getLocalGameCard` + `normalizeGameCardManifest`。
- [ ] **验证**：`build:web` 通过。

### Step B4: `CardFrontendVolume.write/delete` 填实现（`workspace-volumes.ts:118-127`）

- [ ] L118-127 占位 throw 改为：
  - `write`: `writeLocalGameCardFrontendFile(cardId, {path, data: data instanceof Blob ? data : (content ?? "")})` → 返回 WorkspaceFile（text 类 content / 媒体类 binary + placeholder，仿 enumerate L99-116 分流逻辑）。
  - `delete`: `deleteLocalGameCardFrontendPathForCard(cardId, pathPrefix)`。
- [ ] import `writeLocalGameCardFrontendFile`/`deleteLocalGameCardFrontendPathForCard` from storage。
- [ ] **验证**：`build:web` 通过。

### Step B5: `writeGameCardManifestFileForCard` + 路径解析（`workspace-ops.ts`）

- [ ] 新 `writeGameCardManifestFileForCard(cardId, content)`（design B1.3）：parse + `normalizeGameCardManifest` + 强制受保护字段 + `putLocalGameCard({manifest, contentFiles: undefined, source})` + 返回合成 WorkspaceFile。
- [ ] import `normalizeGameCardManifest` + `GAME_CARD_MANIFEST_SCHEMA` from `game-card-packages.ts`，`getLocalGameCard`/`putLocalGameCard` from storage。
- [ ] `resolveStudioWorkspacePath`（L145-207）在 `frontend/` 分支（L194）前加 `game-card.json` 分支：`{scope:"card-content", displayPath:"game-card.json", storagePath:"game-card.json", isManifest:true}`。
- [ ] `StudioResolvedPath` 类型加 `isManifest?: boolean`。
- [ ] **验证**：`build:web` 通过。

### Step B6: list 合并 manifest（`workspace-ops.ts` + `workspace.ts`）

- [ ] `listStudioWorkspaceFilesForGameCard`（L120-143）：L125 后加 manifest 合成文件注入（design B1.1）。
- [ ] `listEffectiveWorkspaceFilesForSave`（`workspace.ts:1338-1372`）：L1371 后加 manifest 合成文件注入。需 import `normalizeGameCardManifest`（storage 层 import game-card-packages）。
- [ ] `executeStudioWorkspaceOperation` card 分支（L496-499）`cardScopedFiles` 加 manifest 合成文件（让 read/validate 找到它）。
- [ ] **验证**：dev Explorer 见 `game-card.json` 在卡根目录；助手 `workspace_read` 能读到 manifest JSON。

### Step B7: build + 冲烟（B 阶段）

- [ ] `npm run build:contracts && npm run build:web`。
- [ ] dev 冲烟：
  - Explorer 见 `game-card.json` + `frontend/*`。
  - 编辑 `game-card.json` 的 name → 卡片详情反映；编辑 id/source/schema → 被强制覆盖回原值。
  - 编辑 `frontend/index.html` → /play serve 新内容（无 split-brain）。
  - 助手 `workspace_read` 读 `game-card.json` 和 `frontend/*`；`workspace_write` 改它们。
  - 运行时 agent（level 1）写 card-frontend / manifest → 权限拒绝（editLevel 2）。
- [ ] **验证**：B 阶段全过。**Review gate**：B4 后 review 写路由无 split-brain；B7 三绿是硬 gate。

## Phase 收口

- [ ] spec 更新：
  - `state-management.md`：ManifestVolume + game-card.json 文件化 + fallback 策略（builtin 不可见 + 自动创建默认卡）。
  - `type-safety.md`：manifest 受保护字段强制模式 + ManifestVolume 路径特殊路由。
- [ ] commit（用户确认后）。
- [ ] 登记真实 LLM 往返 PV（助手 use_skill→workspace_write 改 manifest/前端→/play 反映，待 provider+key）。

## Validation Commands

```bash
npm run build:contracts
npm run build:web
npm run dev:web   # 冲烟
```

## Rollback Points

- A1-A6 后：还原 fallback（git checkout internal.ts / game-cards.ts / GameCardLibraryView.vue 对应段）。
- B1-B6 后：还原 storage API / volume / 路由 / list 注入（git checkout 对应文件）。
- 已创建的默认卡是用户数据保留。

## Review Gates

- A7（A 阶段 build + 冲烟）是 A 的硬 gate，先验证再进 B。
- B3 后 review ManifestVolume + dispatch 路由正确性。
- B4 后 review 写路由无 split-brain（前端写 gameCardFrontendFiles、manifest 写 gameCards.manifest，都不经 contentFiles）。
- B7 三绿是 B 的硬 gate。

## 已知行为变化（写进 spec / journal）

- 库视图不再显示 builtin 卡（用户看不到内置模板）。
- 无活跃卡时自动创建可编辑默认卡（不再回退 builtin）。
- 删完所有 local 卡后自动重建默认卡（活跃卡永不为 builtin）。
- `game-card.json` 出现在卡工作区根目录（Explorer + 助手可见可编辑）。
- 编辑 `game-card.json` 写回 `gameCards.manifest`（受保护字段强制覆盖）。
- 前端文件可在 Explorer 编辑，写落 `gameCardFrontendFiles`，/play 立即反映。
- 封面图片字节文件编辑不支持（text-only 工作区限制，仍走 UI 上传）。
