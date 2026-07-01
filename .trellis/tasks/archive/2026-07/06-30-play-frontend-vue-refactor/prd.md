# 开发前端 Vue 重构 + UI 库引入

## Goal

将 `apps/play-frontend-dev` 从 vanilla TS（4 文件 ~127KB，无框架）重构为 Vue 3 SFC 结构 + Reka UI + GSAP + anime.js v4，并全部重设计视觉为「烛火书卷 · 重铸」暗色仪式系，使其成为流经平台构建引擎的**真正默认前端种子**——取代当前 `default-frontend-files.ts` 里的 vanilla 占位前端，让内置游戏卡跑起完整的 AIRP 阅读器。这是父任务 `06-27-default-card-novel-reader-airp` 的收尾子任务，也兑现已归档 `06-30-platform-frontend-build-service` PRD 的 R7b 跟进。

## Background — 已确认事实（代码库探索得出）

### 当前前端结构（待重构对象）

- `src/main.ts`（1137 行）：主游玩壳。渲染对话流（用户消息/叙述 markdown/过程节点 thought·tool·interim/agent 标签）、轮次计时、故事选项 `[[选项]]`、ask_user 面板；拥有轮次状态机、story↔checkpoints 视图切换、检查点恢复弹窗、send/stop composer 接线。含 ~30 个 `renderXxx` DOM 构造辅助函数。
- `src/source-import.ts`（1023 行）：开局导入向导。choose→paste/file→review→understanding 四屏 + 5 步 stepper（仅 step1/2 实现，角色设定/游玩倾向/开局确认是 stub）。单 `state` 闭包对象 + 手动全量 `render()`（`story.innerHTML=""` 重建）。
- `src/style.css`（1042 行）：单文件全局样式。"烛火书卷 / Lamplight Codex" 暗色主题，`:root` 设计 token，平铺类名前缀，断点 920px/640px。无预处理器、无 CSS modules。
- `src/anim.ts`（102 行）：GSAP 集中入口（注册 ScrollTrigger + Flip，但两者无调用点=死代码；实际只用 core gsap + 自定义 helper）。仅 source-import.ts 引用。
- 入口 `index.html` 静态根 DOM，main.ts 抓 ~10 个 DOM ref 接线。无路由、无组件目录、无 store。状态=模块级 `let` + 闭包。

### play-bridge 包（关键运行时依赖）

- `@tsian/play-bridge`：798 行/6 文件，**内部 workspace 包，`private:true`，未发布 npm**。公开 API = `createTsian()` + `parseStoryOptions()` + 一批类型（contracts 类型全是 `import type`，编译期消失）。
- 前端实际用到的 bridge 面：lifecycle（ready/waitForReady/sessionId）、send、invokeAgent、5 订阅（onMessage/onRoundEnd/onTurnEnd/onTool/onAsk）、history.get、checkpoints.list/restore、workspace.read/write。未用：workspace.list/search、query、runAction、send options。
- dev app 通过 vite.config.ts 别名把 `@tsian/play-bridge` + `@tsian/contracts` 直接指到源码（`packages/*/src/index.ts`），构建期内联。

### 平台构建引擎（B 段产物去向，本任务 A 段不触及）

- Vue SFC 已完整支持：`@vue/compiler-sfc` 插件编译 `.vue`，`framework:"vue"` 路由接 `vue@3` esm.sh import map。`main.ts` 入口 `import './App.vue'` + `createApp(App).mount('#app')` 可行。
- 已知缺口：构建引擎无法解析 `@tsian/*` 内部包，`@tsian/play-bridge` 会被丢给 esm.sh → 404。本任务 A 段用 remote 前端模式绕开此问题（见 D1）；B 段移植时发布 bridge 到 npm 解决。
- 引擎限制（B 段需遵守）：无 HMR、无 SFC sourcemap、`<style lang="scss/less">` 不支持（只能 plain + scoped CSS）、无 CSS modules、入口必须是 `main.*`。

## Decisions

