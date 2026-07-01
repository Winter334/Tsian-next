# 开发前端 Vue 重构 — Implementation Plan

## 执行顺序（每步独立可验证，迁完即删旧文件）

### Step 1 — 脚手架 + 设计基底
- [x] 安装依赖：`vue` `@vue/compiler-sfc`(dev) `reka-ui` `animejs@^4`；确认 `gsap` `marked` 已有
- [x] 建目录结构（design §2）：`components/` `composables/` `lib/` `types.ts`
- [x] `main.ts` 重写为 `createApp(App).mount('#app')`
- [x] `App.vue` 空壳：仅 `<AtmosphereLayer>` + `<CornerBrackets>` + 视图路由占位
- [x] `lib/tokens.css`：`:root` 设计 token（D4 配色，全局非 scoped）
- [x] `AtmosphereLayer.vue`：径向 `--ember-glow` + 点阵 overlay + 巨字漂移 + `useAtmosphere` 余烬粒子 Canvas
- [x] `CornerBrackets.vue`：四角 L 形括号
- [x] `useAtmosphere.ts`：余烬粒子 rAF + 鼠标 lerp 视差（参考 lachisa 花瓣算法改暖色微粒）
- [x] 验证：`npm run dev`，空白页有氛围层 + 余烬 + 四角括号（build 通过 + 用户浏览器视觉确认）
- [x] commit

### Step 2 — Logo + 开屏动画
- [x] `lib/shader.ts`：搬 `burning-reveal` 的 vertex/fragment shader 字符串，火焰色调向琥珀 `vec3(6,1.8,0.2)`，烧蚀改中心向外推进
- [x] `TsianLogo.vue`：4 层 SVG 拆分（外框/内框/对角线/核心裂隙星+撕裂线+奇点），配色用 `--ember`/`--ember-bright`/`--blood`/`--prose`；`animated` prop true 时 GSAP 4 层动效（外框 40s 缓转/内框 30s 反向/对角线呼吸/核心 scale+glow 脉动/奇点 glow 脉冲）；false 时静态简化
- [x] `BurningReveal.vue`：WebGL 初始化 + 文字纹理 + `trigger` prop 驱动 `u_progress` 0→1（easeInOut ~3s）+ 完成 emit `revealed`
- [x] `App.vue` 开屏状态机：`booting`（活 Logo 等待）→点击→Logo 汇聚收缩+奇点爆发（GSAP）→`burning`→`revealed`→向导/主游玩态
- [ ] **风险验证**：remote 回路下 iframe 沙箱 WebGL `getContext` 可用性（design §7 风险 1）。若失败，暂停讨论 fallback  ← 留到 Step 3 remote 回路（需平台卡 remote 配置）
- [x] 验证：开屏 Logo 动效 + 点击燃烧过渡烧穿（build 通过 + 用户浏览器视觉确认；定稿方案见下方注）
- [x] commit

> 定稿方案（用户反馈多轮迭代）：
> - Logo 不做进幕布纹理（SVG→纹理渲染不一致剧变），idle 层 SVG logo 点击后脉动+淡出消失
> - 幕布为纸张质感（fbm 噪声生成，非字样），照搬示例边缘推进 fbm 烧蚀算法
> - 烧穿区 alpha=0 真透明，露出下层向导占位（层级：占位 z:0 / 幕布 z:1 / canvas z:50）
> - 并行初始化消除前摇：点击即挂载 BurningReveal 并开始 rAF 燃烧（canvas hidden），logo 动画 0.4s 填充初始化，canvas delay 400ms 显示 emit shown 后才移除 paper-curtain（防闪现）
> - shader 烧蚀阈值前置：main_noise = (1.-fbm(...))*0.8-0.2，消除"开始燃烧到有可见效果"的静默期
> - duration 8s（边缘推进 fbm 节奏，非中心向外）

