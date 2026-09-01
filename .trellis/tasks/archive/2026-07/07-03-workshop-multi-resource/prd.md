# 创意工坊：多资源类型分享 + Tag 分类 + 差异化安装

## Goal

把当前“应用市场”（仅整卡包上传/下载）演进为“创意工坊”：支持游戏卡包、Agent、Skill 三种资源类型的独立上传/分享/安装，配合 tag 分类检索、统一资源元数据、统一 Agent/Skill 资源包格式，以及可维护的差异化安装架构。

## Parent

- `.trellis/tasks/06-22-mvp-completion`

## Background

应用市场任务 `06-22-app-market` 已完成并归档：整卡包上传/下载/搜索/安装，`resource_type` 字段已预留，`internal/market/` 包 + `BlobStore` + `market_packages` 表 + 前端 `marketApi` / `AppMarketView` 已就绪。本任务在此基础上扩展多资源类型、tag 分类和差异化安装。

任务尚未进入实现阶段，因此本轮规划选择一次性优化几处会形成长期债务的设计：用通用 `resource*` 字段替代 `card*` 语义复用；Agent/Skill 共享统一 `resource-package.json`；避免 `AppMarketView.vue` 继续膨胀；安装覆盖语义沉到目录替换 helper，而不是散落在 UI 里。

## User Value

- 玩家可以单独分享自己做的 Agent 或 Skill，不必打包整张卡。
- 安装 Agent/Skill 时可以选择安装目标（卡共享 / 指定 Agent / 覆盖助手）。
- tag 分类让市场内容可检索、可过滤，不再只有“全部”一个视图。
- “创意工坊”文案更贴合游戏卡、Agent、Skill 三类创作资源。
- 统一资源元数据和统一资源包格式降低后续新增资源类型的成本。

## Confirmed Facts

- 当前 `MarketResourceType = "game_card"`，`MarketPackage` 使用 `cardId` / `cardAuthor` / `cardVersion` 字段（`packages/contracts/src/market.ts:1-21`）。这些字段对 Agent/Skill 会产生语义错位。
- 当前 server `market_packages` 表有 `resource_type`（默认 `'game_card'`）、`card_id`、`card_author`、`card_version` 列；没有 `resource_id` / `resource_author` / `resource_version` / `tags` 列（`apps/platform-server/internal/storage/db.go:66-79`）。
- SQLite 初始化使用 `CREATE TABLE IF NOT EXISTS`，仅修改建表 SQL 不会为旧库自动增加列（`apps/platform-server/internal/storage/db.go:66`）。
- `BlobStore` 接口 + `FileSystemBlobStore` 已实现；`internal/market/` 包已建（domain + repo + handler + 路由）。
- 前端 `marketApi`（list/get/upload/download）+ `AppMarketView`（list/detail/upload/install 状态机）已就绪；继续把多资源上传/安装目标选择都堆进该文件会形成巨型组件。
- Agent 是卡内工作区文件：`agents/<id>/agent.json` + `AGENT.md` + 可选 `SOUL.md` + 可选 `skills/<skill-id>/`。
- Skill 是卡内工作区文件：`skills/<id>/SKILL.md` + 可选 `skill.config` + 可选 `scripts/` + 可选 `lib/`。
- AgentConfig schema：`{ id, title, summary, contacts, contextPaths, skills, platformTools, workspaceAccess, knowledgeMount?, providerPresetId?, entryMode?, system? }`（`packages/contracts/src/runtime.ts:407-435`）。
- SKILL.md frontmatter：`{ name, title, description, triggers[], appliesTo[] }`。
- 桌面助手入口硬编码 `LOCAL_ASSISTANT_AGENT_ID = "assistant"`（`apps/platform-web/src/storage/local-assistant-files.ts:7`，`apps/platform-web/src/platform-host/assistant-chat.ts:314`）。
- 助手路径：`.tsian/local/assistant/`（agent.json + AGENT.md + SOUL.md + skills/）。
- `buildAgentRegistry` 优先使用 `agent.json.id`，不是目录名；覆盖助手时若不改写 id，助手配置读取会找不到 `assistant`（`apps/platform-web/src/agent-runtime/registry.ts:714`，`apps/platform-web/src/platform-host/local-assistant.ts:233`）。
- `saveLocalAssistantFiles(files)` 是合并模式，不会删除旧文件（`apps/platform-web/src/storage/local-assistant-files.ts:1521-1552`）；删除助手旧文件需要使用删除 helper 或新增专用替换逻辑。
- 卡内容已有目录删除能力 `deleteLocalGameCardContentPathForCard`（`apps/platform-web/src/storage/game-cards.ts:575-607`），但安装替换更适合封装成批量 replace helper，避免 delete + 循环 write 散落在 UI。
- `writeCardContentFileForCard(cardId, {path, content})` 是“把文件写入指定卡”的现成函数（`apps/platform-web/src/platform-host/internal.ts:137`）。
- `AGENT_CONFIG_FILE_PATH_PATTERN` 匹配 `agents/<id>/agent.json` 和 `.tsian/local/<id>/agent.json`（`apps/platform-web/src/agent-runtime/registry.ts:41`）。
- Agent/Skill 没有独立打包格式（只在卡包 zip 内随 `workspace/` 前缀存在）。

