# 开发前端 Vue 重构 — Design

## 1. 架构边界

本任务只改 `apps/play-frontend-dev/`。不触碰：
- `apps/platform-web/src/storage/default-frontend-files.ts`（B 段移植）
- `apps/platform-web/src/frontend-build/`（B 段才需，且选发布 npm 方案故引擎零改动）
- `packages/play-bridge/`、`packages/contracts/`（仅消费，不改）

开发回路：平台卡 `frontend.kind:"remote"` + `url:"http://localhost:5173"`（vite dev server）。平台 iframe 加载，vite 别名解析 `@tsian/*`。`vite.config.ts` 现有别名（`@tsian/play-bridge`→`packages/play-bridge/src/index.ts`、`@tsian/contracts`→`packages/contracts/src/index.ts`）保留不动。

## 2. 目录结构（目标）

```
apps/play-frontend-dev/src/
├── main.ts                     # 入口：createApp(App).mount('#app')
├── App.vue                     # 根组件：氛围层 + 视图路由 + 开屏/向导/主游玩态切换
├── components/
│   ├── TsianLogo.vue           # 活 Logo（4 层拆分动效）+ 静态简化版 prop
│   ├── BurningReveal.vue       # WebGL 燃烧过渡（shader + 纹理 + 点击驱动）
│   ├── AppHeader.vue           # 顶栏（静态 Logo + 状态点 + 轮次徽章 + nav 折叠按钮）
│   ├── AppNav.vue              # 右侧可折叠 nav（展开图标+文字 / 折叠仅图标）
│   ├── AtmosphereLayer.vue     # 氛围层（径向+点阵+巨字漂移+余烬粒子 Canvas）
│   ├── CornerBrackets.vue      # 四角 L 形括号取景框
│   ├── story/
│   │   ├── StoryView.vue       # 对话流容器（52em 列 + 滚动 + 视差）
│   │   ├── UserMessage.vue     # 用户消息（左竖条 + auto-layout 进场）
│   │   ├── NarrativeMessage.vue# 叙述（逐字浮现 + markdown + 滚动点亮）
│   │   ├── ProcessNode.vue     # 过程节点（Reka Disclosure + 折叠卡）
│   │   ├── TurnMeta.vue        # 轮次计时 meta 行
│   │   ├── StoryOptions.vue    # 故事选项卡（auto-layout + hover 火光）
│   │   └── SceneImage.vue      # 场景插画位（暗色滤镜 + 卷轴展开进场）
│   ├── setup/
│   │   ├── SetupWizard.vue     # 向导壳（横向 stepper + stage + 状态机）
│   │   ├── SetupStepper.vue    # 5 节点 stepper（GSAP 连线填充）
│   │   ├── step1/
│   │   │   ├── MethodChoose.vue    # choose 两卡
│   │   │   ├── PasteInput.vue      # paste 输入
│   │   │   ├── FileInput.vue       # file 拖放
│   │   │   └── SplitReview.vue     # review 双栏
│   │   ├── step2/
│   │   │   ├── UnderstandingIdle.vue
│   │   │   ├── UnderstandingRunning.vue  # 余烬升级 + 分阶段文案
│   │   │   ├── UnderstandingReady.vue    # 分支卡
│   │   │   └── UnderstandingFailed.vue
│   │   └── StepStub.vue        # step3-5 占位
│   ├── checkpoints/
│   │   ├── CheckpointMark.vue  # 对话流内 ember 分隔印记（旋转 glyph + 常驻微动效）
│   │   └── RestoreDialog.vue   # Reka Dialog 恢复确认
│   └── Composer.vue            # 输入区（send/stop + 聚焦动效）
├── composables/
│   ├── useTsian.ts             # 单 tsian 实例 + 5 订阅 + 状态暴露
│   ├── useTurnState.ts         # 轮次状态机（替代 main.ts 散乱 let）
│   ├── useSetupState.ts        # 向导状态（替代 source-import 闭包 state）
│   └── useAtmosphere.ts        # 余烬粒子 Canvas + 鼠标 lerp 视差
├── lib/
│   ├── shader.ts               # burning-reveal 的 vertex/fragment shader 字符串 + WebGL 初始化
│   ├── tokens.css              # :root 设计 token（全局，非 scoped）
│   └── markdown.ts             # marked 配置（标题/引用/代码 渲染）
└── types.ts                    # 共享类型
```

