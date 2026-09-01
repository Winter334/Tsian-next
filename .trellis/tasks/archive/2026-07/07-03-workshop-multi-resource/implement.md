# 创意工坊 — Implementation Plan

## Execution Order

### Phase A: Contract 扩展

- [ ] A1: `packages/contracts/src/market.ts`：`MarketResourceType` 加 `"agent" | "skill"`。
- [ ] A2: `MarketPackage` 从 `cardId/cardAuthor/cardVersion` 切换为 `resourceId/resourceAuthor/resourceVersion`，并加 `tags: string[]`。
- [ ] A3: 反向搜索 `MarketPackage` / `cardId` / `cardAuthor` / `cardVersion` 消费点，列出需要同步更新的前端文件。
- [ ] A4: `npm run build:contracts` 验证 contracts 自身。

### Phase B: Backend — schema migration + domain model

- [ ] B1: `apps/platform-server/internal/storage/db.go`：`market_packages` CREATE TABLE 加 `resource_id` / `resource_author` / `resource_version` / `tags`；保留旧 `card_*` 列以降低迁移风险。
- [ ] B2: `db.go` 增加 idempotent migration helper：检查 `PRAGMA table_info(market_packages)`，缺列时分别 `ALTER TABLE ... ADD COLUMN ...`。
- [ ] B3: migration 回填旧数据：`resource_*` 为空时从 `card_*` 填充；`tags` 为空时设为 `[]`。
- [ ] B4: `internal/market/market.go`：`ResourceAgent` / `ResourceSkill` 常量；`Package` 改用 `ResourceID` / `ResourceAuthor` / `ResourceVersion` / `Tags`；`ListFilter.ResourceType` / `Tag`。
- [ ] B5: 新增/放置 tag normalization helper：trim、lower-case、去重、最多 10 个、1-32 字符、只允许中文/英文/数字/`-`/`_`；非法返回 400。
- [ ] B6: `internal/market/sqlite_repo.go`：SELECT/Get 使用 `resource_*` + `tags`；Create 写 `resource_*`、`tags`，并同步写旧 `card_*`；Scan 解析 tags JSON；List SQL 加 resource_type/tag/q 组合过滤。
- [ ] B7: `cd apps/platform-server && go build ./...` 验证。

### Phase C: Backend — 上传校验与 API response

- [ ] C1: `internal/market/handler.go`：`HandleUpload` 解析 `resourceType`（空默认 `game_card`，未知 400）和 `tags`。
- [ ] C2: 保留 game_card 现有 `game-card.json` 校验逻辑；写入 `ResourceGameCard`、`ResourceID=manifest.ID`、`ResourceAuthor=authorName(manifest)`、`ResourceVersion=manifest.Version`、tags。
- [ ] C3: 定义统一 `resourcePackageManifestPayload` Go struct：`schema/resourceType/resourceId/name/summary/author/version/files`。
- [ ] C4: 增加 `validateResourcePackageZip(content, expectedType)`：读取 `resource-package.json`，校验 schema、resourceType、resourceId/name/summary/version/files。
- [ ] C5: 按 resourceType 校验 required files：agent 必含 `agent.json` + `AGENT.md`；skill 必含 `SKILL.md`。
- [ ] C6: Agent/Skill 校验共用 path safety + UTF-8 文本校验：拒绝绝对路径、空路径、NUL、`.` / `..`、清单缺文件、清单外非目录文件、无法 UTF-8 解码。
- [ ] C7: `packageResponse` / `toPackageResponse` 切换到 `resourceId/resourceAuthor/resourceVersion/tags`；Download filename 按 resourceType 生成。
- [ ] C8: `HandleList` 解析 `resourceType` / `tag` query 参数；未知 resourceType 或非法 tag 返回 400。
- [ ] C9: `cd apps/platform-server && go build ./...` 验证。

### Phase D: Backend — 测试

- [ ] D1: 更新现有 market 测试 helper：支持 upload `resourceType` / `tags` 表单字段；响应断言 `resourceId` / `tags`。
- [ ] D2: 更新现有 game_card 上传/搜索/下载测试，确认旧卡包格式仍可上传并返回 `resourceId`。
- [ ] D3: 追加 Agent `resource-package.json` 上传 happy path：上传 → list `resourceType=agent` → tag 过滤 → detail → download。
- [ ] D4: 追加 Skill `resource-package.json` 上传 happy path：上传 → list `resourceType=skill` → tag 过滤 → detail → download。
- [ ] D5: 追加校验失败测试：缺 `resource-package.json`、schema 错、resourceType 不匹配、缺必需文件、unsafe path、清单缺文件、清单外文件、无法 UTF-8 解码、非法 tag、未知 resourceType。
- [ ] D6: 追加旧库迁移测试：旧 schema（仅 card_*、无 resource_* / tags）启动后确认新列存在、旧记录回填到 resource_*、tags 默认 `[]`。
- [ ] D7: `cd apps/platform-server && go test ./...` 通过。