- **D1 — bridge 解析（分阶段）**：最终方案 = 发布 `@tsian/play-bridge` 到 npm，但**现在不做**。开发阶段用 **remote 前端模式**：平台卡 `frontend.kind: "remote"` + `url` 指向 vite dev server（如 `http://localhost:5173`），平台 iframe 直接加载，vite 用现有别名解析 `@tsian/*`，全程绕开构建引擎/esm.sh/发布。验证通过后再移植为默认前端种子（B 段），届时执行发布。已验证前提：`packages/contracts/src/game-card.ts:35` `GameCardFrontendBinding` 已有 `kind:"remote"` + `url` 分支。
  - 本任务主工作量 = A 段（Vue 重构 + remote 回路验证）。B 段（移植为默认前端 + 发布 bridge）含外部 npm 发布依赖、风险面不同，拆为独立 follow-up 任务（见 Open Questions Q5）。
- **D2 — 技术栈 = Vue 3 SFC + Reka UI + GSAP + anime.js v4**。Reka UI（headless 无样式 a11y 原语，视觉 100% 自定义，B 段引擎零 CSS 包袱最安全）。动效栈：GSAP 做通用动效（timeline/ScrollTrigger/Flip，复活死代码）+ anime.js v4 专做 `createLayout` auto-layout 内容切换（token 级散聚重组，GSAP 无此特化能力）+ Vue `<Transition>`/`<TransitionGroup>`。anime.js v4 经 esm.sh 可直接解析（`https://esm.sh/animejs@4`），B 段兼容。
- **D3 — 重构幅度 = 全部重设计**。主游玩壳 + 开局导入向导都重做视觉。`a7b6f16`（06-30 刚落地的向导 UI 重设计）视觉将被推倒重做。向导的**功能流程**（choose→paste/file→review→understanding + stepper 步骤划分）是已验证产品流程，重设计的是视觉演绎而非流程结构。
- **D4 — 视觉方向 = A+「烛火书卷 · 重铸」暗色仪式系**。基于两份示例（`F:/workspace/tmp/`）提取定稿：
  - 示例 1 `anime-js-code-explosion-auto-layout-animation`：anime.js v4 `createLayout` 内容散聚语言。
  - 示例 2 `lachisa`：氛围工具箱（多层 inset/outer shadow 破矩形 + 径向 vignette + 点阵 overlay + 角落 L 形括号 + 巨字背景漂移 + Canvas 粒子 + 鼠标 lerp 视差 + 竖排文字）。配色近黑底 `#060608` + 暗血径向氛围 `#2b0404` + 古金 `#b5893d`/琥珀 + 暖白正文。
  - 融合：背景氛围用 lachisa 工具箱，内容切换用 anime.js auto-layout，保留烛火核心隐喻。
- **D5 — 新增开屏动画（仪式入口）**。取代"开屏即向导"。开屏 = 全屏活 Logo；玩家**点击 Logo 触发纸张燃烧过渡** → 烧穿露出向导。不是自动播放，是主动开启。
  - 燃烧过渡 = WebGL fragment shader（参考 `F:/workspace/tmp/burning-reveal`）：离屏 canvas 把 Logo 画成纹理 → 全屏 WebGL canvas 跑 fbm 噪声驱动 fragment shader，`u_progress` 0→1 推进烧蚀边界，阈值线过后像素变暗+边缘亮起火焰色+alpha 衰减。点击触发进度（改示例自动 8s 为点击驱动，~3s 烧完）。烧蚀从核心奇点向外扩散。
  - 复刻方式 = 搬示例 shader + 适配为 Vue `<BurningReveal>` 组件。零 npm 依赖（WebGL/GLSL 浏览器原生），B 段零负担。
  - **不要 CSS fallback**。接受无 WebGL 环境开屏不可用。
- **D6 — Logo 重设计**。原 SVG（`F:/workspace/tmp/logo/tsian.svg`，几何抽象：旋转方框+十字裂隙星+中心奇点+对角线，原配色 Indigo/Magenta）拆分 4 层 + 配色转 A+ 烛火琥珀系 + 动效：外框（`--ember` 古金，40s 缓转）+ 内框（`--ember-bright` 琥珀，30s 反向缓转）+ 对角线（`--whisper` opacity 呼吸）+ 核心裂隙星（`--ember-bright`→`--blood` 渐变，scale+glow 火光脉动）+ 中心奇点（`--ember-bright` glow 脉冲）。点击触发：汇聚收缩→奇点爆发→`<BurningReveal>` 接管。Vue `<TsianLogo>` 组件，每层独立 ref + GSAP 驱动。header 用静态简化版（仅核心裂隙星+奇点，无旋转）。