## 3. 状态管理

不用 Pinia（避免 B 段 esm.sh 解析额外包；本任务规模 composables 够）。用 Vue `reactive`/`ref` + composables：

- `useTsian()`：单例 `createTsian()`，暴露 ready/sessionId/turn 状态/历史/checkpoints/workspace，封装 5 订阅回调到响应式状态。所有组件通过此 composable 访问 bridge，不直接 import play-bridge 实例。
- `useTurnState()`：轮次状态机。`turnActive`/`currentTurnEls`(改响应式)/`turnState`/`userPinnedToBottom`/`turnTimer`。替代 main.ts 模块级 `let`。
- `useSetupState()`：向导状态。`step`/`subView`/`understandingStatus`/`importData`。替代 source-import 闭包 `state`。状态变 → Vue 响应式自动渲染（替代手动 `render()`）。
- `useAtmosphere()`：余烬粒子 Canvas rAF 循环 + 鼠标 lerp + 滚动视差挂载/卸载。

## 4. 动效架构

分层，职责不重叠：

| 层 | 工具 | 场景 |
|---|---|---|
| 内容切换 | anime.js v4 `createLayout` | stepper 推进、向导子屏切换、选项/卡片进场、轮次更替 |
| 元素动效 | GSAP | 叙述逐字浮现（stagger+blur→sharp）、滚动逐段点亮（ScrollTrigger）、nav 折叠（width）、卡片 hover（JS 增强）、模态进出场、Logo 4 层动效 |
| 组件进出场 | Vue `<Transition>`/`<TransitionGroup>` | 条件渲染元素的 fade/slide |
| 背景 | Canvas + GSAP | 余烬粒子 rAF + 视差 |
| 开屏 | WebGL shader | fbm 燃烧 |

`anim.ts` 退役（GSAP 注册移入使用处或 composable，ScrollTrigger/Flip 按需在组件 `onMounted` 注册）。

## 5. 关键组件设计

### BurningReveal.vue
- props: `text`(纹理文字)/`trigger`(boolean)/`duration`(ms,默认 3000)
- `onMounted`：初始化 WebGL（ getContext webgl，编译 vertex/fragment shader，创建离屏 textCanvas 画文字纹理）。参考 `F:/workspace/tmp/burning-reveal/script.js`。
- watch `trigger` true：startTime=now，rAF 驱动 `u_progress` 0→1（easeInOut），烧蚀推进。烧蚀从中心向外（shader uv 中心推进，改示例的边缘推进）。
- 完成：`canvas display:none`，emit `revealed`。
- shader 字符串存 `lib/shader.ts`，fbm 噪声+火焰边界算法直接搬示例，火焰色可调向琥珀 `vec3(6,1.8,0.2)`。

### TsianLogo.vue
- props: `animated`(boolean,开屏用 true/header 用 false)/`size`
- 4 层独立 SVG 元素带 ref：外框 rect/内框 rect/对角线 g/核心裂隙星 path+内部撕裂线 path+中心奇点 rect。
- `animated` true：GSAP timeline 驱动外框缓转(40s)/内框反向缓转(30s)/对角线 opacity 呼吸/核心 scale+glow 脉动/奇点 glow 脉冲。
- 点击（开屏）：emit `click` → 父组件触发汇聚收缩（GSAP scale→0.92+glow 增强）→奇点爆发（scale 1.5）→触发 BurningReveal。
- `animated` false：静态，仅核心裂隙星+奇点，无旋转，用于 header。
- 配色用 CSS 变量 + SVG fill/stroke 引用。

