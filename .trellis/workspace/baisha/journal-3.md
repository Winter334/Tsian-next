# Journal - baisha (Part 3)

> Continuation from `journal-2.md` (archived at ~2000 lines)
> Started: 2026-07-01

---



## Session 107: Task 超时从总时长改为无响应超时

**Date**: 2026-07-01
**Task**: Task 超时从总时长改为无响应超时
**Package**: platform-web
**Branch**: `feat/workspace-context-cache-split`

### Summary

超时语义从'turn 开始累计总时长 5 分钟'改为'距离上一次活动超过 10 分钟无进展才超时'。DEFAULT_TASK_TIMEOUT_MS(300s)→DEFAULT_TASK_INACTIVITY_TIMEOUT_MS(600s)。WorkspaceToolLoopOptions: taskStartedAt→lastActivityAt, taskTimeoutMs→inactivityTimeoutMs。runtime 每轮结束更新 lastActivityAt。assistant-chat.ts 的 setTimeout 改为可重置计时器,onDelta/onRoundEnd/onTool 回调里 reset。TaskTimeoutError 消息改为'任务无响应超时'。invokeAgent 路径去掉无效的 taskStartedAt 字段。spec 更新 Turn Token Budget scenario。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `de84e2e` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 108: 统一三处脚本 runner 注入（createBrowserScriptRunners 工厂）

**Date**: 2026-07-01
**Task**: 统一三处脚本 runner 注入（createBrowserScriptRunners 工厂）
**Package**: platform-web
**Branch**: `feat/workspace-context-cache-split`

### Summary

评估三处 capabilities 的重复程度：真正重复的只有 runBrowserScript + runTestSkillScript 创建逻辑（约 30 行），callModel/workspaceMutations/callbacks 都有真实业务差异。抽 createBrowserScriptRunners 工厂函数统一脚本 runner 注入，三处用 ...spread。不统一有差异的部分。spec 13 步清单更新 step 8b 反映工厂模式。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `8e7449f` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 109: Step 3 角色设定向导 + 脚本/系统监视器修复

**Date**: 2026-07-01
**Task**: Step 3 角色设定向导 + 脚本/系统监视器修复
**Package**: platform-web
**Branch**: `feat/workspace-context-cache-split`

### Summary

(Add summary)

### Main Changes

## 会话内容

本次会话涵盖三个方向的修复和一个新功能开发：

### 1. 脚本系统修复（3 个 bug）

- **Worker TS 断言残留**：`BROWSER_SCRIPT_WORKER_SOURCE` 的 config Proxy 块里有 3 处 `as` 类型断言（line 160/162/168），浏览器 Worker 不认 TS 语法 → 所有脚本 SyntaxError。修复：移除 `as` 断言。补充 spec "Browser Script Worker Source Is Pure JavaScript" 场景。
- **test_skill_script exposedOperations 空**：`createTestSkillScriptRunner` 调 `runBrowserScript` 时没传 `executorContext`，Worker 内 `tsian.workspace.*` 全部 `WORKSPACE_OPERATION_NOT_EXPOSED`。修复：类型加第二参数 `RuntimeControlledExecutorContext`，dispatch 传 `{ agentContext, exposedWorkspaceOperations }`。
- **read_opening_slice 标题重复**：章节文件首行是纯文本标题（无 `#`），`cleanText` 不移除，脚本手动加 `#` 标题 → 重复。修复：拼接前检测 `used` 首行是否等于 `chapter.title`，是则剥离。

### 2. 系统监视器清理

- 移除"最近问题"区段（从全量诊断+AI debug 积累错误，永久不清理）。
- `overallStatus` 只看最新回合诊断，不积累历史。
- 清理死代码 -97 行。

### 3. 默认前端 UI 修复

- **gsap.from 陷阱**：选项卡不可见，根因是 `gsap.from()` 读"当前值"作终点，组件重渲染打断 tween → 元素停在 opacity:0。修复：全部改 `gsap.fromTo`（3 个组件）。
- **角色卡透明度**：背景对比度调整（不是根因，但改善了可读性）。

### 4. Step 3 角色设定向导（新功能）

走完整 Trellis 流程：brainstorm → PRD → design → implement → 实现。

