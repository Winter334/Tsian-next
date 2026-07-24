<script setup lang="ts">
import { computed, ref } from "vue"
import TsianLogo from "./TsianLogo.vue"

/**
 * AppHeader — 顶栏（仅主游玩态）。
 *
 * prd 屏2：左=静态简化 Logo+连接状态点；中=无文字；右=轮次徽章 `第 N 轮`（ember pill mono）+nav 折叠按钮。
 * 底边 --line + 激光扫描线。
 * 向导期由父组件 v-if 控制不渲染（:has(.setup-shell) 机制）。
 *
 * 状态栏折叠按钮（design §4.3）：左侧 Logo 旁新增 28×28 折叠按钮，与右侧 nav 折叠按钮对称。
 */
const props = defineProps<{
  ready: boolean
  turnCount: number
  navCollapsed: boolean
  statusBarCollapsed: boolean
}>()

const emit = defineEmits<{
  toggleNav: []
  toggleStatusBar: []
  openStatus: []
}>()

const turnLabel = computed(() => `第 ${props.turnCount} 轮`)
const desktopStatusButton = ref<HTMLButtonElement | null>(null)
const mobileStatusButton = ref<HTMLButtonElement | null>(null)

defineExpose({ desktopStatusButton, mobileStatusButton })
</script>

<template>
  <header class="app-header">
    <!-- 左：状态栏折叠按钮 + 静态简化 Logo + 连接状态点 -->
    <div class="header-left">
      <button
        ref="desktopStatusButton"
        type="button"
        class="nav-toggle status-toggle desktop-status-toggle"
        :aria-label="statusBarCollapsed ? '展开状态栏' : '折叠状态栏'"
        @click="emit('toggleStatusBar')"
      >
        <span class="toggle-icon" :class="{ collapsed: statusBarCollapsed }" />
      </button>
      <button
        ref="mobileStatusButton"
        type="button"
        class="nav-toggle mobile-status-toggle"
        aria-label="打开状态抽屉"
        @click="emit('openStatus')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 6h14M5 12h9M5 18h11" />
          <circle cx="18" cy="12" r="2" />
        </svg>
      </button>
      <TsianLogo :animated="false" :size="28" />
      <span class="status-dot" :class="{ connected: ready }" :title="ready ? '已连接' : '连接中…'" />
    </div>

    <!-- 中：无文字 -->

    <!-- 右：轮次徽章 + nav 折叠按钮 -->
    <div class="header-right">
      <span class="turn-badge">{{ turnLabel }}</span>
      <button
        type="button"
        class="nav-toggle"
        :aria-label="navCollapsed ? '展开导航' : '折叠导航'"
        @click="emit('toggleNav')"
      >
        <span class="toggle-icon" :class="{ collapsed: navCollapsed }" />
      </button>
    </div>

    <!-- 底边激光扫描线 -->
    <span class="scan-line" />
  </header>
</template>

<style scoped>
.app-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 52px;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  background: rgba(6, 6, 8, 0.85);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--line);
}

.header-left,
.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* 连接状态点：未连接暗灰，连接后 ember 呼吸 */
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--whisper);
  transition: background 0.3s;
}
.status-dot.connected {
  background: var(--ember);
  box-shadow: 0 0 8px var(--ember);
  animation: dot-pulse 2s ease-in-out infinite;
}
@keyframes dot-pulse {
  0%, 100% { opacity: 0.7; }
  50% { opacity: 1; }
}

/* 轮次徽章：ember pill mono */
.turn-badge {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--ember-bright);
  border: 1px solid var(--line-strong);
  border-radius: 12px;
  padding: 2px 10px;
  letter-spacing: 0.06em;
}

.mobile-status-toggle {
  display: none;
}

.mobile-status-toggle svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
}

/* nav 折叠按钮 */
.nav-toggle {
  background: transparent;
  border: 1px solid var(--line);
  border-radius: 4px;
  width: 28px;
  height: 28px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.2s;
}
.nav-toggle:hover,
.nav-toggle:focus-visible {
  border-color: var(--ember);
}
.nav-toggle:focus-visible {
  outline: 2px solid var(--ember-bright);
  outline-offset: 2px;
}
.toggle-icon {
  width: 14px;
  height: 2px;
  background: var(--prose);
  position: relative;
  transition: transform 0.2s;
}
.toggle-icon::before,
.toggle-icon::after {
  content: "";
  position: absolute;
  left: 0;
  width: 14px;
  height: 2px;
  background: var(--prose);
}
.toggle-icon::before { top: -5px; }
.toggle-icon::after { top: 5px; }
.toggle-icon.collapsed {
  transform: rotate(90deg);
}

/* 底边激光扫描线 */
.scan-line {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 1px;
  width: 100%;
  background: linear-gradient(90deg, transparent, var(--ember), transparent);
  background-size: 200% 100%;
  animation: scan 6s linear infinite;
  opacity: 0.5;
}
@keyframes scan {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

@media (max-width: 720px) {
  .app-header {
    height: var(--play-header-height);
    padding: env(safe-area-inset-top) 12px 0;
    box-sizing: border-box;
  }

  .header-left,
  .header-right {
    gap: 8px;
  }

  .desktop-status-toggle,
  .header-right .nav-toggle {
    display: none;
  }

  .mobile-status-toggle {
    display: flex;
    color: var(--prose);
  }

  .turn-badge {
    padding: 2px 8px;
    font-size: 0.68rem;
  }

  .scan-line {
    animation: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .status-dot.connected,
  .scan-line {
    animation: none;
  }
}
</style>
