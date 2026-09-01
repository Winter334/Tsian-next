# Spatial 桌面外壳与窗口会话

## Goal

在已验收的 HTML-in-Canvas 渲染/输入底座上建立本地开发专用的 Spatial Desktop 外壳：平台能够从统一配置选择 UI 模式，以真实 Source DOM 承载启动器、状态区和多个独立 2.5D 悬浮窗口，并完成路由同步、静态聚焦、可读默认尺寸、自由拖动/尺寸调整、最小化/恢复、关闭和键盘操作。

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
- 已有引擎提供 Source 纹理、dirty upload、投影输入和资源恢复；旧 Interaction Lab 的视觉与产品实现已经脱节，用户确认在基础视觉框架收尾时移除独立 lab 页面、适配器和探针表面，产品运行时直接拥有共享引擎路径。
- 参考图对比确认全局曲面模型不符合目标：当前 renderer 虽逐窗捕获独立 Source 纹理，却先把全部窗口合成到一张平面 surface，再执行一次全屏曲面 pass，因此所有窗口视觉上仍粘在同一曲面。目标改为环境稳定、逐 Source 独立曲面与 2.5D pose 合成；悬浮感由局部曲率、深度、朝向、尺度、遮挡、Source 窄框和活动层次共同建立。
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
- 支持打开、聚焦、自由拖动、八方向缩放、克制的侧区姿态吸附、最小化、恢复、关闭、全部最小化和视口变化后的可恢复 clamp。
- 聚焦窗口只更新活动状态、层级和路由，不自动移动、旋转或重定位桌面；所有窗口的 world position 保持不变。
- 新窗口默认尺寸采用可读的视口比例：常见 1920×1080 目标约 58% 宽、72% 高，并受应用最小值、launcher/status 保留区和可恢复边界约束；窗口尺寸只通过八方向边缘拖动改变。
- 滚轮不改变单个窗口尺寸。本阶段撤销窗口 wheel zoom；未来如增加远近控制，必须是背景空白区域触发的统一摄像机 zoom。
- 侧区姿态不得量化为固定网格或插槽，也不得阻止用户再次拖动；窗口位置决定克制的 `depth/yaw/pitch/scale`，聚焦本身不得改变 pose。视觉几何、DOM border box 和命中几何必须由同一 pose 投影结果关联。
- 非关闭窗口始终保留 Vue/DOM 树。最小化可以显式释放 GPU texture，但必须保留滚动、表单、草稿和运行状态，并在恢复可见前重新捕获。
- before-close guard 必须在 Spatial 关闭路径中继续生效；取消关闭不得改变路由、焦点或纹理状态。

### Source DOM, Input, Accessibility, and Motion

- Canvas 内的壁纸时钟、启动器、状态面和每个窗口必须是直接 Source 子元素；透明 input plane 覆盖完整视口，指针通过逐 Surface pose/曲率反投影路由到可交互 Source DOM，时钟则明确排除在命中候选之外。
- 左右 shell Source 使用对称的垂直圆形 Dock：左侧只承载应用启动器，右侧承载打开窗口任务与紧凑状态/全部最小化/返回 RetroOS 工具；不再提供本地诊断按钮或浮动诊断面板。两侧使用约 `clamp(48px, 4vw, 72px)` 的安全 inset，不贴视口边缘。
- 两个 Dock 的主列表在正常支持桌面视口固定显示 5 个圆形图标项，并通过隐藏滚动条的纵向 wheel/trackpad 滚动访问其余项目；所有项目必须保留在语义 DOM 中，不得通过数组切片隐藏。右侧最小化任务继续显示为弱化图标，点击时恢复并聚焦。
- 产品外壳复用框架无关的 renderer/scheduler/input/lifecycle 控制器；移除旧实验室后不得为已废弃对比页保留第二套包装、探针或入口。
- 每个 Source 的局部曲率、2.5D pose、Source CSS layout 和输入反投影必须共享同一逐窗配置，不得用全屏后处理或逐控件补偿制造视觉与命中几何偏差。
- 键盘用户可以打开启动器、切换窗口、聚焦活动窗口并执行最小化/关闭；Source DOM 保留语义和可见 focus 状态。
- 全视口 parallax 在 X/Y 两轴都必须与指针方向相反，中心仍精确为零，既有离开边界与 recenter 策略不变。
- 尊重 `prefers-reduced-motion`；移除自动聚焦移动后，降低动效不应改变聚焦、窗口缩放或层级结果。

