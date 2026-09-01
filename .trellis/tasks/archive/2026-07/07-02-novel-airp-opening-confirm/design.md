# Design — 小说 AIRP 开局确认 Step 5

## 1. 架构总览

Step 5 是开局向导的收口：纯过渡入口屏 + enterPlay 翻转 + StoryView 开局叙事渲染。三层改动：

```
┌─ 前端（play-frontend-dev）─────────────────────────────────┐
│  OpeningConfirm.vue（新）                                   │
│    设定卡片（summary 文本 + 四角括号 + pulse-ring）          │
│    装饰元素（烛火书卷氛围）                                   │
│  useSetupState.ts                                           │
│    goToStep(5) 路由 → subView="opening-confirm"              │
│    completedUntil Step 5 点亮                                │
│    重载恢复：setup-summary complete → 直接 Step 5            │
│  SetupWizard.vue                                             │
│    stub 渲染块 → OpeningConfirm                              │
│    actions play-setup 分支 primary → emit enterPlay          │
│    emit 定义 enterPlay 事件                                  │
│  App.vue                                                     │
│    @enterPlay handler：await loadOpeningNarrative → pending  │
│    phase="burning" 先烧 Step 5，@shown 后切 mode="play"       │
│  StoryView.vue                                               │
│    mergedStream 之前渲染 openingNarrative 特殊消息           │
│    空状态 guard 纳入 openingNarrative                        │
└──────────────────────────────────────────────────────────────┘
```

## 2. 组件设计

### 2.1 OpeningConfirm.vue

纯展示 + 触发 enterPlay，无内部状态机。

```vue
<script setup lang="ts">
import { ref, onMounted } from "vue"
import { useSetupState } from "../../../composables/useSetupState"
import { useTsian } from "../../../composables/useTsian"

const { playSetupSummary } = useSetupState()  // 新增：setup-summary 数据
const emit = defineEmits<{ enterPlay: [] }>()
</script>
```

**视觉设计参考**（`F:\workspace\tmp\lachisa`，项目基调样式参考）：

参考项目色系与 Tsian token 完全吻合（`#060608`≈`--void-deep`、`#2b0404`=`--ember-glow`、`#b5893d`=`--ember`），以下技法可取用到 OpeningConfirm 设定卡片：

1. **卡片容器打破矩形刚性**（lachisa .canvas-container）：
   - 多层 `box-shadow`：外层大投影 `0 30px 100px rgba(0,0,0,0.8)` + 双层 inset 暗角 `inset 0 0 80px rgba(void-deep,0.9)` / `inset 0 0 140px rgba(0,0,0,0.95)`
   - `::after` 伪元素 radial-gradient vignette（`transparent 40% → rgba(void-deep,0.85) 100%`）四周进一步暗化
   - 1px 极淡边框 `rgba(ember,0.06)` + 12px 圆角
   - 效果：卡片边缘"融入黑暗"，非生硬矩形

2. **点阵纹理叠加**（lachisa .canvas-dot-overlay）：
   - `radial-gradient(rgba(prose,0.04) 15%, transparent 16%)` 6px 网格点
   - 极淡白色点阵作卡片背景质感，z-index 叠在底色之上、内容之下

3. **背景巨字缓慢横移**（lachisa .nihility-bg-text）：
   - 14rem 巨字，`rgba(ember,0.03)` 极淡古金色，30px 字间距
   - 200% 宽度 + 35s linear infinite 水平移动
   - 用于卡片背景装饰：可放小说标题或"術式"等主题词，极淡不抢焦点但赋予叙事纵深

4. **标题阶梯阴影**（lachisa .main-kanji，App.vue:175 已有先例）：
   - `text-shadow: 1px 1px 0 var(--ember), 2px 2px 0 #8a6428, 3px 3px 0 #5e4319, 5px 5px 25px rgba(0,0,0,0.95)`
   - 古金色阶梯立体阴影，App.vue placeholder-text 已用同款，卡片标题复用保持一致