## Visual Contract — 设计系统基底（全屏共用）

**配色 token**（CSS 变量，全局 `:root`）：
```
--void:#060608  --void-deep:#0a0506  --ember-glow:#2b0404
--ember:#b5893d  --ember-bright:#e8a948  --blood:#9b3a2e
--prose:#d4c9b4  --prose-dim:#8a8073  --whisper:#5c5347
--line:rgba(181,137,61,0.15)
```

**字体**：标题/Logo `Cinzel`+`Noto Serif SC`；正文叙述 `Noto Serif SC`；UI/meta `JetBrains Mono`。

**图片配合策略**：设计预留图片位，先借示例图占位（lachisa 角色 render + 背景图），后续替换。所有图片过暗色滤镜（drop-shadow + contrast/sepia + `--void` 半透遮罩 + 径向 vignette）融进暗色仪式系。图片位：开屏背景层、向导背景、story 场景插画位、checkpoints 缩略图位。

**氛围层（每屏背景）**：`--void` 底 + 径向 `--ember-glow` 中心氛围光 + 点阵 overlay（`radial-gradient rgba(255,255,255,0.03) 6px`）+ 巨字背景漂移（40s，opacity 0.02-0.04）+ Canvas 余烬粒子（暖色微粒上升+鼠标 lerp）+ 四角 L 形括号取景框。

## Visual Contract — 界面级设计

### 屏 1 — 开屏动画
全屏氛围层 + 中央活 Logo（D6），无文字副标题/无提示文字。背景余烬粒子+巨字漂移+可选暗色滤镜氛围图。点击：Logo 汇聚→奇点爆发→`<BurningReveal>` 烧蚀（中心向外）→露出向导 step1。状态：idle→burning→revealed。

### 屏 2 — App Shell（仅主游玩态）
- **Header**：左=静态简化 Logo+连接状态点；**中=无文字**；右=轮次徽章 `第 N 轮`（`--ember` pill mono）+nav 折叠按钮。底边 `--line`+激光扫描线。
- **右侧 nav（可折叠）**：展开态 ~180px 竖排图标+文字标签（故事/检查点/设置），当前态 `--ember` 左边框+`--ember-bright`；折叠态 ~56px **仅图标无 Tooltip**（hover 不弹标签）；GSAP width 动画+偏好持久化（localStorage）。
- 向导期隐藏 header+nav（沿用 `:has(.setup-shell)` 机制）。主游玩态余烬粒子更稀疏。

### 屏 3 — Story 视图（核心游玩面）
中央 52em 阅读列，垂直滚动。
- **用户消息**：左侧 2px `--ember` 竖条+`--prose` Serif；进场 auto-layout 逐 token 从右散入。
- **叙述消息**（主角）：全宽 `--prose` Serif 行高 1.8；逐字浮现（GSAP blur→sharp+opacity stagger 墨迹渗透）；markdown 渲染（标题 Cinzel `--ember-bright`/引用 `--ember` 左条/代码 `--void-deep`+`--ember` 边 mono）；ScrollTrigger 滚动逐段点亮（`--prose-dim`→`--prose`）。
- **过程节点**（thought/tool/interim/agent）：折叠卡 `--void-deep`+`--line` 边+inset shadow；标签 mono `--ember`/`--whisper`；Reka UI Disclosure；内容 mono `--prose-dim`；进场 auto-layout 散聚。
- **轮次计时 meta**：每轮底细行 `· 12.4s · 1.2k tokens · 第 N 轮` mono `--whisper`。
- **故事选项 `[[选项]]`**（主游玩唯一交互，因 ask_user 删除）：卡片 `--void-deep`+`--line` 边+角落括号+可选数字编号；hover/active `translateY(-2px)`+`--ember` 描边动画+`inset 0 0 24px var(--ember-glow)` 内发光；进场 auto-layout stagger from random；选中 `--ember` 实心边+scale，其余淡出。
- **~~ask_user 面板~~**：删除，主游玩不用。
- **图片位**：章节开场/关键场景可插场景插画位（占位 lachisa render，暗色滤镜+`--line` 边+括号），进场 GSAP scale+clipPath 卷轴展开感，宽度受限不抢叙述。
- **滚动/视差**：巨字背景 0.3x 视差；余烬粒子 0.1x 视差。
- **空状态**：`故事尚未开始`（Serif `--prose-dim`）+余烬+`在下方写下你的行动…`（`--whisper` 呼吸）。

