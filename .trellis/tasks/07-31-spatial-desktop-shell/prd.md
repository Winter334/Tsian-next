# Spatial 桌面外壳与窗口会话

## Goal

在已验收的 HTML-in-Canvas 渲染/输入底座上建立本地开发专用的 Spatial Desktop 外壳：平台能够从统一配置选择 UI 模式，以真实 Source DOM 承载启动器、状态区和多个空间窗口，并完成路由同步、静态聚焦、可读默认尺寸、自由拖动/尺寸调整、最小化/恢复、关闭和键盘操作。

本子任务只建立外壳、窗口会话和后续面板接入边界。尚未适配的应用显示明确的 Spatial 占位面，不嵌入 RetroOS 视图；正式构建继续锁定 RetroOS，直到发布集成子任务完成全部功能对等验收。

## Parent and Dependency

- Parent: `.trellis/tasks/07-31-html-in-canvas-platform-ui`
- 已完成依赖: `.trellis/tasks/archive/2026-08/07-31-spatial-rendering-input-foundation`
- 后续 Library、Workspace、Agent、System、Play/Global 子任务依赖本任务提供的注册表、窗口会话、Source DOM 和接入契约。

## Confirmed Facts

- Spatial 底座已通过 76 项自动化测试、platform-web 类型检查、生产构建和目标 Chromium/Flag 人工验收；其开发实验室未进入生产产物。
- `App.vue` 当前在配置预热完成前直接挂载 `DesktopShell`，因此新增 UI 模式时必须改为中性启动门，不能先闪现 RetroOS 再切换。
- `.tsian/local/platform-config.json` 已有完整读写、默认合并和同步内存缓存；新增 `appearance.uiMode` 应扩展该唯一配置源，不得再写 localStorage。
- `desktop-apps.ts` 当前同时拥有路由身份、RetroOS 组件和窗口几何；Spatial 与 RetroOS 共存前必须拆出 shell-neutral 注册表，并保留现有导出兼容。
- `useDesktopWindows.ts` 已建立“URL 仅表示活动/深链窗口、桌面会话仅在内存中”的行为，以及模块级 before-close guard；Spatial 必须保留这些业务语义，但不能复用平面像素窗口状态冒充空间会话。
- HTML-in-Canvas 要求每个可绘制顶层 Source 是 `layoutsubtree` Canvas 的直接子元素。Source DOM 是布局、语义、焦点、表单和事件权威，GPU 只负责视觉合成。
- 已有引擎提供曲面正反投影、Source 纹理、dirty upload、投影输入和资源恢复；目标曲面由单轴圆柱调整为可逆浅双轴球面，现有 `SpatialLabController` 仍混有实验室诊断职责，产品外壳不能直接依赖它。
- 首版 Spatial 只面向具备精细指针、足够视口、WebGL2 和实验性 HTML-in-Canvas 能力的桌面 Chromium。窄屏、手机和能力不足环境继续使用 RetroOS。

## Requirements

### UI Mode and Startup

- 在 `PlatformConfig` 增加 `appearance.uiMode: "retro" | "spatial"`，默认 `retro`；缺少该段的既有配置按默认值合并，不触发整份配置重置。
- 平台启动必须等待 host 初始化和配置预热后再选择外壳；等待期间只显示中性启动状态，不挂载任何桌面会话。
- 显式切换 UI 模式时先全量保存平台配置，再整页 reload；当前 hash route 保留，已打开窗口、位置、尺寸、层级和最小化状态不迁移。
- 开发构建可选择 Spatial；生产构建在发布门禁未开启时始终选择 RetroOS，并隐藏切换到 Spatial 的入口。门禁回退不得静默改写用户保存的偏好。
- Spatial 能力、精细指针或最低视口条件不满足时回退到 RetroOS，并给出清晰原因；不得进入半损坏的 Spatial 中间态。

### Shell-Neutral Registry

- 建立唯一的平台应用注册表，集中拥有稳定 app id、route name/path、实例 identity、标题/图标、singleton/detail/editor 规则，以及每套外壳的组件和窗口默认值。
- Router、RetroOS 和 Spatial 必须从同一注册表解析路由与窗口 identity；`desktop-apps.ts` 保持兼容导出，现有 RetroOS 行为和深链不变。
- 未适配的 Spatial 应用不得加载或包装 RetroOS route view；使用共享占位面明确显示应用身份和“待适配”状态。
- `/play` 继续是 singleton；Game Card detail、Workspace editor/media 等参数化窗口继续使用稳定实例 id。

### Spatial Window Session

- Spatial 窗口状态必须独立于 RetroOS，至少包含稳定 world position、尺寸、层级、最小化、聚焦和 Source 纹理状态；刷新后只从当前路由重建一个默认窗口。
- 支持打开、聚焦、自由拖动、八方向缩放、克制的侧区曲面吸附、最小化、恢复、关闭、全部最小化和视口变化后的可恢复 clamp。
- 聚焦窗口只更新活动状态、层级和路由，不自动移动、旋转或重定位桌面；所有窗口的 world position 保持不变。
- 新窗口默认尺寸采用可读的视口比例：常见 1920×1080 目标约 58% 宽、72% 高，并受应用最小值、launcher/status 保留区和可恢复边界约束；窗口尺寸只通过八方向边缘拖动改变。
- 滚轮不改变单个窗口尺寸。本阶段撤销窗口 wheel zoom；未来如增加远近控制，必须是背景空白区域触发的统一摄像机 zoom。
- 曲面吸附不得量化为固定网格或插槽，也不得阻止用户再次拖动；视觉几何、DOM border box 和命中几何必须使用同一布局结果。
- 非关闭窗口始终保留 Vue/DOM 树。最小化可以显式释放 GPU texture，但必须保留滚动、表单、草稿和运行状态，并在恢复可见前重新捕获。
- before-close guard 必须在 Spatial 关闭路径中继续生效；取消关闭不得改变路由、焦点或纹理状态。