5. **菱形脉冲装饰**（lachisa .diamond）：
   - `✦` 符号，`var(--ember)` 古金色，`pulse-glow 2s` 缩放+透明度脉冲
   - 用于卡片标题旁或分隔线装饰点

6. **角括号**（lachisa .ui-corner-bracket）：
   - 参考项目用两对角（top-left + bottom-right）15px×15px 2px border `rgba(prose,0.15)`
   - Step 3 CharacterConfirmed 已用四角括号；OpeningConfirm 可沿用四角保持向导内一致性，或用两对角更克制——实现时视觉调优决定

7. **live-pulse-bar 脉冲条**（lachisa .live-pulse-bar）：
   - 40px×2px 古金色条，`bar-stretch 1.2s` 宽度伸缩脉冲
   - 可作卡片底部"就绪"状态指示

**不取用**：
- 外部音频/字体（Google Fonts）——Tsian 无外部音频/字体依赖
- 花瓣 canvas 粒子——OpeningConfirm 是静态确认屏，不需粒子动效（EmberForge 已是项目粒子方案）
- 鼠标 parallax——向导内不需交互式视差

**外部图片占位**：
- 卡片背景可使用外部图片作背景质感（类比 lachisa .canvas-container 的 background-image），叠加点阵纹理 + vignette + inset shadow 后图片退化为暗色调质感层。
- 当前无项目专属素材，**暂用 lachisa 的背景图占位**（`https://u.cubeupload.com/zmonochrome/tumblr8b1866a9355004.jpg`），后续替换为 Tsian 专属素材。
- 图片通过 CSS `background-image` 引用，不打包进项目；`background-size: cover` + `background-position: center` + 多层暗色 overlay 使图片不抢焦点。

**设定卡片结构**（呼应 Step 3 CharacterConfirmed + lachisa 卡片语言）：
```vue
<div class="confirm-card">
  <!-- 点阵纹理 + vignette 由 ::before/::after 承担 -->
  <span class="bracket tl" aria-hidden="true" />
  <span class="bracket tr" aria-hidden="true" />
  <span class="bracket bl" aria-hidden="true" />
  <span class="bracket br" aria-hidden="true" />

  <!-- 背景巨字装饰 -->
  <span class="bg-glyph" aria-hidden="true">{{ title }}</span>

  <!-- 卡片内容 -->
  <div class="card-body">
    <span class="card-title">{{ title }}</span>
    <span class="card-divider"><span class="diamond">✦</span></span>
    <p class="card-summary">{{ summary }}</p>
    <div class="pulse-bar" aria-hidden="true" />
  </div>

  <!-- 一次性脉冲环（mount 时触发，类比 CharacterConfirmed） -->
  <div class="pulse-ring" aria-hidden="true" />
</div>
```

**数据来源**：
- summary：需从 useSetupState 暴露 `playSetupSummary` ref（读 setup-summary.json）
- 标题：复用现有 `understandingSummary.value?.title ?? manifest.value?.title`

### 2.2 SetupWizard.vue 改动

**emit 定义**：
```ts
const emit = defineEmits<{ enterPlay: [] }>()
```

**模板**：stub 渲染块替换：
```vue
<div v-else-if="subView === 'opening-confirm'" key="opening-confirm" class="stage-content">
  <OpeningConfirm @enter-play="onEnterPlay" />
</div>
```

**actions**：opening-confirm 分支替换 stub 分支：
```ts
if (subView.value === "opening-confirm") {
  return {
    secondaryLabel: "返回设定",
    secondaryDisabled: false,
    onSecondary: () => goToStep(4),
    primaryLabel: "进入故事",
    primaryDisabled: false,  // 进入 Step 5 即说明 setup complete
    onPrimary: onEnterPlay,
  }
}
```

**onEnterPlay**：
```ts
function onEnterPlay() {
  emit("enterPlay")
}
```

### 2.3 App.vue 改动

**@enterPlay 接线**：
```vue
<SetupWizard
  v-if="(phase === 'burning' || phase === 'revealed') && mode === 'wizard'"
  @enter-play="onEnterPlay"
/>
```