**3 个新组件**：
- `CanonCharacterSelect`：原著角色竖向列表，选中态标记字点燃+粒子上升+点燃弹跳
- `OriginalCharacterForm`：原创角色表单，必填名字+简介，可选字段 grid 折叠
- `CharacterConfirmed`：确认屏，单卡 scale 进场+一次性脉冲环

**useSetupState 扩展**：
- 3 个新状态：characterBranch / selectedCharacter / characterSetupStatus
- 5 个新操作：setCharacterBranch / backToBranchChoice / confirmCanonCharacter / confirmOriginalCharacter / resetCharacterSetup
- 重载恢复：initialize() 读 runtime.json player.character
- localId 生成：original- 前缀 + 角色名，冲突加序号

**UI 细节修复（3 轮迭代）**：
- 角色卡简介：scrollWidth>clientWidth 检测截断 → 展开链接（不破坏行高一致性）
- 折叠动画：max-height → grid-template-rows 0fr→1fr + visibility transition-delay 防闪烁
- 选中动效加强：标记字点燃弹跳 + 内/外光晕加深 + 琥珀渐变底色 + 角色名 text-shadow

### Git Commits

| Hash | Message |
|------|---------|
| 843f8fc | fix(browser-script): Worker 源码残留 TS 断言导致全脚本 SyntaxError |
| ac6fdc0 | fix(test-skill-script): 透传 executorContext 修复 WORKSPACE_OPERATION_NOT_EXPOSED |
| 6141d91 | fix(opening-script): read_opening_slice 章节标题重复 |
| c971ff3 | refactor(debug-view): 移除最近问题区段,状态徽章只看最新回合 |
| 930b8ca | fix(play-frontend-dev): 设定阶段选项卡可见度过低 |
| ae0e154 | fix(play-frontend-dev): gsap.from 陷阱导致选项卡不可见 |
| 87a9f59 | feat(play-frontend-dev): Step 3 角色设定向导 |
| 004a9ec | fix(play-frontend-dev): Step3 角色卡简介截断 + 折叠动画生硬 |
| 731c3c2 | fix(play-frontend-dev): 角色卡简介展开 + 折叠闪烁 |
| 7b62cf2 | fix(canon-select): 用 CSS 截断检测替代固定字符数判定展开 |
| 250e264 | fix(canon-select): 展开简介重复 + 加强选中动效 |
| 083a379 | chore(task): record planning artifacts |


### Git Commits

| Hash | Message |
|------|---------|
| `250e264` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 110: Add OpenAI Responses provider

**Date**: 2026-07-02
**Task**: Add OpenAI Responses provider
**Package**: platform-web
**Branch**: `feat/workspace-context-cache-split`

### Summary

Implemented and archived OpenAI Responses provider support: added openai-responses provider kind, /responses adapter for text/native streaming and non-streaming paths, Responses tool-call mapping, usage/error parsing, debug contract update, and documented local stateless replay. Builds passed and user verified primary streaming native plus non-streaming text modes.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `58f8e5f` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 111: Model config UI redesign

**Date**: 2026-07-02
**Task**: Model config UI redesign
**Package**: platform-web
**Branch**: `feat/workspace-context-cache-split`

### Summary

Redesigned browser AI model configuration around provider-aware parameter branches, updated runtime adapter mappings and Settings add/edit/test UI, and validated with npm run build:web.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `b6f78ee` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 112: novel-airp understanding loader: random SVG magic circle

**Date**: 2026-07-02
**Task**: novel-airp understanding loader: random SVG magic circle
**Package**: platform-web
**Branch**: `feat/workspace-context-cache-split`

### Summary

用随机生成的 SVG 魔法阵替换 UnderstandingRunning 的源文鳞阵 GSAP 圆点网格。新增 magicCircleGenerator.ts（seeded mulberry32 PRNG + 极坐标几何 + n-gram/starburst/弧线星阵/符文 textPath 环/符号节点/核心 glyph），UnderstandingRunning.vue 重写为 CSS 驱动多层低频反向旋转 + 显现动画，保留四段阶段文案与底部提示。移除 three 依赖、GSAP scales 代码、agentHeartbeat 消费。build 通过，tsc 基线错误与本任务无关。spec 不更新（play-frontend-dev 无 spec 层，模式单点未复用）。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `7b8d84d` | (see git log) |
| `7a2ebf8` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 113: novel-airp play setup dialog Step 4 — archive (code landed prior sessions)

