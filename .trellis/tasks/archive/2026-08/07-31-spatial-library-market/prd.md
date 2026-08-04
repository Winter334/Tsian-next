# Spatial 应用库与创意工坊

## Goal

把“我的应用”“应用属性”和“创意工坊”迁移为首批可完整操作的 Spatial 功能窗口，在真实曲面窗口中证明卡片列表、图片、表单、文件选择、上下文菜单、异步业务操作和多窗口状态都能工作，同时保持 RetroOS 的既有行为与数据实现不变。

## Background and Confirmed Facts

- Spatial 渲染/输入基础与桌面外壳已经完成，应用注册表能够为每个路由分别声明 RetroOS 与 Spatial presentation；本任务开始时三个目标应用仍为 `pending`。
- 父任务已确定本阶段顺序和范围：Spatial My Apps 是第一个真实功能切片，随后完成 App Market 与 Game Card detail/property。
- 当前 `GameCardLibraryView.vue`、`AppMarketView.vue`、`GameCardDetailView.vue` 分别约 641、1286、1004 行，业务状态、平台调用和 RetroOS 表现混在同一组件中。三者合计拥有 121 个 computed/lifecycle/function 入口，直接复制会形成两套业务实现。
- 平台以 Vue 局部状态、platform-host/storage API 和 payload-less change events 为权威；本任务不引入全局 store，也不把持久化写入藏到新的展示组件中。
- 非关闭窗口在最小化、失焦和遮挡时必须保持挂载；只有关闭窗口可以卸载并释放视图状态。
- HTML-in-Canvas 可能省略不可读的跨域图片像素。父任务要求同源、Blob 和 CORS-readable 图片走统一策略，失败时显示设计过的 Spatial 占位，不新增任意图片代理。
- Toast、Confirm 和通用 FloatingWindow 是平台全局宿主，其 Spatial presentation 属于后续“Play 与全局界面”任务。本任务继续调用现有命令 API，不复制全局反馈状态。
- Spatial 生产发布门继续关闭；本任务完成只使三个内部开发 presentation 进入 `ready`。
- 用户确认功能窗口首先必须与已经完成的 Spatial 框架保持同一视觉语言；页面内部布局不是兼容约束，在提升信息层级、曲面可读性或交互效率时可以重组。

## Requirements

### 1. Shared business behavior and RetroOS compatibility

- 从三个现有视图中抽取按领域聚合的共享 controller/composable 与纯 helper，使 RetroOS 和 Spatial presentation 调用同一套平台 mutation、校验、事件订阅、草稿和错误处理逻辑。
- 共享逻辑不得依赖 RetroOS 的 `useDesktopWindows()`。跨应用导航使用 shell-neutral 路由身份，使当前活动壳负责打开或聚焦目标窗口。
- platform-host、storage、认证和 market API 继续是业务与数据权威；mutation 成功后通过既有事件和重新读取收敛状态，不建立第二份业务缓存或乐观持久化。
- RetroOS 三个现有视图必须迁移为共享 controller 的消费者，并保持已有功能、路由、提示文案、关闭保护和窗口行为。

### 2. Spatial My Apps

- 提供 Spatial 专用的应用库 presentation，不挂载或包裹 `GameCardLibraryView.vue`，也不使用 `retro-*` 内容 chrome。
- 展示所有非 builtin 游戏卡的封面、标题、简介、当前加载状态和可用更新状态。
- 支持创建默认游戏卡、导入卡包、打开应用属性、复制、加载、从创意工坊更新、删除以及进入创意工坊。
- 支持卡片快捷操作、空白区/卡片上下文菜单、加载/错误/空状态和操作反馈。
- 卡片可通过键盘聚焦；Enter/Space 可打开，快捷操作可单独聚焦，键盘可打开上下文菜单且焦点状态清晰。
- 订阅现有游戏卡和活动卡事件并重新读取数据；窗口失焦、侧置、遮挡、最小化和恢复不能丢失滚动、选择或进行中的本地状态。

