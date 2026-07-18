<script setup lang="ts">
/**
 * CharacterView — 角色卡全屏视图根（由 App.vue 在 navCurrent==='character' 时挂载）。
 *
 * design §4.1 / §7 / §8 / R1 / R6 / R14：
 * - useRuntime() 取 runtime；从 activeSceneRefs[0].ref 取当前场景 ref。
 * - useScene(sceneRef) 读 scene.present（Array<{ ref }>)。
 * - 默认选中 protagonistRef.ref；若 protagonistRef 为 null，选 present[0].ref。
 * - CharacterSlot（:key=selectedRef）内部 useEntity + useRelationships 读取选中角色。
 * - 渲染 CharacterList（左）+ CharacterSlot（右，内含 CharacterCard）。
 *
 * scene 切换：根 div :key=currentSceneRef 触发 remount，setup 重新跑，
 * useScene 绑定新 sceneRef，selectedRef 重置为 protagonistRef / present[0]。
 *
 * 空态/降级（design §8）：
 * - runtime 读取失败 → "存档运行时不可读"。
 * - runtime 无 activeSceneRefs → "当前无活跃场景"。
 * - scene 读取失败 → "场景数据不可读"。
 * - scene 读取中 → "读取场景…"。
 * - present 为空 → "当前场景无在场人物"。
 * - entity 读取失败 → CharacterCard 显示 ref/localId + "档案缺失"。
 */
import { computed, onMounted, ref, watch } from "vue"
import { useRuntime } from "../../composables/useRuntime"
import { useScene } from "../../composables/useScene"
import CharacterList from "./CharacterList.vue"
import CharacterSlot from "./CharacterSlot.vue"

const { runtimeData } = useRuntime()

const runtime = computed(() => runtimeData.value.runtime)
const runtimeError = computed(() => runtimeData.value.error)
const runtimeStatus = computed(() => runtimeData.value.status)

const sceneRef = computed(() => {
  const r = runtime.value
  if (!r) return null
  return r.activeSceneRefs[0]?.ref ?? null
})

// 当前场景 ref（用于 :key 和 useScene 绑定）。setup 期固定；sceneRef 变化时
// 通过根 div :key=currentSceneRef 触发整个视图 remount，setup 重新跑。
const currentSceneRef = computed(() => sceneRef.value ?? "")

const { data: sceneData, error: sceneError, load: loadScene } = useScene(currentSceneRef.value)

const presentRefs = computed<Array<{ ref: string }>>(() => {
  const raw = sceneData.value?.entity?.present
  if (!Array.isArray(raw)) return []
  const out: Array<{ ref: string }> = []
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue
    const r = (item as Record<string, unknown>).ref
    if (typeof r === "string" && r.length > 0) out.push({ ref: r })
  }
  return out
})

const hasPresent = computed(() => presentRefs.value.length > 0)

// 默认选中：protagonistRef.ref 优先；其次 present[0].ref；都没有则 null。
const defaultSelectedRef = computed<string | null>(() => {
  const prot = runtime.value?.protagonistRef?.ref
  if (prot && prot.length > 0) return prot
  return presentRefs.value[0]?.ref ?? null
})

const selectedRef = ref<string | null>(null)
const portraitRefreshToken = ref(0)

// 当默认选中变化时（首次加载、场景切换 remount 后），同步 selectedRef。
watch(
  defaultSelectedRef,
  (v) => {
    selectedRef.value = v
  },
  { immediate: true },
)

const protagonistRef = computed(() => runtime.value?.protagonistRef?.ref ?? null)

onMounted(() => {
  if (currentSceneRef.value) void loadScene()
})

function onSelect(ref: string) {
  selectedRef.value = ref
}

function onPortraitUpdated() {
  portraitRefreshToken.value += 1
}