## Requirements

- R1: `MarketResourceType` 扩展为 `"game_card" | "agent" | "skill"`；后端上传/列表/详情/下载支持按 `resource_type` 区分。
- R2: `MarketPackage` 引入通用资源字段：`resourceId`、`resourceAuthor`、`resourceVersion`；新前后端逻辑不再用 `cardId` 表达 Agent/Skill。`cardId/cardAuthor/cardVersion` 不作为新 contract 字段继续扩展。
- R3: `market_packages` 使用通用列 `resource_id`、`resource_author`、`resource_version`、`tags`；旧库通过 idempotent migration 增列并从 `card_id/card_author/card_version` 回填，旧列可保留为历史遗留但新 repo 不依赖。
- R4: 游戏卡包继续复用现有 `.tsian-card.zip` / `game-card.json` 格式，避免破坏已完成的卡包导入导出。
- R5: Agent/Skill 共享统一资源包格式：zip 含 `resource-package.json` manifest + 扁平目录文件。manifest 含 `schema: "tsian.resource.package.v1"`、`resourceType: "agent" | "skill"`、`resourceId`、`name`、`summary`、`author`、`version`、`files: [{path, mediaType?}]`。
- R6: Agent resource package 必含 `agent.json` + `AGENT.md`；可选 `SOUL.md`、`skills/<skill-id>/...`。`resourceId` = Agent id。
- R7: Skill resource package 必含 `SKILL.md`；可选 `skill.config`、`scripts/**`、`lib/**`。`resourceId` = Skill id。
- R8: Agent/Skill resource package v1 只支持 UTF-8 文本文件；前端导出/安装和后端上传校验都拒绝无法 UTF-8 解码的文件。二进制资源留到后续 schema 版本。
- R9: Agent/Skill 包路径安全：manifest `files[].path` 与 zip entry 必须是安全相对路径，禁止绝对路径、空路径、NUL、`.` / `..` 穿越；安装时只信任 manifest `files` 清单，不安装清单外文件。
- R10: Tag 系统：所有资源类型上传时可打 tag；前端逗号分隔输入，后端做权威规范化；JSON 数组存 `market_packages.tags` 列；列表 API 支持 `tag` 查询参数（SQL `LIKE '%"tag"%'`）；前端 tag 筛选 UI（在当前资源类型内筛选）。
- R11: Tag 规范：trim、去空、去重、统一 lower-case；每个 tag 1-32 字符，最多 10 个；仅允许中文、英文、数字、`-`、`_`；非法 tag 请求返回 400。
- R12: 左侧分类 = 资源类型切换器：`游戏卡` / `Agent` / `Skill` 三个标签，点击切换当前查看的资源类型。列表只显示该类型的资源，搜索和 tag 筛选都限定在当前类型内，避免搜索结果混乱。替换现有硬编码的 `["全部游戏卡", "已安装", "可游玩", "模板", "工具"]`。
- R13: 前端 UI 结构要拆分：`AppMarketView.vue` 只作为页面 shell/状态协调；资源类型侧栏、列表、详情、上传面板、安装目标选择、tag 筛选拆到 `components/market/`；列表/上传/安装业务逻辑拆到 composable 或 platform-host helper。
- R14: 差异化安装：
  - 游戏卡包：安装到本地（复用现有 `importPlatformGameCardPackage`）。
  - Agent：安装到指定游戏卡（写入 `agents/<resourceId>/`）或覆盖桌面助手（写入 `.tsian/local/assistant/`）。
  - Skill：安装到当前卡共享（写入 `skills/<resourceId>/`）或指定 Agent（写入 `<agentDir>/skills/<resourceId>/`，含助手 Agent）。