**Date**: 2026-07-02
**Task**: novel-airp play setup dialog Step 4 — archive (code landed prior sessions)
**Package**: platform-web
**Branch**: `feat/workspace-context-cache-split`

### Summary

归档已完成但未收尾的 Step 4 游玩设定对话任务。代码在先前 7 个 commit 中已全部落地并经用户端到端验证：后端 play-setup-dialog skill + commit_play_setup 脚本 + setup-summary/opening-narrative 种子 + mode.json 移除（workspace-templates.ts）；前端 PlaySetupDialog.vue + SetupComposer.vue + useSetupState play-setup 状态机/心跳/重载恢复/路由 + SetupWizard 接入 + useTsian openingNarrative ref/loader。两包 build 通过。spec 不更新（知识沉淀于任务 PRD/design，无项目级通用约定）。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `3317ce9` | (see git log) |
| `6b02113` | (see git log) |
| `89152ac` | (see git log) |
| `318b6ee` | (see git log) |
| `7a1d5ce` | (see git log) |
| `d3c3365` | (see git log) |
| `bd7e210` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 114: novel-airp opening confirm Step 5

**Date**: 2026-07-02
**Task**: novel-airp opening confirm Step 5
**Package**: platform-web
**Branch**: `feat/workspace-context-cache-split`

### Summary

实现开局向导 Step 5 开局确认：新增 OpeningConfirm 设定卡片（lachisa 质感背景、外部图片占位、随机 SVG 魔法阵装饰层，fixed 全屏区域池 + best-candidate 分散、淡入淡出生命周期、Step2 式内部多层旋转），useSetupState 接通 opening-confirm 路由/summary/重载恢复，SetupWizard emit enterPlay，App.vue enterPlay 使用 BurningReveal scroll 过渡并延后到 @shown 后切 mode 避免露帧/黑闪，StoryView 特殊渲染 openingNarrative 为第一条消息并修正空状态。用户端到端测试通过；build 通过，改动文件 tsc 无错误；spec 不更新（play-frontend-dev 无 code-spec 层，gotcha 已沉淀到任务 design）。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `a144b90` | (see git log) |
| `e94c8af` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 115: Account system Discord auth

**Date**: 2026-07-02
**Task**: Account system Discord auth
**Package**: platform-web
**Branch**: `feat/workspace-context-cache-split`

### Summary

Implemented the account-system task: planned and built the Go platform-server auth backend with SQLite users/auth_identities/sessions, Discord OAuth and mock-login, platform-web auth API client/composable/taskbar UI, shared User contract, docs, tests, and validation. Preserved unrelated play-frontend-dev useTsian.ts changes for the other session.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `80c0645` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 116: Account Center Window — 操作员身份终端桌面窗口

**Date**: 2026-07-02
**Task**: Account Center Window — 操作员身份终端桌面窗口
**Package**: platform-web
**Branch**: `feat/workspace-context-cache-split`

### Summary

把 taskbar 直接 Discord OAuth 按钮升级为 RetroOS 风格的'账号中心'桌面窗口（AccountView.vue）。新增 /account 路由 + account 桌面应用注册（appId/icon/async component）；AccountView 以'操作员身份终端'概念落地：状态条（NO OPERATOR SIGNED IN 磷光呼吸 / OPERATOR ONLINE）+ 身份区（头像凹斜面框 + displayName + OP-ID handle）+ 凭证槽位纵列（Discord 可点/已绑定 ✓，账密/邮箱/Magic Link disabled 即将开放）+ 退出登录。taskbar 账号按钮改为打开账号中心窗口，保留为状态指示器。复用 useAuth/authApi，不动后端，build:web 通过。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `5674b44` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 117: App Market MVP — 卡包上传/下载/搜索/安装 + 创意工坊任务创建

**Date**: 2026-07-03
**Task**: App Market MVP — 卡包上传/下载/搜索/安装 + 创意工坊任务创建
**Package**: platform-web
**Branch**: `feat/workspace-context-cache-split`

### Summary

