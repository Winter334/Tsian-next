# Design: Assistant Attachment Upload

## Architecture Overview

附件上传涉及两层改造，共享同一套多模态 content 类型：

```
Layer 1: 助手聊天附件（用户直接发图/文件给助手）
  AssistantView UI (paste/drop/pick) → attachments state → send()
    → ConversationMessageRecord 持久化（含附件引用）
    → assistant-chat orchestrator → AiChatMessage[] (content: string | ContentPart[])
    → provider adapters (多模态序列化)

Layer 2: Agent workspace_read 图片支持（agent 主动读工作区图片）
  workspace_read("temp/<img>") 或 workspace_read("world/<img>")
    → WorkspaceFile.binary (Blob) → image ContentPart
    → agent runtime 消息构建 → AiChatMessage[] / RuntimeChatMessage[]
    → provider adapters (同 Layer 1 的序列化)
```

两层共享：`ContentPart` 类型定义 + provider adapter 多模态序列化逻辑。

## Data Contracts

### 1. ContentPart（新增，packages/contracts/src/runtime.ts）

```ts
/** 多模态消息内容的一个组成部分. */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string }  // base64-encoded
```

- `image.data` 是 base64 字符串（不带 data URL prefix），由调用方编码
- 各 provider adapter 负责将其转为原生格式（OpenAI `image_url` data URL / Claude `image` source / Gemini `inlineData`）
- 统一用 base64 而非 URL，因为浏览器本地无图床，所有 provider 都需要 base64

### 2. ConversationMessageRecord 扩展

```ts
export interface ConversationMessageRecord {
  role: string
  content: string
  /** 附件元数据列表. 不持久化 Blob 本体（Blob 存 Dexie 表）;
   *  这里只存引用路径,加载时按路径从附件表取回 Blob. */
  attachments?: AttachmentRef[]
}

export interface AttachmentRef {
  /** VFS 路径,形如 "temp/<sessionId>/<filename>". */
  path: string
  /** 原始文件名. */
  name: string
  /** MIME 类型. */
  mimeType: string
  /** 文件大小(字节). */
  size: number
  /** 附件种类: image 走多模态, text 走文本注入. */
  kind: "image" | "text"
}
```

### 3. AiChatMessage / RuntimeChatMessage 扩展

```ts
// packages/contracts/src/debug.ts
export interface AiChatMessage {
  role: "user" | "assistant" | "system"
  content: string | ContentPart[]  // was: string
}

// apps/platform-web/src/runtime-host/ai.ts
export type RuntimeChatMessage =
  | { role: "user" | "system"; content: string | ContentPart[] }
  | { role: "assistant"; content: string; toolCalls?: NativeToolCall[] }
  | { role: "tool"; toolCallId: string; content: string }
```

- assistant 和 tool role 的 content 保持 string（多模态只发生在 user 输入）
- `normalizeMessages` 放宽：content 为 string 时保留，为 ContentPart[] 时也保留，其他丢弃

### 4. WorkspaceScope 新增 "temp"

```ts
// packages/contracts/src/runtime.ts
export type WorkspaceScope =
  | "effective" | "card-content" | "save-runtime"
  | "platform-meta" | "card-frontend"
  | "temp"  // ← 新增
```

```ts
// agent-runtime/workspace-operations.ts DEFAULT_SCOPE_ACCESS
"temp": {
  readLevel: 0,   // 所有 agent 可读（助手 + 运行时 agent 都能读图片）
  editLevel: 4,   // 只有助手(level 4)能写入 temp/
}
```

### 5. WorkspaceFile / WorkspaceReadResult 图片支持

`WorkspaceFile` 已有 `binary?: Blob` 字段和 `content: string`(placeholder)。
新增字段：

```ts
export interface WorkspaceFile {
  path: string
  content: string
  binary?: Blob
  /** 图片 MIME 类型,当 binary 是图片时设置. Agent runtime 据此构建 image ContentPart. */
  imageMimeType?: string
  createdAt: number
  updatedAt: number
}
```

`WorkspaceReadResult` 新增：

```ts
export interface WorkspaceReadResult extends WorkspaceFile {
  // ... 现有字段 ...
  /** 图片 base64 数据,当文件是图片且 workspace_read 返回时设置.
   *  Agent runtime 据此 + imageMimeType 构建 image ContentPart 注入 LLM 消息. */
  imageBase64?: string
}
```

