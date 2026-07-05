<script setup lang="ts">
/**
 * StatusBar — 左侧状态栏容器（仅主游玩态）。
 *
 * design §5.1 / §4.3：
 * - fixed left, top 52px, bottom 0, z 19（与 AppNav 对称）。
 * - GSAP width 动画 240↔48，duration 0.3s，ease power2.inOut（同 AppNav）。
 * - 背景 rgba(10,5,6,0.7) + backdrop-filter blur(8px)（同 AppNav）。
 * - 右边框 1px solid var(--line)。
 * - 展开态：垂直排列 Scene → Character → Status → Metrics → Refs。
 * - 折叠态：只渲染 Character 折叠模式（头像），其他子组件 v-if="!collapsed"。
 * - emit toggle（折叠态头像点击展开）+ open-character（展开态头像点击进角色卡）。
 *
 * 错误态（design §6 / type-safety §"play-frontend Workspace Data Consumption"）：
 * - error === "load-failed" → 顶部统一显示"状态暂不可用"，隐藏各分区。
 * - error === "not-found" → 各分区走空态文案（runtime=null 时子组件 fallback）。
 * - status === "loading" → 显示淡入占位。
 *
 * 数据：useRuntime() 模块级单例，与 StoryView 共享同一份 RuntimeData。
 */
import { computed, onMounted, ref, watch } from "vue"
import gsap from "gsap"
import { useRuntime } from "../composables/useRuntime"
import StatusBarScene from "./status-bar/StatusBarScene.vue"
import StatusBarCharacter from "./status-bar/StatusBarCharacter.vue"
import StatusBarStatus from "./status-bar/StatusBarStatus.vue"
import StatusBarMetrics from "./status-bar/StatusBarMetrics.vue"
import StatusBarRefs from "./status-bar/StatusBarRefs.vue"

const props = defineProps<{
  collapsed: boolean
}>()

const emit = defineEmits<{
  toggle: []
  "open-character": []
}>()

// useRuntime 模块级单例：与 StoryView 共享同一份数据 + 刷新触发。
const { runtimeData } = useRuntime()

const barRef = ref<HTMLElement | null>(null)

// 派生数据视图（runtime 为 null 时子组件走 fallback/空态）。
const runtime = computed(() => runtimeData.value.runtime)
const error = computed(() => runtimeData.value.error)
const status = computed(() => runtimeData.value.status)
const displayItems = computed(() => runtimeData.value.displayItems)

// 角色来源：runtime.protagonistRef（新 shape，替代旧 runtime.player.character）。
const character = computed(() => runtime.value?.protagonistRef ?? null)
// 状态数据来源改为主角 entity.status，由 StatusBarStatus 内部 useEntity 读取。
const protagonistRefStr = computed(() => runtime.value?.protagonistRef?.ref ?? null)
const tags = computed(() => displayItems.value.tags)
const metrics = computed(() => displayItems.value.metrics)
const refs = computed(() => displayItems.value.refs)

// GSAP width 动画（collapsed 变化时）—— 同 AppNav 模式。
watch(
  () => props.collapsed,
  (collapsed) => {
    if (!barRef.value) return
    gsap.to(barRef.value, {
      width: collapsed ? 48 : 240,
      duration: 0.3,
      ease: "power2.inOut",
    })
  },
)

onMounted(() => {
  // 初始宽度对齐 collapsed 状态（无动画）—— 同 AppNav onMounted 模式。
  if (barRef.value) {
    barRef.value.style.width = props.collapsed ? "48px" : "240px"
  }
})

// 顶部降级文案：仅在 load-failed 时显示（design §6）。
const showFatalError = computed(
  () => error.value === "load-failed" && status.value !== "loading",
)

// loading 占位：未读到数据且未报错时显示淡入占位。
const showLoading = computed(
  () => status.value === "loading" && runtime.value === null && error.value === null,
)
</script>

<template>
  <aside ref="barRef" class="status-bar" :class="{ collapsed }">
    <!-- loading 占位 -->
    <div v-if="showLoading" class="sb-loading">
      <span class="sb-loading-text">载入中…</span>
    </div>

    <!-- 顶部统一降级文案：load-failed -->
    <div v-else-if="showFatalError" class="sb-fatal">
      <span class="sb-fatal-text">状态暂不可用</span>
    </div>

    <!-- 折叠态：只渲染角色头像（点击展开）。
         :key 按 character.ref 重挂——useEntity 在 setup 期捕获 ref 字符串，
         切换角色时需重挂才能读到新实体路径（MVP 内角色 ref 一般不变，此为兜底）。 -->
    <template v-else>
      <StatusBarCharacter
        :key="character?.ref ?? 'none'"
        :collapsed="collapsed"
        :character="character"
        @toggle="emit('toggle')"
        @open-character="emit('open-character')"
      />

      <!-- 展开态：渲染其余分区（v-if 避免折叠态占布局） -->
      <div v-if="!collapsed" class="sb-expanded-body">
        <StatusBarScene :runtime="runtime" />
        <StatusBarStatus
          :key="protagonistRefStr ?? 'none'"
          :protagonist-ref="protagonistRefStr"
          :tags="tags"
        />
        <StatusBarMetrics :metrics="metrics" />
        <StatusBarRefs :refs="refs" />
      </div>
    </template>
  </aside>
</template>

<style scoped>
.status-bar {
  position: fixed;
  top: 52px;
  left: 0;
  bottom: 0;
  width: 240px;
  z-index: 19;
  display: flex;
  flex-direction: column;
  background: rgba(10, 5, 6, 0.7);
  backdrop-filter: blur(8px);
  border-right: 1px solid var(--line);
  overflow: hidden;
}

.sb-expanded-body {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  scrollbar-width: thin;
}

/* loading / fatal 占位：垂直居中淡入文案 */
.sb-loading,
.sb-fatal {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.sb-loading-text,
.sb-fatal-text {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--whisper);
  letter-spacing: 0.14em;
  text-align: center;
  font-style: italic;
  animation: sb-fade 1.2s ease-in-out infinite alternate;
}
.sb-fatal-text {
  animation: none;
  color: var(--prose-dim);
}
@keyframes sb-fade {
  0% { opacity: 0.5; }
  100% { opacity: 1; }
}
</style>
