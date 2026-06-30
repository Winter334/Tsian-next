<script setup lang="ts">
import { ref } from "vue"
import AtmosphereLayer from "./components/AtmosphereLayer.vue"
import CornerBrackets from "./components/CornerBrackets.vue"
import TsianLogo from "./components/TsianLogo.vue"
import BurningReveal from "./components/BurningReveal.vue"

// App.vue 根组件。
// 开屏状态机（design §5 / prd D5-D6，用户反馈定稿方案）：
// - idle：纸张幕布 + 中央活 Logo（转动），等待点击
// - burning：点击→并行（logo 快速动效 + BurningReveal 挂载即燃烧）→logo 动画结束移除 idle 层→幕布继续烧→烧穿透明露出向导
// - revealed：向导/主游玩态（后续 step 接入 SetupWizard / StoryView）
//
// 衔接策略（并行，零前摇，防闪现）：
// 点击瞬间 phase=burning 挂载 BurningReveal——它挂载即开始 rAF 燃烧（canvas hidden），
// 同时 logo 播放消失动效（脉动+淡出 0.4s）。
// BurningReveal 的 delay（400ms）后 canvas 显示并 emit shown → 此时 canvas 已盖住 →
// 才移除 paper-curtain（curtainReplaced=true）。保证 canvas 先盖住再移除幕布，不闪现下层占位。
// logo 动画结束（done）仅表示 logo 消失，paper-curtain 保留到 canvas shown。
//
// 层级（实现"从空洞看到背后内容"）：
// 占位层 z:0 最底 → 纸张幕布 z:1 → canvas z:50 最高。
// canvas shown 移除 paper-curtain 后，烧穿透明透出 z:0 占位。
const phase = ref<"idle" | "burning" | "revealed">("idle")
const curtainReplaced = ref(false)

function onLogoClick() {
  // 立即切 burning：挂载 BurningReveal（挂载即开始燃烧，canvas 延迟显示）
  phase.value = "burning"
}

function onCurtainShown() {
  // canvas 已显示盖住，安全移除 paper-curtain（避免闪现 z:0 占位层）
  curtainReplaced.value = true
}

function onRevealed() {
  phase.value = "revealed"
}
</script>

<template>
  <div class="app-root">
    <AtmosphereLayer :density="60" parallax="12" ghost-text="TSIAN" />

    <!-- idle：纸张幕布 + 活 Logo。保留到 canvas shown（curtainReplaced），避免闪现占位 -->
    <div
      v-if="phase === 'idle' || (phase === 'burning' && !curtainReplaced)"
      class="paper-curtain"
    >
      <TsianLogo :animated="true" :size="320" @click="onLogoClick" />
    </div>

    <!-- burning + revealed 占位层：z:0 最底，burning 时被幕布遮，烧穿透明露出 -->
    <main
      v-if="phase === 'burning' || phase === 'revealed'"
      class="stage-placeholder"
    >
      <CornerBrackets :size="15" :inset="25" />
      <p class="placeholder-text">烛火书卷 · 重铸</p>
      <p class="placeholder-sub">向导待接入</p>
    </main>

    <!-- burning：WebGL 燃烧幕布。挂载即开始燃烧（canvas hidden），delay 后显示+emit shown -->
    <BurningReveal
      v-if="phase === 'burning'"
      :duration="8000"
      :delay="400"
      @shown="onCurtainShown"
      @revealed="onRevealed"
    />
  </div>
</template>

<style scoped>
.app-root {
  position: relative;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}

/* 纸张幕布：暖白米黄古卷底 + 纸纹斑点，遮住氛围层，承载 idle logo */
.paper-curtain {
  position: fixed;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #e8d9b8;
  background-image:
    radial-gradient(rgba(120, 90, 50, 0.04) 15%, transparent 16%),
    radial-gradient(rgba(120, 90, 50, 0.03) 12%, transparent 13%);
  background-size: 80px 80px, 130px 130px;
  background-position: 0 0, 40px 60px;
}

.stage-placeholder {
  position: relative;
  /* z-index:0 最底层：burning 阶段被纸张幕布(z:1)遮住，
     幕布烧穿透明才透出占位（实现"从空洞看到背后内容"）。
     revealed 阶段幕布已移除，占位独立显示。 */
  z-index: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
}

.placeholder-text {
  margin: 0;
  font-family: var(--font-display);
  font-size: 2.5rem;
  font-weight: 700;
  color: var(--ember-bright);
  letter-spacing: 0.08em;
  text-shadow: 1px 1px 0 var(--ember), 2px 2px 0 #8a6428,
    3px 3px 0 #5e4319, 5px 5px 25px rgba(0, 0, 0, 0.95);
}

.placeholder-sub {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.8rem;
  color: var(--prose-dim);
  letter-spacing: 0.3em;
  text-transform: uppercase;
}
</style>
