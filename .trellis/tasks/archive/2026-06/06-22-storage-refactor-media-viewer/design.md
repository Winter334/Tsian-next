# Design — 存储层重构 + 媒体查看器 + 分流 + 改后缀提示

## 范围

跨层改动:
- `packages/contracts/src/runtime.ts`(WorkspaceFile 等类型)
- `apps/platform-web/src/storage/db.ts`(DB schema + 版本 bump)
- `apps/platform-web/src/storage/workspace.ts`(工作区读写)
- `apps/platform-web/src/storage/game-cards.ts`(contentFile 读写 + 封面)
- `apps/platform-web/src/storage/game-card-packages.ts`(导入导出 + inferMediaType 合并)
- `apps/platform-web/src/platform-host/workspace-ops.ts`(platform API)
- `apps/platform-web/src/platform-host/covers.ts`(封面上传)
- `apps/platform-web/src/agent-runtime/workspace-operations.ts`(size 派生)
- `apps/platform-web/src/agent-runtime/workspace-tools.ts`(size 派生)
- `apps/platform-web/src/agent-runtime/registry.ts`(size 派生)
- `apps/platform-web/src/lib/game-card-display.ts`(封面 URL)
- `apps/platform-web/src/lib/workspace-file-types.ts`(合并 inferMediaType)
- `apps/platform-web/src/views/WorkspaceEditorView.vue`(清理 mediaType 状态)
- `apps/platform-web/src/views/WorkspaceExplorerView.vue`(分流 + 改后缀提示)
- `apps/platform-web/src/views/WorkspaceMediaView.vue`(新增)
- `apps/platform-web/src/desktop-apps.ts`(注册媒体查看器路由)
- `apps/platform-web/src/router/*`(路由配置)
- `apps/platform-web/public/tsian-game-card-frontend-sw.js`(DB 名 + Blob.type)

## 关键设计决策

### D1 WorkspaceFile 契约形态

```ts
// packages/contracts/src/runtime.ts
export interface WorkspaceFile {
  path: string
  content: string        // 文本文件有值,媒体文件为 ""
  binary?: Blob          // 媒体文件有值,文本文件无
  createdAt: number
  updatedAt: number
}
```

移除 `mediaType`。类型由消费点 `inferMediaTypeFromPath(path)` 派生。

`WorkspaceEntry` 移除 `mediaType`:
```ts
export interface WorkspaceEntry {
  path: string
  name: string
  kind: WorkspaceEntryKind
  updatedAt?: number
  size?: number          // binary?.size ?? content.length
  childCount?: number
}
```

`WorkspaceOperationRequest` 移除 `mediaType`,`content` 扩展:
```ts
export interface WorkspaceOperationRequest {
  operation: WorkspaceOperationName
  scope: WorkspaceScope
  path?: string
  targetPath?: string
  query?: string
  pattern?: string
  limit?: number
  content?: string | Blob  // write/patch 支持 Blob
  expectedContent?: string
  validator?: "json" | "frontmatter"
  autoFix?: boolean
}
```

### D2 存储层 DB schema

`LocalWorkspaceFileRecord`:
```ts
export interface LocalWorkspaceFileRecord {
  id: string
  saveId: string
  path: string
  content: string        // 文本文件有值
  data?: Blob            // 媒体文件有值,与 content 互斥
  createdAt: number
  updatedAt: number
}
```
移除 `mediaType`。`content` + `data` 互斥(写入时保证只有一个有值)。

`LocalGameCardContentFileRecord`:
```ts
export interface LocalGameCardContentFileRecord {
  id: string
  gameCardId: string
  path: string
  content: string        // 文本文件有值
  data?: Blob            // 封面等媒体文件有值,与 content 互斥
  createdAt: number
  updatedAt: number
}
```
移除 `mediaType`。

