# Spatial 发布集成与功能对等

## Goal

将已完成的 Spatial Desktop 引擎、桌面外壳、全部平台应用和全局交互收敛为可在生产环境选择的完整 UI 模式，并以明确的环境要求、可靠回退、可访问性、性能与 RetroOS 回归证据关闭父任务的发布门。

## Background and Confirmed Facts

- Spatial 父任务的七个前置子任务已经完成；本任务是唯一剩余子任务，负责整体验收与发布，不重做各领域面板。
- `platformAppRegistry` 当前注册 13 个平台应用，全部已有独立 Spatial presentation：创意工坊、我的应用、资源管理器、编辑器、媒体查看器、工作室、桌面助手、应用属性、Play、控制面板、账号中心、公告中心和系统监视器。
- `SPATIAL_RELEASE_READY` 当前为 `true`；生产环境在满足 fine pointer 与视口条件时可以选择 Spatial，关闭该常量仍可立即回滚到 RetroOS。
- RetroOS 与 Spatial 共享 shell-neutral registry、领域 controller、持久化平台配置与业务数据；UI 模式切换完整保存配置、保留当前路由并重新加载，但不迁移窗口会话。
- Spatial 运行时已经检测 `layoutSubtree`、Canvas paint event、`requestPaint`、WebGL2、alpha/antialias framebuffer、`RGBA8`、`texElementImage2D` 和纹理尺寸。能力缺失或渲染器失败会回退 RetroOS，且不静默改写已保存偏好。
- 首版环境门槛已确定为 fine pointer 与至少 `1024×640` 视口；窄屏、手机或不支持实验性 HTML-in-Canvas/WebGL2 的环境继续使用 RetroOS。
- 最终发布验证（2026-08-07）：focused Spatial/release tests 258/258、controller/component/view tests 79/79 通过；`npm run build:web` 通过并产出 Spatial Desktop shell chunks；最终全仓测试 120 files、899 tests 全部通过。此前一次并行 schema cache 超时已隔离重跑通过，最终检查未复现。
- release gate、两套控制面板文案、required Spatial registry、pending presentation 清理与真实浏览器 product matrix 均已完成；公告发布仍不是 runtime dependency。

## Requirements

### R1. Registry 与功能范围完整

Spatial production registry 必须覆盖父任务首次发布范围内的全部 13 个平台应用，不得存在 `pending` presentation、RetroOS 面板嵌入或自动切回旧面板。启动器、路由/deep link、详情/编辑器/媒体多实例身份和 Play singleton 必须继续使用共享 registry 契约。

### R2. 清理本地开发占位路径

删除不再可达的 pending application presentation、对应样式和“业务面板仍在适配”文案。保留必要的 capability fallback 与 renderer failure fallback；不得把真实环境不支持误当作面板未完成。

### R3. 生产发布门

只有在本任务的自动化与浏览器验收完成后才把 `SPATIAL_RELEASE_READY` 打开。生产控制面板届时允许选择 Spatial；RetroOS 仍是默认值、完整回滚路径和不满足环境条件时的回退模式。

### R4. 环境要求与回退

Spatial 首版继续要求桌面 Chromium、fine pointer、至少 `1024×640` 视口、WebGL2 与实验性 HTML-in-Canvas API。运行时必须检测真实能力；缺少任一要求、动态加载失败、WebGL context/renderer 初始化失败时进入可操作的 RetroOS，并向用户说明原因，不进入半初始化桌面。

### R5. 发布引导

控制面板仅用简短文案说明 Spatial 需要桌面 Chromium、实验性 HTML-in-Canvas Flag 和鼠标/触控板，并说明不兼容时会回退 RetroOS；不得堆积浏览器配置教程或大段实验说明。版本、Flag 配置细节和已知限制由发布公告补充，底层能力检测与稳定回退不依赖公告。

### R6. 路由与关键动作对等

对 13 个应用及 splash、toast、confirm、dialog、context menu、assistant config 和 Play fullscreen 等全局宿主执行 route/action parity audit。发布任务只修复审计发现的集成缺口；新增领域功能或重新设计已归档面板不在范围内。

### R7. 可访问性与运动