完成应用市场 MVP：Go 后端新增 internal/market 包（domain + SQLite repo + HTTP handler），FileSystemBlobStore 实现 BlobStore 接口隔离文件存储，market_packages 表（resource_type 预留、card_author/card_version 列），4 个 API 端点（列表/详情/上传/下载 + 封面端点），50MB+manifest 校验，封面从 zip 提取存 BlobStore。前端 marketApi + AppMarketView 状态机（list/detail/upload），搜索/排序/封面展示/下载安装+card_id 冲突提示。GameCardDetailView 新增作者/版本编辑。contracts 新增 MarketPackage 类型。集成测试覆盖上传/列表/详情/下载/搜索+鉴权。修复：manifest 两层结构校验（package manifest 包裹 card manifest）、内置卡过滤、封面提取、作者/版本展示。创建创意工坊任务（07-03-workshop-multi-resource）记录多资源类型+tag+差异化安装愿景。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `8024077` | (see git log) |
| `60d3a85` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 118: 创意工坊多资源类型实现

**Date**: 2026-07-03
**Task**: 创意工坊多资源类型实现
**Package**: platform-web
**Branch**: `feat/workspace-context-cache-split`

### Summary

实现创意工坊多资源类型分享与安装：扩展 market contract/backend schema/API/tests，新增 Agent/Skill resource-package 导出安装、tag 筛选、市场 UI 拆分、当前卡安装目标限制、Studio Skill 删除入口与助手替换语义修正。验证通过 build:contracts、build:web、platform-server go test。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `6249b78` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 119: Optimize workshop cover traffic

**Date**: 2026-07-03
**Task**: Optimize workshop cover traffic
**Branch**: `feat/workspace-context-cache-split`

### Summary

Implemented WebP cover derivation and zip normalization for workshop game cards, added cover thumbnails, counts endpoint, cursor pagination, frontend load-more UI, lazy image loading, tests, and Trellis task planning artifacts.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `30cb4b1` | (see git log) |
| `a12e9b5` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 120: Tsian Boot BSOD Nyan splash

**Date**: 2026-07-03
**Task**: Tsian Boot BSOD Nyan splash
**Branch**: `feat/workspace-context-cache-split`

### Summary

Replaced the platform-web splash with a first-run Tsian logo gate, boot loader, parody BSOD, and Nyan Cat intro; added versioned same-device skip, public media assets, and validated with npm run build:web.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `e48c5c8` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 121: Workshop content management

**Date**: 2026-07-03
**Task**: Workshop content management
**Branch**: `feat/workspace-context-cache-split`

### Summary

Completed creative workshop owner content management: mine scope, metadata edit, package replacement, hard delete, owner checks, updatedAt contracts, API/client routes, and integration tests; validated contracts, web build, and platform-server tests.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `13486c3` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 122: 游戏前端长历史消息窗口化

**Date**: 2026-07-03
**Task**: 游戏前端长历史消息窗口化
**Branch**: `feat/play-frontend-message-windowing`

### Summary

为游戏前端 StoryView 增加按 turn 的渐进窗口渲染，默认只渲染最近历史，向上滚动自动展开更早回合，并加入低调回到最近内容浮标；归档对应 Trellis 任务。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `aae2572` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 123: 修复 play frontend 类型检查

**Date**: 2026-07-03
**Task**: 修复 play frontend 类型检查
**Branch**: `feat/play-frontend-message-windowing`

### Summary

修复 play-frontend-dev setup 流程中的 vue-tsc 错误：让展示型数据接受 readonly 数组、按 WorkspaceEntry[] 使用 workspace.list、收窄消息索引访问，并把原创角色提交交给表单自身处理；vue-tsc 与 play frontend build 均通过。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `86cead3` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 124: 默认 AIRP Agent 模板重写

**Date**: 2026-07-04
**Task**: 默认 AIRP Agent 模板重写
**Branch**: `feat/airp-agent-invocation-entrypoints`

### Summary

重写默认 AIRP 后台剧组模板：默认 playerTurn 入口改为 storyteller，默认 Agent 阵容切换为说书人/资料员/场记/世界架构师/导演，新增 Agent-local Skill 占位与 mode.json，并更新相关 specs/docs；验证 npm run build:web、task validate、git diff --check 通过。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `95e392c` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 125: 回合后场记编排 + card.entrypoints bridge API

**Date**: 2026-07-04
**Task**: 回合后场记编排 + card.entrypoints bridge API
**Branch**: `master`

### Summary