### 3. Spatial App Market

- 提供 Spatial 专用的创意工坊 presentation，并完整覆盖列表、详情、上传和管理流程。
- 支持资源类型、全部/我的上传、tag、搜索、排序、数量、分页/加载更多和登录提示。
- 支持查看资源详情，安装游戏卡、Agent、Skill、Tool，并保留目标选择、覆盖确认和旧版本存档提示。
- 支持上传本地游戏卡、Agent、Skill、Tool；支持编辑发布物元数据、替换包内容和删除自己的发布物。
- 登录入口通过 shell-neutral 路由打开账号中心。
- Market install/replacement 等领域浮层必须位于 Spatial Source 内并可被曲面捕获与投影输入；平台级 Toast/Confirm/通用表单宿主仍复用现有命令 API，视觉替换留给全局界面任务。

### 4. Spatial Game Card detail/property

- 提供 Spatial 专用的应用属性 presentation，覆盖概览与前端绑定两个区域。
- 支持加载当前卡、导出卡包、编辑名称/简介/作者/版本、上传封面、应用封面 URL、清除封面、统一保存属性和删除应用。
- 封面与 metadata 均保持 draft-until-saved；上传预览对象 URL 必须在替换、关闭或卸载时释放。
- 支持未配置、Remote URL、Packaged 三种前端绑定，前端包导入/导出、入口文件状态和清除绑定。
- 未保存属性在关闭 Spatial detail 窗口时必须通过现有 shell-neutral close guard 阻止静默丢失；拒绝关闭不改变路由、焦点、DOM 或草稿。
- `cardId` 改变时重载正确卡片并重置该窗口的页签/草稿，活动卡事件触发权威重读。

### 5. Shared Spatial media policy

- 提供一个 Spatial 图片 resolver/component，统一处理：无图片、同源 URL、Blob/File/object URL、CORS-readable 外部 URL、加载中和不可用状态。
- 同源资源可直接使用；Blob/File 通过受控 object URL 使用；外部 URL 只在 CORS 可读时物化为 Blob URL。
- helper 必须处理异步竞态、组件卸载和 owned object URL 释放，不能继续调用会在每次 render 创建新 URL 的路径。
- 图片加载或 CORS 失败只降级为与资源类型匹配的 Spatial FUI 占位；标题、操作、安装、编辑等非图片功能继续可用。
- 不新增后端代理、共享 contract、Dexie schema 或额外持久化副本。

### 6. Unified Spatial visual language, adaptable layout, and accessibility

- 视觉语言必须直接继承现有 Spatial 框架：暖灰白窗口体、炭灰控件、低对比灰层级、克制红色强调、既有青/橙语义色，以及 JetBrains Mono/Inter 字体关系。功能窗口不得建立独立色板、材质系统或第二套 FUI 组件语法。
- 内容控件复用或派生自现有 `--spatial-*` tokens；新增语义变量必须引用框架 token，不能硬编码一组近似但漂移的颜色。
- 不要求复刻 RetroOS 的像素布局。My Apps、Market 和 Detail 可在必要时调整信息架构、分栏、工具区、卡片密度和操作位置，但必须保留功能、术语、状态、业务顺序与可发现性。
- 布局变化应由窗口尺寸、曲面边缘可读性、键盘路径或功能密度驱动，而不是仅为了视觉差异；同类操作在三个窗口中的位置和组件形态应保持一致。
- 布局随窗口可恢复尺寸自适应；主滚动区不能依赖浏览器视口尺寸，长列表和长表单在曲面边缘仍可滚动和命中。
- 点击、悬停、上下文菜单、拖动滚动条、文本输入、textarea、select、文件选择、键盘焦点和关闭保护必须通过现有投影输入工作。
- 原生 file/select 等浏览器 top-layer UI 可以保持平面逃生口；普通应用内容不得通过 Canvas 上方的平面 DOM overlay 绕过 Source 捕获。
- Reduced motion 不改变功能结果；本任务不修改 engine 投影、window pose 或 shell lifecycle contract。为使 Source 内 CSS transition 的中间 computed frame 能连续进入纹理，允许增加一个 opt-in、硬上限、空闲自动停止的 `animated-source` 调度契约，但不得改变投影、输入或窗口生命周期语义。