## Storage Design

### 新建 Dexie 表：assistantAttachments

`workspaceFiles` 表 keyed by saveId，本地助手模式没有 saveId，不适合存附件。`meta` KV 是 JSON string，不能存 Blob。新建表最干净：

```ts
// storage/db.ts — TsianLocalDb 新增
assistantAttachments: "&id, sessionId, createdAt"
```

```ts
export interface LocalAssistantAttachmentRecord {
  /** 主键,形如 "<sessionId>::<filename>" 或 UUID. */
  id: string
  /** 所属会话 id. 用于会话删除时批量清理. */
  sessionId: string
  /** VFS 路径,形如 "temp/<sessionId>/<filename>". */
  path: string
  /** 原始文件名. */
  name: string
  /** MIME 类型. */
  mimeType: string
  /** 文件种类. */
  kind: "image" | "text"
  /** Blob 本体. */
  data: Blob
  /** 文件大小(字节). */
  size: number
  createdAt: number
}
```

DB version bump: `tsian-agent-runtime-v8` → `v9`（prototype 项目，无迁移）。

### VFS temp/ 路径解析

`temp/` 路径不来自 game card content 也不来自 save runtime。新增一个 workspace 文件源：assistant temp attachments。在组装 effective workspace 时，`assistantAttachments` 表中当前会话的附件映射到 `temp/<sessionId>/<filename>` 路径。

### 清理策略

1. **会话删除时**：`deleteAssistantSession` 联动删除 `assistantAttachments` 表中 `sessionId` 匹配的行
2. **启动时**：清理 `createdAt` 超过 7 天且不属于任何现存会话的孤儿附件
3. **手动清理**：后续可加设置按钮，本版不做

## Provider Adapter Multimodal Serialization

每个 adapter 的 user/system 分支增加 content 形状判断：

### 共享辅助函数（ai.ts 新增）

```ts
function isContentParts(content: unknown): content is ContentPart[] {
  return Array.isArray(content)
}

function buildOpenAiContent(content: string | ContentPart[]): unknown {
  if (typeof content === "string") return content
  return content.map(part => {
    if (part.type === "text") return { type: "text", text: part.text }
    return { type: "image_url", image_url: { url: `data:${part.mimeType};base64,${part.data}` } }
  })
}

function buildClaudeContent(content: string | ContentPart[]): unknown {
  if (typeof content === "string") return content
  return content.map(part => {
    if (part.type === "text") return { type: "text", text: part.text }
    return { type: "image", source: { type: "base64", media_type: part.mimeType, data: part.data } }
  })
}

function buildGeminiParts(content: string | ContentPart[]): unknown[] {
  if (typeof content === "string") return [{ text: content }]
  return content.map(part => {
    if (part.type === "text") return { text: part.text }
    return { inlineData: { mimeType: part.mimeType, data: part.data } }
  })
}
```

### 改动点（6 处序列化 + 2 处类型 + 1 处共享 helper）

| 位置 | 改动 |
|------|------|
| `ai.ts:438` openai `buildNativeRequestBody` user 分支 | `content: buildOpenAiContent(message.content)` |
| `ai.ts:218/235` `buildChatCompletionsRequestBody` | messages 原样透传（parts 已是 OpenAI 原生形状，前提是上游 pre-shape） |
| `ai.ts:651` `buildGeminiNativeContent` user 分支 | `parts: buildGeminiParts(message.content)` |
| `ai.ts:714` gemini `buildRequestBody` inline map | `parts: buildGeminiParts(message.content)` |
| `ai.ts:687` `buildClaudeNativeMessage` user 分支 | `content: buildClaudeContent(message.content)` |
| `ai.ts:901` claude `buildRequestBody` inline map | `content: buildClaudeContent(message.content)` |
| `ai.ts:1212-1219` / `1364-1369` debug record 映射 | 非 string content 时降级为 `[multipart]` 或 JSON stringify |

## Message Flow Changes

### Layer 1: 助手聊天附件

```
用户粘贴/拖拽/选择文件
  → AssistantView: attachments ref<AttachmentDraft[]>
  → send(): 构建 user message
    → 图片附件: Blob → base64 → ContentPart { type:"image", ... }
    → 文本附件: 读取文本 → 拼入 message.content 文本
    → ChatMessage.attachments = AttachmentRef[]
  → persistCurrentSession(): ConversationMessageRecord + attachments
  → runAssistantChat({ message, attachments, history, ... })
    → assistant-chat.ts: 构建 AiChatMessage (content: ContentPart[] for images)
    → agent-runtime: buildAgentContextMessages 传递 content parts
    → provider adapter 多模态序列化
```