### SetupWizard.vue
- 状态机：`step`(1-5)/`subView`(step1 的 choose/paste/file/review)/`understandingStatus`(idle/running/ready/failed)。
- 横向 stepper 在顶，stage 在下。步骤切换用 anime.js auto-layout（stepper 节点 + stage 内容 token 散聚）。
- 全屏接管：`.app:has(.setup-shell)` 隐藏 header+nav（沿用现有 CSS 机制，迁入 scoped 或全局）。
- step1/2 实现，step3-5 渲染 StepStub。

## 6. 迁移策略

不做 big-bang。按能独立验证的层逐步迁移，每步 vite dev 可跑：

1. **脚手架 + 基底**：建目录结构 + `main.ts` createApp + `App.vue` 空壳 + `lib/tokens.css` + `AtmosphereLayer`+`CornerBrackets`。验证：vite dev 空白页有氛围层。
2. **Logo + 开屏**：`TsianLogo`+`BurningReveal`+开屏状态机。验证：开屏 Logo 动效+点击燃烧过渡。
3. **bridge composable + App shell**：`useTsian`+`AppHeader`+`AppNav`。验证：remote 回路连上平台，ready 后进主游玩态（空 story）。
4. **story 视图**：`StoryView`+各消息组件+`StoryOptions`+`Composer`。验证：完整对话流+选项+发送。删除 ask_user。
5. **checkpoints**：对话流内 `CheckpointMark`+`RestoreDialog`。验证：流内印记 + 恢复。
6. **向导 step1**：`SetupWizard`壳+`SetupStepper`+step1 各子屏。验证：导入流程+auto-layout 切换。
7. **向导 step2**：understanding 各状态。验证：invoke world-architect+running 动画+ready 分支+failed。
8. **step3-5 stub + 收尾**：`StepStub`+清理旧 vanilla 文件+`npm run build` 通过。

旧 `main.ts`/`source-import.ts`/`style.css`/`anim.ts` 在对应步骤迁完后删除，不并行保留（避免双份维护）。

## 7. 风险与回滚

- **WebGL 在平台 iframe 沙箱未实测**：开屏燃烧依赖 WebGL。若 iframe 沙箱下 getContext 失败，开屏死锁（已接受无 fallback 风险）。缓解：迁移第 2 步优先实测 remote 回路下 WebGL 可用性，若不可用需重新讨论 fallback。
- **anime.js v4 auto-layout 与 Vue 响应式渲染的协调**：auto-layout 需要在 DOM 切换前后配对 token。Vue 响应式渲染时机与 anime.js `createLayout.update` 的协调需在 step1/step2 实现时验证。若冲突，fallback 到 GSAP Flip 做内容切换。
- **remote 回路 CORS**：平台 iframe 加载 `http://localhost:5173`，若平台页是 https 或不同源，可能被 CORS/混合内容拦截。迁移第 3 步验证，必要时平台侧调整 iframe sandbox 属性或 dev server 配置。
- 回滚点：每步独立 git commit，任一步失败可 `git checkout` 回退到上一步可跑状态。

## 8. Validation

```bash
npm run build --workspace play-frontend-dev   # vite build 通过
npm run dev --workspace play-frontend-dev      # vite dev server 启动
```

手动（remote 回路）：
- 平台卡 remote 指向 dev server，iframe 加载前端。
- 开屏 Logo 动效 + 点击燃烧过渡 → 向导。
- 向导 step1 导入流程 + step2 理解流程（invokeAgent world-architect）+ step3-5 stub。
- 主游玩态：对话流 + 故事选项 + composer + checkpoints + nav 折叠。
- bridge 经 vite 别名解析，无 esm.sh 404。
- `default-frontend-files.ts` 未改。