### Step 3 — bridge composable + App shell + remote 回路
- [x] `useTsian.ts`：单例 `createTsian()`，5 订阅回调映射到响应式状态，暴露 ready/sessionId/turn/history/checkpoints/workspace
- [x] `AppHeader.vue`：静态简化 Logo + 连接状态点 + 轮次徽章 + nav 折叠按钮；底边 `--line` + 激光扫描线
- [x] `AppNav.vue`：展开态（图标+文字）/折叠态（仅图标无 Tooltip）；GSAP width 动画 + localStorage 偏好
- [x] `App.vue`：向导期 `:has(.setup-shell)` 隐藏 header+nav；主游玩态显示（Step 3 revealed 后直接进主游玩态，向导 Step 6 接入）
- [x] **风险验证**：remote 回路 CORS/混合内容（design §7 风险 3）+ WebGL iframe 沙箱（Step 2 遗留）。平台卡设 `frontend.kind:"remote"` + `url:"http://localhost:5174"`，iframe 加载，验证 bridge ready + WebGL 燃烧（用户确认连接成功，WebGL 在 iframe 沙箱下正常）
- [x] 验证：连上平台，ready 后进主游玩态（空 story）（用户 remote 回路验证通过；header/nav 出现时机待 Step 6 接向导后自然修正）
- [x] commit

### Step 4 — story 视图（核心）
- [x] `StoryView.vue`：52em 列 + 滚动 + 视差（视差留优化期）
- [x] `UserMessage.vue`：右对齐独白体（无框 + ember 短横线标签 + Serif）；进场淡入右移；editable 编辑按钮（停止后重新编辑）
- [x] `NarrativeMessage.vue`：流式光标 + 暖光晕淡入；marked 渲染（标题 Cinzel/引用/代码）；逐字浮现留优化期
- [x] `ProcessNode.vue`：Reka UI Collapsible + chevron 旋转动画 + 折叠卡；tool-group 合并摘要
- [x] `RoundProcess.vue`：本轮推演大折叠（无框，包裹 interim/thought/tool，默认折叠，概要统计）
- [x] `TurnMeta.vue`：`· 12.4s · 1.2k tokens · 第 N 轮` mono `--whisper`
- [x] `StoryOptions.vue`：选项卡 `--void-deep`+`--line`+括号+编号；hover 浮起+描边+内发光；选中淡出其余
- [x] `SceneImage.vue`：场景插画位（占位，暗色滤镜+`--line`+括号）
- [x] `Composer.vue`：烛火辉光 + ember 底线 + 圆形按钮（hover 涟漪+旋转）；停止按钮 + setText 回填
- [x] `useTurnState.ts`：轮次状态机（实时计时器 + 滚动跟随）
- [x] `lib/markdown.ts`：marked 配置（标题/引用/代码 渲染）
- [x] **停止功能全链路**：contracts→bridge→host AbortController→useTsian.stop→Composer/StoryView；停止后保留半截内容 + 重新编辑入口
- [x] **布局修复**：flex 列布局（滚动区 + Composer 正常流），从根源消除 fixed Composer 遮挡
- [x] **历史选项恢复**：loadHistory 末尾兜底恢复最后一轮未选选项
- [x] **顶栏 Logo 修复**：animated=false 时跳过 idle 动效 + 不响应点击
- [x] **删除 ask_user**：不实现 ask_user 面板（R4）— useTsian onAsk 占位空回调
- [x] 验证：完整对话流 + 选项 + 发送 + composer 状态切换 + 停止 + 重新编辑（用户浏览器视觉确认）
- [x] commit