### 向导共用骨架
全屏接管（隐藏 header+折叠 nav）。顶部横向 stepper（5 节点：导入小说/初始理解/角色设定/游玩倾向/开局确认）：完成态 `--ember` 实心+勾，当前态 `--ember-bright` 发光脉动，未实现 `--whisper` 空心；连线 GSAP width 填充；节点文字 mono `--prose-dim`。步骤切换 auto-layout 散聚。无页头标题条。Stage 全宽。

### 向导 Step 1 — 导入小说
- **choose**：仅两卡（粘贴/文件）居中，`--void-deep`+`--line`+inset shadow+括号+小图标；hover `translateY(-2px)`+`--ember` 描边+内发光；进场 auto-layout 散聚；无标题副标题。
- **paste**：标题输入框+大 textarea（`--void-deep`+`--line`，`--prose` Serif）+返回/下一步按钮；文案精简。
- **file**：标题输入框+真实拖放区（实现 dragover/drop）或纯选择文件按钮；拖放区虚线 `--whisper` 边，拖入 `--ember` 高亮。
- **review**：概览（标题+章节数+字数 mono）+双栏（章节列表/预览）；列表项 `--ember` 左条选中；预览 ScrollTrigger 逐段点亮；按钮"开始理解"。

### 向导 Step 2 — 初始理解
- **idle**：中央"开始理解"按钮（`--ember` 实心 pill 火光呼吸）+一句引导 `AI 将阅读开头，建立开局资料`+"返回切分"次级。
- **running**：余烬粒子升级+烛火呼吸；分阶段文案（`正在观察导入结构…`→`正在阅读开头剧情…`→`正在写入开局资料…`，不暴露 world-architect）auto-layout 逐字散聚切换；阶段推进轮询 `save/playthrough/understanding-summary.json` status 或时间 fallback。
- **ready**：引导问 `你想以谁的身份走进这个故事？`+两分支卡（原著角色/原创角色，视觉同 choose 卡）；进场 auto-layout；选中推进 stepper 到③；"返回切分"次级，无主"下一步"。
- **failed**：短重试文案+`--blood` 边框重试按钮。

### 向导 Step 3-5 — stub 占位
本任务不实现详情。stepper 节点亮起但 stage 显示 `即将开放`（Serif `--prose-dim`）+返回。step2 ready 选卡决定 step3 后续内容（角色卡网格/原创角色对话采集），本任务不深入。

### Checkpoints 视图
中央 52em 列，卡片纵列。检查点卡：`--void-deep`+`--line`+inset shadow+括号；`第 N 回`（Cinzel `--ember-bright`）+reason 标签（mono `--ember` pill）+相对时间（mono `--whisper`）+可选缩略图位；hover `translateY(-2px)`+`--ember` 描边；进场 auto-layout stagger+ScrollTrigger 视口触发。恢复确认弹窗：Reka UI Dialog，`--void-deep`+`--ember` 2px 边+括号+背景模糊遮罩；GSAP scale+opacity+Vue Transition。空/加载/错误态极简文案。

### Composer
story 底部 52em 居中列。textarea：`--void-deep`+`--line` 顶边+`--prose` Serif，placeholder `写下你的行动…`。按钮区：send（`--ember` 实心 pill 火光 hover）+stop（`--blood` 边框，仅轮次进行时显示）。聚焦：`--ember` 顶边增亮+内发光。状态：idle/轮次中（send 隐藏 stop 显示）/向导期（隐藏）。聚焦失焦 GSAP 过渡。

