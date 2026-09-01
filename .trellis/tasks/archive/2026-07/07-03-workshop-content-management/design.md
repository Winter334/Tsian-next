# 创意工坊内容管理 — Technical Design

## Architecture Overview

本任务在现有 `market` 架构上补内容管理能力，不引入新的顶层应用或跳转入口。

```text
platform-web
  AppMarketView.vue                         # 创意工坊页状态协调
    ├─ MarketResourceTypeSidebar.vue         # 资源类型 + 底部单按钮范围切换
    ├─ MarketPackageGrid.vue                 # 列表卡片
    ├─ MarketPackageDetail.vue               # 详情 + owner-only 管理区 + 内联编辑态
    ├─ MarketReplacementDialog.vue           # 新增：选择替换资源弹窗
    └─ MarketInstallDialog.vue               # 既有安装目标弹窗，作为交互参考

platform-host/api-client.ts
  marketApi.list/counts/get/upload/download/update/delete

packages/contracts/src/market.ts
  MarketPackage updatedAt + 管理 API 参数/结果相关类型（按需要）

platform-server
  internal/server/server.go                  # 注册 my-list / update / delete 路由
  internal/market/handler.go                 # auth owner 校验、multipart update、delete
  internal/market/market.go                  # Repository 接口扩展
  internal/market/sqlite_repo.go             # uploader filter、update、delete
  internal/storage/blobstore.go              # 继续使用 Put/Open/Delete
```

核心边界：

- **发布物身份**：`package.id`，由服务器生成，更新资源包后保持不变。
- **资源本体身份**：`resourceId`，来自资源包 manifest；替换资源包时允许变化。
- **资源类型**：`resourceType`，替换资源包时必须保持一致。
- **所有权**：后端以 `market_packages.uploader_id` 为权威；前端 owner-only UI 只是展示优化。

## API Design

### 公开列表与计数保持不变

现有：

- `GET /api/v1/market/packages`
- `GET /api/v1/market/packages/counts`
- `GET /api/v1/market/packages/{id}`
- `GET /api/v1/market/packages/{id}/download`
- `GET /api/v1/market/packages/{id}/cover`
- `GET /api/v1/market/packages/{id}/cover-thumb`

继续公开可读。

### 我的上传列表

新增登录后端点：

- `GET /api/v1/market/my/packages`
- `GET /api/v1/market/my/packages/counts`

两者使用 `middleware.RequireAuth`。查询参数复用公开列表：

- `resourceType`
- `q`
- `tag`
- `sort`
- `limit`
- `cursor`

服务端将当前用户 ID 写入 `ListFilter.UploaderID` / `CountFilter.UploaderID`，只返回该用户上传的资源。未登录直接由 middleware 返回 401；前端未登录时通常不发起该请求，而是在创意工坊内显示登录提示。

### 更新发布物

新增登录端点：

```http
PATCH /api/v1/market/packages/{id}
Content-Type: multipart/form-data
```

表单字段：

- `file`：可选。存在时表示替换资源包。
- `title`：标题。保存时应非空；选择替换资源包时可由新 manifest 补齐。
- `summary`：简介。保存时应非空；选择替换资源包时可由新 manifest 补齐。
- `author`：作者，可为空。
- `version`：版本，可为空但 UI 默认给出当前值或 manifest 值。
- `tags`：tags 字符串，复用现有 comma / JSON 数组解析；空字符串清空 tags。

后端流程：

1. `RequireAuth` 注入当前用户。
2. 根据 `{id}` 读取现有发布物。
3. 不存在返回 404；`uploader_id != currentUser.id` 返回 403。
4. 解析并校验 tags。
5. 如果包含 `file`：
   - 继续使用 50MB 限制；
   - 使用现有 `validateUploadZip(content, existing.ResourceType)` 校验资源包；
   - 因为校验传入现有 `resourceType`，跨类型替换会返回 400；
   - 不校验新旧 `resourceId` 是否一致；
   - 游戏卡继续走封面处理，生成展示封面与缩略图；
   - `resourceId/resourceAuthor/resourceVersion` 可随新 manifest 更新。
6. 合成最终元数据：
   - 有替换文件时，`title/summary/author/version` 非空表单值优先，否则使用新 manifest 值；
   - 无替换文件时，使用表单值更新当前元数据；`title/summary` 必须非空；
   - tags 使用表单解析结果。
7. 写入 blob（如果有替换文件）与数据库更新。
8. 返回更新后的 `MarketPackage`。

状态码：

