# Implement: Assistant Attachment Upload

## Execution Checklist

### Step 1: Contracts — ContentPart + 类型扩展
- [ ] `packages/contracts/src/runtime.ts`：新增 `ContentPart` 类型（text | image）
- [ ] `ConversationMessageRecord` 加 `attachments?: AttachmentRef[]` + `AttachmentRef` 接口
- [ ] `AiChatMessage.content` 放宽为 `string | ContentPart[]`（`packages/contracts/src/debug.ts`）
- [ ] `WorkspaceScope` 加 `"temp"`
- [ ] `WorkspaceFile` 加 `imageMimeType?: string`
- [ ] `WorkspaceReadResult` 加 `imageBase64?: string`
- [ ] **验证**：`npm run build:contracts` 通过

### Step 2: Storage — Dexie 表 + 附件存取
- [ ] `apps/platform-web/src/storage/db.ts`：DB version v8→v9，加 `assistantAttachments` 表（`&id, sessionId, createdAt`）+ `LocalAssistantAttachmentRecord` 接口
- [ ] 新建 `apps/platform-web/src/storage/assistant-attachments.ts`：
  - `saveAssistantAttachment(sessionId, file: File): Promise<AttachmentRef>` — 识别 image/text kind，存 Blob，返回 ref
  - `getAssistantAttachmentBlob(path: string): Promise<Blob | undefined>` — 按 path 取 Blob
  - `getAssistantAttachmentBase64(path: string): Promise<{data: string, mimeType: string} | undefined>` — 取 base64（图片用）
  - `readTextAttachment(path: string): Promise<string | undefined>` — 取文本内容
  - `deleteAttachmentsBySession(sessionId): Promise<void>` — 会话删除时清理
  - `cleanupOrphanAttachments(): Promise<void>` — 清理 7 天以上孤儿
  - `listAttachmentsBySession(sessionId): Promise<LocalAssistantAttachmentRecord[]>` — VFS temp/ 组装用
- [ ] `deleteAssistantSession`（assistant-conversations.ts）联动调用 `deleteAttachmentsBySession`
- [ ] App 启动时调用 `cleanupOrphanAttachments`（在 App.vue 或 router 初始化处）
- [ ] **验证**：`npm run build:web` 类型通过

### Step 3: normalizeMessages 放宽
- [ ] `assistant-conversations.ts:normalizeMessages`：content 为 string 时保留（现有行为），为 ContentPart[] 时保留，其他丢弃
- [ ] `saves.ts:normalizeMessages`（如果有类似逻辑）：同步放宽
- [ ] **验证**：`npm run build:web` 通过

### Step 4: Provider adapters — 多模态序列化
- [ ] `apps/platform-web/src/runtime-host/ai.ts`：新增 `buildOpenAiContent` / `buildClaudeContent` / `buildGeminiParts` 辅助函数
- [ ] openaiAdapter `buildNativeRequestBody`（:438）：user/system 分支用 `buildOpenAiContent`
- [ ] openaiAdapter `buildRequestBody`（:402-408）：messages 透传（AiChatMessage content 已是 OpenAI 原生形状）或在 helper 中 shape
- [ ] geminiAdapter `buildGeminiNativeContent`（:651）：用 `buildGeminiParts`
- [ ] geminiAdapter `buildRequestBody`（:714）：用 `buildGeminiParts`
- [ ] claudeAdapter `buildClaudeNativeMessage`（:687）：用 `buildClaudeContent`
- [ ] claudeAdapter `buildRequestBody`（:901）：用 `buildClaudeContent`
- [ ] debug record 映射（:1212-1219, :1364-1369）：非 string content 时降级显示
- [ ] **验证**：`npm run build:runtime-core && npm run build:web` 通过

### Step 5: workspace_read 图片支持
- [ ] `agent-runtime/workspace-operations.ts` `DEFAULT_SCOPE_ACCESS`：加 `"temp"` scope（readLevel 0, editLevel 4）
- [ ] `readWorkspaceFile`（:626-634）：binary 图片文件时，base64 编码 → 返回 `imageBase64` + `imageMimeType`，`isBinaryPlaceholder: false`
- [ ] `normalizeWorkspaceScope`：接受 `"temp"`
- [ ] workspace 文件组装：`temp/` 路径从 `assistantAttachments` 表映射（当前会话附件 → `temp/<sessionId>/<name>`）
- [ ] agent-runtime workspace-tools.ts：read 返回 `imageBase64` 时，构造 image ContentPart 注入当前轮 user message
- [ ] `buildAgentContextMessages` / `aiChatMessagesToRuntime`：content 为 ContentPart[] 时透传
- [ ] **验证**：`npm run build:web` 通过

### Step 6: assistant-chat orchestrator 扩展
- [ ] `AssistantChatInput` 加 `attachments?: AttachmentRef[]`
- [ ] `runAssistantChat`：首轮 user message 构建时：
  - 图片附件 → `getAssistantAttachmentBase64` → ContentPart[]
  - 文本附件 → `readTextAttachment` → 拼入 message 文本
  - 组合为 `content: string | ContentPart[]`