`LocalGameCardFrontendFileRecord`:
```ts
export interface LocalGameCardFrontendFileRecord {
  id: string
  gameCardId: string
  path: string
  data: Blob             // 不变,已是 Blob
  size: number
  createdAt: number
  updatedAt: number
}
```
移除 `mediaType`——Service Worker 改读 `data.type`(Blob 自带 type)。

DB 名 `tsian-agent-runtime-v7` → `v8`。SW 同步。

### D3 inferMediaType 统一

新建 `apps/platform-web/src/lib/media-type.ts`:

```ts
export function inferMediaTypeFromPath(
  path: string,
  options?: { fallback?: string },
): string {
  const fallback = options?.fallback ?? "application/octet-stream"
  const p = path.toLowerCase()
  // 文本
  if (p.endsWith(".json")) return "application/json"
  if (p.endsWith(".jsonl")) return "application/x-ndjson"
  if (p.endsWith(".md") || p.endsWith(".markdown")) return "text/markdown"
  if (p.endsWith(".ts") || p.endsWith(".tsx")) return "text/typescript"
  if (p.endsWith(".js") || p.endsWith(".mjs") || p.endsWith(".jsx")) return "text/javascript"
  if (p.endsWith(".css")) return "text/css"
  if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html"
  if (p.endsWith(".yaml") || p.endsWith(".yml")) return "text/yaml"
  // 图片
  if (p.endsWith(".svg")) return "image/svg+xml"
  if (p.endsWith(".png")) return "image/png"
  if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg"
  if (p.endsWith(".webp")) return "image/webp"
  if (p.endsWith(".gif")) return "image/gif"
  if (p.endsWith(".avif")) return "image/avif"
  // 音频
  if (p.endsWith(".mp3")) return "audio/mpeg"
  if (p.endsWith(".ogg")) return "audio/ogg"
  if (p.endsWith(".wav")) return "audio/wav"
  if (p.endsWith(".m4a")) return "audio/mp4"
  if (p.endsWith(".flac")) return "audio/flac"
  // 视频
  if (p.endsWith(".mp4")) return "video/mp4"
  if (p.endsWith(".webm")) return "video/webm"
  if (p.endsWith(".mov")) return "video/quicktime"
  // 其他
  if (p.endsWith(".woff")) return "font/woff"
  if (p.endsWith(".woff2")) return "font/woff2"
  if (p.endsWith(".wasm")) return "application/wasm"
  return fallback
}

// workspace 域薄包装(fallback text/plain)
export function inferWorkspaceMediaType(path: string): string {
  return inferMediaTypeFromPath(path, { fallback: "text/plain" })
}

export function isTextMediaType(mediaType: string): boolean {
  return mediaType.startsWith("text/")
    || mediaType === "application/json"
    || mediaType === "application/x-ndjson"
    || mediaType === "text/yaml"
    || mediaType === "application/yaml"
}

export function isImageMediaType(mediaType: string): boolean {
  return mediaType.startsWith("image/")
}

export function isAudioMediaType(mediaType: string): boolean {
  return mediaType.startsWith("audio/")
}

export function isVideoMediaType(mediaType: string): boolean {
  return mediaType.startsWith("video/")
}
```

`game-cards.ts` / `game-card-packages.ts` / `workspace-file-types.ts` / `workspace.ts` 的 4 份重复函数改为 import 这个共享函数。`inferWorkspaceMediaType` 保留为薄包装(外部消费点已引用这个名字)。

### D4 封面 Blob 链路

**上传(`covers.ts`)**:
```
input.file (File) → 直接就是 Blob (File extends Blob)
→ writeLocalGameCardContentFile(cardId, { path: ".cover/cover.${ext}", data: input.file })
```
不再 base64。`input.file.type` 就是 mediaType(Blob.type),存进 `data: Blob`。

**显示(`game-card-display.ts`)**:
```ts
export function getGameCardCoverUrl(card: LocalGameCardView): string | null {
  const cover = card.coverContentFile
  if (!cover?.data) return null
  return URL.createObjectURL(cover.data)
}
```
删 svg/base64 三路分支。Blob URL 长期有效(封面图缓存),组件卸载时可选 revoke(但桌面窗口多次开关,URL 重建成本低,接受不 revoke 或在 view unmount 时 revoke)。