## Requirements

- **R1 技术栈迁移**：`apps/play-frontend-dev` 从 vanilla TS 重构为 Vue 3 SFC（`<script setup>`+TS）。Reka UI 提供交互原语 a11y。GSAP+anime.js v4+Vue Transition 提供动效。`@tsian/play-bridge` 经 vite 别名继续可用（dev 期）。
- **R2 视觉全部重设计**：按 Visual Contract 设计系统基底 + 8 屏界面级设计重做视觉。旧"烛火书卷"平铺 CSS 拆分为 per-SFC `<style scoped>`（plain CSS，B 段引擎不支持预处理器），token 留全局 `:root`。
- **R3 开屏动画新增**：`<TsianLogo>` 活 Logo（D6 拆分动效）+ `<BurningReveal>` WebGL 燃烧过渡（D5）。点击触发，非自动。无 CSS fallback。
- **R4 ask_user 删除**：主游玩不用 ask_user，story 视图无 ask_user 面板。故事选项承担全部玩家输入响应。
- **R5 向导流程保留**：功能流程（choose→paste/file→review→understanding + stepper 5 步）保留，重设计视觉演绎。step1/2 实现，step3-5 stub 占位。
- **R6 图片配合预留**：设计预留图片位，先借示例图占位（lachisa），暗色滤镜处理统一融进氛围，后续替换。
- **R7 remote 开发回路**：平台卡 `frontend.kind:"remote"` + `url` 指向 vite dev server，平台 iframe 加载验证。不触及构建引擎 / esm.sh / bridge 发布（B 段 follow-up）。
- **R8 默认卡不触碰**：本任务只改 `apps/play-frontend-dev`，不改 `apps/platform-web/src/storage/default-frontend-files.ts`（B 段才移植）。

## Acceptance Criteria

- [ ] `apps/play-frontend-dev` 为 Vue 3 SFC 结构，`main.ts` 入口 mount `App.vue`，无 vanilla TS 残留 DOM 构造代码。
- [ ] Reka UI 提供交互原语（Disclosure/dialog 等），视觉 100% 自定义。
- [ ] 8 屏视觉按 Visual Contract 实现：配色 token、字体、氛围层、图片处理、四角括号一致。
- [ ] 开屏：活 Logo 4 层动效 + 点击触发 WebGL 燃烧过渡烧穿露出向导。无 fallback。
- [ ] 向导：横向 stepper + auto-layout 步骤切换 + step1（choose/paste/file/review）+ step2（idle/running/ready/failed）实现，step3-5 stub 占位。
- [ ] story 视图：叙述逐字浮现+滚动逐段点亮+过程节点折叠+故事选项卡（无 ask_user）。
- [ ] composer：send/stop 状态切换 + 聚焦动效。
- [ ] checkpoints：卡片列表 + 恢复确认弹窗（Reka Dialog）。
- [ ] nav 可折叠（展开图标+文字 / 折叠仅图标无 Tooltip），偏好持久化。
- [ ] remote 回路：平台卡 remote 指向 vite dev server，iframe 加载，前端正常工作（bridge 经 vite 别名解析）。
- [ ] `npm run build --workspace play-frontend-dev` 通过（vite build）。
- [ ] `default-frontend-files.ts` 未被修改。

## Out of Scope

- B 段：移植为默认前端种子 + 发布 `@tsian/play-bridge` 到 npm + 构建引擎产物链路验证（独立 follow-up）。
- 向导 step3-5 详情实现（角色卡网格 / 原创角色对话采集 / 游玩倾向 / 开局确认）——等各自讨论时设计。
- 构建引擎改造（`@tsian/*` 解析插件）——B 段才需，且选了发布 npm 方案故引擎零改动。
- 真实图片资源制作（本任务用示例占位）。

## Open Questions

- Q5：B 段（移植为默认前端 + 发布 bridge）拆为独立 follow-up 任务——本任务完成后创建。无阻塞。
