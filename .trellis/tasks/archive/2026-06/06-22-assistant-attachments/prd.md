# Assistant Attachment Upload

## Goal

让玩家在桌面助手聊天中粘贴/拖拽/选择附件发给助手 agent，参考 ChatGPT 网页版的交互。同时顺带把 agent 的 `workspace_read` 工具升级为支持读取图片，使多模态能力贯通"用户直接发图"和"agent 读工作区图片"两条路径。

## User Value

- 玩家可以截图粘贴给助手描述问题/上下文，而不必文字描述画面内容
- 玩家可以拖拽文本文件（.txt/.json/.md）让助手直接读取内容
- agent 可以读取工作区中的图片文件（如 `.cover/` 下的封面、`world/` 下的设定图），不再拿到 placeholder 字符串

## 支持的附件类型

1. **图片**（粘贴剪贴板图片 / 拖拽图片文件 / 文件选择器选图片）
   - 走多模态 image content block 发给 LLM
   - 支持的 MIME 类型由 LLM provider 决定（常见：image/png, image/jpeg, image/webp, image/gif）
   - 我们不做限制，provider 不支持时由 API 报错反馈
2. **文本文件**（.txt / .json / .md / .csv / .xml / .yaml 等文本类 MIME）
   - 提取文件内容作为文本注入消息，不发给 LLM 多模态 API
   - 注入格式：在消息文本中附加 `[文件: <name>]\n<content>` 段落

## 不支持的附件类型（Out of Scope）

- 任意二进制文件（PDF / zip / 可执行文件等）— 本版不处理，后续版本考虑
- 游戏卡包（.tsian-card.zip）粘贴安装 — 后续版本
- 音频/视频 — 后续版本

## Requirements

### R1: 输入交互
- 玩家在聊天输入框 `Ctrl+V` 粘贴剪贴板中的图片 → 图片添加为待发附件（预览缩略图）
- 玩家拖拽图片/文本文件到聊天面板 → 添加为待发附件
- 玩家点击附件按钮（📎）→ 打开文件选择器 → 选择图片/文本文件 → 添加为待发附件
- 附件预览区显示在输入框上方，可逐个移除
- 按 Enter 发送时，附件随消息一起发出
- 无文字仅有附件时也可发送（附件本身就是消息内容）

### R2: 消息渲染
- 用户消息气泡内显示图片缩略图（可点击放大/查看原图）
- 用户消息气泡内显示文本文件附件标识（文件名 + 大小，可展开看内容）
- 助手消息不变（纯文本 markdown 渲染，不需要渲染附件）

### R3: 持久化
- 附件 Blob 存储在虚拟文件系统的 `temp/` 目录下，定期清理
- 消息记录保存附件引用（路径 + 元数据），刷新后恢复
- 会话删除时清理该会话的 temp 附件

### R4: LLM 多模态发送（图片）
- 图片附件编码为各 provider 的原生 image content block：
  - OpenAI/DeepSeek: `image_url` (base64 data URL)
  - Claude: `image` source block (base64 + media_type)
  - Gemini: `inlineData` (base64 + mimeType)
- 文本文件附件注入为消息文本，不走多模态
- 助手发送消息时，图片附件与文本内容组合为 multipart content

### R5: Agent workspace_read 图片支持
- `workspace_read` 读取图片文件时，返回 image content block 而非 placeholder 字符串
- Agent runtime 的消息构建层将 image block 注入到发给 LLM 的消息中
- 覆盖助手 agent 和运行时 game agent 两条路径

### R6: 清理
- temp/ 目录的附件定期清理（会话删除时清理 + 启动时清理超过 N 天的孤儿附件）

## Acceptance Criteria

- [ ] AC1: 在助手聊天框粘贴剪贴板图片 → 出现缩略图预览 → Enter 发送 → 消息气泡显示图片 → 助手能看到图片内容并回复（需要支持视觉的 model + key）
- [ ] AC2: 拖拽图片文件到聊天面板 → 添加为附件 → 发送成功
- [ ] AC3: 点击 📎 按钮 → 选择图片文件 → 添加为附件 → 发送成功
- [ ] AC4: 拖拽 .txt 文件 → 添加为附件 → 发送 → 助手能读到文件内容
- [ ] AC5: 附件预览区可逐个移除待发附件
- [ ] AC6: 刷新页面 → 之前的图片附件仍显示在消息气泡中
- [ ] AC7: 删除会话 → 该会话的 temp 附件被清理
- [ ] AC8: 构建三绿（build:contracts + build:runtime-core + build:web）
- [ ] AC9: Agent `workspace_read` 读取 `temp/<image>` → 返回 image content block（在 debug view 可见 image 块进入 LLM 请求）
- [ ] AC10: provider 不支持的图片类型 → API 报错能被用户看到（不静默吞错）

## Confirmed Facts (from codebase research)

- `ConversationMessageRecord` = `{ role: string; content: string }` — 纯文本，无附件字段 (`packages/contracts/src/runtime.ts:1`)
- `AiChatMessage` = `{ role, content: string }` — 同样纯文本 (`packages/contracts/src/debug.ts:1`)
- `RuntimeChatMessage` content 全为 string (`apps/platform-web/src/runtime-host/ai.ts:32`)
- `normalizeMessages` 硬性丢弃非 string content (`assistant-conversations.ts:46`)
- 4 个 provider adapter 都只发文本，序列化点明确：
  - OpenAI `buildNativeRequestBody:438` + `buildChatCompletionsRequestBody:218`
  - Gemini `buildGeminiNativeContent:651` + `buildRequestBody:714`
  - Claude `buildClaudeNativeMessage:687` + `buildRequestBody:901`
- AssistantView 输入是 `<textarea>` (line 291)，无任何 paste/drop/file 处理
- 用户消息渲染是纯文本 `{{ msg.content }}` (line 240)，无图片渲染
- `workspace_read` 对二进制文件返回 `binaryPlaceholderText` (`workspace.ts:1112`)，注释明确说 "Future multimodal support will replace this with an image content block"
- WorkspaceScope 是 5 值联合 (`runtime.ts:108`)：effective | card-content | save-runtime | platform-meta | card-frontend
- `DEFAULT_SCOPE_ACCESS` 定义在 `agent-runtime/workspace-operations.ts:105`，4 个具体 scope 的 readLevel/editLevel
- 附件存储：`workspaceFiles` 表已有 `data?: Blob` 字段，但 keyed by saveId；本地助手文件存 `meta` KV JSON map（不能存 Blob）

## Out of Scope

- 任意二进制文件（非图片非文本）的上传
- 游戏卡包粘贴安装
- 音频/视频附件
- 附件大小限制策略（不做限制，由 provider API 自然约束）
- 多附件批量管理的复杂 UI（本版只做逐个添加/移除）

## Open Questions

- 无阻塞问题。存储实现细节见 design.md。