### Local-Only Visual Shell

- 左右 Dock 与窗口框架统一使用灰白、炭灰和少量背景红色 tokens。最新热更新评审恢复最初的连续竖向胶囊结构，并保持与装饰圆环、窗口边框和时钟一致的低透明灰白面板，只通过降低实体度和柔化暖白描边避免原版过亮；内部图标按钮保持平面圆形，不得使用青色科技面板、选中发光、窗口外投影或背景模糊。窗口体积由物理曲面、透视、前后遮挡和随 Source 一起变形的窄框表达；环境亮部 Bloom 不得扩散到 Source 文字或充当窗口选中效果。相关规则不得堆进 RetroOS 的全局样式。
- 左右 Dock 属于窗口后的 shell Source 层：其 scene z 必须低于从约 100 起步的窗口会话 z，renderer 先绘制 Dock Source 再按会话 z 由后向前绘制窗口，投影输入则按相同 z 由前向后解析，确保窗口在视觉和命中上都遮挡 Dock。前景环境标记仍在窗口后绘制。
- 产品 `SpatialDesktopShell` 使用内置 `src/spatial/shell/assets/spatial-desktop-background.jpg` 作为 WebGL 拥有、可随 context restore 重建的环境纹理，并保持与当前壁纸完全相同的居中 `cover` 构图。根 CSS 只保留同图静态启动/失败回退，不再承担正式效果或 SVG 色差滤镜；其他通用 renderer consumer 保留既有默认环境路径。
- 环境后处理只作用于壁纸与环境粒子，采用中心清晰、向边缘渐强的径向 RGB 色散、局限于月亮/高亮粒子的阈值 Bloom、极轻微暗角和细颗粒电影质感，并预留低频空气折射参数。Dock、窗口、时钟正文和全部 HTML Source 绕过环境后处理；不得增加全屏雾、扫描线、持续故障、正文 Bloom、景深或玻璃/背景模糊。
- 右侧状态 Dock 不显示时间。壁纸时钟继续由真实、可访问、每秒更新的 HTML DOM 提供，但作为不参与命中的低 z 背景 Source 在环境后处理之后、Dock/窗口之前清晰合成；其位置、大小、暖白/淡红 halo 与深色可读性阴影保持当前验收结果，并由窗口自然遮挡。
- 月亮/主体装饰环不再依赖根 DOM SVG 滤镜或逐帧大纹理上传；两条反向慢旋虚线环、确定性径向条和少量淡红强调由环境后的独立 GPU 装饰 pass 绘制，保持当前构图和亮度，不参与输入，并在 `prefers-reduced-motion` 下静止保留。
- 环境粒子保持独立 WebGL pass 与既有 scheduler/reduced-motion 契约，继续使用三层不同景深、暖白为主与少量淡红近点的构成；运动不得表现为整层规则网格匀速平移。每个层级叠加平滑低频流场、确定性的逐粒子相位/摆动、速度与尺寸微差，使轨迹更自然但不闪烁、跳变或形成全屏雾层。
- 本地 Spatial 外壳必须清楚区分“外壳已实现”与“业务面板待后续适配”，不能用平面 DOM overlay 或旧面板伪装完成度。
- 最新风格目标仍是轻量窗口：去除选中阴影、活动外发光、网格、渐变和内容纹理；为避免壁纸穿透削弱遮挡，窗口主体提高到约 90–92% alpha，标题/拖拽入口与最小化/关闭突出块约 94–96% alpha，并移出完整横向标题栏。窗口使用约 2–3px 暖灰白 Source 窄框和可选 1px 低对比内分隔线承载轮廓；捕获纹理正文保持锐利，不再绘制几何外的独立 GPU shadow/rim pass。