**导入导出(`game-card-packages.ts`)**:
- 导入:zip cover bytes → `new Blob([bytes], { type: inferMediaTypeFromPath(coverPath) })` → 存 `data`。
- 导出:`cover.data.arrayBuffer()` → bytes 写进 zip。删 `parseDataUrl`/`base64ToBytes`/`bytesToBase64`(确认无其他消费点后)。

### D5 写入路径支持 Blob

`writeWorkspaceFileForSave` / `writeLocalGameCardContentFile` 签名扩展:
```ts
interface WorkspaceWriteInput {
  path?: unknown
  content?: unknown   // string (文本) 
  data?: unknown      // Blob (二进制)
  // mediaType 删除
}
```
写入逻辑:`if (data instanceof Blob) { 存 data 字段, content 置空 } else { 存 content 字段, data 置空 }`。

`WorkspaceOperationMutationAdapter.write` 签名也扩展支持 data。

`workspace-operations.ts` 的 `writeWorkspaceFile` / `moveWorkspacePath`:
- write:`request.content` 是 `string | Blob`,按类型分流存 content 或 data。
- move:`file.content` + `file.binary` 都透传到 `mutations.write`。

### D6 读取路径

`toWorkspaceFile`(workspace.ts) / `toWorkspaceFileFromGameCardContent`(workspace.ts):
```ts
function toWorkspaceFile(record: LocalWorkspaceFileRecord): WorkspaceFile {
  const hasBinary = Boolean(record.data)
  return {
    path: record.path,
    // 二进制文件 content 不是空串,而是占位说明,避免 agent 误判文件为空。
    // 未来多模态支持时,这个占位被替换成真正的 image content block。
    content: hasBinary
      ? binaryPlaceholderText(record.data!, record.path)
      : record.content ?? "",
    ...(record.data ? { binary: record.data } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function binaryPlaceholderText(blob: Blob, path: string): string {
  const mediaType = inferMediaTypeFromPath(path)
  return `[binary file: ${mediaType}, ${blob.size} bytes — 不可读取为文本]`
}
```

**二进制文件 content 返回占位说明而非空串**:agent `workspace.read` 一个 `image.png` 会拿到 `"[binary file: image/png, 12345 bytes — 不可读取为文本]"`。这避免 agent 误判文件为空,也不会尝试把内容当文本解析。未来多模态支持时,agent runtime 的 read 工具层把 `file.binary` 转成 image content block(独立通道,不进 text context),替换这个占位文本。

agent runtime 读 `file.content` 的代码零改动——content 仍是 string,只是二进制文件的 content 值从 `""` 变成有意义的占位文本。

`workspace-operations.ts` 的 `searchWorkspaceFiles`:搜索时跳过 `file.binary` 存在的文件(二进制不可搜索文本,占位文本不应被搜索匹配)。

### D7 size 派生

4 处 `size = content.length` 改为:
```ts
const size = file.binary?.size ?? file.content.length
```
位置:workspace-operations.ts(list entries)、registry.ts、workspace-tools.ts、storage/workspace.ts。

### D8 媒体查看器

新增 `apps/platform-web/src/views/WorkspaceMediaView.vue`:

```vue
<template>
  <section class="grid min-h-full grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
    <div class="retro-toolbar border-b px-3 py-2">
      <h1 class="truncate text-sm font-bold text-text-main">{{ path || "未知文件" }}</h1>
    </div>
    <main class="grid min-h-0 place-items-center overflow-auto bg-[#101411] p-4">
      <div v-if="loading" class="...">正在加载</div>
      <div v-else-if="loadError" class="...">{{ loadError }}</div>
      <img v-else-if="isImage" :src="blobUrl" class="max-h-full max-w-full object-contain" />
      <audio v-else-if="isAudio" controls :src="blobUrl" />
      <video v-else-if="isVideo" controls :src="blobUrl" class="max-h-full max-w-full" />
      <p v-else class="text-text-dim">不支持预览的文件类型</p>
    </main>
  </section>
</template>
```