// 状态派生（用于模板分支）
const isRuntimeLoading = computed(
  () => runtimeStatus.value === "loading" || runtimeStatus.value === "idle",
)
const runtimeReady = computed(() => runtimeStatus.value === "ready")
const runtimeFailed = computed(
  () => runtimeStatus.value === "error" || runtimeError.value !== null,
)
const sceneMissing = computed(() => runtimeReady.value && !currentSceneRef.value)
const sceneLoading = computed(
  () =>
    !sceneData.value &&
    sceneError.value === null &&
    Boolean(currentSceneRef.value) &&
    runtimeReady.value,
)
const sceneFailed = computed(() => sceneError.value === "load-failed")
const scenePresentEmpty = computed(
  () => sceneData.value !== null && sceneError.value === null && !hasPresent.value,
)
</script>

<template>
  <div :key="currentSceneRef" class="character-view">
    <!-- runtime 错误降级 -->
    <div v-if="runtimeFailed" class="cv-empty">
      <p class="cv-empty-text">存档运行时不可读</p>
    </div>
    <!-- runtime 加载中 -->
    <div v-else-if="isRuntimeLoading" class="cv-empty">
      <p class="cv-empty-text">读取运行时…</p>
    </div>
    <!-- runtime ready 但无活跃场景 -->
    <div v-else-if="sceneMissing" class="cv-empty">
      <p class="cv-empty-text">当前无活跃场景</p>
    </div>
    <!-- scene 读取失败 -->
    <div v-else-if="sceneFailed" class="cv-empty">
      <p class="cv-empty-text">场景数据不可读</p>
    </div>
    <!-- scene 读取中 -->
    <div v-else-if="sceneLoading" class="cv-empty">
      <p class="cv-empty-text">读取场景…</p>
    </div>
    <!-- 场景在场人物为空 -->
    <div v-else-if="scenePresentEmpty" class="cv-empty">
      <p class="cv-empty-text">当前场景无在场人物</p>
    </div>
    <!-- 主视图：CharacterList + CharacterSlot -->
    <template v-else-if="runtimeReady && hasPresent">
      <CharacterList
        :present-refs="presentRefs"
        :selected-ref="selectedRef"
        :protagonist-ref="protagonistRef"
        :relationships="null"
        :portrait-refresh-token="portraitRefreshToken"
        @select="onSelect"
      />
      <Transition name="character-card-switch" mode="out-in">
        <CharacterSlot
          :key="selectedRef ?? 'none'"
          :selected-ref="selectedRef"
          :protagonist-ref="protagonistRef"
          @select="onSelect"
          @portrait-updated="onPortraitUpdated"
        />
      </Transition>
    </template>
    <!-- 兜底空态 -->
    <div v-else class="cv-empty">
      <p class="cv-empty-text">无可用角色</p>
    </div>
  </div>
</template>

<style scoped>
.character-view {
  /* 让出顶部 header；左右按侧栏展开状态平滑让位。 */
  display: flex;
  height: calc(100% - var(--play-header-height));
  width: 100%;
  min-width: 0;
  margin-top: var(--play-header-height);
  padding-right: var(--play-right-panel);
  padding-left: var(--play-left-panel);
  overflow: hidden;
  transition: padding-right 0.3s var(--play-sidebar-ease), padding-left 0.3s var(--play-sidebar-ease);
  box-sizing: border-box;
}
.cv-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cv-empty-text {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 0.9rem;
  color: var(--prose-faint);
  font-style: italic;
  letter-spacing: 0.06em;
}
.character-card-switch-enter-active {
  transition: opacity 240ms cubic-bezier(0.22, 1, 0.36, 1), transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
}
.character-card-switch-leave-active {
  transition: opacity 140ms ease, transform 140ms ease;
}
.character-card-switch-enter-from {
  opacity: 0;
  transform: translateX(12px);
}
.character-card-switch-leave-to {
  opacity: 0;
  transform: translateX(-8px);
}
@media (prefers-reduced-motion: reduce) {
  .character-card-switch-enter-active,
  .character-card-switch-leave-active {
    transition: none;
  }
}
</style>
