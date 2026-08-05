# Spatial Play 与全局界面

## Goal

把 Play 启动器/宿主和平台级 Toast、Confirm、通用表单浮窗及桌面上下文交互迁移为独立 Spatial presentation，使这些界面进入 HTML-in-Canvas 的 Source、曲面合成与投影输入体系，同时保持 RetroOS、平台业务 API、Play runtime/bridge、现有开屏画面和游戏卡 iframe 前端语义不变。Spatial Play 的曲面窗口只承担可显示、可基本点击和进入游玩的兼容预览；主要游玩路径使用同一个真实 iframe 的浏览器原生全屏，不追求在曲面、视差和实验性 projected input 下完成完整游戏操作。

本轮首先交付并由用户验证 Spatial Confirm；其余全局表面和 Play 在同一子任务后续阶段完成。

## Background and Confirmed Facts

- 用户实测确认 Spatial Workspace Editor 已可用，但未保存关闭提示仍显示 RetroOS 平面确认框；截图显示该框由全局 `ConfirmHost` / `FloatingWindow` 提供，不属于 Editor presentation。
- `App.vue` 当前无条件把 `ToastHost`、`ConfirmHost` 和 form-mode `FloatingWindow` 挂在 Spatial Canvas 之上，因此 Spatial 模式仍会出现 RetroOS 平面 overlay。
- `useConfirm.ts` 是 confirm、prompt、choice 的 Promise/单实例行为权威；`useDialogForm.ts` 和 `useToast.ts` 分别是通用表单浮窗和提示状态权威。presentation 不得复制调用方业务逻辑。
- Spatial renderer 只发现 Canvas 直属、带 `data-spatial-source` 的元素；Source 动态增删后必须同步 texture/input ownership 并请求一次按需绘制。
- 已完成的 Spatial app 原语定义暖灰白实体表面、炭灰结构块、克制红色强调、无外框 focus、Source-local dialog/select 和有界 transition 规则。
- RetroOS Confirm 目前默认聚焦取消按钮，confirm 点击遮罩等价取消，prompt 支持 Enter 提交和校验，choice 返回字符串或 null；这些语义必须保留。
- RetroOS 桌面存在桌面/图标上下文菜单；Spatial launcher/status 尚无对应全局菜单。
- `PlayView.vue` 同时拥有前端挂载生命周期、runtime/bridge 注册、事件刷新、路由和 Retro 展示；`GameLauncherPanel.vue` 同时拥有存档 mutation 与 Retro 展示。Spatial Play 不得复制这些业务实现。
- 游戏卡 iframe 像素能否在目标 Flag Chromium 下稳定进入 HTML-in-Canvas 尚无产品证据；Play 阶段必须先探针，失败时回到设计，不能默认为普通平面 overlay。
- 用户于 2026-08-05 明确：曲面和视差对长时间游玩是负收益，HTML-in-Canvas 也仍具实验性；Spatial 窗口内只需证明 iframe 正常显示及基本点击，主游玩路径应与 RetroOS 一致，对实际 iframe 使用浏览器原生全屏。
- RetroOS 当前由窗口全屏按钮在 trusted activation 链中定位 Play iframe 并调用 Fullscreen API；“继续存档”需要异步选择存档并挂载 iframe，不能可靠把同一次用户激活保留到 iframe ready 后自动全屏。
- `play` 和 `game-launcher` 的 Spatial registry 仍为 pending，生产 Spatial release gate 保持关闭。

## Requirements

### 1. Global host ownership and compatibility

- RetroOS 继续使用现有 Splash、Toast、Confirm、FloatingWindow presentation；Spatial 模式不得挂载这些 Retro 全局视觉宿主。
- `confirm`、`prompt`、`confirmChoice`、`toast`、`openDialogForm` 的调用 API、返回值、并发拒绝、校验、测试和错误语义保持不变。
- Spatial 全局表面必须作为 Canvas 直属 Source 参与 renderer z-order、Source capture 和 projected input，不使用位于 GPU Canvas 上方的普通 DOM overlay。
- 新增/移除/改变全局 Source 时，Spatial shell 负责同步 Source 和按需 repaint；空闲时不得保留 rAF 或连续纹理上传。
- Browser-owned file/color/fullscreen surface 可保留原生；每个 escape 必须是显式、窄边界，不能演变成通用平面兼容层。

### 2. Spatial Confirm first slice

