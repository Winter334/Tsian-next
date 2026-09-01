# 编辑器简化与媒体查看器：文件编辑体验对齐 Windows

## Goal

让 Tsian 的文件打开/编辑体验对齐 Windows 心智模型,同时把工作区存储层改干净:移除冗余的 mediaType 字段(可动部分全删),引入二进制 Blob 存储让媒体文件不再走 base64 文本,文本文件走轻量编辑器(后缀决定类型、未保存提示、标准快捷键),媒体文件(图片/音频/视频)走专用只读查看器。

## Background

当前文件编辑/查看体验存在几个问题:
1. **mediaType 下拉框与后缀脱节**——改下拉框改的是独立 `mediaType` 字段,不改文件后缀,可能出现 `data.txt` 但 mediaType 是 `application/json` 的不一致状态。mediaType 是冗余字段,始终能从 path 后缀还原。
2. **上边栏按钮冗余**——"校验"按钮(保存时本会自动校验)、"还原"按钮(CodeMirror 已有原生 Ctrl+Z 撤销)价值低。
3. **下边栏布局 bug**——`main` 缺少高度约束,CodeMirror `height:100%` 失效,footer 被推到内容底部而非窗口底部。
4. **无未保存提示**——关闭编辑器窗口时不会提示保存,容易丢失改动。无 Ctrl+S 保存快捷键。
5. **媒体文件走文本编辑器**——封面图是 base64 data-URI 存在 contentFile,玩家点开看到 base64 文本而非图片;`inferWorkspaceMediaType` 完全没覆盖图片/音视频后缀。
6. **base64 存储不健康**——媒体文件以 base64 文本存在 `content: string` 字段,膨胀 33%,大文件(音视频)性能差。项目已有 `LocalGameCardFrontendFileRecord.data: Blob` 的二进制存储先例,工作区层应复用。

## 决策

- **mediaType 移除范围**:可动部分全删(`WorkspaceFile`/`WorkspaceEntry`/`WorkspaceSearchResult`/`WorkspaceOperationRequest`/`LocalWorkspaceFileRecord`/`LocalGameCardContentFileRecord`);不动 `LocalGameCardFrontendFileRecord.mediaType`(Service Worker HTTP Content-Type 依赖)和外部 zip manifest 的 mediaType 字段(格式契约)。
- **二进制存储形态**:路径 B(存储分字段,契约加可选 binary)。`LocalWorkspaceFileRecord` + `LocalGameCardContentFileRecord` 加 `data?: Blob`(与 `content: string` 互斥),`WorkspaceFile` 契约加 `binary?: Blob`。agent runtime 只读 `content`(string),不碰 `binary`,零改动——对 agent 透明。
- **破坏性变更**:项目未上线,无真实用户数据,允许破坏性变更,不做数据迁移。DB 版本号 bump,旧数据丢弃。
- **封面也改 Blob**:`LocalGameCardContentFileRecord` 从 base64 content 改为 Blob 存储,删 base64/svg 分支,改用后缀判断 + Blob URL。不留 base64 尾巴。
- **子任务结构**:2 个子任务。子1 编辑器 UI,子2 存储层重构 + 媒体查看器 + 分流 + 改后缀提示。

## 子任务拆分

### 子1: 编辑器布局修复 + 简化 + UI 增强
- 修复 `main` 高度约束,footer 固定窗口底部。
- 移除 mediaType 下拉框(mediaType 仍按现有逻辑从 path 推断,子2 接管存储层移除)。
- 移除"校验"按钮(保存时自动校验)。
- 移除"还原"按钮和 `resetDraft` 逻辑(CodeMirror 原生 Ctrl+Z 撤销已够)。
- 标题未保存星号(`文件名 *` 标记 `hasDraftChanges`)。
- Ctrl+S 保存快捷键(window 级监听,编辑器路由生效时拦截)。
- 关闭时未保存提示(需桌面 shell `useDesktopWindows` 加 beforeClose 钩子)。