### 7. Shared interactive presentation primitives and motion

- Spatial presentation 不直接使用原生 `<select>` 作为主题控件。需要主题化的选择器使用 Source 内自绘 trigger/listbox，避免浏览器原生下拉弹层脱离曲面视觉；保留完整的打开、选中、Escape、方向键、Enter/Space、Home/End 和禁用语义。
- 带图标按钮统一使用一个 Spatial Action Button 基元：图标与文字保持同一水平基线、固定图标盒、稳定间距和不随文本变化的尺寸；纯图标按钮必须有可访问名称。
- 新桌面不显示 outline、box-shadow 或额外边框形成的“焦点提示框”。键盘焦点若需要状态反馈，只能使用不改变几何的填充、文字、底边或局部强调，并保持与 shell 控件一致。
- Market 页面切换和 Detail tab 切换必须在 Source 纹理内即时替换，不使用会触发 Chromium descendant compositor promotion 的 CSS `transform`、`opacity`、`filter`、`clip` 等主内容入场效果；主内容始终由 WebGL 曲面网格绘制。下拉/菜单/对话框开合和列表/卡片进入可暂时保留共享且有界的局部动效，但不得持续循环、阻塞输入或改变业务状态。
- 真正保持曲率的主内容转场需要 renderer 在同一 WebGL 网格上合成旧/新两张 Source 纹理。该 dual-texture/GPU 能力属于后续平台底座，本任务不扩张 renderer 来实现。
- 所有内容动效尊重 `prefers-reduced-motion`，降级为即时最终状态；HTML-in-Canvas texture repaint 只在短暂过渡期间发生，空闲时不持续 dirty。
- Source repaint 必须串行消费纹理快照：等待中的 dirty/paint-ready generation 不得被下一次动画采样覆盖；结束、取消、reduced-motion 或硬超时后补最终纹理并停止，不能出现旧/新内容交替闪现或离散跳帧。

### 8. Test maintenance policy

- 新测试只覆盖具有长期维护价值的行为契约：controller 状态/竞态、registry/release gate、媒体生命周期、共享交互基元的键盘与状态语义。
- 不为可人工调整的像素、颜色数值、动画中间帧或源码排版增加脆弱测试；视觉语言与动效质量由构建检查和人工浏览器验收负责。
- 广域测试发现旧 shell/engine 失败时逐项审核其现行契约：删除源码格式、可调视觉数值和重复实现细节测试；把仍有价值的几何/渲染检查改写为单调性、对称性、顺序、归属和生命周期等语义不变量。不得为了迁就退役断言修改生产代码，也不得长期保留稳定红色基线。

## Out of Scope

- 修改 Spatial renderer、曲线投影算法、窗口几何或桌面环境效果。为满足本任务已要求的 Select 点击与滚动条拖拽，允许在既有投影坐标/捕获之上增加最低限度的合成事件默认动作适配，但不得引入另一套命中或逆投影算法。
- 迁移 Workspace、Studio、Assistant、Settings、Account、Announcements、System Monitor、Play 或平台全局宿主。
- 给 Spatial 增加手机/窄屏等价实现，或打开生产 Spatial release gate。
- 修改 Game Card iframe 前端、市场后端协议、共享 contracts、Dexie schema 或平台数据格式。
- 为跨域图片增加 unrestricted server proxy，或在图片失败时自动切换到 RetroOS。
- 把现有 RetroOS route view 直接嵌入 Spatial 窗口，或通过 `variant` 条件把两个完整页面塞回同一模板。