**handler**：
```ts
async function onEnterPlay() {
  const { loadOpeningNarrative } = useTsian()
  await loadOpeningNarrative()  // 确保 openingNarrative ref 就绪
  mode.value = "play"
  phase.value = "burning"  // 触发 BurningReveal 过渡
}
```

**过渡流程**（复用现有 phase 状态机）：
1. `mode = "play"` + `phase = "burning"` → App.vue:73 `(phase === 'burning' && mode === 'play')` 为真，stage-play 挂载（StoryView 在幕布下）
2. BurningReveal `variant="scroll"` 挂载即燃烧（:106-113）
3. `@shown` → `curtainReplaced = true`，wizard 模式的 SetupWizard 条件失效卸载
4. `@revealed` → `phase = "revealed"`，过渡完成

**注意**：现有 `onCurtainShown` 和 `onRevealed` handler 已存在（:42-48），无需新建。但 `onCurtainShown` 设 `curtainReplaced = true`，影响 `paper-curtain` 的 v-if（:65）。enterPlay 时 paper-curtain 已不在（phase 早已是 revealed），所以 `curtainReplaced` 只影响 idle/burning 的纸张幕布，不影响 enterPlay 流程。需确认 wizard SetupWizard 的卸载时机。

**wizard 卸载时机分析**：
- SetupWizard v-if（:102）：`(phase === 'burning' || phase === 'revealed') && mode === 'wizard'`
- enterPlay 后 `mode = "play"` → 条件立即失效 → SetupWizard 卸载
- 但 BurningReveal 需要 canvas 盖住底层 → stage-play 在 z:0，BurningReveal 在顶层烧蚀
- 问题：SetupWizard 卸载是即时的，烧蚀幕布烧穿后露出的是 stage-play，中间无 wizard 层
- 这是正确的：enterPlay 时 wizard 内容应消失，幕布烧穿直接露出 play 态

## 3. useSetupState 改动

### 3.1 新增 SetupSubView 类型

```ts
export type SetupSubView = "choose" | "paste" | "file" | "review" | "understanding" | "character-setup" | "play-setup" | "opening-confirm" | "stub"
```

### 3.2 goToStep(5) 路由

```ts
if (target === 5) {
  subView.value = "opening-confirm"
  step.value = 5
  errorText.value = ""
  return
}
```

### 3.3 completedUntil

`completedUntil`（SetupWizard.vue:73-79）当前 `playSetupStatus === "complete"` 返回 3。Step 5 进入后 `subView === "opening-confirm"` 应返回 4：

```ts
const completedUntil = computed(() => {
  if (subView.value === "opening-confirm") return 4
  if (playSetupStatus.value === "complete") return 3
  ...
})
```

### 3.4 playSetupSummary ref

新增 ref 暴露 setup-summary 数据供 OpeningConfirm 读取：

```ts
const playSetupSummary = ref<string | null>(null)
```

在 `handleAgentResponse` 检测 complete 时（useSetupState.ts:649-655），同时存 summary：
```ts
if (summary?.status === "complete") {
  playSetupStatus.value = "complete"
  playSetupSummary.value = summary.summary ?? null
}
```

`startPlaySetupDialog` 重载恢复路径（:562-566）同样存 summary。

### 3.5 重载恢复路由

`initialize()` 完成后检查 setup-summary complete → 直接 goToStep(5)。需在 initialize 末尾或 playSetupStatus 设 complete 后触发。

## 4. StoryView 开局叙事渲染

### 4.1 模板改动

```vue
<!-- 开局叙事：独立于 stream，作为第一条消息特殊渲染 -->
<NarrativeMessage
  v-if="openingNarrative"
  :content="openingNarrative"
  class="opening-narrative"
/>

<template v-for="(item, i) in mergedStream" :key="item.id">
  ...
</template>
```

### 4.2 空状态 guard

```vue
<div v-if="stream.length === 0 && !openingNarrative && !streaming" class="empty-state">
```

### 4.3 useTsian 引入

StoryView 已通过 `useTsian()` 获取 stream 等，只需解构新增 `openingNarrative`。

## 5. 数据流

