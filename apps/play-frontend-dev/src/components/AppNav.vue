<script setup lang="ts">
import { onMounted, ref, watch } from "vue"
import gsap from "gsap"

/**
 * AppNav — 右侧可折叠导航（仅主游玩态）。
 *
 * prd 屏2：展开态 ~180px 竖排图标+文字标签（故事/检查点/设置），
 * 当前态 --ember 左边框 + --ember-bright；折叠态 ~56px 仅图标无 Tooltip（hover 不弹标签）。
 * GSAP width 动画 + 偏好持久化（localStorage）。
 */
type NavItem = "story" | "checkpoints" | "settings"

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
  { key: "checkpoints", label: "检查点", icon: "M12 2v20M2 12h20" },
  { key: "settings", label: "设置", icon: "M12 8a4 4 0 100 8 4 4 0 000-8z" },
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
      class="nav-item"
      :class="{ active: current === item.key }"
      :title="collapsed ? '' : item.label"
      @click="onItemClick(item.key)"
    >
      <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path :d="item.icon" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <span v-if="!collapsed" class="nav-label">{{ item.label }}</span>
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
  color: var(--prose-dim);
  transition: color 0.2s, background 0.2s;
  white-space: nowrap;
}
.app-nav.collapsed .nav-item {
  justify-content: center;
  padding: 0;
}

.nav-item:hover {
  color: var(--prose);
  background: rgba(181, 137, 61, 0.05);
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

.nav-label {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  letter-spacing: 0.1em;
}
</style>