### Dock Visual Revision 2 (Confirmed)

- 左侧继续只承载应用启动器，右侧继续承载已打开窗口任务与“全部最小化 / 返回 RetroOS”工具；滚动、键盘焦点、活动/最小化辨识、Source z-order 和 projected input 行为不变。
- 右侧显示 `READY`、renderer 状态和窗口数量的 `.spatial-status-surface__readout` 已确认删除，不用另一种状态胶囊替代；运行状态仍通过既有 typed snapshot/fallback 供内部逻辑使用，不在桌面常驻展示。
- 第一轮候选 A“悬浮节点轨道”已经热更新评审否定：即使删除胶囊，纵向细轨仍把节点组织成廉价珠链；单层描边圆按钮又过于通用、缺少材质层次和精密结构。下一轮必须同时删除连接轨道并重做节点造型，而不是继续调虚线颜色/间距。
- 固定约束：不恢复连续胶囊、共享实体背板、自动隐藏或 hover 展开；每个控件仍保留至少 48px 的稳定语义/投影命中盒，视觉轮廓可缩进其内部；左右安全 inset、滚动、键盘焦点、活动/最小化层次、工具分组、Source z-order 和 projected input 不变。
- 用户批准候选 D2“平面切角标记”：每个 48px 命中盒内放置 42–44px 的纯平面切角圆方/八边形色块；使用单一低透明炭灰填色、1px 暖白主框、两段断开的外括线和 1–2 个微型刻度/缺口形成精密感，图标与几何共面。活动项只把单侧短边/楔形改为红色并提高平面填色实体度。禁止凹面核心、内外高低层、阴影、渐变、高光、材质厚度或任何 3D/拟物效果。
- 候选 E“悬浮角标框”：去掉完整外轮廓，只用四个 L 形角标与中心半透明圆片围住图标；活动项将一个角标改为红色。视觉最轻、最不像普通按钮，但在复杂红云背景上可读性稍弱。
- 候选 F“内向短翼标签”：每个图标使用朝屏幕中心伸出的短切角翼板，左右 Dock 镜像；翼板可承载细小状态刻线而不显示文字。层次最明确、最像 FUI 控件，但横向占用更大，可能与侧边窗口重叠得更早。
- 候选 E“悬浮角标框”和候选 F“内向短翼标签”不进入本轮；不增加 Dock 动画或改变功能集合。

### Dock Visual Revision 3 (Confirmed)

- Revision 3 supersedes Revision 2's node silhouette and prohibition on continuous capsules: the user rejected both the rail/circle iteration and the later cut-corner marks, and explicitly restored the original two continuous vertical capsule panels with inset circular icon controls.
- The restored capsule stays in the original translucent gray-white family so it harmonizes with the white decorative ring, window frame and clock, but uses lower opacity and a softer warm-white outline than the original bright milky panel. Idle circular controls remain quiet and flat; active launcher/task controls gain clearer charcoal contrast with restrained red reserved for the active accent, while return RetroOS remains the only strongly red utility control.
- The removed right-side `READY`/renderer/window-count readout and its small nested capsule must stay removed. Do not restore its markup, props or styles while restoring the surrounding right Dock capsule.
- Preserve the existing 48px semantic/projected hit boxes, five-item scrolling, hidden scrollbars, empty task-list behavior, keyboard focus, safe inset, Source z-order, explicit `translate3d`, projected input and status-Source relayout/synchronization. Do not restore rails, add Dock motion, or change renderer/window behavior.
- Keep the capsule and controls flat: no gradient, backdrop blur, glow, bevel, inset/outer shadow, scale motion or 3D/material-depth treatment.

