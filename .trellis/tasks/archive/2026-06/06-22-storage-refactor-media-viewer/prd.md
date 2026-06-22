# 存储层重构 + 媒体查看器 + 分流 + 改后缀提示

## Goal

一次性把工作区存储层改干净:移除可动部分 mediaType 字段(全删),引入二进制 Blob 存储让媒体文件不再走 base64 文本,封面从 base64 改 Blob,新增媒体查看器,资源管理器按 mediaType 分流,改后缀弹风险提示。

## Requirements

### R1 mediaType 全删(可动部分)

移除以下类型的 mediaType 字段:
- `WorkspaceFile.mediaType`(contracts/runtime.ts)
- `WorkspaceEntry.mediaType`(contracts/runtime.ts)
- `WorkspaceSearchResult.mediaType`(contracts/runtime.ts)
- `WorkspaceOperationRequest.mediaType`(contracts/runtime.ts)
- `LocalWorkspaceFileRecord.mediaType`(storage/db.ts)
- `LocalGameCardContentFileRecord.mediaType`(storage/db.ts)

**不动**:
- `LocalGameCardFrontendFileRecord.mediaType`(Service Worker HTTP Content-Type 依赖,但改用 `Blob.type` 派生后也可删——见 R3)。
- `GameCardPackageFileEntry.mediaType` / `FrontendPackageFileEntry.mediaType`(外部 zip manifest 格式契约)。

所有消费点改用 `inferWorkspaceMediaType(path)` 或共享 `inferMediaTypeFromPath(path)` 派生。

### R2 二进制 Blob 存储

- `LocalWorkspaceFileRecord` 加 `data?: Blob`(与 `content: string` 互斥:文本文件 content 有值 data 空,媒体文件 data 有值 content 空)。删 `mediaType`。
- `LocalGameCardContentFileRecord` 加 `data?: Blob`(封面改 Blob)。删 `mediaType`。
- `WorkspaceFile` 契约加 `binary?: Blob`(可选,媒体文件有值)。`content` 仍是 string(文本文件有值,媒体文件为空串或占位)。删 `mediaType`。
- 写入路径:`writePlatformWorkspaceFile` / `patchPlatformWorkspaceFile` 支持 Blob 输入;`writeWorkspaceFileForSave` / `writeLocalGameCardContentFile` 支持接收 Blob。
- 读取路径:二进制文件返回 `WorkspaceFile { content: "", binary: Blob }`;文本文件返回 `{ content: string }`。
- `WorkspaceOperationRequest.content` 扩展为 `string | Blob`(write/patch 签名扩展)。
- agent runtime 透明:`content` 仍是 string,agent 只读 content 不碰 binary,代码零改动。但 `size = content.length` 的 4 处(workspace-operations.ts:472、registry.ts:768、workspace-tools.ts:352、storage/workspace.ts)改用 `binary?.size ?? content.length`。

### R3 封面改 Blob

- `covers.ts` 上传封面:`input.file.arrayBuffer()` → `Blob`,直接存 `data: Blob`,不再 base64。删 `bytesToBase64`。
- `game-card-display.ts` `getGameCardCoverUrl`:从 `coverContentFile.data`(Blob)构造 `URL.createObjectURL(blob)` 返回,不再 data-URI。删 svg/base64 三路分支。注意:Blob URL 需要在组件卸载时 `URL.revokeObjectURL` 释放(或接受泄漏,封面 URL 长期有效)。
- `game-card-packages.ts` 导入导出:导入时 cover bytes → Blob 存 `data`;导出时 `data`(Blob)→ bytes 写进 zip。删 `parseDataUrl`/`base64ToBytes`/`bytesToBase64` 的封面分支(可能其他地方还用,确认后删)。
- `LocalGameCardFrontendFileRecord.mediaType`:可改用 `Blob.type` 派生,但 Service Worker 读 `file.mediaType` 字段。方案:SW 改读 `file.data.type`(Blob 自带 type),删 `mediaType` 字段。或保留字段但写入时从 `Blob.type` 填充。设计阶段定——倾向删字段,SW 改读 `data.type`。

