# Spatial 工作区界面

## Goal

把资源管理器、工作区编辑器和媒体查看器迁移为完整可操作的 Spatial 功能窗口，在不复制平台业务逻辑的前提下保留全部文件管理、文本编辑、草稿保护和媒体生命周期语义，并补齐投影环境下可靠的音视频控件、视频帧曲面合成与全屏逃生口。

## Background and Confirmed Facts

- 父任务把本子任务定义为 Spatial 第四阶段：Explorer、Editor、Media Viewer、上下文菜单、快捷键、草稿/关闭保护、`.keep`、跨根剪贴板、存档槽/只读保护、多编辑器身份、CodeMirror/IME、媒体播放和全屏矩阵。
- Spatial shell、投影输入、Source-local Select/菜单、窗口生命周期和双 presentation 注册表已经可用；`workspace-explorer`、`workspace-editor`、`workspace-media` 当前仍为 `pending`。
- 当前三个 RetroOS 视图把平台读取/写入、事件订阅、竞态保护和展示状态放在组件内部。直接复制会形成第二套 workspace 业务实现。
- `platform-apps.ts` 已定义 Explorer 单例、基于 `editorId` 的多编辑器身份和基于 scope/path 的媒体窗口身份；本任务不得重新发明窗口 id。
- 非关闭窗口在失焦、遮挡、最小化和恢复期间保持挂载；窗口本地的目录位置、搜索、选择、剪贴板、草稿、撤销栈和媒体播放状态不应因此重置。
- 当前编辑器已具备 JSON 与 `SKILL.md` frontmatter 校验、二进制拒绝、乐观 `expectedContent` 写入、只读语义、Ctrl+S 和保存/丢弃/取消关闭保护。
- 当前媒体查看器使用 workspace Blob 与 object URL，并在卸载时释放；原生 `<audio controls>` / `<video controls>` 不能作为投影输入下的可靠产品控件。
- 现有 HTML-in-Canvas API 只有显式 `requestPaint()`、paint 回调和元素纹理上传，没有“视频解码帧自动更新 Source 纹理”的契约。持续重绘整个窗口既不可靠，也违反 animated media 不持续 dirty HTML texture 的既有规范。
- 因此本任务允许一个受限的 engine 扩展：Blob 视频帧进入独立 WebGL 纹理，在所属 Source 的曲面子区域合成；只有实际解码帧请求 `animated-media` 绘制，暂停、结束、隐藏、移除和卸载后不保留连续帧需求。
- Spatial 生产 release gate 继续关闭；本任务只把三个 workspace presentation 置为内部开发 `ready`。

## Requirements

### 1. Shared workspace controllers and RetroOS compatibility

- 抽取按 Explorer、Editor、Media 领域划分的 per-instance controller/composable 与纯 helper，使 RetroOS 和 Spatial presentation 调用同一套平台读取、mutation、校验、事件、竞态保护和 object URL 生命周期。
- controller 不得导入 RetroOS 视图、`useDesktopWindows` 或 Spatial shell。关闭保护直接使用 shell-neutral `window-close-guards.ts`，窗口身份使用 `platform-apps.ts`。
- platform-host/storage 继续是文件与只读状态的权威；controller 不建立持久化副本，不把平台 mutation 隐藏为自动 watcher side effect。
- 先把现有 RetroOS 三个视图迁移到共享 controller，再添加 Spatial presentation；每个迁移缝必须保持既有路由、错误、确认、事件刷新和操作结果。
- 全局快捷键必须只由当前活动的目标窗口处理。Explorer 至少校验活动路由；多个 Editor 必须按完整窗口身份/`editorId` 区分，不能让同一路由名下的后台编辑器一起保存。

### 2. Spatial Explorer