### Window Lifecycle Motion

- 环境后处理底座已经通过用户热更新验收，下一轮候选范围是窗口打开与关闭的 Canvas 原生动效；窗口仍由真实 HTML Source 提供内容、状态和语义，GPU 只对已捕获纹理和逐窗网格做短时 presentation 变换。
- 用户确认首轮采用“曲面光隙展开/收束”：打开时窗口从最终位置的一条窄曲面光隙展开，局部 bow、深度和 alpha 同步建立，展开边缘带短暂暖白/淡红色散；关闭在 guard 通过后反向收束并在完成时卸载。该效果复用现有两轴 tessellated mesh，纯 HTML 难以在不拆分内容的情况下实现同等连续曲面形变。
- 过渡期间复用同一张 Source 纹理，不逐帧重新捕获 HTML；Source 暂时退出投影命中，完成后恢复输入。`prefers-reduced-motion` 走相同完成路径但直接到达终态。
- 打开必须先挂载并完成首张 Source 纹理上传，再启动可见展开；关闭必须先通过 async before-close guard，再进入收束，动画完成后才卸载 DOM、释放纹理、遗忘 guard 并同步最终路由。guard veto 是严格无动画、无状态变化。
- opening/closing Source 不参与 projected input；动画完成后的可交互窗口继续使用原有 CPU/GPU pose 和曲率反投影，不要求为近奇异光隙形变增加实时 inverse。
- 已验收的开关光隙动效保持不变。此前“窗口沿曲线压缩进右侧 Dock 图标”的最小化方案已明确废弃；第二阶段改用基于逐窗曲面纹理的径向粒子涟漪溶解/重组。
- 参考图对比表明当前“屏幕空间 Y 弯曲 + 单边外缘扩张”仍把窗口表现成弯曲贴纸。用户授权改变既有设计以优先逼近参考图；该模型由真实逐窗口三维曲面、刚体 yaw/pitch、camera-space depth 和透视投影整体替换，不再继续增加二维 bow/gain 参数。

### Reference-Calibrated 3D Curved Surface and Frame

- 每个窗口从 Source 局部 CSS 平面生成明显但连续的水平圆柱弧：曲率进入局部 Z 深度，而不是直接压缩屏幕 Y。曲面先在窗口中心执行真实 yaw/pitch 旋转和 depth 平移，再通过统一虚拟相机焦距投影到屏幕；顶点的 camera-space Z 必须自然产生尺度、梯形汇聚和透视正确纹理插值。
- 证据归属必须保持明确：`codex-clipboard-539026e7...png` 是单窗口近景参考，用于标定窗口自身曲率；`codex-clipboard-bab542d3...png` 是唯一的多窗口参考，用于标定位置姿态与远近尺度。`codex-clipboard-3f95272b...png` 是已否定的旧二维弯曲实现，`codex-clipboard-6c813afe...png` 是当前强度不足且带问题阴影的物理曲面实现，后两者只用于确认差距，不作为目标样式。两张参考共同确认强弧度应在中央窗口也持续存在，而 side pose 采用中等旋转配合明显后退，不能靠过大的 yaw 把窗口扭成梯形。
- 下一轮参考标定统一为：水平曲面半弧约 28–30°、虚拟相机焦距约 `1.0 × max(viewport)`、水平最大 yaw 约 18°、垂直最大 pitch 约 8°、侧区 depth 约 200 CSS px；水平/垂直常用响应范围分别约为视口轴的 32%/34%，继续使用从中心精确为零的连续 ease-out。窗口位置只改变 yaw/pitch/depth，不削弱固定局部曲率。
- 用户热更新确认当前物理曲面方向正确，但现有最大 yaw 11°、pitch 5°、depth 120px、曲面半弧 7° 与 `1.5 × max(viewport)` 焦距只产生轻微汇聚和约贴纸级弯曲，必须由上述标定整体替换，而不是叠加旧二维 bow/gain。
- CPU 与 GPU 共享同一三维顶点公式。现有二维网格三角形反投影继续负责命中，不为三维曲面增加逐控件补偿或独立解析 inverse；拖动使用屏幕空间位移，resize 使用 Source 局部位移，避免旋转窗口拖动速度失真。
- clamp 根据投影后的曲面边界和标题控制区保证可恢复，而不是只检查未投影 DOM 矩形。开关光隙与粒子涟漪在局部曲面阶段生成，再经过同一刚体/相机投影，因此稳定态和动画态不会切换成两套姿态。
- 删除产品窗口独立 GPU shadow/rim pass。现有 shadow 是扩张 9px、偏移约 5–7px/8–11px、内部 alpha 24% 的完整曲面，会透过半透明 Source 形成灰黑条带，且 minimizing 时没有共享径向 ripple mask 而短暂停留；该视觉和生命周期均不符合参考。
- 改用 Source DOM 内部约 2–3px 的暖灰白窄框与可选 1px 低对比内分隔线。最外约 2–3px 顶边继续优先响应 resize，其内侧提供约 8–10px 的透明拖拽命中带并避开标题/窗口控制；左右和底部保持既有 resize 优先级。边框属于捕获纹理，会自动共享物理曲面、光隙、径向溶解、粒子采样和纹理释放，不会独立滞留。
- 半透明主体继续提高不透明度，前窗在重叠处必须明确遮挡后窗。首轮不重新引入背景模糊、景深或任何替代性窗口投影，由真实几何、尺度、遮挡和 Source 窄框建立立体感。