- [ ] history 中的附件：历史消息的 `attachments` 引用 → 重建 ContentPart（图片附件在 history 中也发）
- [ ] **验证**：`npm run build:web` 通过

### Step 7: AssistantView UI — 附件输入
- [ ] `ChatMessage` 接口加 `attachments?: AttachmentRef[]`
- [ ] 新增 `pendingAttachments` ref（待发附件草稿）
- [ ] `<textarea>` 加 `@paste="handlePaste"` — 检测 clipboardData image item → `saveAssistantAttachment` → 加到 pendingAttachments
- [ ] 聊天面板加 `@dragover.prevent` + `@drop="handleDrop"` — 检测 dataTransfer files
- [ ] 输入框左侧加 📎 按钮 + 隐藏 `<input type="file" accept="image/*,.txt,.json,.md,.csv,.xml,.yaml,.yml" multiple>`
- [ ] 附件预览区：图片显示缩略图（`URL.createObjectURL(blob)`），文本文件显示 📄 icon + name + size
- [ ] 每个附件 ✕ 按钮移除
- [ ] `send()`：附件随消息发出 → `messages.value.push({ role: "user", content, attachments })` → 传给 `runAssistantChat`
- [ ] 无文字仅有附件时可发送（send 按钮 disabled 条件改为 `!inputText.trim() && pendingAttachments.length === 0`）
- [ ] **验证**：dev server 手动测试 paste/drop/pick

### Step 8: AssistantView UI — 附件渲染
- [ ] 用户消息气泡：有图片附件 → 渲染 `<img>` 缩略图（点击放大 modal）
- [ ] 用户消息气泡：有文本附件 → 渲染文件 chip（文件名 + 大小，可展开看内容）
- [ ] `persistCurrentSession`：`toStore` 映射时保留 `attachments` 字段
- [ ] `loadActiveSession` / `handleSelectSession`：加载时保留 `attachments` 字段
- [ ] **验证**：dev server 手动测试刷新后附件仍在

### Step 9: 构建三绿
- [ ] `npm run build:contracts` 通过
- [ ] `npm run build:runtime-core` 通过
- [ ] `npm run build:web` 通过
- [ ] **验证**：三绿

### Step 10: dev server 冒烟
- [ ] `npm run dev:web`，`/#/assistant`
- [ ] 粘贴剪贴板图片 → 预览 → 发送 → 消息气泡显示图片
- [ ] 拖拽图片文件 → 预览 → 发送
- [ ] 📎 选择图片 → 预览 → 发送
- [ ] 拖拽 .txt → 预览 → 发送 → 助手读到文本内容
- [ ] 附件 ✕ 移除
- [ ] 刷新 → 附件仍在
- [ ] 删除会话 → temp 附件清理（检查 IndexedDB）
- [ ]（需要 vision model + key）助手能看到图片内容并回复
- [ ]（需要 vision model + key）Agent workspace_read 读 temp 图片 → debug view 可见 image block 进 LLM 请求
- [ ] **验证**：全部通过

### Step 11: spec 更新
- [ ] `trellis-update-spec`：
  - state-management：记 assistantAttachments 表 + temp scope + 附件持久化策略
  - type-safety：记 ContentPart 多模态类型 + normalizeMessages 放宽规则 + provider adapter 多模态序列化约定
  - 记 workspace_read 图片支持（imageBase64 路径）

### Step 12: commit
- [ ] 用户确认后 commit

## Validation Commands

```bash
npm run build:contracts
npm run build:runtime-core
npm run build:web
npm run dev:web   # 冒烟
```

## Rollback Points

- Step 1/2 后：`git checkout packages/contracts/src/ apps/platform-web/src/storage/db.ts`（DB 回 v8 需清库）
- Step 4 后：`git checkout apps/platform-web/src/runtime-host/ai.ts`（adapter 回纯文本）
- Step 5/6 后：`git checkout apps/platform-web/src/agent-runtime/ apps/platform-web/src/platform-host/assistant-chat.ts`
- Step 7/8 后：`git checkout apps/platform-web/src/views/AssistantView.vue`
- 纯增量改造，回滚不影响已有功能

## Review Gates

- Step 1 后：review ContentPart 类型 + WorkspaceScope "temp" 是否融入现有体系
- Step 4 后：review 3 个 provider 的多模态序列化正确性（对照 OpenAI/Claude/Gemini API 文档）
- Step 5 后：review workspace_read 图片路径 + scope 权限
- Step 9 构建三绿是硬 gate
- Step 10 冒烟是功能 gate（需要 vision model + key 才能完整验 AC1/AC9，无 key 时验 UI + 持久化 + 清理）

## Risky Files

- `apps/platform-web/src/runtime-host/ai.ts` — 4 个 adapter 改动，影响所有 LLM 调用
- `packages/contracts/src/runtime.ts` — 核心类型扩展，影响全链路
- `apps/platform-web/src/agent-runtime/workspace-operations.ts` — scope 权限体系
- `apps/platform-web/src/storage/db.ts` — DB schema 变更
- `apps/platform-web/src/views/AssistantView.vue` — 主交互界面