- 提供独立 Spatial Explorer presentation，不挂载或包裹 `WorkspaceExplorerView.vue`，不使用 `retro-*` chrome。
- 展示本地 `.tsian` 根与游戏卡根，支持根卡片/目录列表、面包屑、目录进入/返回、搜索、选择、加载/空/错误/反馈状态。
- 支持打开文件或目录、新建文件、新建文件夹、内联重命名、复制、剪切、粘贴、删除和刷新。
- 新建目录继续写入 `<dir>/.keep`；`.keep` 只在 Explorer presentation 中隐藏，不改变 workspace operation/Agent 可见性。
- 剪贴板保持窗口实例本地并跨目录、卡根与 `.tsian` 根保留；复制可重复粘贴，剪切成功后清空，跨根操作传递源/目标 card id。
- 完整保留通用 `readOnly`、受保护 `save`/`save-N` 条目和 `save` 目录创建限制；上下文菜单和键盘快捷键必须复用同一 capability guards。
- F2、Delete、Ctrl/Cmd+C/X/V 与 Escape 在非编辑目标上工作；输入框、textarea、contenteditable、CodeMirror 和非活动/最小化窗口不能被 Explorer 快捷键劫持。
- 文件按中心媒体类型分类：文本与 SVG 打开 Editor，图片/音频/视频打开 Media Viewer；每次打开文本文件生成新的 `editorId`，媒体窗口继续按 scope/path 复用身份。
- 条目与空白区上下文菜单必须位于所属 Source 内；投影鼠标坐标相对 Explorer route root 转换并夹取，键盘调用锚定到当前选择。
- workspace content changed 事件触发当前目录和活动搜索的权威重读；旧请求不得覆盖较新的根、目录或搜索结果。

### 3. Spatial Workspace Editor

- 提供独立 Spatial Editor presentation，共享 Editor controller 和 `WorkspaceCodeEditor.vue` 行为，不复制 CodeMirror 初始化、语言识别或保存逻辑。
- `WorkspaceCodeEditor.vue` 增加 presentation/theme variant：默认保持 Retro dark；Spatial variant 使用现有 `--spatial-*` token、无外框式焦点框，并保持语言扩展、readonly、line wrapping、撤销栈和 model 同步。
- 支持 create/edit 模式、加载/错误/只读/校验/保存状态、标题脏标记、字符数、保存按钮和 Ctrl/Cmd+S。
- JSON 与 `SKILL.md` frontmatter 在写入前校验；create 模式拒绝覆盖已有目标，edit 模式继续发送 `expectedContent` 进行冲突检测。
- 已加载或刚写回的 `WorkspaceFile.binary` 必须在建立可编辑 baseline 前拒绝，不能把二进制 placeholder 当文本保存。
- 只读文件不可编辑、不可保存且永不进入 dirty/关闭提示；普通文件保存成功后发出 workspace 事件并在保留 `editorId` 的前提下同步路径/模式路由。
- 每个编辑器实例用 `platform-apps.ts` 的稳定 id 注册一次 shell-neutral close guard；路径在保存后变化不能导致注销错 id。
- 有草稿时关闭提供保存/不保存/取消；保存失败或校验失败继续 veto，取消不改变窗口、路由、焦点、DOM、草稿或撤销栈。
- 多个编辑器可同时打开并独立保持内容、撤销历史、只读状态、保存状态和关闭保护；Ctrl/Cmd+S 只作用于活动编辑器。
- 在目标 Flag Chromium 中，曲面中心和可见边缘的 CodeMirror 点击、拖动选择、滚动、键盘输入、组合输入/IME、复制粘贴与撤销均可用。

### 4. Spatial Media Viewer