### Minimize/Restore Particle Ripple Motion

- 用户选择候选 C“涟漪蒸发/重组”，并要求波前经过后窗口真正解体为粒子，而不是只有透明度或噪声 dissolve。单个窗口最小化时，以该窗口最小化按钮中心对应的 Source 局部 UV 为原点；径向波前裁切完整窗口曲面，同时由独立 GPU 点精灵 pass 从同一 Source 纹理采样颜色/alpha，把文字、图标和面板碎成对应颜色的细小粒子。粒子只做短距离景深/径向漂移、暖白/淡红边缘能量与短暂色差，不演变为大范围爆炸。真实 HTML DOM 不拆分，纹理不逐帧重捕获。
- 最小化开始后窗口立即退出 projected input，但保留 DOM 与现有纹理直到波前完成；完成时才标记 `minimized`、释放 GPU texture 并同步活动窗口/路由。DOM、滚动、表单、草稿和运行状态继续挂载。
- 全部最小化时，每个可见窗口均使用各自最小化按钮的局部 UV 作为确定性波纹原点；各窗口进度独立，不要求把波纹投影到右侧 Dock 或建立跨 Surface 轨迹。
- 恢复必须先重新捕获有效纹理，再以窗口中心局部 UV `{ x: 0.5, y: 0.5 }` 为固定原点启动反向粒子重组；中心区域先恢复，波前向外推进，粒子汇入各自纹理采样位置。恢复动画期间同样退出 projected input，完成后才进入稳定 `visible` 并恢复交互；右侧 Dock 任务图标只做克制状态反馈，不作为波纹或粒子的空间起点。

## Acceptance Criteria

