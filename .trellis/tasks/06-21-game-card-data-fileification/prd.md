# Game Card Data Fileification

## Parent

- `.trellis/tasks/06-20-content-generation-foundation`

## Goal

让游戏卡的**所有可配置数据**（内容文件 + 打包前端文件 + 卡片 manifest 元数据）都在工作区文件系统里可见可编辑，并被桌面助手 agent 通过现有工具统一管理。配套：把内置空白卡彻底退化为**不可见的内部模板**（用户看不到、打不开，只作创建复制源），让"所有可见数据皆可编辑"的理念无例外。

理念：项目所有可配置数据皆可收录于文件系统，并被助手 agent 管理。这与框架哲学一致（"Gameplay-specific behavior belongs in Skills and workspace conventions"），也是子2 创作 Skills 能"管理卡的一切"的赋能层。

## Requirements

### A. 内置卡退化为不可见模板（前置）

- 库视图过滤掉 `source === "builtin"` 的卡（`GameCardLibraryView` 一行 filter）。`listPlatformGameCards` 保持 `ensureBuiltinBlankGameCard`（模板源仍需在 DB 存在）。
- **fallback 改为自动创建可编辑默认卡**，3 个修点：
  - `ensureActiveGameCardId`（`platform-host:588-592`）：从回退 `getBuiltinBlankGameCard()` 改为创建可编辑默认卡（内联 `createDefaultPlatformGameCard` 的 copy 逻辑，避免递归，只创建一次）。
  - `ensureActiveSave`（`platform-host:603-605`）：创建的 save 绑定活跃卡（`createLocalSaveFromGameCard(activeCard)`）而非 builtin。
  - `deletePlatformGameCard`（`platform-host:2311`）：删完最后一张本地卡，回退改为自动创建默认卡（或清空活跃 id），不再回退 builtin。
- **保留全部 GUARD 类引用**（11 处，保护模板不被改/删/导入覆盖）+ **保留 TEMPLATE-SOURCE**（`createDefaultPlatformGameCard` 仍复制 builtin）。
- `getPlatformActiveGameCard` 的 stale-save 兜底（`platform-host:2527/2532`）对齐新策略（返回自动创建的默认卡或 null，不返回 builtin）。
- 可选：详情路由对 `source === "builtin"` 加守卫（重定向到库）。
- **回退子1 的 S4**：删掉 `GameCardDetailView`/`GameCardLibraryView` 的"模板"标签和引导文案（已做）。

### B. 全数据文件化

#### B1. `game-card.json` manifest 文件化（卡根目录）

- 在卡根目录合成一个 `game-card.json` 文件，content = `JSON.stringify(normalizeGameCardManifest(card.manifest))`（复用 `game-card-packages.ts:266-303` 的 normalize）。
- 在工作区 list（Explorer + 助手工作区文件集）注入这个合成文件。
- 写路径拦截：`executeStudioWorkspaceOperation` 的 `mutations.write` 拦截 `game-card.json` 路径 → 新 `writeGameCardManifestFileForCard(cardId, content)`：JSON parse + `normalizeGameCardManifest` 校验 + `putLocalGameCard({ manifest: parsed, contentFiles, source })`。
- **受保护字段**（写时强制覆盖，同 `serializeWorkspaceManifest` 模式）：`id`（DB 主键，强制回原 id）、`source`（系统管理）、`schema`（强制 `tsian.game-card.v1`）、`bridgeVersion`（强制 `tsian.play-bridge.v1`）。用户可编辑：`name`/`version`/`summary`/`author`/`cover`/`frontend`。
- `normalizeTemplateFiles`（`game-cards.ts:137-152`）reject `game-card.json` 路径，避免它被当普通 contentFile 重复存储。
- builtin 卡的 manifest 文件不可编辑（触发"另存为本地"流程或拒绝）。

#### B2. 前端文件可见可编辑（`card-frontend` volume 实现）

- 子5 已定义 `card-frontend` scope（read 0/edit 2）+ `CardFrontendVolume` 框架（enumerate 可用，write/delete 占位）。本任务填实现。
- 新增 `writeLocalGameCardFrontendFile`/`deleteLocalGameCardFrontendFile` 单文件 API（`game-cards.ts`，填补子5 占位）。
- 填 `CardFrontendVolume.write/delete` 实现（子5 的 `workspace-volumes.ts`）。
- `resolveStudioWorkspacePath` 加 `frontend/` → card-frontend 解析。
- list 合并经 volume enumerate：`listStudioWorkspaceFilesForGameCard`/`listEffectiveWorkspaceFilesForSave`/`runAssistantChat` 工作区组装注入前端（+ manifest）。
- 助手 level 4 能写 card-frontend（editLevel 2）；运行时 agent level 1 不能（合理，运行时不应改 play UI）。