键盘用户必须能够选择 UI 模式、进入应用、在窗口间切换并使用主要操作；Source DOM 保持语义与焦点权威，焦点可见。`prefers-reduced-motion` 下功能必须完整，持续装饰动效停止或冻结。

### R8. 视觉一致性

最终界面保持父任务已确定的 Spatial FUI 契约：独立局部曲面与 pose、至少三个可感知深度层、灰白无纹理窗口主体、左右顶部突出块、无窗口阴影/外发光/装饰边框、正文和表单可读；不得残留实验 lab、RetroOS chrome 或全屏 rubber-sheet 形变。

### R9. 性能与资源生命周期

多窗口同时打开、移动、最小化、恢复和关闭时不得出现持续无原因 texture upload、不可恢复输入或 WebGL 资源泄漏。静止场景必须回到事件驱动 idle；动态媒体、Source texture、renderer 与 context lifecycle 的既有计数器/清理断言必须保持通过。

### R10. RetroOS 与数据兼容

RetroOS 的应用、路由、窗口和全局交互回归必须保持通过。切换 UI 模式只改变 presentation 与窗口会话，不迁移、不复制、不删除业务数据，也不引入新的存储 schema 或后端契约。

## Acceptance Criteria

- [x] AC1: 13 个 registry 应用全部具有 Spatial component；生产代码不再包含 `pending` readiness、`SpatialPendingAppSurface` 或其 CSS，且 registry 完整性测试不再维护手写“当前已适配集合”。
- [x] AC2: `SPATIAL_RELEASE_READY` 为 `true`；production resolution 在 fine pointer 与足够视口下允许 Spatial，控制面板不再把它描述为本地实验或仍在适配。
- [x] AC3: production 与 development 的 UI-mode tests 覆盖 RetroOS 默认值、Spatial 选择、完整配置保存后 reload、当前 hash/route 保留，以及 release gate 打开后的行为。
- [x] AC4: coarse pointer、`<1024×640`、缺少 HTML-in-Canvas、缺少 WebGL2、异步 shell 加载失败和 renderer/context 失败均安全回退 RetroOS；反馈说明原因，保存偏好不被静默修改。
- [x] AC5: RetroOS 与 Spatial 两套控制面板都以一段简短文案展示桌面 Chromium、实验 Flag、fine pointer 与自动回退要求；详细配置说明留给公告，界面不堆积长篇教程，也不声称所有浏览器均可使用。
- [x] AC6: route/action parity 清单覆盖 13 个应用、详情/编辑器/媒体多实例、Play singleton、模式 reload 与全部平台级全局宿主；发现的集成缺口已修复并有相应测试或明确浏览器验收记录。
- [x] AC7: 键盘、焦点可见/顺序、语义 spot check 与 reduced-motion 验收通过；关闭或降低运动后仍可完成关键工作流。
- [x] AC8: 视觉审计确认独立曲面/pose、三层深度、既定窗口样式与内容可读性，且源码和产物无 Spatial lab、未完成占位或误嵌 RetroOS chrome。
- [x] AC9: 多窗口 dirty/idle、minimize/restore/close、dynamic media、context loss/restore 与资源 dispose 测试通过；idle 不持续上传 Source texture。
- [x] AC10: 支持的桌面 Chromium + Flag 可进入 Spatial 并完成核心窗口/输入流程；无 Flag、窄屏/手机条件和不支持的图形环境继续提供完整 RetroOS。
- [x] AC11: `npm run build:web`、`npm test` 和 `git diff --check` 通过；若全仓测试仅出现可复现的并行时限抖动，必须记录首轮结果并以隔离重跑证明非产品失败。
- [x] AC12: 父任务全部 acceptance criteria 经最终审查关闭后，才能归档本子任务与父任务。

## Out of Scope

- 新增父任务首次发布范围之外的应用或领域功能。
- 重写已完成的 Spatial 引擎、外壳或各业务面板。
- 为 Firefox、Safari、手机或无实验 API 的 Chromium 实现等价渲染引擎。
- 为 HTML-in-Canvas 增加 polyfill，或移除 RetroOS 回退。
- 保存、迁移或同步 RetroOS 与 Spatial 的窗口会话。
- 新增后端、共享 contract、存储 schema、远程图片代理或业务数据迁移。
- 将 Game Card iframe 内部前端改写为 Spatial FUI。