- [ ] `appearance.uiMode` 能从 `.tsian/local/platform-config.json` 默认化、读取、保存和克隆；旧配置缺字段时保留其他 section 并补 `retro`。
- [ ] 首次启动不闪现错误外壳；显式切换模式保存成功后 reload，hash route 保留而桌面会话重建。
- [ ] 开发构建可以进入 Spatial，发布门禁关闭的生产构建始终进入 RetroOS，且没有可操作的 Spatial 入口。
- [ ] 缺少精细指针、视口不足、WebGL2 或 HTML-in-Canvas 时稳定回退 RetroOS，不改写保存偏好。
- [ ] Router、RetroOS 与 Spatial 从同一注册表得到 app/route/window identity；现有所有 RetroOS 路由、窗口 id、launcher 和 before-close 行为保持不变。
- [ ] 未适配应用在 Spatial 中只显示专用占位面，没有 RetroOS view、`retro-*` 内容 chrome 或自动切回旧 UI。
- [ ] 多个 Spatial 窗口可同时存在并完成打开、聚焦、拖动、缩放、侧区姿态、最小化、恢复和关闭。
- [ ] 聚焦任意窗口不会自动移动桌面或窗口，只更新活动状态、层级和路由。
- [ ] 新窗口默认打开尺寸接近常见视口 58% 宽、72% 高，达到参考图的阅读尺度；滚轮不会改变窗口大小。
- [ ] 环境、粒子与其他窗口不经过统一全屏曲面；每个窗口保持独立、明显且连续的横向圆柱弧面，移动或缩放一个窗口不会改变其他窗口的曲率或轮廓。
- [ ] 中央窗口近正视且可读，并持续具有约 28–30° 水平曲面半弧；偏离中心的窗口通过真实局部 Z 曲率、刚体 yaw/pitch、camera-space depth 和透视投影形成四向空间姿态。常用中段位置即可观察到边缘汇聚、远近尺度和朝中心内转，最大参考约为水平 18°、垂直 8°、整体后退 200px，焦距约为最大视口轴 1.0 倍。不得继续用屏幕 Y bow、单边 edge-scale ramp 或抵消 depth 尺度来伪造姿态；文字与内容不得出现扇形扭曲、波浪、条带或对角缝。聚焦只改变活动状态、z-order 和 route，不改变窗口位置或 pose。
- [ ] 窗口主体采用不带网格、渐变或内容纹理的灰白半透明平面，无选中效果；左上常驻突出块显示图标/标题，右上常驻突出块承载最小化/关闭。约 2–3px 暖灰白 Source 窄框和可选 1px 内分隔线随窗口纹理共同变形，不随焦点发光；不得恢复完整横向标题栏或独立 GPU shadow/rim pass。
- [ ] 窗口主体为约 90–92% alpha 的灰白平面，标题/控制突出块约 94–96% alpha；深色正文和占位输入仍可读。Source 内容采样保持锐利且不受环境后处理污染，窄框不改写正文颜色，最小化粒子波前通过后不存在单独滞留的投影或外轮廓。
- [ ] GPU 和 CPU 对每个网格顶点产生一致的 camera-space XYZ、clip W 与屏幕位置；中心、四边、四角控件命中与显示一致。标题拖动按屏幕位移移动窗口，八方向 resize 按 Source 局部位移改变尺寸；投影后 clamp 始终保留可恢复标题/控制区。
- [ ] 重叠窗口具有明确前后遮挡：前窗的高不透明主体、Source 窄框和物理曲面把后窗分离；position-derived depth 自然改变尺度/汇聚，不能再出现多个同尺度透明贴纸互相混色的观感。
- [ ] 构造“中央大窗口 + 侧后方窗口 + 下层窗口”的参考布局时，可观察到独立面板悬浮层次，而不是所有窗口粘在同一张透明橡胶幕布上。
- [ ] 每个窗口中心、左右及上下可见弧面边缘的控件、拖动面和八方向缩放手柄命中均与视觉一致。
- [ ] 最小化释放纹理后 Source DOM 状态仍保留；恢复会先重新捕获再显示，关闭才真正卸载组件。
- [ ] 直接加载每个已注册 route 会创建/聚焦正确的 Spatial 窗口；URL 只跟随活动窗口，不序列化整个会话。
- [ ] 左右 Dock 垂直居中并使用相同安全 inset；左侧 5 项可视启动器与右侧 5 项可视任务列表均可纵向滚动访问完整语义 DOM，滚动条不可见，右侧任务可区分活动/最小化并恢复聚焦，工具簇只保留全部最小化和返回 RetroOS；不存在 `READY`/renderer/window-count 常驻读数、诊断按钮或浮动诊断面板。
- [ ] 两侧恢复各自贯穿控件列的连续竖向胶囊，使用与白色桌面装饰一致的低透明灰白底与柔和暖白描边，内部为稳定 48px 命中盒中的平面圆形图标按钮；不存在纵向连接轨、切角标记或 `READY`/renderer/window-count 嵌套胶囊。活动项使用克制红色点缀，返回 RetroOS 为唯一强红工具按钮；hover/focus 不使用 glow、投影、渐变、内阴影、材质厚度或自动展开。
- [ ] 任一窗口与 Dock 重叠时，窗口在 WebGL painter order 中覆盖 Dock，并在 projected input front-to-back 解析中先于 Dock 命中；前景环境标记仍在全部 Source 之后绘制。
- [ ] 壁纸由 context-restorable WebGL 纹理以与现状一致的居中 `cover` 构图绘制；CSS 同图只作为启动/失败回退，当前固定 SVG RGB split 被移除。
- [ ] 环境效果在常见 1920×1080 视口可明确辨认但不压过壁纸：中心无明显色边，边缘高反差处出现约 1–2 CSS px 的径向色散；Bloom 只扩散月亮/粒子亮部；暗角与颗粒不形成黑角、雾层或闪烁噪点。
- [ ] Dock、窗口、时钟文字和所有 Source 捕获纹理保持锐利且颜色/alpha 不受环境后处理改变；移动、缩放或聚焦窗口仍不改变命中几何。
- [ ] 右侧 Dock 不再显示时间；壁纸时钟作为低 z、非交互的 HTML 背景 Source 每秒稳定显示时/分/秒和日期，保持当前大小/位置/阴影，并在 renderer painter order 中被 Dock 与窗口自然遮挡。
- [ ] GPU 装饰环位于处理后的环境与时钟/窗口之间，包含两条反向慢旋虚线环和确定性 varied radial bars，不带音频语义、不参与命中，并在 reduced motion 下静止保留。
- [ ] 环境后处理纹理、framebuffer、程序和壁纸纹理在 resize/context loss/restore/dispose 后不泄漏、不保留旧尺寸；后处理不可用时仍能直接绘制壁纸并进入可用 Spatial 外壳。
- [ ] 新窗口先以非交互 capturing 状态挂载，首张有效 Source 纹理上传后才在最终 geometry 处从窄曲面光隙连续展开；完成时恢复现有精确 flat-neutral 颜色/alpha、pose 和 projected input，不闪现完整窗口或空白纹理。
- [ ] 关闭请求先执行现有 async guard；veto 不启动动效也不改变 route/focus/DOM/纹理。guard 通过后窗口反向收束，收束期间 DOM/纹理保留且不参与输入，完成后才卸载、释放、遗忘 guard 并同步路由。
- [ ] 开关动画只更新 per-Source presentation uniforms/mesh，不逐帧调用 `texElementImage2D` 或改变窗口最终 world geometry；多个窗口同时过渡时各自进度独立，其他窗口不变形。
- [ ] 光隙边缘只在过渡期间显示克制暖白/淡红高光与色散，稳定 visible 状态仍走精确 flat-neutral shader，不增加常驻 glow、模糊、纹理或正文色差。
- [ ] `prefers-reduced-motion`、context loss、shell dispose 和 transition cancellation 通过同一完成路径安全到达终态，不遗留 capturing/opening/closing/minimizing/capturing-restore/restoring 状态、失效回调或不可交互窗口。
- [ ] 单个窗口从其最小化按钮中心对应的局部 UV 产生径向涟漪；波前连续裁切完整窗口曲面，GPU 粒子从同一捕获纹理采样原位置颜色/alpha，使正文、图标和面板可辨认地解体为细小点粒子。粒子只短距离漂移并带克制暖白/淡红能量及短暂色差，不拆分 DOM、不逐帧重捕获 HTML、不形成全屏爆炸或雾层。
- [ ] minimizing/restoring 阶段均不参与 projected input；最小化波纹完成前保留 DOM 与纹理，完成后才释放纹理并进入 `minimized`，恢复则在有效纹理捕获后才开始重组并在动画完成后恢复交互。
- [ ] 全部最小化为每个可见窗口使用其自身最小化按钮的确定性局部 UV，各窗口独立完成涟漪并安全释放纹理，不向右侧 Dock 压缩或沿跨 Surface 曲线路径移动。
- [ ] 恢复在首张有效纹理上传后从窗口中心 UV `{ x: 0.5, y: 0.5 }` 向外重组：采样粒子汇回对应窗口纹理位置，完整 flat-neutral 曲面随波前恢复；右侧 Dock 仅提供状态反馈，动画完成前窗口不可交互。
- [ ] 三层环境粒子仍读作离散光点：暖白为主、淡红近点为辅，核心清晰、光晕克制；同层粒子具有平滑、确定性的方向/速度/摆动/尺寸差异，不再像规则网格整体匀速移动，也不出现跳变、闪烁、青色污渍或雾化铺屏。reduced motion 仍冻结粒子而不改变层级。
- [ ] 指针移向任一视口边缘时，环境与 Source 的 parallax 在 X/Y 两轴向相反方向移动，中心目标仍为 `{ x: 0, y: 0 }`。
- [ ] 键盘可以进入 launcher、切换活动窗口并执行关键窗口命令，focus-visible 在捕获画面中可见。
- [ ] `spatial-lab.html` 与 `src/spatial/lab/` 的独立入口、控制器、探针表面和样式全部移除；产品引擎、Spatial 外壳与正式构建不再引用 lab 标记或保留过时对比页面。
- [ ] 新增窗口/注册表/模式解析纯逻辑具有默认尺寸比例、中心/四向边缘、逐窗 pose 正反投影、重叠命中、越界、参数化 route、reduced-motion 和回退用例。
- [ ] 完整 Spatial Vitest、platform-web Vue 类型检查、`npm run build:web` 和 `git diff --check` 通过。