实现默认 novel 前端回合后场记编排：正文落定后 invokeAgent 发起维护，SyncToast 卡片扫光三态。契约层增 GameCardRuntimeEntrypoints.postTurnMaintenance + CardBridge；bridge 暴露 tsian.card.entrypoints()；前端从配置读 agent id，Toast 文案不硬编码 agent 名。审查父任务 3 个归档子任务，发现 workspace-with-checkpoint 平台层缺口悬空，建子任务 07-04-invoke-agent-workspace-with-checkpoint 认领。trellis-check 修复 useSyncAfterTurn 重复代码（抽取 runSyncInvocation），spec 追加前端不硬编码 agent 名约定。端到端验证暂缓（向导阶段改动未落地）。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `17b5731` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 126: 07-04-runtime-summary-injection: 发送前多消息 runtime 上下文注入

**Date**: 2026-07-05
**Task**: 07-04-runtime-summary-injection: 发送前多消息 runtime 上下文注入
**Branch**: `feat/play-frontend-status-bar`

### Summary

为 play-frontend 引入发送前多消息 runtime 上下文注入：新增 lib/context-injection.ts 纯函数把 runtime.json/当前 scene/protagonist 编译为多条 storyteller-friendly injection message；useTsian.send 接入并新增 lastSendError；StoryView 输入区上方渲染错误 banner。阻断策略：ref 存在但 load 失败或 runtime 未就绪 → 阻断发送；ref 缺省则跳过该 block；runtime.extensions.frontendInjection.enabled=false short-circuit 不注入。hook-guidelines 补 composable init cycle 与 pre-send 注入模式两个 pattern。build 通过。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `6c25684` | (see git log) |
| `712debb` | (see git log) |
| `9fb1acc` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 127: 07-05-status-bar-character-field-pinning: 左侧状态栏角色字段钉选

**Date**: 2026-07-05
**Task**: 07-05-status-bar-character-field-pinning: 左侧状态栏角色字段钉选
**Branch**: `feat/play-frontend-status-bar`

### Summary

在 play-frontend 引入左侧状态栏钉选机制：新增 lib/pin-types.ts (PinTarget + readPinValue 6 kinds + missing)、composables/useStatusBarPins.ts (localStorage 模块单例)、共享 PinButton 组件；在角色卡 6 处（StatusChips/IdentityFacts/AttributeCard/GaugeBar/OverviewPane 外貌/GoalsBlock）集成 hover pin；状态栏新增 StatusBarPinned 分区并插入到 Status 之后/Metrics 之前，空钉选整段隐藏（保持 MVP 行为）。存储只保留字段引用，渲染时从主角 entity 重读；主角切换/回合刷新通过 :key remount 触发。build 通过。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `8bda07d` | (see git log) |
| `c413ccb` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 128: 07-05 Agent Tool 机制：类 MCP 工具发现与卡定制层

**Date**: 2026-07-06
**Task**: 07-05 Agent Tool 机制：类 MCP 工具发现与卡定制层
**Branch**: `feat/play-frontend-status-bar`

### Summary

落地 Tool 层（parallel to Skill）：contracts 加 ToolRegistryEntry / RegistryDiagnostic / AgentToolConfig / AgentContextEntry.toolIndex 与 enabled/disabledTools；registry.ts 加 tool 路径解析、parseToolManifest、buildToolRegistry、filterToolsForAgent，reserved-name 拒绝 + same-scope 冲突 skip + agent-local shadow shared 全部走诊断；context.ts 组装 toolIndex；buildEnabledToolSchemas 追加 userTools 注入原生 function schema；workspace-tools.ts 加 executeUserTool 与 dispatch（tsian.config 恒 {}）；browser-skill-script-executor 泛化 owner root（Skill + Tool 共用），Worker SDK 加 tsian.lib.random.nextInt/dice（advantage/disadvantage 仅 count===1 生效）；Studio snapshot 带 tools + toolDiagnostics，新增自定义 Tools 与诊断两节；workspace-templates 加 tools/README.md + tools/roll_dice（数值 modifier only，遵循 AIRP 价值化规则）；docs/reference/tool-vs-skill.md 记边界 + tsian.lib admission 规则。build:contracts + build:web 通过，AI-facing 层 scope grep 零残迹。附带 07-04-action-resolution-system PRD Blocked On 记录。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `6d6d4a1` | (see git log) |
| `4406b1a` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