### R4 inferMediaType 统一

当前有 4 份媒体类型推断函数(game-card-packages.ts / game-cards.ts / workspace-file-types.ts / workspace.ts),后缀覆盖不一致。合并为一份共享 `inferMediaTypeFromPath(path, { fallback })`:
- 二进制后缀列表统一(png/jpg/jpeg/webp/gif/avif/svg/mp3/ogg/wav/m4a/flac/mp4/webm/mov + 文本后缀)。
- fallback 可配:包/frontend 用 `application/octet-stream`,workspace 用 `text/plain`。
- 放在 `lib/media-type.ts` 或 `storage/media-type.ts`,各消费点 import。
- `inferWorkspaceMediaType` 变成 `inferMediaTypeFromPath(path, { fallback: "text/plain" })` 的薄包装。

### R5 媒体查看器

- 新增 `WorkspaceMediaView.vue`:根据 `inferMediaTypeFromPath(path)` 判断类型,渲染:
  - `image/*` → `<img :src="blobUrl">`
  - `audio/*` → `<audio controls :src="blobUrl">`
  - `video/*` → `<video controls :src="blobUrl">`
  - 其他 → 显示"不支持预览的文件类型"。
- Blob URL 用 `URL.createObjectURL(blob)`,组件卸载时 `revokeObjectURL`。
- 只读查看,不编辑。无保存按钮,无工具栏(或极简标题栏显示文件名)。
- 路由:复用 `workspace-editor` 路由或新增 `workspace-media` 路由。设计阶段定。

### R6 分流逻辑

- 资源管理器 `openEditorForFile(path)` 改为 `openFile(path)`:
  - `inferMediaTypeFromPath(path)` 是 text/* / json / yaml / 未知 → 编辑器。
  - 是 image/* / audio/* / video/* → 媒体查看器。
- 路由分流:编辑器走 `workspace-editor`,媒体走 `workspace-media`(或同路由不同 mode)。

### R7 改后缀风险提示

- 资源管理器 `commitRename` 时,若新名与旧名的后缀不同(`splitNameExt(old).ext !== splitNameExt(new).ext`),弹窗提示"改变扩展名可能导致文件无法正确解析,确定吗?",对齐 Windows。
- 确认 → 继续 rename;取消 → 保持原重命名输入状态。

### R8 DB 版本 bump

- DB 名 `tsian-agent-runtime-v7` → `v8`(破坏性变更,旧数据丢弃)。
- 同步改 `public/tsian-game-card-frontend-sw.js` 的 `DB_NAME`。
- 不写 version(2) 迁移,直接新建库。

## Constraints

- 破坏性变更,不做数据迁移,旧数据丢弃(项目未上线)。
- agent runtime 零改动(content 仍是 string)。
- 不改外部 zip manifest 格式(GameCardPackageFileEntry.mediaType / FrontendPackageFileEntry.mediaType 保留)。
- `npm run build:web` + `npm run build:contracts` 通过。

## Acceptance Criteria

- [ ] `WorkspaceFile`/`WorkspaceEntry`/`WorkspaceSearchResult`/`WorkspaceOperationRequest`/`LocalWorkspaceFileRecord`/`LocalGameCardContentFileRecord` 无 mediaType 字段。
- [ ] `LocalGameCardFrontendFileRecord` 的 mediaType 处理(SW 改读 Blob.type 或保留)明确且一致。
- [ ] 媒体文件以 Blob 存储,不再 base64 文本。
- [ ] 封面以 Blob 存储,`getGameCardCoverUrl` 用 Blob URL,无 base64/svg 分支。
- [ ] `inferMediaTypeFromPath` 统一,4 份重复函数消除(或薄包装)。
- [ ] 图片/音频/视频文件点开走媒体查看器(`<img>`/`<audio>`/`<video>`),不走文本编辑器。
- [ ] 资源管理器重命名改后缀时有风险提示弹窗。
- [ ] DB 名 bump 到 v8,SW 同步。
- [ ] agent 的 workspace.read 仍返回 string,agent runtime 代码零改动。
- [ ] `npm run build:web` + `npm run build:contracts` 通过。
