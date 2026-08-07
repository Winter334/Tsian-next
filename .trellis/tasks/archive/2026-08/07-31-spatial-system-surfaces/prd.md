# Spatial 系统界面

## Goal

为 Spatial Desktop 提供独立的控制面板、账号中心、公告中心与系统监视器，使首发范围内的系统级功能不再落入 pending 占位页，同时复用现有配置、认证、公告与诊断能力，保持 RetroOS 行为和数据兼容。

## Background and Confirmed Facts

- 平台注册表已经为 `settings`、`account`、`announcements`、`debug` 定义稳定的 route、singleton identity、窗口尺寸和 RetroOS presentation，但四者尚未注册 Spatial component，因此仍为 `pending`（`apps/platform-web/src/platform-apps.ts:218`、`:224`、`:230`、`:236`）。
- 控制面板当前包含 AI 提供商/预设/模型管理、模型连通性与 native Tool calling 测试、语义检索、云备份、运行参数和桌面外观；配置草稿会 800ms 自动保存，语义检索、云备份、运行参数与 UI 模式切换各自遵守现有完整配置写入语义（`apps/platform-web/src/views/SettingsView.vue:34`、`:313`、`:321`、`:339`、`:348`、`:719`）。
- 账号状态和登录/退出能力已集中在 `useAuth`；Spatial 不需要复制认证状态机。当前账号页展示 Discord 登录/绑定状态及若干尚未开放的凭证槽位（`apps/platform-web/src/composables/useAuth.ts:9`、`apps/platform-web/src/views/AccountView.vue:42`）。
- 公告加载、60 秒轮询、已读集合和未读计数已集中在 `useAnnouncements`；RetroOS 状态区已经显示未读数，而 Spatial 状态区尚未接入公告入口或未读提示（`apps/platform-web/src/composables/useAnnouncements.ts:18`、`apps/platform-web/src/components/desktop/DesktopShell.vue:99`、`apps/platform-web/src/spatial/shell/SpatialStatusSurface.vue:42`）。
- 系统监视器当前包含总览、统一 Trace 和检查点恢复三个分区；Trace 支持过滤、分页、记录详情、结构化 JSON、复制和诊断包导出，并订阅诊断记录变化（`apps/platform-web/src/views/DebugView.vue:186`、`:311`、`:325`、`:354`；`apps/platform-web/src/components/debug/DiagnosticTracePanel.vue:324`、`:402`、`:425`、`:596`、`:626`）。
- 现有 Spatial 应用采用独立 presentation + 共享 controller/composable 的模式，并复用 `SpatialActionButton`、`SpatialSelect`、`spatial-apps.css` 和 Spatial 全局 confirm/dialog/toast surface；本任务不得嵌入 RetroOS route view 或恢复一套业务实现。

## Requirements

### R1. Spatial 控制面板完整覆盖现有配置能力

- 提供 Spatial 原生的设置导航和内容布局，覆盖 AI 提供商、模型、语义检索、云备份、运行参数、桌面外观六类现有功能。
- AI 提供商区域采用渐进披露：先选择提供商类型，再浏览预设卡片；进入某个预设后只显示其模型列表；模型参数仅在显式编辑时出现。不得在同一滚动页同时展开所有提供商、预设、模型和参数。
- 支持提供商预设的新增、编辑、连通性测试、删除、设为默认和自动保存；支持模型新增、删除、排序、启停、fallback strategy、参数编辑、Chat ping 与 native Tool calling probe。
- 保留 secret 字段、provider kind、base URL 归一化、至少保留一个模型等现有验证与错误反馈。
- 语义检索保存必须同时更新 provider embedding config 与 RAG 配置；云备份和运行参数继续使用完整 platform config merge/write，不得以局部写入覆盖其他段。
- 桌面外观切换继续先保存完整配置、保留当前 route，再执行 full reload；不得迁移窗口会话。
- 云备份继续反映登录状态、用量/配额、备份列表和删除操作。

### R2. Spatial 账号中心保持认证语义

- 展示初始化中、访客、已登录、认证错误和退出中状态。
- 保留 Discord 登录、绑定状态、头像/显示名/handle、退出登录，以及尚未开放凭证方式的只读说明。
- 头像使用 Spatial 已有安全媒体解析/回退能力；跨源、失效或空头像不得污染 Source capture，也不得留下破损图片。
- 认证状态必须直接复用 `useAuth`，不得创建 Spatial 专用登录缓存或状态机。

### R3. Spatial 公告中心与全局未读状态联动

- 展示公告列表、时间、已读/未读状态、Markdown 正文、加载/空/错误状态和手动刷新。
- 首次选中与显式选中继续调用共享 `markRead`，并即时更新全局未读计数。
- 在 Spatial 状态区提供公告入口与未读计数/指示；入口能打开或聚焦公告 singleton window。
- 继续复用共享轮询与 localStorage 已读契约，不创建第二套定时器或已读存储格式。

### R4. Spatial 系统监视器达到诊断功能对等

- 提供总览、Trace、恢复三个分区，保留 token、cache、provider/model、请求状态、前端错误和诊断存储健康信息。
- Trace 保留时间、状态、provider、model、全文过滤，30 条分页，记录选择与关联详情，结构化 JSON 展示、原始记录复制和诊断包导出。
- 大型 JSON/请求响应必须在可滚动、可复制且不破坏 Source capture 的结构中展示；不得把完整诊断数据复制进新的 UI 状态或持久化层。
- 检查点恢复继续经过危险操作确认，调用既有 bridge action，并在成功后刷新总览、Trace 与恢复列表。
- 保留诊断记录与 turn-ready 订阅、去抖刷新、卸载清理和 object URL 回收。