## Acceptance Criteria

- [ ] AC-01：`market`、`my-apps`、`game-launcher` 在 Spatial 注册表中使用独立 Spatial 组件并处于 `ready`；其他未迁移应用保持 `pending`，生产 release gate 保持关闭。
- [ ] AC-02：三个 RetroOS 视图和三个 Spatial 视图消费同一套领域 controller/helper；mutation、storage/event 订阅、校验和 close guard 没有被复制成第二套。
- [ ] AC-03：RetroOS 的应用库、创意工坊和应用属性既有流程通过回归验证，路由与窗口身份不变。
- [ ] AC-04：Spatial My Apps 可完成创建、导入、打开、复制、加载、更新和删除，并正确显示空/加载/错误/反馈状态。
- [ ] AC-05：Spatial My Apps 的卡片、快捷操作和上下文菜单可用鼠标与键盘操作；事件刷新后列表和 active/update 状态正确。
- [ ] AC-06：Spatial App Market 可筛选、搜索、排序、分页、切换全部/我的上传并查看详情；未登录状态能打开账号中心。
- [ ] AC-07：游戏卡、Agent、Skill、Tool 的安装目标、覆盖确认、上传、发布物编辑/替换/删除流程与 RetroOS 功能对等。
- [ ] AC-08：Spatial 应用属性可完成 metadata/封面 draft、统一保存、加载、导出和删除；builtin 限制保持不变。
- [ ] AC-09：Spatial 应用属性可完成 none/remote/packaged 前端绑定、前端包导入/导出与清除；文件列表和状态正确。
- [ ] AC-10：有未保存属性时关闭 detail 窗口会提示；拒绝关闭完整保留窗口、路由、焦点和草稿，批准后只关闭目标窗口。
- [ ] AC-11：同源、Blob/File、CORS-readable 外部图片可显示；无图、失败外链和不可读跨域图片显示稳定占位且其他功能不受影响；owned object URL 均被释放。
- [ ] AC-12：My Apps、Market、Detail 同时打开时，聚焦、侧置、遮挡、最小化和恢复不重置各自滚动、筛选、表单草稿或异步状态。
- [ ] AC-13：在目标 Flag Chromium 中，曲面中心与可见边缘的卡片、表单、上下文菜单、滚动和文件选择命中一致，无平面 DOM overlay 代替普通应用内容。
- [ ] AC-14：键盘焦点可见、DOM 语义可读，reduced motion 下所有业务操作仍能完成。
- [ ] AC-15：三个窗口与现有 Spatial shell/Dock/窗口框架并置时属于同一视觉系统：复用框架 token、字体、材质、线条和交互状态，不出现独立色板、RetroOS chrome 或另一套科技面板；必要的布局变化不减少功能或可发现性。
- [ ] AC-16：聚焦测试、Spatial/registry 回归、Vue type-check、`npm run build:web` 与 `git diff --check` 全部通过。
- [ ] AC-17：Spatial 范围内不存在用于产品选择器的原生 `<select>`；共享选择器在 Source 内完成视觉、键盘、禁用、选择和关闭语义。
- [ ] AC-18：三个窗口的带图标按钮共享同一 icon/text 布局基元，图标不再出现在文字上方、挤压文字或产生不一致对齐。
- [ ] AC-19：Spatial 应用内容不出现外框式焦点提示；键盘状态不改变控件几何，并与现有 shell 的无焦点框语言一致。
- [ ] AC-20：Market screen 与 Detail tab 在 Source 纹理中即时替换且全程保持曲率；菜单/选择器/对话框的局部过渡有界、可中断、无无限循环，并在 reduced motion 下即时完成。
- [ ] AC-21：任务测试保持小而必要；不新增或维护脆弱视觉/源码字符串断言；广域套件中的旧失败完成契约审核后删除或改写，保留下来的行为测试全部通过。