- 提供独立 Spatial Media Viewer presentation，共享媒体 controller 的 workspace read、类型判断、请求竞态、错误状态和 object URL 所有权。
- 图片使用 contain 布局显示，保留加载、错误、不支持类型和缺少 binary 的明确状态；替换来源、路由变化、关闭或卸载时释放 owned object URL。
- 音频和视频使用 Source-local 自绘控件，不依赖原生 `controls`：至少提供播放/暂停、当前时间/总时长、可拖动进度、静音、音量；视频另提供全屏。
- 控件通过语义 button/range/status 实现，支持键盘、投影指针、禁用/加载状态和可访问名称；普通控件不得放到 Canvas 上方的平面 overlay。
- seek、volume 和播放命令以媒体元素的实际状态为准；播放 promise 失败、decode/error、不可 seek 和未知 duration 必须进入稳定的可恢复状态，而不是制造成功 UI。
- 音频不拥有连续 renderer frame reason；时间/进度只在浏览器媒体事件或有界计时采样时更新 Source。
- 视频内容由 renderer-owned dynamic media texture 合成到所属窗口曲面的媒体区域。Source 中保留同一个 `<video>` 作为解码/全屏权威，但正常 Spatial 显示不依赖 HTML Source 捕获其动态像素。
- `requestVideoFrameCallback` 可用时每个实际解码帧请求一次 `animated-media`；目标 Chromium 缺失该 API 时只允许播放期间的有界 rAF fallback。暂停、结束、页面隐藏、Source release、元素移除、context loss 和 dispose 必须取消回调/帧需求。
- `animated-media` 不进入 reduced-motion 自动抑制集合：用户明确播放的视频仍可播放；它也不得持续 dirty HTML Source texture或在暂停时占用帧。
- 视频纹理使用 Blob/object URL，同源可读；上传失败只降级媒体区域并保留控件/错误，不使整个 Spatial shell fallback。context restore 后由下一可用帧重建纹理。
- 全屏是明确的浏览器拥有逃生口：从用户激活链调用实际 video 的 fullscreen API，`:fullscreen` 显示原始视频像素；退出后回到曲面 viewer。全屏不可用或被拒绝时显示反馈。

### 5. Spatial presentation, input, and window lifecycle

- 三个窗口继承既有 Spatial shell 的暖灰白/炭灰/克制红色 token、字体和交互基元，不建立独立色板、Retro chrome 或第二套面板语言。
- 内部布局可为曲面可读性重组，但必须保留全部命令、状态和可发现性。默认与最小窗口尺寸下，工具区、列表、编辑器、媒体及状态区均不溢出到 Source 外。
- 目录长列表、搜索结果、CodeMirror 和媒体控件使用所属 Source 的可滚动区域；中心与可见曲面边缘的滚轮、滚动条拖动和命中一致。
- 不新增产品原生 `<select>`；若本任务需要选择器，使用已完成的 Source-local Spatial Select。
- 焦点状态不使用 outline、box-shadow 或额外外框改变几何；键盘状态通过填充、文字、底边或局部强调表达。
- 普通 DOM 更新保持 demand-driven；除用户播放的视频、短暂有界局部 transition 和既有环境原因外，空闲窗口不保留 rAF 或持续纹理上传。
- Explorer、多个 Editor 和多个 Media 窗口同时打开时，聚焦、失焦、遮挡、侧置、最小化和恢复不重置窗口实例状态；只有关闭释放 controller、CodeMirror、媒体回调和 object URL。

### 6. Tests and release boundary

- 自动测试聚焦长期行为契约：controller 请求竞态/mutation guards、只读与 `.keep`、编辑器身份/关闭保护、二进制拒绝、媒体 URL 生命周期、dynamic video texture/frame scheduling、context cleanup、registry readiness 和 release gate。
- 不为可人工调节的像素、颜色值、动画中间帧或源码排版增加脆弱断言；曲面媒体合成、CodeMirror/IME、上下文菜单和全屏由 Flag Chromium 产品矩阵验收。
- `workspace-explorer`、`workspace-editor`、`workspace-media` 完成后可置为 Spatial `ready`；其他未迁移 app 状态和生产 release gate 不变。

## Out of Scope

- 修改 workspace backend、contracts、Dexie schema、文件格式、只读策略、存档槽定义或 Agent workspace 工具行为。
- 把 RetroOS 视图直接嵌入 Spatial，或把两个完整页面塞进一个 presentation 条件模板。
- 重写 CodeMirror、增加协同编辑、文件 watcher、语法服务器、diff/merge UI、图片编辑或播放列表。
- 为视频实现字幕管理、画中画、投屏、倍速菜单或自定义解码器；浏览器 fullscreen 之外的平面媒体 overlay 不在范围内。
- 改变曲线投影、窗口 pose、Source 输入命中、窗口生命周期或生产 Spatial release gate。允许的 engine 变更仅限 renderer-owned dynamic video texture、曲面子区域合成、实际视频帧调度与所需 fullscreen trusted-activation seam。
- 迁移 Studio、Assistant、Play、系统界面或平台全局 Toast/Confirm/FloatingWindow presentation。

