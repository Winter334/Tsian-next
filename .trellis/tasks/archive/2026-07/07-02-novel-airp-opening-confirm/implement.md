# Implement — 小说 AIRP 开局确认 Step 5

执行顺序按此 checklist 推进。

## 阶段 1：useSetupState 状态 + 路由

- [ ] 1.1 SetupSubView 类型新增 `"opening-confirm"`（useSetupState.ts:43）
- [ ] 1.2 新增 `playSetupSummary = ref<string | null>(null)`，导出 readonly
- [ ] 1.3 `handleAgentResponse`（:649-655）complete 时存 summary：`playSetupSummary.value = summary.summary ?? null`
- [ ] 1.4 `startPlaySetupDialog` 重载恢复路径（:562-566）complete 时同样存 summary
- [ ] 1.5 `goToStep(5)`（:220-223）改为 `subView="opening-confirm"` + `step.value = 5`，不再落 stub
- [ ] 1.6 重载恢复路由：initialize 完成后若 setup-summary complete → goToStep(5)
- [ ] 1.7 🚦 验证：`rg -n "stub" apps/play-frontend-dev/src/composables/useSetupState.ts` 确认 goToStep 无 stub 残留（stub 类型保留给类型完备）

## 阶段 2：OpeningConfirm.vue 组件

- [ ] 2.1 新建 `apps/play-frontend-dev/src/components/setup/step5/OpeningConfirm.vue`
- [ ] 2.2 script：从 useSetupState 取 playSetupSummary；从 useSetupState 或 useTsian 取标题（understandingSummary.title / manifest.title）；defineEmits enterPlay
- [ ] 2.3 template：设定卡片容器 + 四角括号 + pulse-ring 脉冲（呼应 CharacterConfirmed :44-80 结构）
- [ ] 2.4 卡片容器打破矩形刚性：多层 box-shadow（外投影 + inset 暗角）+ ::after vignette + 1px 极淡边框 + 圆角（参考 lachisa .canvas-container）
- [ ] 2.5 卡片背景图片：暂用 lachisa 背景图占位（`https://u.cubeupload.com/zmonochrome/tumblr8b1866a9355004.jpg`），background-size:cover + 多层暗色 overlay 使图片退化为质感层，后续替换为 Tsian 专属素材
- [ ] 2.6 点阵纹理叠加：::before radial-gradient 6px 网格点 rgba(prose,0.04)（参考 lachisa .canvas-dot-overlay）
- [ ] 2.6 背景巨字装饰：极淡古金色 rgba(ember,0.03) 标题/主题词缓慢横移（参考 lachisa .nihility-bg-text）
- [ ] 2.7 卡片标题：小说标题，阶梯阴影 text-shadow（复用 App.vue:175 同款古金色阶梯）
- [ ] 2.8 菱形脉冲 ✦：古金色分隔装饰，pulse-glow 动画（参考 lachisa .diamond）
- [ ] 2.9 卡片正文：summary 文本 serif 排版（超长可滚动）
- [ ] 2.10 live-pulse-bar：卡片底部古金色脉冲条作"就绪"指示（参考 lachisa .live-pulse-bar）
- [x] 2.12 style：颜色全部使用 Tsian token，不硬编码；外部图片仅卡片背景占位用，不引入外部字体/音频
- [x] 2.13 背景魔法阵：复用 magicCircleGenerator；fixed 全屏装饰层；区域池 + best-candidate 分散；淡入淡出生命周期；Step2 式内部多层旋转；无 3D 翻转

## 阶段 3：SetupWizard.vue 接入

- [ ] 3.1 import OpeningConfirm
- [ ] 3.2 defineEmits 新增 `enterPlay: []`
- [ ] 3.3 模板 stub 渲染块（:358-360）替换为 `<OpeningConfirm @enter-play="onEnterPlay" />`
- [ ] 3.4 actions computed：stub 分支（:214-224）替换为 opening-confirm 分支（secondary 返回 Step 4，primary "进入故事" → onEnterPlay）
- [ ] 3.5 `onEnterPlay` 函数：`emit("enterPlay")`
- [ ] 3.6 `completedUntil`（:73-79）：`subView === "opening-confirm"` 返回 4
- [ ] 3.7 🚦 手测：Step 4 complete → 下一步 → Step 5 设定卡片显示，返回回 Step 4

## 阶段 4：App.vue enterPlay 接线 + 烧蚀过渡

- [x] 4.1 SetupWizard 标签加 `@enter-play="onEnterPlay"`
- [x] 4.2 `onEnterPlay` async handler：`await loadOpeningNarrative()` → `enterPlayPending=true` → `phase="burning"`（暂不切 mode）
- [x] 4.3 BurningReveal variant：`enterPlayPending || mode === "play" ? "scroll" : "paper"`
- [x] 4.4 过渡流程：在 Step 5 上方启动 scroll 烧蚀 → `@shown` 后 `mode="play"` → `@revealed` 后 `enterPlayPending=false`，避免露帧/黑闪
- [x] 4.5 🚦 用户手测通过：进入故事 → 烧蚀幕布过渡 → StoryView 出现，无露帧

## 阶段 5：StoryView 开局叙事渲染

- [ ] 5.1 从 useTsian 解构 `openingNarrative`
- [ ] 5.2 模板：mergedStream v-for 之前加 `<NarrativeMessage v-if="openingNarrative" :content="openingNarrative" class="opening-narrative" />`
- [ ] 5.3 空状态 guard（:276）改为 `stream.length === 0 && !openingNarrative && !streaming`
- [ ] 5.4 样式：.opening-narrative 可加轻微 top padding / 分隔线与后续消息区分
- [ ] 5.5 🚦 手测：StoryView 首次渲染开局叙事在顶部，空状态不重叠

## 阶段 6：最终质量门

- [x] 6.1 🚦 `npm run build --workspace play-frontend-dev` 通过
- [x] 6.2 🚦 stub 仅保留兜底，正常 Step 5 走 `opening-confirm`
- [x] 6.3 🚦 用户手测端到端：Step 4 对话确认 → Step 5 设定卡片 → 进入故事 → 烧蚀过渡 → StoryView 开局叙事
- [x] 6.4 🚦 用户确认当前测试没问题
- [x] 6.5 触发 `/trellis-check` 跑质量验证：build 通过、改动文件 tsc 无错误、无 debug leftovers

## 回滚点

- OpeningConfirm 视觉不满意 → 调卡片样式/装饰，不影响路由和翻转逻辑
- 烧蚀过渡层叠问题 → 回退为即时 mode 翻转（不加 phase=burning，直接 mode=play）
- StoryView 开局叙事渲染冲突 → 加 v-if 条件收紧或独立容器隔离
- 重载恢复路由出错 → 回退到 Step 4 停留（不自动跳 Step 5），手动点下一步

## 风险文件

- `useSetupState.ts`：状态机核心，goToStep 路由 + 重载恢复改动影响全向导
- `App.vue`：mode 翻转 + phase 状态机，影响开屏和游玩态切换
- `SetupWizard.vue`：模板 + actions + emit 改动
- `StoryView.vue`：渲染逻辑改动，空状态 guard
