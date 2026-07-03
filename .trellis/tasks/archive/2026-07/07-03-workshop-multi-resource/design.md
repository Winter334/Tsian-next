# 创意工坊 — Technical Design

## Architecture Overview

复用 app-market 已有架构，升级为通用 resource market：多资源类型 + 统一资源元数据 + 统一 Agent/Skill 资源包格式 + tag + 差异化安装。代码标识符仍保留 `market` / `/market`，用户可见文案改为“创意工坊”。

```
┌──────────────────────────────────────────────────────────────┐
│ platform-web (Vue)                                           │
│  AppMarketView.vue = page shell / 状态协调                    │
│   ├─ components/market/MarketResourceTypeSidebar.vue          │
│   ├─ components/market/MarketPackageGrid.vue                  │
│   ├─ components/market/MarketPackageDetail.vue                │
│   ├─ components/market/MarketTagFilter.vue                    │
│   ├─ components/market/MarketUploadPanel.vue                  │
│   └─ components/market/MarketInstallDialog.vue                │
│                                                              │
│  composables / platform-host                                  │
│   ├─ useMarketPackages: list/detail/search/tag                │
│   ├─ useMarketUpload: resource source selection + upload      │
│   ├─ useMarketInstall: target selection + confirm + install   │
│   └─ resource-packages.ts: package + install service          │
│      ├─ exportResourcePackage(agent/skill)                    │
│      ├─ installResourcePackage(agent/skill)                   │
│      ├─ replaceCardContentDirectory                           │
│      └─ replaceAssistantDefinition/SkillDirectory             │
└──────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────────┐
│ platform-server (Go)                                         │
│  /api/v1/market/*                                            │
│   ├─ storage.OpenSQLite: resource_* + tags migration          │
│   ├─ HandleList: resourceType + tag + q 过滤                  │
│   ├─ HandleUpload: game-card legacy + resource-package v1     │
│   ├─ HandleDownload: 返回原 zip                               │
│   └─ HandleCover: game_card 可有封面，Agent/Skill 可无        │
└──────────────────────────────────────────────────────────────┘
```

## Contract Changes

### `packages/contracts/src/market.ts`

```typescript
export type MarketResourceType = "game_card" | "agent" | "skill"

export interface MarketPackage {
  id: string
  resourceType: MarketResourceType
  resourceId: string
  resourceAuthor: string
  resourceVersion: string
  name: string
  summary: string
  tags: string[]
  coverUrl: string | null
  uploader: MarketPackageUploader
  downloadCount: number
  createdAt: string
}
```

`cardId/cardAuthor/cardVersion` 不再作为新 contract 字段扩展。若后端旧库仍保留旧列，那只是 server 内部兼容细节；前端和新测试只使用 `resource*`。

## Database Design

### Target schema

`market_packages` 增加通用资源列：

```sql
resource_id TEXT NOT NULL DEFAULT ''
resource_author TEXT NOT NULL DEFAULT ''
resource_version TEXT NOT NULL DEFAULT ''
tags TEXT NOT NULL DEFAULT '[]'
```

旧 `card_id/card_author/card_version` 列可保留，避免破坏已有库和旧 SQL 迁移复杂度，但 repo 新 SELECT/INSERT 以 `resource_*` 为准。新建库可以同时保留旧列或去掉旧列；为降低改动风险，推荐保留旧列并同步写入 game_card 值。

### Idempotent migration

`OpenSQLite` 初始化后运行：

1. `PRAGMA table_info(market_packages)`。
2. 缺 `resource_id` → `ALTER TABLE ... ADD COLUMN resource_id TEXT NOT NULL DEFAULT ''`。
3. 缺 `resource_author` → `ALTER TABLE ... ADD COLUMN resource_author TEXT NOT NULL DEFAULT ''`。
4. 缺 `resource_version` → `ALTER TABLE ... ADD COLUMN resource_version TEXT NOT NULL DEFAULT ''`。
5. 缺 `tags` → `ALTER TABLE ... ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'`。
6. 回填旧数据：
   ```sql
   UPDATE market_packages
   SET resource_id = CASE WHEN resource_id = '' THEN card_id ELSE resource_id END,
       resource_author = CASE WHEN resource_author = '' THEN card_author ELSE resource_author END,
       resource_version = CASE WHEN resource_version = '' THEN card_version ELSE resource_version END,
       tags = CASE WHEN tags = '' THEN '[]' ELSE tags END
   ```

