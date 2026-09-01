# 修复工作区可编辑文本读取

## Goal

确保资源管理器与桌面 Agent 能一致读取、搜索、编辑和保存 Vue 等在线可编辑文本文件，同时保留真正二进制文件的字节与预览行为，杜绝将二进制占位符覆盖回源文件的数据损坏风险。

## Background

- `apps/platform-web/src/lib/media-type.ts:13-51` 未识别 `.vue`，因此回退为 `application/octet-stream`。
- Studio 的 `cardFrontendVolume`（`apps/platform-web/src/platform-host/workspace-volumes.ts:104-153`）与 Agent effective workspace（`apps/platform-web/src/storage/workspace.ts:346-379`）分别按该结果把前端 Blob 投影为文本或二进制；两条路径都会把 `.vue` 变成占位符。
- Agent `read` 会返回占位符，`search` 跳过该文件，`edit`/`diff` 拒绝二进制，`validate` 不验证源码。
- `WorkspaceEditorView.vue:368-397` 未检查 `WorkspaceFile.binary`；若保存当前占位符，可能覆盖原始源码。
- 前端构建器在 `apps/platform-web/src/frontend-build/engine.ts:196-220` 已把 `.vue/.mts/.cts/.cjs` 当文本源码，说明现有分类发生跨层漂移。
- 独立前端包规范要求导入时 manifest `mediaType` 优先、导出时保真（`.trellis/spec/platform-web/frontend/state-management.md:240-267`），但当前导入在 `game-card-packages.ts:930-949` 丢弃 MIME，导出在 `:990-1000` 重新按路径推断。

## Requirements

### R1. 统一可编辑文本判定

- `media-type.ts` 是路径媒体类型与文本 MIME 判断的单一来源。
- 至少识别 `.vue`、`.mts`、`.cts`、`.cjs`、`.scss`、`.sass`、`.less`、`.svelte`。
- 还应覆盖常见在线可编辑 Web、配置和数据文本格式，包括 Astro、MDX、TOML、XML、CSV/TSV、GraphQL、SQL、常用模板，以及 `.env`/`skill.config`/常见配置文件名。
- 识别为文本只承诺可读写，不代表浏览器构建器已支持相应框架或预处理器。
- `application/json`/`+json`、XML/`+xml`、YAML、TOML 等文本 MIME 应统一被视为文本；SVG 是可编辑文本图片。

### R2. 统一 Blob 工作区投影

- Studio 与 Agent effective workspace 必须复用同一个 Blob→`WorkspaceFile` helper，不能继续复制文本/二进制分支。
- 有意义的 `Blob.type` 优先；空值或 `application/octet-stream` 视为无信息并回退路径推断，因此既有 octet-stream `.vue` 无需迁移即可恢复。
- 文本必须以严格 UTF-8 解码；非法 UTF-8 明确失败，不能用替换字符静默损坏后再保存。
- 真正二进制文件保留 `binary` 与占位符；图片同时携带 `imageMimeType` 供现有 Agent 多模态读取。
- 前端构建源码加载复用同一文本路径判定，避免后续扩展表再次漂移。

### R3. 前端包 MIME 保真

- 内部前端文件写入输入可携带瞬态 `mediaType`，并保存在 Blob 自带 `type` 中。
- 整卡包和独立前端包导入均传递 manifest MIME；缺失或空白时才按路径推断。
- 导出优先复用有意义的 `Blob.type`，否则按路径推断。
- 不新增 Dexie 字段、不变更 DB 名、不增加迁移、不更改外部 package contract。
- 字符串在线写入表达文本意图；调用者提供 Blob/字节时维持其二进制语义与显式 MIME。

### R4. 编辑器与路由防误写

- 文本编辑器读取到带 `binary` 的文件时必须 fail loud，不把占位符装入编辑器，也不允许保存。
- 写入返回带 `binary` 的结果时同样拒绝作为已保存基线。
- SVG 从资源管理器进入文本编辑器；PNG/JPEG/音视频仍进入媒体查看器。
- CodeMirror 复用现有语言支持为 `.mts/.cts`、Vue/Svelte/Astro 和样式预处理文件提供近似高亮，不新增语言依赖。
- 未知二进制即使进入编辑路由，也不能覆盖原始字节。

### R5. 修复同次审计确认的 Agent 读取缺口

- 临时文本附件加入 Agent 工作区快照时必须携带真实文本，而不是空字符串。
- 附件 `File.type` 为空时按文件名推断，兑现现有注释。
- 普通工作区图片通过统一投影携带 `imageMimeType`；非图片二进制保持不透明。

### R6. 兼容性与范围约束

- 保留现有 workspace 路径规范化、scope 权限、`.tsian` 所有权和 package 路径安全检查。
- 不引入平台 Web 测试框架。
- ZIP 解压限额、通用二进制上传、大文件读取分页/内存上限属于后续任务，本次仅记录，不实现。
- 不修改无关的 `tmp/`。
- 浏览器验证由用户执行；实现方提供可复现的手工验证清单，除非用户反馈难以转述或排查的问题，否则不自行启动浏览器验证。

## Acceptance Criteria

- [ ] AC1: 既有 `Blob.type = application/octet-stream` 的 `frontend/src/App.vue` 在 Studio 与 Agent 读取路径中均返回原始源码，且无 `binary`/占位符，无需数据库迁移。
- [ ] AC2: `.vue/.mts/.cts/.cjs/.scss/.sass/.less/.svelte` 以及约定的配置/数据文本扩展均可在线读取、搜索、编辑和 diff；真正二进制负例仍为二进制。
- [ ] AC3: Studio 与 Agent 的 card-frontend Blob 投影使用同一 helper；构建器文本源码判定不再维护独立扩展正则。
- [ ] AC4: 非法 UTF-8 的文本声明会明确失败且原 Blob 不被改写。
- [ ] AC5: 整卡包与独立前端包导入/导出保留显式 MIME，且未新增 Dexie schema/迁移/外部 contract 变更。
- [ ] AC6: 编辑器绝不把二进制占位符作为可编辑或可保存内容；读取与保存返回的二进制均 fail loud。
- [ ] AC7: SVG 进入文本编辑器；普通图片/音频/视频仍进入媒体查看器；普通图片 Agent read 继续走现有多模态通道。
- [ ] AC8: 临时文本附件的 Agent `workspace_read` 返回真实正文，空 File MIME 按文件名推断。
- [ ] AC9: `npm run build:web` 通过，静态反向搜索确认所有相关投影、导入/导出与 UI 路径已覆盖。
- [ ] AC10: 向用户交付清晰的浏览器手工验证清单，并明确浏览器结果尚待用户执行。

## Out of Scope

- 新增或替换通用二进制文件上传/编辑能力。
- ZIP bomb / 解压总量限制设计。
- Agent 大文件读取分页与图片尺寸/字节上限重构。
- 为 Svelte/Astro/MDX 新增浏览器编译器支持。
- 引入 Jest、Vitest 或其他新的 platform-web 测试运行器。
