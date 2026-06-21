# Implement: Game Card Data Fileification

## Execution Checklist

### Phase A: Builtin Invisible + Fallback Rework

#### Step A1: ensureActiveGameCardId rework
- [ ] `platform-host/index.ts:576-594` `ensureActiveGameCardId`：fallback 分支改为"检查是否有 local 卡 → 有则选第一个 → 无则内联创建默认卡"。
- [ ] 内联 copy 逻辑（copyPlatformGameCardAsLocal + putLocalGameCard 注入前端 + setActiveGameCardId），不调 createDefaultPlatformGameCard（避免递归）。
- [ ] 幂等：进入 fallback 前先 `listLocalGameCards()`，已有 local 卡则用它。
- [ ] **验证**：清 Dexie 后首次 init 创建一张可编辑默认卡（非 builtin 活跃）。

#### Step A2: ensureActiveSave rework
- [ ] `platform-host/index.ts:603-605` `ensureActiveSave`：用 `getPlatformActiveGameCard()` 取活跃卡 → `createLocalSaveFromGameCard(activeCard)`（确认 saves.ts 有此函数或加 cardId 参数重载）。
- [ ] 不再调 `createLocalSave()`（builtin-bound）。
- [ ] **验证**：第一条助手消息创建的 save 绑定活跃卡，显示在该卡存档列表。

#### Step A3: deletePlatformGameCard fallback
- [ ] `platform-host/index.ts:2311`：删完最后一张 local 卡，回退改为"有 local 卡选第一个 → 无则自动创建默认卡"，不返回 builtin.id。
- [ ] **验证**：删完所有 local 卡后活跃卡是新建默认卡（非 builtin）。

#### Step A4: getPlatformActiveGameCard stale fallback
- [ ] `platform-host:2527/2532`：stale-save 兜底对齐新策略（返回自动创建默认卡或 null，不返回 builtin）。
- [ ] **验证**：stale active save 不暴露 builtin。

#### Step A5: 库过滤
- [ ] `GameCardLibraryView.vue:252`：`cards.value = loadedCards.filter(c => c.source !== "builtin")`。
- [ ] `listPlatformGameCards` 保持 ensureBuiltinBlankGameCard。
- [ ] **验证**：库不显示 builtin 卡。

#### Step A6: build + 冲烟（A 阶段）
- [ ] `build:contracts && build:runtime-core && build:web` 三绿。
- [ ] dev 冲烟：空 DB 首次进入 → 自动创建可编辑默认卡（库只见它，无 builtin）→ /play 加载前端 → 删卡后重建默认卡。
- [ ] **验证**：A 阶段全过。

### Phase B: Full Data Fileification

#### Step B1: storage 单文件前端 API
- [ ] `game-cards.ts`：加 `writeLocalGameCardFrontendFile`/`deleteLocalGameCardFrontendFile`（确认 `readLocalGameCardFrontendFile` 已存在并导出）。
- [ ] `normalizeTemplateFiles` reject `game-card.json` 路径。
- [ ] 导出 `normalizeGameCardManifest` from `game-card-packages.ts`（供 platform-host 复用）。
- [ ] **验证**：build:runtime-core 通过。

#### Step B2: card-frontend scope
- [ ] `workspace-operations.ts:93` `DEFAULT_SCOPE_ACCESS` 加 `"card-frontend": { read:{level:0}, edit:{level:2} }`。
- [ ] 确认 scope 类型（`WorkspaceScope` 或等价）加 `"card-frontend"`。
- [ ] **验证**：build:runtime-core 通过。

#### Step B3: list 合并（Explorer + 助手）
- [ ] `listStudioWorkspaceFilesForGameCard`（platform-host:676）：合并 contentFiles + frontendFiles（async text）+ 合成 game-card.json。
- [ ] `listEffectiveWorkspaceFilesForSave`（workspace.ts:1360）：同理合并 frontend+manifest。
- [ ] `runAssistantChat` 工作区组装（platform-host:1800-1823）：注入前端+manifest。
- [ ] **验证**：dev Explorer 见 game-card.json + frontend/*；助手 workspace_read 能读。

#### Step B4: 路径解析 + 写路由
- [ ] `resolveStudioWorkspacePath`（platform-host:698）：加 `game-card.json`（isManifest）+ `frontend/`（card-frontend scope）分支。
- [ ] `executeStudioWorkspaceOperation` mutations.write：card-frontend → writeGameCardFrontendFile；isManifest → writeGameCardManifestFileForCard。
- [ ] mutations.delete：card-frontend → deleteGameCardFrontendFile；isManifest → 拒绝。
- [ ] `assertCompatibleStudioMove`：加 card-frontend→card-frontend 支持。
- [ ] 新 `writeGameCardManifestFileForCard`：parse + normalizeGameCardManifest + 强制受保护字段 + putLocalGameCard。
- [ ] 新 `writeGameCardFrontendFile`/`deleteGameCardFrontendFile`：包 platform-host 调 storage 单文件 API。
- [ ] **验证**：dev Explorer 编辑前端 → /play serve 新内容（无 split-brain）；编辑 game-card.json name → 详情反映。

#### Step B5: build + 冲烟（B 阶段）
- [ ] `build:contracts && build:runtime-core && build:web` 三绿。
- [ ] dev 冲烟：Explorer 见 game-card.json + frontend/*；编辑前端→/play 刷新；编辑 manifest name→详情更新；助手 workspace_read 读 manifest/frontend；受保护字段强制覆盖。
- [ ] **验证**：B 阶段全过。

### Phase 收口
- [ ] spec 更新（state-management：card-frontend scope + manifest 文件化 + fallback 策略；type-safety：受保护字段强制模式）。
- [ ] commit（用户确认后）。
- [ ] 登记真实 LLM 往返 PV（助手 use_skill→workspace_write 改 manifest/前端→/play 反映，待 provider+key）。

## Validation Commands

```bash
npm run build:contracts
npm run build:runtime-core
npm run build:web
npm run dev:web   # 冲烟
```

## Rollback Points

- A1-A4 后：还原 fallback（git checkout platform-host/index.ts 对应段）。
- A5 后：还原库过滤。
- B1-B4 后：还原 storage/scope/list/路由（git checkout 对应文件）。
- 已创建的默认卡是用户数据保留。

## Review Gates

- A6（A 阶段 build+冲烟）是 A 的硬 gate，先验证再进 B。
- B2 后 review scope 定义正确性。
- B4 后 review 写路由无 split-brain（前端写 gameCardFrontendFiles、manifest 写 gameCards.manifest，都不经 contentFiles）。
- B5 三绿是 B 的硬 gate。