## Package Format

### Game card package

游戏卡包保持现有格式：`.tsian-card.zip` + `game-card.json`。后端上传 game_card 继续用现有 `validatePackageZip` 逻辑读取 `game-card.json`，但写入 `resourceId/resourceAuthor/resourceVersion`。

### Agent/Skill resource package

Agent/Skill 共享统一 manifest 文件：`resource-package.json`。

```typescript
interface ResourcePackageManifest {
  schema: "tsian.resource.package.v1"
  resourceType: "agent" | "skill"
  resourceId: string
  name: string
  summary: string
  author: string
  version: string
  files: ResourcePackageFileEntry[]
}

interface ResourcePackageFileEntry {
  path: string
  mediaType?: string
}
```

#### Agent package contents

- `resource-package.json`
- `agent.json`
- `AGENT.md`
- 可选 `SOUL.md`
- 可选 `skills/<skill-id>/SKILL.md`
- 可选 `skills/<skill-id>/skill.config`
- 可选 `skills/<skill-id>/scripts/**`
- 可选 `skills/<skill-id>/lib/**`

约束：

- `resourceType === "agent"`。
- `resourceId` = Agent id。
- 必含 `agent.json` + `AGENT.md`。
- `agent.json.id` 应与 `resourceId` 一致；安装到桌面助手时允许改写为 `assistant`。

#### Skill package contents

- `resource-package.json`
- `SKILL.md`
- 可选 `skill.config`
- 可选 `scripts/**`
- 可选 `lib/**`

约束：

- `resourceType === "skill"`。
- `resourceId` = Skill id。
- 必含 `SKILL.md`。

### Package v1 safety constraints

Agent/Skill package v1 只支持 UTF-8 文本文件，原因是 `.tsian/local/assistant/` 当前存储模型只保存 `content: string`，不能表达 Blob。导出端只写文本文件；上传端和安装端都拒绝无法 UTF-8 解码的文件。

路径规则：

- `files[].path` 与 zip entry 都规范化为 `/` 分隔的安全相对路径。
- 禁止空路径、绝对路径、NUL、`.`、`..` 穿越。
- `resource-package.json` 不进入 `files`。
- `files` 清单中的每个文件必须在 zip 中存在。
- 上传端拒绝清单外非目录文件；安装端只安装 manifest `files` 清单内文件。

## Tag Design

### Storage

`market_packages.tags` 保存规范化后的 JSON 字符串数组。

### Normalization

后端是权威：

- 输入支持逗号分隔字符串或 JSON string array（上传表单字段叫 `tags`）。
- trim。
- 去空。
- 统一 lower-case。
- 同包去重。
- 最多 10 个。
- 每个 tag 1-32 字符。
- 只允许中文、英文、数字、`-`、`_`。
- 非法 tag：上传/list query 返回 400。

### Query

List SQL 动态拼接条件：

```sql
WHERE 1=1
  [AND p.resource_type = ?]
  [AND (p.name LIKE ? OR p.summary LIKE ?)]
  [AND p.tags LIKE ?]
```

`tag` 过滤使用规范化后的 tag，并匹配 `LIKE '%"tag"%'`。由于 tag 字符集禁止 `%` / `_` / `"`，无需额外 LIKE escape。

## Backend Changes

### `internal/storage/db.go`

- 建表 SQL 加 `resource_*` 与 `tags`。
- 增加 idempotent migration helper：`ensureMarketPackageColumns(ctx, db)`。

### `internal/market/market.go`

