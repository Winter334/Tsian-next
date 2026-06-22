# Implement — 存储层重构 + 媒体查看器 + 分流 + 改后缀提示

跨层改动,按依赖顺序执行:契约 → 存储 → platform-host → agent-runtime → lib → 视图 → 路由 → SW。

## 执行清单

### 1. 契约层(packages/contracts/src/runtime.ts)

- [ ] 1.1 `WorkspaceFile`:删 `mediaType`,加 `binary?: Blob`。
- [ ] 1.2 `WorkspaceEntry`:删 `mediaType`。
- [ ] 1.3 `WorkspaceSearchResult`:删 `mediaType`。
- [ ] 1.4 `WorkspaceOperationRequest`:删 `mediaType`,`content` 改为 `content?: string | Blob`。
- [ ] 1.5 `npm run build:contracts`(会报错,因为下游消费 mediaType——预期,后续步骤修复)。

### 2. 共享 mediaType 推断(apps/platform-web/src/lib/media-type.ts)

- [ ] 2.1 新建 `lib/media-type.ts`,实现 `inferMediaTypeFromPath(path, { fallback })` + `inferWorkspaceMediaType` 薄包装 + `isTextMediaType`/`isImageMediaType`/`isAudioMediaType`/`isVideoMediaType`。
- [ ] 2.2 `workspace-file-types.ts`:`inferWorkspaceMediaType` 改为从 `media-type.ts` 导入或 re-export。`WORKSPACE_MEDIA_TYPE_OPTIONS` 保留(若编辑器还用,子1 已删下拉框则可删)。
- [ ] 2.3 `game-cards.ts` `normalizeMediaType` 改为调 `inferMediaTypeFromPath`。
- [ ] 2.4 `game-card-packages.ts` `inferMediaType` 改为调 `inferMediaTypeFromPath`(或 re-export)。
- [ ] 2.5 `workspace.ts` `normalizeMediaType` 改为调 `inferMediaTypeFromPath({ fallback: "text/plain" })`。

### 3. DB schema(storage/db.ts)

- [ ] 3.1 `LocalWorkspaceFileRecord`:删 `mediaType`,加 `data?: Blob`。
- [ ] 3.2 `LocalGameCardContentFileRecord`:删 `mediaType`,加 `data?: Blob`。
- [ ] 3.3 `LocalGameCardFrontendFileRecord`:删 `mediaType`(SW 改读 `data.type`)。
- [ ] 3.4 DB 名 `"tsian-agent-runtime-v7"` → `"tsian-agent-runtime-v8"`。
- [ ] 3.5 `public/tsian-game-card-frontend-sw.js`:`DB_NAME` 同步改 v8;响应构造改读 `file.data.type || "application/octet-stream"`(不再读 `file.mediaType`)。

### 4. 存储层读写(storage/workspace.ts + game-cards.ts)

- [ ] 4.1 `WorkspaceWriteInput`:删 `mediaType`,加 `data?: unknown`(Blob)。
- [ ] 4.2 `writeWorkspaceFileForSave` / `writeWorkspaceFileToFiles`:支持 `data` 是 Blob 时存 `data` 字段(content 置空),否则存 content(data 置空)。删 mediaType 处理。
- [ ] 4.3 `toWorkspaceFile` / `toWorkspaceFileFromGameCardContent`:映射 `data`(Blob)到 `binary`,删 mediaType。size 派生 `data?.size ?? content.length`。**二进制文件 content 返回占位说明文本**(`[binary file: ${mediaType}, ${blob.size} bytes — 不可读取为文本]`)而非空串,避免 agent 误判文件为空。新增 `binaryPlaceholderText(blob, path)` helper。
- [ ] 4.4 `game-cards.ts` `writeLocalGameCardContentFile` / `LocalGameCardContentFile` 类型:支持 `data?: Blob`,删 mediaType。
- [ ] 4.5 `game-cards.ts` `toBlob` / `normalizeFrontendFile`:删 mediaType 参数(用 `Blob.type` 或 `inferMediaTypeFromPath`)。`LocalGameCardFrontendFileRecord` 删 mediaType 后,`normalizeFrontendFile` 不再写 mediaType 字段。
- [ ] 4.6 `game-cards.ts` `cloneGameCardFrontendFileRecord`:删 mediaType 透传。
- [ ] 4.7 `local-assistant-files.ts`:`StoredAssistantFile` 删 mediaType(若有),写入硬编码 mediaType 处改为按 path 推断或删除。