### 子2: 存储层重构 + 媒体查看器 + 分流 + 改后缀提示
- **mediaType 全删(可动部分)**:`WorkspaceFile`/`WorkspaceEntry`/`WorkspaceSearchResult`/`WorkspaceOperationRequest`/`LocalWorkspaceFileRecord`/`LocalGameCardContentFileRecord` 移除 mediaType 字段;所有消费点改用 `inferWorkspaceMediaType(path)` 派生。
- **二进制 Blob 存储**:`LocalWorkspaceFileRecord` + `LocalGameCardContentFileRecord` 加 `data?: Blob`(与 `content: string` 互斥);写入路径支持 Blob 输入;读取路径二进制文件返回 Blob。
- **封面改 Blob**:`LocalGameCardContentFileRecord` 封面从 base64 content 改为 Blob;`game-card-display.ts`/`game-card-packages.ts`/`covers.ts` 的 base64/svg 分支改为 Blob URL + 后缀判断。
- **`inferWorkspaceMediaType` 扩展**:补全图片/音视频后缀(对齐已有 `inferMediaType`:png/jpg/gif/webp/avif/svg/mp3/ogg/wav/m4a/flac/mp4/webm/mov)。
- **媒体查看器**:新增 `WorkspaceMediaView.vue`,根据 mediaType 渲染 `<img>`/`<audio controls>`/`<video controls>`,用 Blob URL(`URL.createObjectURL`),只读查看不编辑。
- **分流逻辑**:资源管理器 `openEditorForFile` 改为按 mediaType 分流:文本 → 编辑器,图片/音频/视频 → 媒体查看器,未知 → 文本编辑器(兜底)。
- **改后缀风险提示**:资源管理器重命名时,若后缀变化,弹窗提示"改变扩展名可能导致文件无法正确解析,确定吗?",对齐 Windows。
- **DB 版本 bump**:破坏性变更,旧数据丢弃。
- **agent 透明**:`WorkspaceFile.content` 仍是 string,agent runtime 只读 content,不碰 binary,零改动。

## Cross-Child Acceptance Criteria

- [ ] 编辑器 footer 固定在窗口底部,不随内容滚动。
- [ ] 编辑器无 mediaType 下拉框、无校验按钮、无还原按钮;有未保存星号、Ctrl+S 保存、关闭未保存提示。
- [ ] `WorkspaceFile`/`WorkspaceEntry`/`LocalWorkspaceFileRecord`/`LocalGameCardContentFileRecord` 等可动层不再有 mediaType 字段;消费点改用 `inferWorkspaceMediaType(path)` 派生。
- [ ] `LocalGameCardFrontendFileRecord.mediaType` 和外部 zip manifest 的 mediaType 保留不变。
- [ ] 媒体文件(图片/音频/视频)以 Blob 存储,不再 base64 文本。
- [ ] 封面图以 Blob 存储,`game-card-display.ts`/`game-card-packages.ts` 无 base64/svg 分支。
- [ ] 图片/音频/视频文件在资源管理器点开走媒体查看器(`<img>`/`<audio>`/`<video>`),不走文本编辑器。
- [ ] 资源管理器重命名改后缀时有风险提示弹窗。
- [ ] agent 的 workspace.read 仍返回 string,agent runtime 代码零改动。
- [ ] `npm run build:web` + `npm run build:contracts` 通过。

## Notes

- 父任务不直接实现,只 owns 需求集 + 跨子任务验收。
- 子任务按 1→2 顺序执行,各自独立归档。
- 两个子任务的 spec 更新在各自 Phase 3 完成。
- 子2 是破坏性变更,DB 版本 bump,旧数据丢弃(项目未上线,无真实用户数据)。

## 已登记的未来需求(不在本任务范围)

### Agent 多模态(识图/文生图)

子2 把 `binary?: Blob` 加到 `WorkspaceFile` 契约 + 存储层以 Blob 存媒体文件,为多模态打通了**数据路径**。但 agent runtime 的工具层和消息协议仍只支持 text content,不在此任务范围。

未来支持 agent 识图/文生图需要:
- `RuntimeChatMessage` 扩展 multi-part content(`text` + `image_url`/`image` content block),不把 base64 塞进 text observation。
- provider adapter(OpenAI/Claude/Gemini)翻译 multi-part content 到各家的 image block 格式。
- agent `workspace.read` 工具层:`file.binary` → `arrayBuffer()` → base64 → 构造 image content block(独立通道,不占 text context token 预算——模型按分辨率折算 image token,不按 base64 字符数)。
- agent `workspace.write` 工具层:支持 base64 string 输入 → 平台层转 Blob 存储(文生图)。
- 子2 的二进制文件占位文本(`[binary file: ...]`)在多模态支持后被替换成真正的 image content block。

关键约束:base64 不进 text context——多模态模型的 image content block 是独立通道,模型厂商按分辨率折算 image token(如 512×512 ≈ 170 tokens),不按 base64 字符数计 text token。把 base64 塞进 text observation 才会塞爆上下文,正确实现不会。