- 200：更新成功，返回 `MarketPackage`。
- 400：非法 multipart、非法 tags、资源包校验失败、跨类型替换、标题/简介为空。
- 401：未登录。
- 403：非上传者。
- 404：发布物不存在。
- 500：存储或数据库失败。

### 删除发布物

新增登录端点：

```http
DELETE /api/v1/market/packages/{id}
```

后端流程：

1. `RequireAuth` 注入当前用户。
2. 根据 `{id}` 读取现有发布物。
3. 不存在返回 404；`uploader_id != currentUser.id` 返回 403。
4. 删除数据库记录，让公开列表/详情/下载/封面立即不可见。
5. 清理 `market/<id>.zip`、`coverBlobKey`、`coverThumbBlobKey`。
6. 返回 204。

删除是硬删除；没有恢复入口。blob 清理在成功路径必须执行；若某个 blob 已不存在，应视为可容忍的 cleanup 状态，不应让公开记录复活。若出现非 `not exists` 的 cleanup 错误，优先保证 DB 记录已删除，记录/返回可观测错误按实现时现有错误处理能力决定。

## Contract Changes

`packages/contracts/src/market.ts`：

- `MarketPackage` 增加：
  - `updatedAt: string`
- 保留：
  - `coverUrl: string | null`
  - `coverThumbUrl: string | null`
  - `uploader: MarketPackageUploader`
- 若前端 API client 需要共享参数类型，可新增：
  - `MarketPackageListScope = "all" | "mine"`
  - `MarketPackageUpdateInput`（仅类型，不放运行时验证）

contracts 仍保持 type-only，不放 fetch、表单构建或运行时 parser。

## Repository / Database Design

### Domain Types

`internal/market/market.go` 扩展：

```go
type ListFilter struct {
    Query        string
    Sort         string
    Limit        int
    Cursor       string
    ResourceType ResourceType
    Tag          string
    UploaderID   string // empty = all uploaders
}

type CountFilter struct {
    UploaderID string // empty = all uploaders
}

type PackageUpdate struct {
    ResourceID        string
    ResourceAuthor    string
    ResourceVersion   string
    Name              string
    Summary           string
    Tags              []string
    CoverBlobKey      string
    CoverThumbBlobKey string
}
```

Repository 扩展：

```go
type Repository interface {
    List(ctx context.Context, filter ListFilter) (ListResult, error)
    Counts(ctx context.Context, filter CountFilter) (CountsByResourceType, error)
    GetByID(ctx context.Context, id string) (*PackageWithUploader, error)
    Create(ctx context.Context, pkg Package) error
    Update(ctx context.Context, id string, update PackageUpdate) error
    Delete(ctx context.Context, id string) error
    IncrementDownloadCount(ctx context.Context, id string) error
}
```

### SQLite

- `List` 的 SQL 增加 `AND p.uploader_id = ?`（当 `filter.UploaderID != ""`）。
- `Counts` 接收 `CountFilter`，在有 uploader 时按 uploader 过滤。
- `Update` 更新：
  - `resource_id`
  - `resource_author`
  - `resource_version`
  - `name`
  - `summary`
  - `tags`
  - `cover_blob_key`
  - `cover_thumb_blob_key`
  - `updated_at`
- `Delete` 删除 `market_packages` 记录。
- `IncrementDownloadCount` 不应再更新 `updated_at`，否则公开的 `updatedAt` 会随下载变化，无法表达“发布物更新时间”。

无需新增表。现有 `updated_at` 字段已经可承载“发布内容/元数据更新时间”，但需要停止在下载计数递增时触碰它。

## Blob Handling

现有下载路径由 `package.id` 推导：`market/<id>.zip`。本任务保持这个稳定路径，避免新增 package blob key 列。

更新资源包时：

- zip 仍写入 `market/<id>.zip`。
- 游戏卡封面仍写入：
  - `market/<id>/cover.webp`
  - `market/<id>/cover-thumb.webp`
- 如果新资源包没有封面，则数据库中的 cover key 清空，并删除旧 cover blobs。
- 如果更新数据库失败，应尽力恢复或清理刚写入的 blob，避免公开记录指向不一致内容。
- 封面 URL 应带版本化 query（例如基于 `updatedAt`），避免浏览器缓存 `cover` / `cover-thumb` 后在替换封面时继续显示旧图。

删除发布物时：

- 删除 DB 记录后清理 zip、cover、cover-thumb。
- 删除 zip 或 cover 时不要触碰其他 package 的 blob；所有 key 必须来自读取到的目标发布物。

## Frontend Data Flow

### Scope State

`AppMarketView.vue` 新增：

```ts
type MarketScope = "all" | "mine"
const marketScope = ref<MarketScope>("all")
```