### 5. 封面 Blob 链路

- [ ] 5.1 `covers.ts` `setPlatformGameCardCover`:上传分支改为直接存 `input.file`(File/Blob)到 contentFile `data` 字段,不再 base64。删 `bytesToBase64`(确认无其他消费点)。
- [ ] 5.2 `game-card-display.ts` `getGameCardCoverUrl`:改为 `coverContentFile.data ? URL.createObjectURL(coverContentFile.data) : null`。删 svg/base64 三路分支。
- [ ] 5.3 `game-card-packages.ts` 导入:cover bytes → `new Blob([bytes], { type: inferMediaTypeFromPath(coverPath) })` → 存 `data`。
- [ ] 5.4 `game-card-packages.ts` 导出:`cover.data.arrayBuffer()` → bytes 写 zip。删 `parseDataUrl`/`base64ToBytes`/`bytesToBase64`(确认无其他消费点)。
- [ ] 5.5 `GameCardDetailView.vue` 封面相关:确认 `getGameCardCoverUrl` 返回 Blob URL 后,`<img :src>` 正常工作。卸载时可选 revoke(若封面 URL 重建频繁且泄漏明显)。

### 6. platform-host(workspace-ops.ts + covers.ts + internal.ts + 其他)

- [ ] 6.1 `workspace-ops.ts`:`writePlatformWorkspaceFile` / `patchPlatformWorkspaceFile` 删 mediaType 入参,支持 `data?: Blob`。`executeLocalWorkspaceOperation` / `executeStudioWorkspaceOperation` 的 write mutation 删 mediaType 透传,加 data 透传。
- [ ] 6.2 `workspace-ops.ts` `readPlatformWorkspaceFile`:返回 `WorkspaceFile`(含 binary)。
- [ ] 6.3 `internal.ts`:`writeCardContentFileForCard` / `cardContentFilesToWorkspaceFiles` 删 mediaType,支持 data。
- [ ] 6.4 `assistant-chat.ts` / `history-turns.ts` / `studio-agents.ts` / `local-assistant.ts`:硬编码 mediaType 处改为 `inferMediaTypeFromPath(path)` 或删除(若存储层不再需要)。
- [ ] 6.5 `browser-skill-script-executor.ts`:trace/transaction 透传删 mediaType。

### 7. agent-runtime(workspace-operations.ts + workspace-tools.ts + registry.ts + index.ts)

- [ ] 7.1 `workspace-operations.ts`:
  - `listWorkspaceEntries`:size 派生 `binary?.size ?? content.length`。entry 不再带 mediaType。
  - `searchWorkspaceFiles`:跳过 `file.binary` 存在的文件(不可搜文本)。
  - `readWorkspaceFile`:透传 binary。
  - `writeWorkspaceFile`:`request.content` 是 `string | Blob`,按类型分流。删 mediaType。
  - `moveWorkspacePath`:透传 `file.binary` + `file.content`。删 mediaType。
  - `diffWorkspaceFile`:跳过二进制文件(不可 diff)。
  - `validateWorkspaceFile`:跳过二进制文件(不可校验文本格式)。
- [ ] 7.2 `workspace-tools.ts`:trace size 派生 `binary?.size ?? content.length`。删 mediaType 透传。
- [ ] 7.3 `registry.ts`:`size: candidate.content.length` 改 `binary?.size ?? content.length`。`SkillResourceEntry` 删 mediaType(若有)或改为 `inferMediaTypeFromPath`。
- [ ] 7.4 `index.ts` L526 `formatWorkspaceFile`:`(${file.mediaType})` 改为 `(${inferMediaTypeFromPath(file.path)})` 或删除 mediaType 显示。
- [ ] 7.5 `tool-schemas.ts`:`workspace_write` schema 删 `mediaType` 参数。
- [ ] 7.6 `diagnostics.ts`:确认 `parseTraceFileContent` 不依赖 mediaType。

### 8. 编辑器清理(WorkspaceEditorView.vue)