### Layer 2: Agent workspace_read 图片

```
Agent 调用 workspace_read("temp/<img>") 或 workspace_read("world/<img>")
  → workspace-operations.ts readWorkspaceFile:
    → file.binary 存在 && isImageMime(mimeType)
    → 返回 WorkspaceReadResult { imageBase64, imageMimeType, isBinaryPlaceholder: false }
  → agent-runtime workspace-tools.ts: read 结果处理
    → 检测 imageBase64 → 构造 ContentPart { type:"image", ... }
    → 注入到当前轮 user message 的 content (string | ContentPart[])
  → provider adapter 多模态序列化
```

### 助手聊天入口签名扩展

```ts
// assistant-chat.ts AssistantChatInput
interface AssistantChatInput {
  message: string
  attachments?: AttachmentRef[]        // ← 新增
  history?: ConversationMessageRecord[]
  sessionId: string
  // ... 现有回调 ...
}
```

orchestrator 在构建首轮 user message 时：
- 图片附件 → base64 编码 → ContentPart[] 拼入 content
- 文本附件 → 读取文本 → 拼入 message string

## UI Design (AssistantView)

### 输入区改造

```
┌─────────────────────────────────────────┐
│  [附件预览区 - 有附件时显示]              │
│  ┌──────┐ ┌──────┐ ┌──────────┐         │
│  │ img  │ │ img  │ │ 📄 file  │         │
│  │  ✕   │ │  ✕   │ │  txt ✕   │         │
│  └──────┘ └──────┘ └──────────┘         │
├─────────────────────────────────────────┤
│ 📎  [textarea 输入框]            [发送]  │
└─────────────────────────────────────────┘
```

- `<textarea>` 加 `@paste` 处理（检测 `clipboardData.items` 中的 image）
- 聊天面板 `<main>` 加 `@dragover.prevent` + `@drop` 处理
- 输入框左侧加 📎 按钮 → 隐藏 `<input type="file" accept="image/*,.txt,.json,.md,...">`
- 附件预览区：图片显示缩略图，文本文件显示文件名+大小
- 每个附件有 ✕ 移除按钮

### 消息渲染改造

用户消息气泡（line 240 当前是 `{{ msg.content }}`）：
- 有图片附件 → 渲染 `<img>` 缩略图（点击可放大）
- 有文本附件 → 渲染文件标识 chip（可展开看内容）
- 有文字 → 渲染文字（保持纯文本，不做 markdown）

## Compatibility & Migration

- DB version v8 → v9：prototype 项目无迁移，现有用户清库重建
- `ConversationMessageRecord.attachments` 可选字段，旧数据无此字段时正常加载（无附件）
- `normalizeMessages` 放宽但向后兼容：string content 仍正常处理
- provider adapter 的 content 分支：typeof content === "string" 时走原路径，零行为变化
- 不支持视觉的 model 收到 image parts 时 API 会报错 → 错误冒泡到用户（AC10）

## Tradeoffs

1. **base64 vs URL**：选 base64 因为浏览器本地无图床，所有 provider 都需要 base64 编码。缺点是消息体大（图片 base64 膨胀 ~33%），但附件本身就是用户主动发的，可接受
2. **新建 Dexie 表 vs 复用 workspaceFiles**：新建更干净（workspaceFiles keyed by saveId，助手无 saveId），缺点是多一个表。但 assistantAttachments 的生命周期（会话级 + 定期清理）与 workspaceFiles（存档级）不同，分开更合理
3. **temp 作为新 WorkspaceScope vs 复用 platform-meta**：platform-meta readLevel=4，运行时 agent 无法读取。用户明确要求 agent 能读图片，所以 temp 需要 readLevel=0，必须新增 scope
4. **文本文件注入 vs 多模态**：文本文件直接提取内容注入消息文本，不走 ContentPart，简单且所有 provider 都支持

## Rollback

- 纯增量改造，无破坏性变更
- 回滚点：`git checkout` 相关文件，DB version 回 v8（用户需清库）
- 无外部服务依赖