### Source DOM, Input, Accessibility, and Motion

- Canvas 内的启动器、状态面和每个窗口必须是直接 Source 子元素；透明 input plane 覆盖完整视口，指针通过统一反投影路由到 Source DOM。
- 产品外壳复用框架无关的 renderer/scheduler/input/lifecycle 控制器；实验室诊断包装和产品会话不得复制两套投影、原生控件或资源恢复逻辑。
- parallax、双轴 curve、Source CSS layout 和输入反投影必须共享同一可逆配置，不得出现视觉与命中几何偏差。
- 键盘用户可以打开启动器、切换窗口、聚焦活动窗口并执行最小化/关闭；Source DOM 保留语义和可见 focus 状态。
- 尊重 `prefers-reduced-motion`；移除自动聚焦移动后，降低动效不应改变聚焦、窗口缩放或层级结果。

### Local-Only Visual Shell

- 使用已验收的深黑蓝、青白层级和少量橙色告警语言，建立独立 Spatial tokens、窗口框架、启动器和状态面；不得把规则继续堆进 RetroOS 的全局样式。
- 默认背景复用底座的独立环境/粒子边界；本任务不增加壁纸选择、上传或持久化。
- 本地 Spatial 外壳必须清楚区分“外壳已实现”与“业务面板待后续适配”，不能用平面 DOM overlay 或旧面板伪装完成度。

## Acceptance Criteria

- [ ] `appearance.uiMode` 能从 `.tsian/local/platform-config.json` 默认化、读取、保存和克隆；旧配置缺字段时保留其他 section 并补 `retro`。
- [ ] 首次启动不闪现错误外壳；显式切换模式保存成功后 reload，hash route 保留而桌面会话重建。
- [ ] 开发构建可以进入 Spatial，发布门禁关闭的生产构建始终进入 RetroOS，且没有可操作的 Spatial 入口。
- [ ] 缺少精细指针、视口不足、WebGL2 或 HTML-in-Canvas 时稳定回退 RetroOS，不改写保存偏好。
- [ ] Router、RetroOS 与 Spatial 从同一注册表得到 app/route/window identity；现有所有 RetroOS 路由、窗口 id、launcher 和 before-close 行为保持不变。
- [ ] 未适配应用在 Spatial 中只显示专用占位面，没有 RetroOS view、`retro-*` 内容 chrome 或自动切回旧 UI。
- [ ] 多个 Spatial 窗口可同时存在并完成打开、聚焦、拖动、缩放、侧区吸附、最小化、恢复和关闭。
- [ ] 聚焦任意窗口不会自动移动桌面或窗口，只更新活动状态、层级和路由。
- [ ] 新窗口默认打开尺寸接近常见视口 58% 宽、72% 高，达到参考图的阅读尺度；滚轮不会改变窗口大小。
- [ ] 曲面在水平和垂直两个方向都形成浅球面包围感，完整 Source 域可见，中央上下方不再出现投影造成的大块空带。
- [ ] 曲面中心、左右及上下边缘的窗口控件、拖动面和八方向缩放手柄命中均与视觉一致。
- [ ] 最小化释放纹理后 Source DOM 状态仍保留；恢复会先重新捕获再显示，关闭才真正卸载组件。
- [ ] 直接加载每个已注册 route 会创建/聚焦正确的 Spatial 窗口；URL 只跟随活动窗口，不序列化整个会话。
- [ ] 键盘可以进入 launcher、切换活动窗口并执行关键窗口命令，focus-visible 在捕获画面中可见。
- [ ] 现有 Spatial interaction lab 在控制器抽取后继续通过自动化和目标浏览器回归，资源/dirty upload/context restore 契约不退化。
- [ ] 新增窗口/注册表/模式解析纯逻辑具有默认尺寸比例、中心/四向边缘、双轴往返、越界、参数化 route、reduced-motion 和回退用例。
- [ ] 完整 Spatial Vitest、platform-web Vue 类型检查、`npm run build:web` 和 `git diff --check` 通过。

## Out of Scope

- Library/Market、Workspace、Agent、System、Play 内容面板的正式 Spatial 呈现。
- Spatial splash、toast、confirm、通用 dialog/context-menu 和 Play host 全局表面；这些由 Play/Global 子任务接入统一 Source 系统。
- 在发布门禁开启前向正式用户提供 Spatial 选择。
- 移动端、窄屏、触摸优先、XR 控制器或 HTML-in-Canvas polyfill。
- 跨 reload 保存窗口会话，或在 RetroOS/Spatial 之间迁移打开窗口。
- 多个并行 Play runtime、后端、contracts、Dexie schema 或业务存储改动。
- 壁纸库、媒体上传、动态壁纸持久化和正式浏览器/Flag 引导文案。
