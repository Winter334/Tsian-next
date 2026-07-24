<script setup lang="ts">
import { onMounted, ref, watch } from "vue"
import gsap from "gsap"

/**
 * AppNav — 右侧可折叠导航（仅主游玩态）。
 *
 * prd 屏2：展开态 ~180px 竖排图标+文字标签（故事/角色/设置），
 * 当前态 --ember 左边框 + --ember-bright；折叠态 ~56px 仅图标无 Tooltip（hover 不弹标签）。
 * GSAP width 动画 + 偏好持久化（localStorage）。
 *
 * nav 项扩展：design §4.2 / D3 — 新增"角色"项，与状态栏头像点击共用同一视图切换
 * （navCurrent: "story" | "character" | "settings"）。
 */
type NavItem = "story" | "character" | "timeline" | "settings"

const props = defineProps<{
  current: NavItem
  collapsed: boolean
}>()

const emit = defineEmits<{
  navigate: [item: NavItem]
}>()

const navRef = ref<HTMLElement | null>(null)

const items: Array<{ key: NavItem; label: string; icon: string }> = [
  { key: "story", label: "故事", icon: "M4 6h16M4 12h16M4 18h10" },
  // 角色：人形剪影（头+肩），区分于故事与设置。标准 Material person 图标路径。
  { key: "character", label: "角色", icon: "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" },
  // 时间线：纵向命轨 + 三个节点标签，避免旧图标像抽象折线。
  { key: "timeline", label: "时间线", icon: "M7 4v16M7 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M11 6h7M7 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M11 12h5M7 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M11 18h7" },
  // 设置：三段调校滑杆，比齿轮更适合当前克制线性导航。
  { key: "settings", label: "设置", icon: "M4 7h7M15 7h5M13 7a2 2 0 1 0 4 0 2 2 0 1 0 -4 0M4 12h3M11 12h9M7 12a2 2 0 1 0 4 0 2 2 0 1 0 -4 0M4 17h10M18 17h2M14 17a2 2 0 1 0 4 0 2 2 0 1 0 -4 0" },
]

// GSAP width 动画（collapsed 变化时）
watch(
  () => props.collapsed,
  (collapsed) => {
    if (!navRef.value) return
    gsap.to(navRef.value, {
      width: collapsed ? 56 : 180,
      duration: 0.3,
      ease: "power2.inOut",
    })
  },
)

onMounted(() => {
  // 初始宽度对齐 collapsed 状态（无动画）
  if (navRef.value) {
    navRef.value.style.width = props.collapsed ? "56px" : "180px"
  }
})

function onItemClick(key: NavItem) {
  emit("navigate", key)
}
</script>

<template>
  <nav ref="navRef" class="app-nav" :class="{ collapsed }">
    <button
      v-for="item in items"
      :key="item.key"
      type="button"
      class="nav-item"
      :class="{ active: current === item.key }"
      :title="collapsed ? '' : item.label"
      :aria-current="current === item.key ? 'page' : undefined"
      @click="onItemClick(item.key)"
    >
      <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path :d="item.icon" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <span class="nav-label">{{ item.label }}</span>
    </button>
  </nav>
</template>

<style scoped>
.app-nav {
  position: fixed;
  top: 52px;
  right: 0;
  bottom: 0;
  width: 180px;
  z-index: 19;
  display: flex;
  flex-direction: column;
  padding: 16px 0;
  background: rgba(10, 5, 6, 0.7);
  backdrop-filter: blur(8px);
  border-left: 1px solid var(--line);
  overflow: hidden;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 44px;
  padding: 0 20px;
  margin: 2px 8px;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  color: var(--prose-muted);
  transition: color 0.2s, background 0.2s;
  white-space: nowrap;
}
.app-nav.collapsed .nav-item {
  justify-content: center;
  padding: 0;
}

.nav-item:hover,
.nav-item:focus-visible {
  color: var(--prose);
  background: rgba(181, 137, 61, 0.05);
}
.nav-item:focus-visible {
  outline: 2px solid var(--ember-bright);
  outline-offset: -2px;
}

/* 当前态：ember-bright 文字 + 微暖底（不用竖线指示） */
.nav-item.active {
  color: var(--ember-bright);
  background: rgba(181, 137, 61, 0.08);
}

.nav-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.app-nav.collapsed .nav-label {
  display: none;
}

.nav-label {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  letter-spacing: 0.06em;
}

@media (max-width: 720px) {
  .app-nav,
  .app-nav.collapsed {
    top: auto;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100% !important;
    height: var(--play-bottom-nav-height);
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    padding: 5px 4px env(safe-area-inset-bottom);
    box-sizing: border-box;
    border-top: 1px solid var(--line-strong);
    border-left: 0;
    background: rgba(7, 4, 5, 0.94);
    backdrop-filter: blur(14px);
  }

  .nav-item,
  .app-nav.collapsed .nav-item {
    position: relative;
    min-width: 0;
    height: auto;
    min-height: 48px;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    padding: 3px 2px;
    margin: 0 2px;
    border-radius: 7px 2px 7px 2px;
  }

  .app-nav.collapsed .nav-label,
  .nav-label {
    display: block;
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 0.58rem;
    letter-spacing: 0.05em;
  }

  .nav-icon {
    width: 18px;
    height: 18px;
  }

  .nav-item.active::after {
    content: "";
    position: absolute;
    top: 1px;
    left: 28%;
    right: 28%;
    height: 1px;
    background: var(--ember-bright);
    box-shadow: 0 0 7px rgba(232, 169, 72, 0.5);
  }
}
</style>