#### B3. 封面边界

- 封面 binding（`workspacePath`/`alt`/`url`）在 `game-card.json` 的 `manifest.cover` 可编辑。
- 封面图片字节（`.cover/cover.<ext>` contentFile，base64 data-URI）**暂不支持文件编辑**（工作区 text-only，data-URI 文本编辑不实际）——封面图仍走现有 UI 上传。这是唯一不能完全文件化的角落，登记为已知限制。

### 助手工具面（确认结论）

- 助手 **仍然靠现有工具**（`workspace_read`/`workspace_write`/`use_skill`/`run_script`），无需新工具。
- 子3 让现有工具能管到前端和 manifest 的两个前提：(1) 前端+manifest 纳入助手工作区文件集；(2) workspace_write 路由 `frontend/`→gameCardFrontendFiles、`game-card.json`→gameCards.manifest。
- 能力边界由工作区文件集 + 写路由决定，不是工具数量。

## Acceptance Criteria

### A
- [ ] 库视图不显示 builtin 卡。
- [ ] 首次进入（空 DB）自动创建一张可编辑默认卡并设为活跃（不出现 builtin 卡）。
- [ ] 无活跃卡时不回退 builtin，而是自动创建默认卡。
- [ ] 删完最后一张本地卡后，活跃卡变为自动创建的默认卡（非 builtin）。
- [ ] 第一条助手消息创建的 save 绑定活跃卡（非 builtin），且显示在该卡的存档列表。
- [ ] builtin 卡仍能作为 `createDefaultPlatformGameCard` 的复制源（"创建游戏"仍可用）。
- [ ] 所有 GUARD 仍生效（builtin 不能被改/删/导入覆盖）。
- [ ] 子1 的 S4 标签已回退。

### B
- [ ] `game-card.json` 出现在卡工作区根目录（Explorer + 助手工作区），内容为 manifest JSON。
- [ ] 编辑 `game-card.json` 的 name/summary/author 后，卡片元数据同步更新（详情视图反映）。
- [ ] 编辑 `game-card.json` 的 id/source/schema/bridgeVersion 被强制覆盖回原值（受保护）。
- [ ] 前端文件（`frontend/index.html`/`style.css`/`app.js`）出现在工作区（Explorer + 助手工作区）。
- [ ] 在 Explorer 编辑前端文件后，`/play` serve 新内容（写落 gameCardFrontendFiles，无 split-brain）。
- [ ] 助手能 `workspace_read` 读到 `game-card.json` 和 `frontend/*`，能 `workspace_write` 改它们。
- [ ] 运行时 agent（level 1）不能写 card-frontend / manifest（权限拒绝）。
- [ ] `npm run build:web` 通过。
- [ ] dev server 冲烟：Explorer 见 game-card.json + frontend/*、编辑前端→/play 刷新、助手能读 manifest。
- [ ] 真实 LLM 往返（助手 use_skill→workspace_write 改 manifest/前端）登记 PV，待 provider+key。

## Constraints

- 助手工具面不动（不加新工具）。
- GUARD 类引用全部保留。
- builtin 记录留在 DB（作模板源 + 兼容遗留 builtin-bound saves）。
- 封面图片字节文件编辑是已知限制（暂不支持）。
- 不改导出/导入包格式（复用现有 `game-card.json` round-trip 序列化）。
- `card-frontend` scope 是 agent-runtime 的轻量扩展（加 scope 定义，不改核心逻辑）。

## Out Of Scope

- 封面图片字节的文件编辑（text-only 工作区限制）。
- 平台级 create-card platform action（仍走 UI + storage 原语）。
- 真实 LLM 往返验证（需 provider + API key）。
- 运行时 agent（master/narrative/memory）的 skills（子2 范围）。

## Dependencies

- 强依赖子5（WorkspaceVolume 抽象）：本任务的 `CardFrontendVolume`/`ManifestVolume` 实现插入子5 的统一 dispatch，不碰 host 路由点（子5 已收敛）。
- 强依赖子4（contentFiles per-file 表）：子5 的 `CardContentVolume` 依赖子4 产出的 per-file API；本任务虽不直接碰 contentFiles，但 volume 框架依赖子4→子5 链路。
- 子1（已完成）：`createDefaultPlatformGameCard` + `defaultFrontendFiles` 是 A 的 fallback 和 B2 的测试对象。
- 是子2 的赋能前置：子2 创作 skills 能管理卡的一切，依赖子3 把前端+manifest 文件化。
- 执行顺序：子1（完成）→ 子4 → 子5 → **子3** → 子2。