## Acceptance Criteria

- [ ] AC-01：`workspace-explorer`、`workspace-editor`、`workspace-media` 使用独立 Spatial 组件并处于 `ready`；其他 app readiness 与生产 release gate 不变。
- [ ] AC-02：RetroOS 与 Spatial 三组视图消费共享 workspace controllers/helpers；平台读取、mutation、校验、事件订阅、关闭保护和 object URL 生命周期没有被复制。
- [ ] AC-03：RetroOS Explorer/Editor/Media 的既有关键流程回归通过，路由和窗口身份不变。
- [ ] AC-04：Spatial Explorer 可浏览本地/卡根、面包屑和目录，搜索、选择、打开、刷新并正确显示加载/空/错误/反馈状态。
- [ ] AC-05：新建文件/文件夹、内联重命名、复制/剪切/跨根粘贴和删除均工作；`.keep`、冲突命名、扩展名确认与剪贴板保留语义不变。
- [ ] AC-06：只读目录/条目和受保护 save/save-N 条目在按钮、菜单与快捷键三条路径上得到相同保护。
- [ ] AC-07：Explorer 的 F2、Delete、Ctrl/Cmd+C/X/V、Escape、条目/空白上下文菜单在活动窗口可用，不影响编辑目标或后台/最小化窗口。
- [ ] AC-08：文本/SVG 打开新的稳定 editor id；图片/音频/视频打开正确 scope/path 媒体窗口；事件刷新不会让旧请求覆盖新位置。
- [ ] AC-09：Spatial Editor 支持 create/edit、CodeMirror 语言模式、readonly、JSON/frontmatter 校验、冲突写入、二进制拒绝、保存反馈和保留 editor id 的路由同步。
- [ ] AC-10：多个 Editor 同时打开时状态、撤销栈和 guard 独立；Ctrl/Cmd+S 只保存活动实例。
- [ ] AC-11：未保存编辑器关闭时保存/不保存/取消语义正确；取消或保存失败完整保留窗口、路由、焦点、DOM、内容和撤销历史。
- [ ] AC-12：WorkspaceCodeEditor 默认 Retro theme 不变；Spatial variant 使用 Spatial token、无外框焦点框，并通过曲面点击、选择、滚动、键盘和 IME 验收。
- [ ] AC-13：图片 viewer 可加载 workspace Blob；缺少 binary、未知类型、加载/解码失败显示稳定状态；所有 owned object URL 在替换/关闭时释放。
- [ ] AC-14：音频/视频的 Source-local 播放/暂停、进度、seek、静音、音量可用且反映媒体元素真实状态；视频 fullscreen 成功进入并可退出浏览器全屏，拒绝时有反馈。
- [ ] AC-15：视频实际播放帧通过独立纹理在正确的窗口曲面子区域连续显示；窗口 Source 不因每个视频帧整窗 dirty，暂停/结束/隐藏/关闭后无 `animated-media` 或回调泄漏。
- [ ] AC-16：视频纹理在 seek、resize、minimize/restore、context loss/restore 和多媒体窗口并存时保持正确归属、比例、顺序与清理；单个失败不使 shell fallback。
- [ ] AC-17：三个窗口同时打开时，聚焦、遮挡、侧置、最小化和恢复保留目录位置/搜索/选择/剪贴板、编辑草稿/撤销栈和媒体状态。
- [ ] AC-18：目标 Flag Chromium 中，中心与可见曲面边缘的目录长列表、上下文菜单、滚动条、CodeMirror/IME、媒体控件与 fullscreen/native surface 通过产品矩阵。
- [ ] AC-19：三个窗口与 shell/Dock/窗口 chrome 属于同一视觉系统，无 Retro chrome、产品原生 select、平面普通内容 overlay 或外框式焦点提示。
- [ ] AC-20：聚焦 controller/media/engine/registry 测试、Spatial 回归、Vue type-check、`npm run build:web` 和 `git diff --check` 全部通过。