- R15: 安装覆盖语义必须由目录替换 helper 表达，而不是 UI 直接 delete + 循环 write：同 id 安装到已有目标目录时，先提示确认；确认后通过 helper 删除目标目录并写入新文件，避免旧文件残留；取消则不安装。
- R16: 目录替换 helper 应尽量原子化：卡内容替换应在 storage 层 Dexie transaction 内删除旧目录 + 写入新文件 + 更新 card timestamp；助手替换应在本地 assistant map 中一次性删除/写入相关 path。
- R17: 助手 Agent 覆盖安装语义：允许普通 Agent 包覆盖桌面助手，但安装时必须把 `agent.json.id` 改写为固定 `"assistant"`；只替换助手定义相关文件（`agent.json` / `AGENT.md` / `SOUL.md` / `skills/`），保留 `.tsian/local/assistant/sessions/`、`traces/`、`notes.md` 等本地运行数据。
- R18: 前端上传流程：市场内点上传 → 选资源类型（卡包/Agent/Skill）→ 选本地对应资源 → 填 tag（可选）+ author/version（可选，默认从源文件提取）→ 上传。
- R19: 上传来源：Agent 可从指定卡内 Agent 或桌面助手导出；Skill 可从指定卡共享、指定卡内 Agent-local Skill、桌面助手本地 Skill 导出。
- R20: 前端安装流程：点下载安装 → 资源类型决定安装目标选择对话框（卡包直接装；Agent 选目标卡或覆盖助手；Skill 选卡共享或指定 Agent）→ 确认后安装。
- R21: 目标卡选择不允许直接修改 `source === "builtin"` 的内置模板卡。
- R22: 后端 `GET /api/v1/market/packages` 支持 `resourceType` 查询参数；未知 `resourceType` 返回 400。
- R23: 市场用户可见文案改为“创意工坊”（桌面图标标签、窗口标题、caption、市场内按钮和空状态文案）；路由 `/market` 和 appId `market` 保持不变。

## Decided

- D1 统一资源元数据：contracts/API/新 DB 逻辑使用 `resourceId/resourceAuthor/resourceVersion`，不再把 `cardId` 复用于 Agent/Skill。
- D2 游戏卡包格式保持现状：现有 `game-card.json` 和卡包导入导出不重做，降低破坏面。
- D3 Agent/Skill 打包格式统一为 `resource-package.json` + `schema: "tsian.resource.package.v1"`，通过 `resourceType` 区分类型，便于未来扩展更多资源。
- D4 “全局” Skill = 卡内共享：安装到“全局”= 写入当前激活卡的 `skills/<resourceId>/`。安装到“指定 Agent”= 写入该 Agent 目录下 `skills/<resourceId>/`。复用现有 registry 路径规则，不新建存储层。
- D5 助手 Agent 安装 = 覆盖安装：安装前确认；安装时改写 `agent.json.id` 为 `assistant`；只替换助手定义和 `skills/`，保留 sessions/traces/notes 等本地运行数据。不装新 Agent 到 `.tsian/local/<新id>/`（入口硬编码无法直接对话）。
- D6 Agent/Skill v1 = 文本文件包：拒绝二进制文件，避免助手本地存储无法表达 Blob。
- D7 同 id Agent/Skill 安装 = 确认后替换目录：删除目标目录再写入，避免合并残留旧文件。
- D8 安装目录替换能力沉到 helper：UI 负责选择和确认，platform-host/storage helper 负责路径映射、删除、写入、事件刷新。
- D9 Tag 存储 = `tags` 列 + JSON + LIKE：原型期够用，10 万级再拆关联表。
- D10 安装目标 = 单目标选择对话框：一次只装一个目标。
- D11 上传入口 = 市场内选本地资源：选资源类型 → 选本地资源 → 填 tag/author/version → 上传。
- D12 改名 = 用户文案改，代码标识符不改：路由/appId 不变。
- D13 旧 server SQLite = 轻量迁移：增加 idempotent `resource_*` 与 `tags` 列检查和 `ALTER TABLE`，不要求删除数据库。
- D14 UI 拆分 = 本任务范围内完成：避免 `AppMarketView.vue` 承担复杂上传/安装细节。