```go
type ResourceType string

const (
    ResourceGameCard ResourceType = "game_card"
    ResourceAgent    ResourceType = "agent"
    ResourceSkill    ResourceType = "skill"
)

type Package struct {
    ID              string
    ResourceType    ResourceType
    ResourceID      string
    ResourceAuthor  string
    ResourceVersion string
    Name            string
    Summary         string
    Tags            []string
    CoverBlobKey    string
    UploaderID      string
    DownloadCount   int
    CreatedAt       time.Time
    UpdatedAt       time.Time
}

type ListFilter struct {
    Query        string
    Sort         string
    Limit        int
    ResourceType ResourceType
    Tag          string
}
```

### `internal/market/sqlite_repo.go`

- SELECT/Get 使用 `p.resource_id, p.resource_author, p.resource_version, p.tags`。
- INSERT 写 `resource_*`、`tags`；为兼容旧列，可同步写 `card_* = resource_*`。
- Scan 解析 tags JSON；损坏值建议返回错误，暴露数据问题。
- List 支持 resourceType/tag/query 组合过滤。

### `internal/market/handler.go`

上传分流：

```go
resourceType := normalizeResourceType(r.FormValue("resourceType"))
tags := normalizeTags(r.FormValue("tags"))

switch resourceType {
case ResourceGameCard:
    // 现有 game-card.json 校验
case ResourceAgent, ResourceSkill:
    // 校验 resource-package.json schema/resourceType/resourceId/files
    // 按 resourceType 校验 required files
    // 所有 files 为 UTF-8 文本安全路径
}
```

响应 JSON：

```go
type packageResponse struct {
    ID              string   `json:"id"`
    ResourceType    string   `json:"resourceType"`
    ResourceID      string   `json:"resourceId"`
    ResourceAuthor  string   `json:"resourceAuthor"`
    ResourceVersion string   `json:"resourceVersion"`
    Name            string   `json:"name"`
    Summary         string   `json:"summary"`
    Tags            []string `json:"tags"`
    // ...
}
```

List handler：

- 解析 `resourceType` / `tag` / `q` / `sort`。
- 未知 `resourceType` 返回 400。
- 非法 tag 返回 400。

Download filename：

- `game_card`: `<resourceId>.tsian-card.zip`
- `agent`: `<resourceId>.tsian-agent.zip`
- `skill`: `<resourceId>.tsian-skill.zip`

## Frontend Structure

### Components

新增目录：`apps/platform-web/src/components/market/`。

建议组件：

- `MarketResourceTypeSidebar.vue`：资源类型切换和数量展示。
- `MarketTagFilter.vue`：tag 输入/筛选显示。
- `MarketPackageGrid.vue`：卡片列表。
- `MarketPackageDetail.vue`：详情和下载安装按钮。
- `MarketUploadPanel.vue`：资源类型、来源、metadata、tag 输入。
- `MarketInstallDialog.vue`：Agent/Skill 安装目标选择。

`AppMarketView.vue` 保留：

- screen 状态（list/detail/upload）。
- current resource type / search / sort / selected tag。
- 调用 composable 或 platform-host helper。
- 错误/反馈 toast 协调。

### API client

```typescript
export const marketApi = {
  async list(params?: {
    resourceType?: MarketResourceType
    q?: string
    tag?: string
    sort?: "newest" | "downloads"
  }): Promise<MarketPackage[]> { ... },

  async upload(file: Blob, params: {
    resourceType: MarketResourceType
    title?: string
    summary?: string
    author?: string
    version?: string
    tags?: string
  }): Promise<MarketPackage> { ... },
}
```

Upload filename：

- `package.tsian-card.zip`
- `package.tsian-agent.zip`
- `package.tsian-skill.zip`

## Frontend Package + Install Service

新增 `apps/platform-web/src/platform-host/resource-packages.ts`。

### Types