### Step 5 — checkpoints（对话流内印记）
- [x] `CheckpointMark.vue`：ember 分隔线 + 中心旋转菱形 glyph（常驻慢转 8s + ember 呼吸微光）+ `第 N 回` mono whisper 极小字；点击 emit restore
- [x] `RestoreDialog.vue`：Reka UI Dialog + `--void-deep`+`--ember` 边+括号+背景模糊；GSAP scale+opacity + Vue Transition；确认文案 `恢复到第 N 回？此后 M 轮对话将被抹去。`
- [x] `useTsian.ts`：暴露 `restore(id)` + reloadHistory 抽出 + restore 后重建 stream/checkpoints
- [x] `StoryView.vue`：mergedStream 在对应 turn 的 assistant 后插入 CheckpointMark（含 turn=0 initial）；ready 后 loadCheckpoints；standby 时刷新 checkpoints（实时显示新印记）；恢复过渡燃烧幕布（暗色卷轴 + 琥珀金火焰 + CSS 遮罩类比开屏 paper-curtain）
- [x] `shader.ts`：createScrollTexture 暗色卷轴皮革纤维质感 + 金丝纹理；fragment shader u_variant 区分开屏/恢复火焰色（红橙/琥珀金）
- [x] `App.vue`：nav 移除 checkpoints 项（检查点融入对话流，不需要独立视图）
- [x] 轮次显示修复：turnCount-1（AppHeader + TurnMeta + turnsAfter 都减去 +1 偏移）
- [x] 验证：对话流内印记标记 + 点击弹窗恢复 + 燃烧过渡 + 恢复后 stream/checkpoints 重建（用户浏览器视觉确认）
- [ ] commit

### Step 6 — 向导壳 + step1
- [ ] `SetupWizard.vue`：状态机（step/subView/understandingStatus）；全屏接管（隐藏 header+nav）；stage 容器
- [ ] `SetupStepper.vue`：5 节点横向 stepper；完成/当前/未实现三态；GSAP 连线填充；步骤切换 anime.js auto-layout
- [ ] `step1/MethodChoose.vue`：两卡（粘贴/文件）+ hover 火光 + auto-layout 进场
- [ ] `step1/PasteInput.vue`：标题输入 + textarea + 返回/下一步
- [ ] `step1/FileInput.vue`：标题输入 + 真实拖放区（dragover/drop）或选择文件按钮
- [ ] `step1/SplitReview.vue`：概览 + 双栏章节/预览 + "开始理解"按钮
- [ ] `useSetupState.ts`：向导状态（替代 source-import 闭包 state）
- [ ] 验证：step1 导入流程 + 子屏 auto-layout 切换
- [ ] commit

### Step 7 — 向导 step2
- [ ] `step2/UnderstandingIdle.vue`："开始理解"按钮 + 引导 + 返回切分
- [ ] `step2/UnderstandingRunning.vue`：余烬升级 + 烛火呼吸 + 分阶段文案 auto-layout 逐字散聚；轮询 `save/playthrough/understanding-summary.json` status
- [ ] `step2/UnderstandingReady.vue`：引导问 + 两分支卡（原著/原创）+ 选中推进 stepper
- [ ] `step2/UnderstandingFailed.vue`：短重试 + `--blood` 按钮
- [ ] 接 `tsian.invokeAgent("world-architect", prompt)`（从 source-import 迁移逻辑）
- [ ] 验证：invokeAgent 调用 + running 动画 + ready 分支 + failed 重试
- [ ] commit

### Step 8 — stub + 收尾
- [ ] `StepStub.vue`：`即将开放` + 返回
- [ ] SetupWizard 接 step3-5 渲染 StepStub
- [ ] 删除旧 `main.ts`/`source-import.ts`/`style.css`/`anim.ts`（全部逻辑已迁移）
- [ ] `npm run build --workspace play-frontend-dev` 通过
- [ ] 全流程 remote 回路手动验收（design §8）
- [ ] commit

## Validation Commands

```bash
npm run build --workspace play-frontend-dev   # 每步后跑
npm run dev --workspace play-frontend-dev      # 开发期
```

## 回滚点

每步独立 commit。失败 `git checkout` 回上一步。关键风险点（Step 2 WebGL、Step 3 CORS、Step 6 auto-layout 与 Vue 协调）若验证失败，暂停讨论方案，不强行推进。

## 完成后

- 创建 B 段 follow-up 任务（Q5）：移植为默认前端种子 + 发布 `@tsian/play-bridge` 到 npm + 构建引擎产物链路验证。
