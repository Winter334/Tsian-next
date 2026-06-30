<script setup lang="ts">
import AtmosphereLayer from "./components/AtmosphereLayer.vue"
import CornerBrackets from "./components/CornerBrackets.vue"

// App.vue 根组件。
// 当前 Step 1：仅氛围层 + 四角括号 + 占位。后续 step 接入：
// - 开屏状态机（booting/burning/revealed）→ TsianLogo + BurningReveal
// - 主游玩态（AppHeader + AppNav + StoryView + Composer）
// - 向导态（SetupWizard，:has(.setup-shell) 隐藏 header+nav）
// 状态切换由 useTsian() ready + 开屏/向导状态机驱动。
</script>

<template>
  <div class="app-root">
    <AtmosphereLayer :density="40" parallax="10" ghost-text="STORY" />
    <CornerBrackets :size="15" :inset="25" />
    <!-- Step 1 占位：后续替换为开屏/向导/主游玩态 -->
    <main class="stage-placeholder">
      <p class="placeholder-text">烛火书卷 · 重铸</p>
      <p class="placeholder-sub">Tsian 前端重构中</p>
    </main>
  </div>
</template>

<style scoped>
.app-root {
  position: relative;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}

.stage-placeholder {
  position: relative;
  z-index: 2;
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