### R5. 共享控制器与 RetroOS 回归边界

- 从 `SettingsView.vue`、`DebugView.vue` 和 `DiagnosticTracePanel.vue` 抽取真正 view-neutral 的配置/诊断 orchestration；RetroOS 与 Spatial presentation 消费同一状态和 mutation API。
- `useAuth`、`useAnnouncements`、platform config、diagnostic storage/bridge 和 checkpoint action 保持权威来源；presentation 不直接复制存储、网络或订阅逻辑。
- RetroOS 的路由、业务操作、自动保存、错误反馈和现有视觉行为不得因抽取而改变。
- 不新增 contracts 或持久化迁移，除非实现中发现现有公开类型不足且经过单独评审。

### R6. Spatial presentation 与交互约束

- 四个应用必须是 `spatial/apps/` 下的独立组件，使用 Spatial tokens/primitives，不挂载 RetroOS view 或依赖 `retro-*` 样式。
- 表单、select、range、password、滚动、复制、dialog、confirm 与下载必须在 projected input 下可用，并保留键盘焦点、label 和状态语义。
- 窗口失焦、侧置、遮挡或最小化不得重置草稿、筛选、选中记录、公告选择或进行中的保存/刷新；关闭后按既有组件生命周期清理订阅和临时 URL。
- 所有四项通过功能验收后才能在平台注册表中标记 Spatial `ready`；本任务仍不得开启 production release gate。

## Acceptance Criteria

- [ ] AC1: Spatial 中打开 `/settings` 不再显示 pending 占位页，六类设置均可访问，提供商/模型 CRUD、排序、启停、默认选择、fallback、参数编辑、连通性测试和自动保存与 RetroOS 结果一致。
- [ ] AC2: Spatial 语义检索、云备份、运行参数和 UI 模式切换均保持完整配置 merge/write；切换模式保存后 full reload，当前 route 保留且窗口会话不迁移。
- [ ] AC3: Spatial 账号中心覆盖访客、初始化、登录、已绑定、错误、退出中状态；Discord 登录/退出可用，失效或跨源头像显示设计好的 fallback。
- [ ] AC4: Spatial 公告列表可刷新、选择、阅读 Markdown 正文并标记已读；Spatial 状态区未读数即时变化，入口打开/聚焦同一个公告窗口。
- [ ] AC5: Spatial 系统监视器总览统计、Trace 过滤/分页/详情/JSON/复制/导出和检查点恢复可完成，诊断记录变更后按现有订阅语义刷新。
- [ ] AC6: 大型诊断 JSON、长公告和密集设置表单在默认窗口和最小支持尺寸下可滚动、可读、可键盘操作，projected pointer/scroll/select/range/password/file-download 行为通过浏览器检查。
- [ ] AC7: 失焦、侧置、遮挡、最小化/恢复不会丢失控制面板草稿、公告/Trace 选择和筛选，也不会重复订阅或中断安全的后台刷新。
- [ ] AC8: RetroOS 四个界面的现有功能和样式保持回归通过；配置、认证、公告和诊断业务逻辑没有形成 Spatial 分叉。
- [x] AC9: `settings`、`account`、`announcements`、`debug` 注册为 Spatial `ready`，且没有 RetroOS 嵌入或 production release gate 提前开启。
- [x] AC10: 相关 controller/component tests、diagnostics/storage tests、`npm run build:web`、必要时 `npm run build:contracts` 与 `git diff --check` 通过。

## Out of Scope

- 新增认证提供商、账号密码/邮箱/Magic Link 后端能力。
- 改造公告 API、Markdown 格式、轮询周期或已读存储 schema。
- 改变诊断记录 schema、保留策略、脱敏策略、bundle 格式或 checkpoint 语义。
- 新增设置类别、重设计 AI 配置数据模型，或迁移已有 platform config。
- 开启 Spatial production release gate、执行完整浏览器发布矩阵或移除 pending 基础设施；这些由 `spatial-release-integration` 负责。

## Key Decisions

- **D1 — Spatial 设置导航**：采用常驻左侧分区导航栏，右侧显示当前设置内容；provider 的模型配置作为所选 provider 下的次级层级。RetroOS 继续保留既有“卡片 Hub → 子页”导航，两套 presentation 共享配置 controller，但不强行共享页面结构。
- **D2 — AI 提供商渐进披露**：Spatial 保留常驻设置分区栏，但 AI 提供商内部还原 RetroOS 的任务顺序：提供商类型与预设卡片 → 所选预设的模型列表 → 所选模型的参数子页。参数编辑使用右侧第三级子页而非全局模态 Source，以保证长表单在默认和最小窗口下可滚动、可读。
- **D3 — 可选参数与解释**：Spatial 可空滑块使用独立的最左“不发送”档，下一档才映射 API 最小值；参数说明继续复用 RetroOS 的共享解释，但由 Spatial 原生 Tip 按钮呈现，避免为了说明字段重新堆叠长段正文。Tip 保持在当前 Source 内，并按最近的滚动/Source 边界校正位置和宽度，不能仅依赖层级绕过 `overflow` 裁剪。