列表/计数读取：

- `marketScope === "all"` → `marketApi.list(...)` / `marketApi.counts(...)` 使用公开端点。
- `marketScope === "mine" && loggedIn` → 使用 `/my` 端点。
- `marketScope === "mine" && !loggedIn` → 不请求列表；主内容显示登录提示。

切换 scope 时：

- 返回 list screen；
- 清空 detail；
- 重置 cursor；
- refresh list / counts。

### Sidebar

`MarketResourceTypeSidebar.vue` 从“只有资源类型”扩展为：

- 上部：资源类型按钮（游戏卡 / Agent / Skill）。
- 底部：单一范围切换按钮。
  - 全部资源态显示“我的上传”。
  - 我的上传态显示“全部资源”。

不要把“我的上传”和资源类型按钮并列；它是范围切换，不是资源类型。

### Detail Owner Actions

`MarketPackageDetail.vue` 增加 props / emits：

- `canManage: boolean`
- `updating: boolean`
- `deleting: boolean`
- `edit-state` 或组件内部 draft（实现时决定）
- emits：
  - `update-publish`
  - `delete`
  - `select-replacement`

owner-only 区域展示：

```text
你的发布物
[编辑发布] [删除]
```

非 owner 不渲染该区域。

### Inline Edit + Replacement Dialog

编辑发布态：

- 在详情页内联显示元信息字段：标题、版本、作者、简介、Tags。
- “选择资源以替换”按钮打开新增 `MarketReplacementDialog.vue`。
- 弹窗选择后不立即保存，只回填 `replacementSelection`。
- 已选择替换资源时显示：
  - `将替换为：...`
  - `重新选择`
  - `清除选择`
- 点击“保存发布”时：
  - 如无 replacement：只发送元数据 update；
  - 如有 replacement：先导出对应资源包 Blob，再发送 multipart update。

替换来源范围复用上传：

- 游戏卡：`uploadCards`（所有本地非内置卡）。
- Agent：`agentUploadOptions`（当前加载卡 + 桌面助手）。
- Skill：`skillUploadOptions`（当前加载卡 + 桌面助手）。

文案保持克制；默认不要解释“为什么只显示当前加载卡”。空状态只保留短文案，例如“没有可替换的 Agent。”

### Metadata Default / Dirty Tracking

打开编辑：

- draft 默认来自当前 `MarketPackage`。
- 为 title/version/author/summary 维护 dirty 标记。
- Tags 不跟随 manifest 默认值，只保留 draft。

选择替换资源：

- 计算/读取该替换资源的 manifest 默认值。
- 只填充未被用户改动过的字段。
- 不覆盖已 dirty 字段。

保存成功：

- toast 成功。
- 更新 detailPackage。
- 如果当前在 list，刷新 list/counts；如果在 detail，至少刷新 detail，必要时刷新 counts。
- 若当前 scope 为 mine，更新后的资源仍留在我的上传列表；若 resourceId 改变，详情展示新 resourceId。

### Delete Flow

- owner 点击“删除”。
- 使用现有 `confirm` danger 弹窗：
  - 标题：`删除发布物「...」？`
  - 文案：`删除后将从创意工坊移除，无法撤销。`
  - confirmText：`删除`
- 确认后调用 `marketApi.delete(id)`。
- 成功后 toast，回到 list，刷新 list/counts。

## Error / Permission Model

- 401：未登录；由 RequireAuth 处理。
- 403：已登录但不是 uploader。
- 404：资源不存在或已硬删除。
- 400：无效 tags、无效包、跨类型替换、标题/简介为空。
- 500：数据库或 blob 存储失败。

前端不依赖隐藏按钮保证安全；update/delete 必须以后端 uploader 校验为准。

## Compatibility Notes

- 现有公开列表、详情、上传、下载 API 保持兼容。
- `MarketPackage.updatedAt` 是新增字段；前端 consuming build 需要同步更新。
- 下载计数不再修改 `updated_at`，以保持 `updatedAt` 语义稳定。
- 封面 URL 增加 query 只改变 URL 字符串，不改变 endpoint path。

## Rollback / Failure Considerations

- 如果前端内容管理 UI 出问题，可以隐藏 owner-only 管理区；公开市场浏览/下载仍可工作。
- 如果 update API 失败，必须保留原发布物可读可下载；blob 写入失败时不得提交 DB 更新。
- 如果 delete API 在 DB 删除后 blob cleanup 失败，用户可见状态仍是删除完成；遗留 blob 作为可清理的存储问题，不应恢复公开记录。
