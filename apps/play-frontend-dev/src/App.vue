<script setup lang="ts">
import { onMounted, ref, watch } from "vue"
import AtmosphereLayer from "./components/AtmosphereLayer.vue"
import CornerBrackets from "./components/CornerBrackets.vue"
import TsianLogo from "./components/TsianLogo.vue"
import BurningReveal from "./components/BurningReveal.vue"
import AppHeader from "./components/AppHeader.vue"
import AppNav from "./components/AppNav.vue"
import { useTsian } from "./composables/useTsian"

// App.vue 根组件。
// 开屏状态机（design §5 / prd D5-D6）：
// - idle：纸张幕布 + 中央活 Logo（转动），等待点击
// - burning：点击→并行（logo 动效 + BurningReveal 挂载即燃烧）→canvas shown 移除 idle 层→幕布烧穿透明露出主游玩态
// - revealed：主游玩态壳（AppHeader + AppNav + 视图路由）。向导 Step 6 接入后改为先向导再主游玩。
//
// Step 3：revealed 后直接进主游玩态（向导留 Step 6）。
// useTsian 提供 bridge 响应式状态（ready/sessionId/turnCount/...）。
// nav 折叠偏好持久化（localStorage）。
const phase = ref<"idle" | "burning" | "revealed">("idle")
const curtainReplaced = ref(false)

// nav 折叠状态（localStorage 持久化）
const NAV_COLLAPSED_KEY = "tsian.navCollapsed"
const navCollapsed = ref(localStorage.getItem(NAV_COLLAPSED_KEY) === "true")
const navCurrent = ref<"story" | "checkpoints" | "settings">("story")

watch(navCollapsed, (v) => {
  localStorage.setItem(NAV_COLLAPSED_KEY, String(v))
})

// bridge 状态（useTsian 单例共享）
const { ready, turnCount } = useTsian()

function onLogoClick() {
  phase.value = "burning"
}

function onCurtainShown() {
  curtainReplaced.value = true
}

function onRevealed() {
  phase.value = "revealed"
}

function onToggleNav() {
  navCollapsed.value = !navCollapsed.value
}

function onNavigate(item: "story" | "checkpoints" | "settings") {
  navCurrent.value = item
}
</script>

<template>
  <div class="app-root">
    <AtmosphereLayer :density="40" parallax="10" ghost-text="STORY" />

    <!-- idle：纸张幕布 + 活 Logo。保留到 canvas shown（curtainReplaced），避免闪现占位 -->
    <div
      v-if="phase === 'idle' || (phase === 'burning' && !curtainReplaced)"
      class="paper-curtain"
    >
      <TsianLogo :animated="true" :size="320" @click="onLogoClick" />
    </div>

    <!-- burning + revealed 主游玩态层：z:0 最底，burning 时被幕布遮，烧穿透明露出 -->
    <main
      v-if="phase === 'burning' || phase === 'revealed'"
      class="stage-play"
    >
      <!-- 主游玩态壳：header + nav（向导期 Step 6 接入后会用 :has(.setup-shell) 隐藏） -->
      <AppHeader
        v-if="phase === 'revealed'"
        :ready="ready"
        :turn-count="turnCount"
        :nav-collapsed="navCollapsed"
        @toggle-nav="onToggleNav"
      />
      <AppNav
        v-if="phase === 'revealed'"
        :current="navCurrent"
        :collapsed="navCollapsed"
        @navigate="onNavigate"
      />

      <!-- 视图路由占位（Step 4 接入 StoryView / Step 5 CheckpointView） -->
      <div class="view-stage">
        <CornerBrackets :size="15" :inset="25" />
        <p class="placeholder-text">烛火书卷 · 重铸</p>
        <p class="placeholder-sub">{{ ready ? `已连接 · 第 ${turnCount} 轮 · ${navCurrent}` : '连接平台中…' }}</p>
      </div>
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

/* 主游玩态层：z:0 最底，burning 时被幕布遮，烧穿透明露出 */
.stage-play {
  position: relative;
  z-index: 0;
  height: 100%;
  width: 100%;
}

/* 视图舞台：右侧留 nav 空间，顶部留 header 空间 */
.view-stage {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
  /* 顶部 header 52px + 右侧 nav 180px（折叠 56px） */
  padding-top: 52px;
  padding-right: 180px;
  transition: padding-right 0.3s ease;
}
.app-root:has(.app-nav.collapsed) .view-stage {
  padding-right: 56px;
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