逻辑:
- `onMounted`:`readPlatformWorkspaceFile({ cardId, path })` → 拿 `WorkspaceFile` → `file.binary` → `URL.createObjectURL(binary)`。
- `isImage/isAudio/isVideo` 按 `inferMediaTypeFromPath(path)` 判断。
- `onBeforeUnmount`:`URL.revokeObjectURL(blobUrl)`。

路由:新增 `workspace-media` 路由,query 同 `workspace-editor`(`cardId`/`path`)。注册到 `desktop-apps.ts` 和 router。

### D9 分流逻辑

`WorkspaceExplorerView.vue` 的 `openEditorForFile(path)` 改名 `openFile(path)`:
```ts
function openFile(path: string) {
  if (!isBrowsing.value) return
  contextMenu.value = null
  const mediaType = inferMediaTypeFromPath(path)
  if (isImageMediaType(mediaType) || isAudioMediaType(mediaType) || isVideoMediaType(mediaType)) {
    openMediaRoute(path)
  } else {
    openEditorRoute(path)
  }
}

function openMediaRoute(path: string) {
  void router.push({
    name: "workspace-media",
    query: { ...(selectedCardId.value ? { cardId: selectedCardId.value } : {}), path },
  })
}
```

所有调 `openEditorForFile` 的地方(条目菜单"编辑"、搜索结果点击、双击文件)改为调 `openFile`。但条目菜单"编辑"应只对文本文件出现(媒体文件菜单改为"查看")。

### D10 改后缀风险提示

`WorkspaceExplorerView.vue` 的 `commitRename`:
```ts
async function commitRename(entry: WorkspaceEntry) {
  // ... 现有校验 ...
  const oldExt = splitNameExt(entry.name).ext
  const newExt = splitNameExt(nextName).ext
  if (oldExt !== newExt) {
    const confirmed = await confirm({
      message: `改变扩展名「${oldExt || "无"} → ${newExt || "无"}」可能导致文件无法正确解析,确定吗?`,
      confirmText: "确定",
    })
    if (!confirmed) {
      focusRenameInput()
      return
    }
  }
  // ... 现有 move 逻辑 ...
}
```

## 数据流

```
封面上传
  File → writeLocalGameCardContentFile({ data: File }) → DB record { data: Blob }
  显示 → coverContentFile.data → URL.createObjectURL → <img :src>

媒体文件打开
  资源管理器 openFile(path)
  → inferMediaTypeFromPath(path) is image/audio/video
  → router push workspace-media
  → WorkspaceMediaView onMounted
  → readPlatformWorkspaceFile → WorkspaceFile { binary: Blob }
  → URL.createObjectURL(binary) → <img>/<audio>/<video>

文本文件保存
  编辑器 saveDraft
  → patchPlatformWorkspaceFile({ content: string })
  → writeWorkspaceFileForSave({ content }) → DB record { content: string }
```

## 边界

- agent search 跳过二进制文件(不可搜文本)。
- agent read 二进制文件返回 `content: ""`(空串)——agent 不会主动读媒体文件,即使读了也得到空串,不会崩。
- `move` 二进制文件:`file.binary` 透传到目标,`content` 透传空串。
- 封面 Blob URL 不 revoke(长期有效,桌面窗口反复开关重建成本低;若内存泄漏明显再加 revoke 策略)。
- 导入导出 zip manifest 的 mediaType 保留(外部格式契约),但内部存储不再存 mediaType——导出时 `inferMediaTypeFromPath(path)` 推断后写进 manifest。

## 回滚

跨层改动,回滚需 `git revert` 整个 commit。DB 名 bump 后旧数据已丢弃,回滚后需重新 bump 回 v7(或接受 v8 空库重建)。