- 提供独立 Spatial Confirm presentation，覆盖 confirm、prompt、choice 三种状态，不导入 Retro `FloatingWindow` 或 `retro-*` class。
- 模态由一个全视口 Canvas Source 遮罩和一个独立浅弧面板 Source 组成：遮罩位于全部普通窗口之上并阻断后方命中，面板位于遮罩之上。
- 视觉使用现有 Spatial 暖灰白/炭灰/环境红 token 和控件原语，不使用 Retro 金色描边、棕色面板、完整窗口标题栏、外发光或焦点外框。
- 普通和 danger 状态可辨识；标题、换行消息、choice 长标签、prompt 默认值/placeholder/校验错误在默认及最小桌面视口可读且不溢出。
- confirm/choice 默认聚焦取消；prompt 打开时聚焦输入并全选默认值。Tab/Shift+Tab 保持在当前 modal，Escape 取消，关闭后恢复原调用焦点（仍连接时）。
- confirm/choice 不因默认 Enter 意外执行危险操作；prompt Enter 仅在校验通过时提交。
- 点击 confirm 遮罩等价取消；模态存在时 launcher、status、窗口、CodeMirror 和其他 Source 不得收到 pointer/wheel/contextmenu。
- 打开、关闭、校验错误、hover/focus 和按钮状态按需刷新对应 Source；有界 transition 尊重 reduced motion。

### 3. Remaining global surfaces

- Spatial Toast 复用 toast store，支持 info/success/error、堆叠、dismiss、aria-live、到期移除和 Source-local 有界进退场；modal 打开时保持可见但不可穿透 modal 操作。
- Spatial Dialog Form 复用 `useDialogForm`，支持 text/password/number/textarea、SpatialSelect、validate、async test、busy/result/error、取消与焦点恢复；遮罩外点击保持当前“阻断但不关闭”语义。
- form-mode `FloatingWindow` 的全局能力由 Spatial Dialog Form 覆盖；仅在 Retro route presentation 使用的 slot-mode FloatingWindow 不进入 Spatial shell，Spatial route 自有对话框继续留在所属窗口 Source。
- Spatial 桌面/launcher/status 的全局上下文菜单保留现有可用动作，并位于对应 shell Source 内；应用局部菜单仍由各应用子任务拥有。
- Spatial 只是显示主题，不新增独立 Splash Source、动画或 seen 状态。shell/capability 初始化前继续使用中立 boot gate；现有 Retro Nyan Splash 是唯一产品开屏画面且保持原有挂载边界与状态。

### 4. Shared Play controllers and Retro migration

- 抽取 per-instance Play host controller，统一 active card/save、phase、remote/packaged frontend mount、bridge target、reload/rebuild 事件、竞态取消、ESC return 和 cleanup。
- 抽取 save launcher controller，统一 create/rename/delete/import/export/cloud backup/sync、版本确认、busy/feedback 和 confirm/toast 调用。
- 先迁移 Retro `PlayView` / `GameLauncherPanel` 消费共享 controller，再实现独立 Spatial presentation；不得复制 storage/platform-host/bridge mutation 或事件订阅。
- 原生 file picker 保持 trusted activation；下载和 fullscreen 继续使用浏览器能力。

### 5. Spatial Play presentation

- 实现 Spatial save launcher 的卡片状态、存档列表、创建/重命名、继续、导入/导出、云备份/同步/删除及完整加载/空/错误反馈。
- 为所有现有 `fullscreenable` Spatial 窗口补齐与 Retro OS 同位的标题栏最大化/还原按钮；不新增自动全屏或 Play 内容区内的第二套全屏入口。
- 实现 Spatial Play host 的 resolving/loading/error/no-card/unplayable/rebuilding/ready 状态、返回启动器、路由入口和 fullscreen 控制。
- 曲面 Play Source 的验收边界是 remote/packaged iframe 能正常 capture、显示并支持基本 projected click；不要求在曲面、视差和 projected input 下完成键盘、IME、复杂拖拽或长时间游戏操作等完整游玩等价性。
- Spatial 最大化只改变窗口的有效视口几何；普通窗口几何必须保留用于还原，最大化期间禁用拖动/缩放，最小化、关闭和视口变化不得丢失或污染还原状态。
- Play 最大化按钮采用与 Retro OS 相同的特例：在点击的用户激活链内先对已经 ready 的同一个真实 iframe 调用浏览器 Fullscreen API；成功后由浏览器全屏承担主要游玩，失败或 iframe 尚未 ready 时回退为普通 Spatial 窗口最大化。任何路径都不得重建 iframe、重置 runtime/bridge 或切换存档。
- 浏览器 Escape 退出 iframe 全屏后，窗口最大化状态与按钮状态按 Retro OS 语义恢复；同一 iframe 返回曲面 Source 并保持状态。不得添加普通 DOM iframe 覆盖 Canvas 或隐式 Retro 回退。
- 目标 Flag Chromium 探针分别证明：曲面内 remote/packaged 显示与基本点击；原生全屏内真实 pointer/keyboard/focus、resize、reload 和退出恢复。若曲面连显示或基本点击都失败，停止 Play 阶段并回到设计。
- Play 窗口在失焦、遮挡、最小化、全屏进入/退出和恢复时保持 runtime 与 iframe 实例，只有返回 launcher、重载或关闭按现有契约释放。