```typescript
export type AgentPackageSource =
  | { kind: "card-agent"; cardId: string; agentId: string }
  | { kind: "assistant" }

export type SkillPackageSource =
  | { kind: "card-shared"; cardId: string; skillId: string }
  | { kind: "agent-local"; cardId: string; agentId: string; skillId: string }
  | { kind: "assistant-local"; skillId: string }

export type AgentInstallTarget =
  | { kind: "card"; cardId: string }
  | { kind: "assistant" }

export type SkillInstallTarget =
  | { kind: "card-shared"; cardId: string }
  | { kind: "agent-local"; cardId: string; agentId: string }
  | { kind: "assistant-local" }

export interface ResourcePackageInspection {
  resourceType: "agent" | "skill"
  resourceId: string
  name: string
  summary: string
  version: string
  files: Array<{ path: string; content: string }>
}
```

### Public functions

```typescript
export async function exportAgentPackage(source: AgentPackageSource): Promise<Blob>
export async function exportSkillPackage(source: SkillPackageSource): Promise<Blob>
export async function inspectResourcePackage(blob: Blob): Promise<ResourcePackageInspection>
export async function installAgentPackage(blob: Blob, target: AgentInstallTarget): Promise<void>
export async function installSkillPackage(blob: Blob, target: SkillInstallTarget): Promise<void>
```

### Directory replacement helpers

新增/封装 helper，UI 不直接拼路径和 delete/write：

```typescript
export async function replaceCardContentDirectory(
  cardId: string,
  directoryPath: string,
  files: Array<{ relativePath: string; content: string }>,
): Promise<void>

export async function replaceAssistantDefinition(
  files: Array<{ relativePath: string; content: string }>,
): Promise<void>

export async function replaceAssistantSkillDirectory(
  skillId: string,
  files: Array<{ relativePath: string; content: string }>,
): Promise<void>
```

Implementation notes：

- `replaceCardContentDirectory` 应优先放 storage/platform-host 层，内部使用 Dexie transaction 删除 `directoryPath` 下旧文件并写入新文件；如果短期复用 `deleteLocalGameCardContentPathForCard` + `writeCardContentFileForCard`，也必须通过单一 helper 封装，后续可无感升级为事务实现。
- `replaceAssistantDefinition` 在 assistant map 中删除：
  - `.tsian/local/assistant/agent.json`
  - `.tsian/local/assistant/AGENT.md`
  - `.tsian/local/assistant/SOUL.md`
  - `.tsian/local/assistant/skills/**`
  然后写入新 definition files；保留 sessions/traces/notes。
- `replaceAssistantSkillDirectory` 只删除 `.tsian/local/assistant/skills/<skillId>/`。

### Path mapping

安装到卡：

- Agent：package `agent.json` → `agents/<resourceId>/agent.json`；`AGENT.md` → `agents/<resourceId>/AGENT.md`；`skills/x/...` → `agents/<resourceId>/skills/x/...`。
- Skill card-shared：package `SKILL.md` → `skills/<resourceId>/SKILL.md`。
- Skill agent-local：package `SKILL.md` → `agents/<agentId>/skills/<resourceId>/SKILL.md`。

安装到助手：

- Agent：package files → `.tsian/local/assistant/<path>`；安装前把 `agent.json.id` 改写为 `LOCAL_ASSISTANT_AGENT_ID`。
- Skill：package files → `.tsian/local/assistant/skills/<resourceId>/<path>`。

## Frontend Flows

### Upload

- 游戏卡：`listPlatformGameCards()`，过滤 `source !== "builtin"`，调用 `exportPlatformGameCardPackage`。
- Agent：来源 `{ kind: "card-agent"; cardId; agentId } | { kind: "assistant" }`，调用 `exportAgentPackage`。
- Skill：来源 `{ kind: "card-shared"; cardId; skillId } | { kind: "agent-local"; cardId; agentId; skillId } | { kind: "assistant-local"; skillId }`，调用 `exportSkillPackage`。
- 上传前填 tag/author/version，title/summary 默认从资源元数据提取。

### Install

- 游戏卡：沿用现有卡包安装与覆盖确认。
- Agent：下载 zip → inspect → 选择 `{ kind: "card"; cardId } | { kind: "assistant" }` → 若目标存在同 id，确认替换 → `installAgentPackage`。
- Skill：下载 zip → inspect → 选择 `{ kind: "card-shared"; cardId } | { kind: "agent-local"; cardId; agentId } | { kind: "assistant-local" }` → 若目标存在同 id，确认替换 → `installSkillPackage`。
- 所有目标卡列表过滤 `source === "builtin"`。