### Phase E: Frontend — API 层与基础类型迁移

- [ ] E1: `apps/platform-web/src/platform-host/api-client.ts`：`marketApi.list` 加 `resourceType` / `tag` 参数。
- [ ] E2: `marketApi.upload` 签名改为 `(file, params)`，提交 `resourceType`、`title`、`summary`、`author`、`version`、`tags`；根据 resourceType 设置文件名。
- [ ] E3: 更新现有 `AppMarketView` 和其它 `MarketPackage` 消费点：`cardId` → `resourceId`，`cardAuthor` → `resourceAuthor`，`cardVersion` → `resourceVersion`。
- [ ] E4: 临时保持 game_card 列表/详情/上传/安装可编译，为后续拆组件做基线。

### Phase F: Frontend — 目录替换 helper

- [ ] F1: 在 storage/platform-host 合适层新增 `replaceCardContentDirectory(cardId, directoryPath, files)`，封装“删除目标目录 + 写入新文件 + 更新 card timestamp + 事件刷新”。
- [ ] F2: 若短期无法一次 transaction 完成，也必须保持单一 helper API；内部先复用 `deleteLocalGameCardContentPathForCard` + `writeCardContentFileForCard`，并标注后续可事务优化。
- [ ] F3: 新增 `replaceAssistantDefinition(files)`：在 assistant map 中删除 `agent.json`、`AGENT.md`、`SOUL.md`、`skills/**`，写入新定义文件，保留 sessions/traces/notes。
- [ ] F4: 新增 `replaceAssistantSkillDirectory(skillId, files)`：只替换 `.tsian/local/assistant/skills/<skillId>/`。
- [ ] F5: 为 helper 增加路径边界校验：禁止 helper 写出目标目录。

### Phase G: Frontend — 统一资源包导出/安装服务

- [ ] G1: 新建 `apps/platform-web/src/platform-host/resource-packages.ts`。
- [ ] G2: 定义 local manifest/source/target 类型：`ResourcePackageManifest`、`AgentPackageSource`、`SkillPackageSource`、`AgentInstallTarget`、`SkillInstallTarget`、`ResourcePackageInspection`。
- [ ] G3: 实现共用 package helper：safe relative path normalize、UTF-8 decode、`resource-package.json` lookup、manifest files validation、zip/unzip。
- [ ] G4: 实现 `exportAgentPackage(source)`：
  - card-agent：读取 `agents/<id>/` 目录并扁平化路径；从 `agent.json` 提取 id/title/summary。
  - assistant：读取 `.tsian/local/assistant/` 的 `agent.json` / `AGENT.md` / `SOUL.md` / `skills/**`，排除 sessions/traces/notes 等运行数据；manifest.resourceId 使用 agent.json id 或 `assistant`。
- [ ] G5: 实现 `exportSkillPackage(source)`：支持 card-shared、agent-local、assistant-local；从 SKILL.md frontmatter 或 registry entry 提取 name/summary/resourceId。
- [ ] G6: 实现 `inspectResourcePackage(blob)`：供安装前展示资源名称、id、类型并判断目标是否已存在。
- [ ] G7: 实现 `installAgentPackage(blob, target)`：
  - card：映射到 `agents/<resourceId>/`，调用 `replaceCardContentDirectory`。
  - assistant：改写 `agent.json.id = "assistant"`，调用 `replaceAssistantDefinition`。
- [ ] G8: 实现 `installSkillPackage(blob, target)`：按 card-shared / agent-local / assistant-local 映射目标目录，调用目录替换 helper。
- [ ] G9: `platform-host/index.ts` re-export 新 helper 和类型。

### Phase H: Frontend — market UI 拆分

- [ ] H1: 新建 `apps/platform-web/src/components/market/`。
- [ ] H2: 拆出 `MarketResourceTypeSidebar.vue`：资源类型切换和数量展示。
- [ ] H3: 拆出 `MarketTagFilter.vue`：tag 筛选输入/清除。
- [ ] H4: 拆出 `MarketPackageGrid.vue`：包卡片列表，使用 `resourceId/resourceVersion/tags` 展示。
- [ ] H5: 拆出 `MarketPackageDetail.vue`：详情展示和下载安装按钮。
- [ ] H6: 拆出 `MarketUploadPanel.vue`：资源类型、来源、title/summary/author/version/tags 输入。
- [ ] H7: 拆出 `MarketInstallDialog.vue`：Agent/Skill 安装目标选择。
- [ ] H8: 可选新增 composable：`useMarketPackages`、`useMarketUpload`、`useMarketInstall`；如果不抽 composable，确保复杂逻辑仍在 platform-host helper，不回流到 view。
- [ ] H9: `AppMarketView.vue` 收敛为 page shell：维护 currentType/search/sort/tag/screen，协调组件事件。