- [ ] 8.1 删除 `mediaType`/`mediaTypeTouched`/`originalMediaType` ref。
- [ ] 8.2 删除 `mediaTypeOptions`/`mediaTypeLabel`/`mediaTypeChanged` computed。
- [ ] 8.3 `saveDraft`:不再传 mediaType,`writePlatformWorkspaceFile({ path, content })` / `patchPlatformWorkspaceFile({ path, content })`。
- [ ] 8.4 `editorValidator` computed:删 `type.includes("json")` 分支,只靠 path 后缀(`path.endsWith(".json")`)。
- [ ] 8.5 `loadFile` / `applySavedFile`:删 mediaType 处理。
- [ ] 8.6 footer:`mediaTypeLabel` 改为 `inferMediaTypeFromPath(draftPath)` 或删除类型显示。
- [ ] 8.7 `watch(draftPath)`:删 mediaType 推断逻辑。
- [ ] 8.8 `WORKSPACE_MEDIA_TYPE_OPTIONS` / `workspaceMediaTypeLabel` import 清理。

### 9. 资源管理器(WorkspaceExplorerView.vue)

- [ ] 9.1 `openEditorForFile` 改名 `openFile`,按 mediaType 分流(text → editor,image/audio/video → media)。
- [ ] 9.2 新增 `openMediaRoute(path)`。
- [ ] 9.3 条目菜单"编辑"改为:文本文件显示"编辑",媒体文件显示"查看"(或统一"打开"走分流)。
- [ ] 9.4 搜索结果点击、双击文件:改调 `openFile`。
- [ ] 9.5 `commitRename`:加改后缀风险提示(`splitNameExt(old).ext !== splitNameExt(new).ext` → confirm)。
- [ ] 9.6 `entryTypeLabel`(列表"类型"列):`entry.mediaType ?? inferWorkspaceMediaType(entry.path)` 改为 `inferMediaTypeFromPath(entry.path)`。

### 10. 媒体查看器(WorkspaceMediaView.vue)

- [ ] 10.1 新建 `views/WorkspaceMediaView.vue`:按 mediaType 渲染 `<img>`/`<audio>`/`<video>`,Blob URL,onMounted 读取,onBeforeUnmount revoke。
- [ ] 10.2 `desktop-apps.ts`:注册 `workspace-media` app/route。
- [ ] 10.3 router 配置:新增 `workspace-media` 路由,query `cardId`/`path`。

### 11. Service Worker

- [ ] 11.1 `tsian-game-card-frontend-sw.js`:`DB_NAME` 改 v8。
- [ ] 11.2 响应构造:`file.mediaType` 改 `file.data.type || "application/octet-stream"`。

### 12. 最终清理

- [ ] 12.1 全局搜索 `mediaType` 确认可动部分已全删(`LocalGameCardFrontendFileRecord` 已删,zip manifest 保留)。
- [ ] 12.2 全局搜索 `bytesToBase64`/`base64ToBytes`/`parseDataUrl` 确认已删或仍有合理消费点。
- [ ] 12.3 `npm run build:contracts` + `npm run build:web` 通过。

## 验证

- [ ] `npm run build:contracts` + `npm run build:web` 通过。
- [ ] 手动验证:
  - 封面上传后显示正常(Blob URL)。
  - 封面图在资源管理器点开走媒体查看器显示图片。
  - 上传一个 mp3/mp4 到工作区,点开走媒体查看器播放。
  - 文本文件(json/md)点开走编辑器,正常编辑保存。
  - 资源管理器列表"类型"列正确显示。
  - 重命名改后缀弹风险提示。
  - agent chat 正常(workspace.read 返回 string,agent 不受影响)。
  - 刷新页面后 DB 名 v8 生效(旧 v7 数据丢弃,空白重建)。

## Review Gates

- 契约改完后 build:contracts 会有大量下游错误(预期),不要中途停——一路改到存储层修复后才会绿。
- 存储层改完后 build:web 检查一次。
- 全部改完后完整 build + 手动验证。

## Rollback Points

- 跨层改动,回滚 = `git revert` 整个 commit。
- DB 名 v8 已 bump,回滚后需手动清 IndexedDB 或 bump 回 v7。