## 文案改名“创意工坊”

`desktop-apps.ts`：

- `label: "应用市场"` → `"创意工坊"`
- `title: "应用市场"` → `"创意工坊"`
- `caption: "浏览与安装游戏卡"` → `"分享与安装创意资源"`

UI 文案：

- “上传应用” → “上传资源”
- “搜索市场” → “搜索创意工坊”
- 空状态与错误文案覆盖游戏卡/Agent/Skill 三类。

路由 `/market`、`appId: "market"`、route name 不变。

## Data Flow

### 上传流程（Agent）

```
用户选卡内 Agent 或桌面助手
  → exportAgentPackage(source)
  → 生成 resource-package.json + 文本文件 zip
  → marketApi.upload(blob, {resourceType:"agent", tags, author, version})
  → 后端校验 schema/resourceType/resourceId + UTF-8 + path safety
  → 存 zip + 写 market_packages(resource_id=agentId, tags, resource_type)
```

### 安装流程（Agent → 卡）

```
用户点下载安装
  → marketApi.download(id)
  → inspectResourcePackage(blob)
  → 选择目标卡 X（非 builtin）
  → 若 agents/<resourceId>/ 存在，确认替换
  → installAgentPackage(blob, {kind:"card", cardId:"X"})
  → replaceCardContentDirectory("X", "agents/<resourceId>", files)
  → emitGameCardsChanged()
```

### 安装流程（Agent → 覆盖助手）

```
用户点下载安装
  → 选择“覆盖桌面助手”
  → confirmChoice("将替换当前桌面助手定义，保留会话/trace/notes")
  → 解 zip + 校验
  → agent.json.id 改写为 "assistant"
  → replaceAssistantDefinition(files)
```

### 安装流程（Skill → 指定 Agent）

```
用户点下载安装
  → inspectResourcePackage(blob)
  → 选择卡共享 / 卡内 Agent / 桌面助手 Agent
  → 若目标 skills/<resourceId>/ 存在，确认替换
  → installSkillPackage(blob, target)
  → replaceCardContentDirectory 或 replaceAssistantSkillDirectory
```

## Compatibility & Rollback

- 现有 game_card 包格式不变。
- 现有 `market_packages` 旧列保留并迁移到 `resource_*`；旧记录 `tags` 默认为 `[]`。
- 现有 API response 字段从 `cardId` 切换到 `resourceId` 是前后端同任务内同步改动；外部公开兼容不是 MVP 要求。
- `AppMarketView` 拆分不影响路由。
- 回滚：还原 contracts/market response + market repo/handler + 前端 market view；新增 DB 列可保留不用。

## Tradeoffs

- **resource* 字段** vs 复用 card* 字段：选择 resource*，避免 Agent/Skill 长期语义错位；代价是本任务多改 contracts/backend/frontend。
- **统一 `resource-package.json`** vs `agent-package.json`/`skill-package.json`：选择统一 manifest，后续新增资源类型更省；代价是首版包名少一点直观性。
- **拆组件/composable** vs 单文件快写：选择拆分，避免 `AppMarketView.vue` 巨型化；代价是文件数更多。
- **目录替换 helper** vs UI delete + write：选择 helper，安装语义集中且未来可升级事务；代价是需要多写一层平台服务。
- **助手覆盖改写 id** vs 仅允许 `resourceId=assistant`：选择改写 id，让普通 Agent 包可作为桌面助手使用；代价是安装时需要修改 `agent.json`。
- **Agent/Skill v1 文本包** vs 支持 Blob：选择文本包，匹配助手本地存储；二进制留到后续 schema 版本。
- **tag 用 LIKE** vs 关联表：原型期够用；通过限制 tag 字符集降低 LIKE 误匹配/escape 复杂度，10 万级再迁移。