## Out of Scope

- Library/Market、Workspace、Agent、System、Play 内容面板的正式 Spatial 呈现。
- Spatial splash、toast、confirm、通用 dialog/context-menu 和 Play host 全局表面；这些由 Play/Global 子任务接入统一 Source 系统。
- 在发布门禁开启前向正式用户提供 Spatial 选择。
- 移动端、窄屏、触摸优先、XR 控制器或 HTML-in-Canvas polyfill。
- 跨 reload 保存窗口会话，或在 RetroOS/Spatial 之间迁移打开窗口。
- 多个并行 Play runtime、后端、contracts、Dexie schema 或业务存储改动。
- 壁纸库、媒体上传、动态壁纸持久化和正式浏览器/Flag 引导文案。
- 磨砂玻璃、`backdrop-filter`、逐窗口背景采样、玻璃折射和任何形式的窗口/场景背景模糊；窗口继续使用当前清晰半透明 flat-neutral 材质。
- 此前到右侧 Dock 图标的曲线路径、网格压缩与反向展开方案已废弃；新方案不得把窗口整体移动或压缩进 Dock，也不从 Dock 图标发射恢复粒子。
- CPU 粒子模拟、DOM 节点逐片克隆/切割、逐帧 Source 重捕获、全屏粒子爆炸以及与环境粒子系统混用；窗口粒子是短时、逐 Source、纹理采样的独立 GPU pass。
- 完整 3D 世界、可导航摄像机、6DoF、深度物理、用户手动 Z 轴拖动、景深模糊和 XR 控制器；首版以可逆逐窗 2.5D pose 达到参考悬浮感。