```
Step 4 commit_play_setup
  ↓ 写入
opening-narrative.json { narrative, createdAt }
setup-summary.json { status:"complete", summary, committedAt }
  ↓
Step 4 handleAgentResponse 读 setup-summary → playSetupStatus="complete" + playSetupSummary=summary
  ↓
玩家点"下一步" → goToStep(5) → subView="opening-confirm"
  ↓
OpeningConfirm 渲染设定卡片（playSetupSummary）
  ↓
玩家点"进入故事" → SetupWizard emit enterPlay
  ↓
App.vue onEnterPlay:
  await loadOpeningNarrative() → openingNarrative ref 就绪
  enterPlayPending=true + phase="burning"（mode 仍为 wizard）
  ↓
BurningReveal scroll 在 Step 5 上方显现并烧蚀
  ↓
@shown 后 mode="play"，底层切为 stage-play/StoryView
  ↓
StoryView 挂载 → openingNarrative 特殊渲染为第一条消息
  ↓
@revealed 后 phase="revealed"、enterPlayPending=false，玩家可发送第一条消息（turn-1）
```

## 6. 兼容性与边界

- **不破坏开屏流程**：enterPlay 只在 phase="revealed" 且 mode="wizard" 时触发，不影响 idle/burning 开屏。
- **重载恢复**：刷新页面后 phase 重置为 idle，玩家需点击 logo 重新 burning→revealed→wizard。initialize 检查 setup-summary complete → 直接 Step 5。这是已有行为（Step 4 也这样恢复）。
- **openingNarrative 生命周期**：模块级 ref，mode 翻转后持续存在。reloadHistory/restore 替换 stream 不影响它。仅 loadOpeningNarrative 能赋值。
- **StoryView v-show 不销毁**：App.vue:92 用 v-show 而非 v-if，但 mode 翻转是 v-if 级别挂载（stage-play 整体 v-if），所以 StoryView 在 enterPlay 时首次挂载。后续 nav 切换用 v-show 保留状态。

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| BurningReveal scroll 变体在 enterPlay 时 WebGL 不可用 | BurningReveal 已有 fallback：WebGL 不可用直接 emit revealed（:136） |
| openingNarrative 未加载完成就渲染 StoryView | onEnterPlay await loadOpeningNarrative 后才启动过渡，保证就绪 |
| BurningReveal delay 期间露出 StoryView | enterPlay 先 `phase="burning"` 且保留 `mode="wizard"`；`@shown` 后才切 `mode="play"`，不需要额外黑遮罩 |
| SetupWizard 卸载时机与 BurningReveal canvas 层叠冲突 | SetupWizard 在 `@shown` 后才因 `mode="play"` 卸载；切换发生在 canvas 已覆盖画面时 |
| playSetupSummary 在 OpeningConfirm mount 时为 null | goToStep(5) 前 playSetupStatus 已 complete，summary 已存入 ref |

## 8. 验证方式

1. build：`npm run build --workspace play-frontend-dev`
2. 手测：Step 4 确认 → Step 5 设定卡片 → 进入故事 → 烧蚀过渡 → StoryView 开局叙事
3. 重载恢复：刷新后进向导 → 直接 Step 5

## 9. Step 5 背景魔法阵最终实现

- 复用 `step2/magicCircleGenerator.ts` 生成 SVG。
- 装饰层使用 `position: fixed` 铺满视口，避免受 720px 向导内容框限制。
- 位置采用“区域池 + best-candidate sampling”：只在左上/右上/左下/右下/远左/远右等空旷区域生成，并在 30 个候选点中选择离现有魔法阵边缘最远的位置，避免互相聚集或被中央卡片遮挡。
- 每个魔法阵有 `circle-life`（20～35s 淡入→停留→淡出）和 `circle-drift`（20～36s 漂浮）。
- SVG 内部复用 Step 2 旋转风格：`.magic-layer--outer` 顺时针、`.magic-layer--text` 逆时针、`.magic-layer--inner` 顺时针、`.magic-layer--core` 呼吸。
- 不做 3D `rotateY` 翻转，避免视觉不稳定。