## Acceptance Criteria

- [ ] AC1: `MarketResourceType` 扩展含 `"agent"` / `"skill"`；`MarketPackage` 包含 `resourceId`、`resourceAuthor`、`resourceVersion`、`tags: string[]`。
- [ ] AC2: `market_packages` 表支持 `resource_id/resource_author/resource_version/tags`；已有旧库启动时能通过 idempotent migration 自动补列并从 `card_*` 旧列回填。
- [ ] AC3: 后端 game_card 上传仍兼容现有卡包格式，并以 `resourceId = manifest.id` 写入新字段。
- [ ] AC4: 后端上传支持 Agent/Skill `resource-package.json` zip：校验统一 manifest、必需文件、UTF-8 文本限制、路径安全、resourceType 合法性；存文件 + 写元数据（含 tags）。
- [ ] AC5: `GET /api/v1/market/packages` 支持 `resourceType` 过滤参数 + `tag` 搜索参数 + `q` 全文搜索（均限定在 resourceType 内）；未知 `resourceType` 或非法 tag 返回 400。
- [ ] AC6: Tag 规范化符合 R11；响应 JSON 返回规范化后的 `tags: string[]`。
- [ ] AC7: 前端上传流程：选资源类型 → 选本地卡包/Agent/Skill → 填 tag + author + version → 上传成功；Agent/Skill 支持从桌面助手相关资源导出。
- [ ] AC8: 前端安装 Agent：选目标（指定卡 / 覆盖助手）→ 同 id 目标确认替换 → 通过目录替换 helper 写入 → 成功 toast；覆盖助手前弹确认并把 `agent.json.id` 改写为 `assistant`。
- [ ] AC9: 前端安装 Skill：选目标（卡共享 / 指定 Agent / 助手 Agent）→ 同 id 目标确认替换 → 通过目录替换 helper 写入 → 成功 toast。
- [ ] AC10: 覆盖助手安装不会删除 `.tsian/local/assistant/sessions/`、`traces/`、`notes.md` 等本地运行数据。
- [ ] AC11: 同名 Agent/Skill 替换后旧目录内不属于新包的旧文件不会残留。
- [ ] AC12: `AppMarketView.vue` 拆为页面 shell；资源类型侧栏、列表/详情、上传、安装目标选择、tag 筛选在独立组件或 composable/helper 中实现。
- [ ] AC13: 左侧分类为资源类型切换器（游戏卡/Agent/Skill），切换后列表只显示该类型；搜索和 tag 筛选限定在当前类型内。
- [ ] AC14: 桌面图标/窗口标题/市场内文案改为“创意工坊”；路由 `/market` 不变。
- [ ] AC15: Agent 包包含 agent-local Skill 时，安装 Agent 一并写入 `skills/` 子目录；同名旧 skill 文件不会残留。
- [ ] AC16: 安装目标卡列表过滤 `source === "builtin"` 的内置模板卡。
- [ ] AC17: 后端测试覆盖 game_card 兼容、Agent/Skill 上传 happy path、缺 manifest、schema 错、缺必需文件、unsafe path、非法 tag、未知 resourceType、resourceType/tag/q 过滤、旧库迁移、下载。
- [ ] AC18: `npm run build:contracts` + `npm run build:web` + `cd apps/platform-server && go test ./...` 通过。

## Out of Scope

- 选择入口 Agent（方向 C，独立任务）。
- 评论/评分/社交。
- 付费/交易。
- 版本管理/更新推送。
- 审核机制。
- 跨卡共享的全局 Skill 存储层。
- Agent/Skill 包二进制资源支持。
- Tags 关联表、全文索引或高级 tag 自动补全。
- 重做现有游戏卡包 `.tsian-card.zip` 格式。