### Phase I: Frontend — 上传/安装流程接入

- [ ] I1: 列表/搜索/tag 筛选传 `resourceType: currentType`，搜索和 tag 限定当前类型。
- [ ] I2: 上传流程接入：
  - game_card：`listPlatformGameCards` 过滤 builtin + `exportPlatformGameCardPackage`。
  - agent：列卡内 Agent + 桌面助手 + `exportAgentPackage`。
  - skill：列卡共享 Skill、卡内 Agent-local Skill、桌面助手 local Skill + `exportSkillPackage`。
- [ ] I3: 上传时调用 `marketApi.upload(blob, {resourceType, title, summary, author, version, tags})`。
- [ ] I4: 安装流程按 `pkg.resourceType` 分流：
  - game_card：现有流程，用 `resourceId` 检查同卡。
  - agent：下载 → inspect → 目标选择（指定卡 / 覆盖助手）→ 过滤 builtin → 覆盖确认 → `installAgentPackage`。
  - skill：下载 → inspect → 目标选择（卡共享 / 指定卡内 Agent / 助手 Agent）→ 过滤 builtin → 覆盖确认 → `installSkillPackage`。
- [ ] I5: 同 id Agent/Skill 目标存在时，`confirmChoice` 后再安装；取消则不写入。
- [ ] I6: 更新空状态、按钮、详情文案，覆盖三种资源类型。

### Phase J: 改名 + 质量验证

- [ ] J1: `apps/platform-web/src/desktop-apps.ts`：label/title 改“创意工坊”，caption 改“分享与安装创意资源”。
- [ ] J2: 全局搜索用户可见“应用市场”“上传应用”“搜索市场”等文案，按 PRD 改成“创意工坊”相关表述；代码标识符/路由不改。
- [ ] J3: `npm run build:contracts` 通过。
- [ ] J4: `npm run build:web` 通过。
- [ ] J5: `cd apps/platform-server && go test ./...` 通过。
- [ ] J6: 手动验证完整流程（dev server + mock-login）：
  - 上传游戏卡/Agent/Skill。
  - 按资源类型筛选。
  - tag 搜索。
  - Agent 安装到卡。
  - Agent 覆盖助手，确认 id 改写为 `assistant` 且 sessions/traces/notes 未删。
  - Skill 安装到卡共享、卡内 Agent、助手 Agent。
  - 同名安装确认替换后旧文件不残留。

## Validation Commands

```bash
npm run build:contracts
npm run build:web
cd apps/platform-server && go build ./... && go test ./...
```

## Risky Files / Rollback Points

- `packages/contracts/src/market.ts` — `MarketPackage` 字段切换会影响前端所有市场消费点。
- `apps/platform-server/internal/storage/db.go` — SQLite resource_* + tags migration；需保证幂等、旧库可启动。
- `apps/platform-server/internal/market/sqlite_repo.go` — resource_* 字段、tags JSON scan/store 与组合查询。
- `apps/platform-server/internal/market/handler.go` — 上传校验分流，game_card 兼容 + resource-package v1。
- `apps/platform-web/src/platform-host/resource-packages.ts` — Agent/Skill 导出/安装逻辑，新文件但影响数据写入。
- `apps/platform-web/src/storage/game-cards.ts` 或 platform-host replacement helper — 目录替换语义；需防止误删目标外文件。
- `apps/platform-web/src/storage/local-assistant-files.ts` / helper 调用 — 助手覆盖安装必须保留 sessions/traces/notes。
- `apps/platform-web/src/views/AppMarketView.vue` + `components/market/*` — UI 拆分涉及状态和事件迁移。

## Review Gates

- Phase D 完成后：后端 game_card 兼容、Agent/Skill 上传、tag、过滤、安全校验、旧库迁移测试通过。
- Phase F 完成后：目录替换 helper 单独审查，确认路径边界和助手保留清单正确。
- Phase G 完成后：资源包 helper 通过 build，并人工/临时脚本验证路径映射与 id 改写。
- Phase H 完成后：`AppMarketView.vue` 不再承载大段路径映射/安装写入细节。
- Phase I 完成后：前端完整流程手动验证。
- 最终提交前：build:contracts + build:web + platform-server go test 全通过。