### 6. Testing and release boundary

- 自动测试聚焦 global host mode ownership、Source lifecycle、modal isolation/focus、confirm state variants、toast/dialog behavior、Play controller races/cleanup、registry readiness 和 release gate。
- Flag Chromium 手测覆盖 Confirm 第一切片，以及后续 Toast/Dialog/全局上下文菜单；Play 矩阵区分曲面预览的 center/edge 显示与基本点击，以及原生全屏中的 pointer/keyboard/focus、resize、reload、Escape 退出和实例保持。
- 只有该子任务全部验收后才把 `game-launcher` / `play` 置为 Spatial ready；其他 pending app 和生产 release gate 不变。

## Out of Scope

- 修改 `useConfirm` / `useToast` / `useDialogForm` 的产品级调用协议，增加持久化队列或建立第二套业务状态。
- 重写游戏卡 iframe 前端、Play bridge/runtime、存档格式、云备份协议、storage schema 或 platform-host contract。
- 把 RetroOS 组件嵌入 Spatial、把普通 DOM modal/iframe 长期覆盖 Canvas，或因单个全局 surface 自动切回 RetroOS。
- 自动进入全屏、在 Play 内容区增加独立“进入全屏游玩”按钮，或要求曲面 projected input 达到完整游戏操作等价性。
- 为未标记 `fullscreenable` 的窗口强行显示最大化按钮。
- 为浏览器原生 file/color/fullscreen UI 伪造 Spatial 替代品。
- 启用生产 Spatial release gate；该动作归 release-integration 子任务。

## Acceptance Criteria

- [x] AC-01：Retro 模式的 Splash/Toast/Confirm/FloatingWindow 行为和视觉无回归；Spatial 模式不挂载其 Retro 全局视觉宿主。
- [x] AC-02：Spatial Confirm 是 Canvas 直属 Source，不是 GPU Canvas 上方的普通 DOM overlay，且使用既有 Spatial token/原语。
- [x] AC-03：confirm、prompt、choice 的 Promise 结果、默认文案、危险态、校验和并发拒绝语义不变。
- [x] AC-04：confirm/choice 默认取消焦点，prompt 输入默认聚焦；Tab trap、Escape、遮罩取消与关闭后焦点恢复正确。
- [x] AC-05：modal 打开期间后方窗口、Dock、CodeMirror、wheel 和 contextmenu 均不可命中；取消后恢复正常。
- [x] AC-06：确认面板在默认/最小桌面尺寸及中心/可见曲面边缘可读、可点击，无 Retro chrome、外发光或焦点外框。
- [x] AC-07：Confirm Source 动态创建/销毁和每次状态变更均正确 capture；关闭后无纹理、输入、动画或 frame reason 泄漏。
- [x] AC-08：Spatial Toast、Dialog Form 和全局上下文菜单完成 Source-local 适配并保留现有业务语义；Spatial 不新增主题专属开屏画面。
- [x] AC-09：Retro Play 和 Spatial Play 消费同一 Play/save controllers，平台 mutation、bridge、事件和竞态逻辑没有复制。
- [x] AC-10：Spatial save launcher 的创建、重命名、继续、导入/导出、云备份/同步和删除流程可用。
- [x] AC-11：所有 `fullscreenable` Spatial 窗口有可还原的标题栏最大化按钮；Play 对同一 ready iframe 优先请求浏览器原生全屏，失败时仅回退 Spatial 窗口最大化，无自动全屏或内容区第二入口。
- [x] AC-12：目标浏览器分别有曲面 capture/基本点击和最大化按钮触发的原生全屏完整输入/退出恢复证据；失败时无平面 overlay 或隐式 Retro fallback。
- [x] AC-13：focus/minimize/restore/occlusion 及全屏进入/退出不重置 global/Play 状态或 iframe 实例；close/unmount 精确释放 owned resources。
- [x] AC-14：`game-launcher` 与 `play` 最终可置为 ready，其他 readiness 和生产 release gate 不变。
- [x] AC-15：聚焦测试、Spatial 回归、Vue type-check、`npm run build:web` 和 `git diff --check` 全部通过。
