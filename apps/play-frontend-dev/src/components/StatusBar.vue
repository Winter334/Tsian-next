<script setup lang="ts">
/**
 * StatusBar — 左侧状态栏容器（仅主游玩态）。
 *
 * design §5.1 / §4.3：
 * - fixed left, top 52px, bottom 0, z 19（与 AppNav 对称）。
 * - GSAP width 动画 312↔48，duration 0.3s，ease power2.inOut（同 AppNav）。
 * - 展开态是 overlay 命册侧卷，不参与主视图排版。
 * - 展开态：天时地利 → 玩家概要 → 个人信息 → 数值 → 钉选/关联。
 * - 折叠态：只渲染当前角色小肖像入口，点击展开。
 * - emit toggle（折叠态头像点击展开）+ open-character（展开态头像点击进角色卡）。
 *
 * 错误态（design §6 / type-safety §"play-frontend Workspace Data Consumption"）：
 * - error === "load-failed" → 顶部统一显示"状态暂不可用"，隐藏各分区。
 * - error === "not-found" → 各分区走空态文案（runtime=null 时子组件 fallback）。
 * - status === "loading" → 显示淡入占位。
 *
 * 数据：useRuntime() 模块级单例，与 StoryView 共享同一份 RuntimeData。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import gsap from "gsap"
import { useRuntime } from "../composables/useRuntime"
import { getTsianClient } from "../composables/useTsian"
import { refToEntityPath } from "../composables/useEntity"
import { parseCharacter } from "../lib/parse-character"
import { pickDefaultAvatarUrl } from "../lib/character-avatar"
import type { CharacterEntity } from "../lib/character-types"
import StatusBarScene from "./status-bar/StatusBarScene.vue"
import StatusBarCharacter from "./status-bar/StatusBarCharacter.vue"
import StatusBarIdentity from "./status-bar/StatusBarIdentity.vue"
import StatusBarPinned from "./status-bar/StatusBarPinned.vue"
import StatusBarMetrics from "./status-bar/StatusBarMetrics.vue"
import StatusBarRefs from "./status-bar/StatusBarRefs.vue"

const STATUS_BAR_EXPANDED_WIDTH = 312
const STATUS_BAR_COLLAPSED_WIDTH = 48

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
const characterSnapshot = computed(() => runtime.value?.protagonistRef ?? null)
const protagonistRefStr = computed(() => characterSnapshot.value?.ref ?? null)
const metrics = computed(() => displayItems.value.metrics)
const refs = computed(() => displayItems.value.refs)

// 主角 entity 集中读取：状态栏各分区共享同一份读取结果。
const entityRaw = ref<Record<string, unknown> | null>(null)
const entityLoading = ref(false)
const entityError = ref<"load-failed" | "not-found" | null>(null)
let entityLoadVersion = 0

// 肖像 object URL 管理。
const portraitUrl = ref<string | null>(null)
let portraitLoadVersion = 0

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function stringField(raw: Record<string, unknown> | null, key: string): string | undefined {
  const v = raw?.[key]
  return typeof v === "string" && v.trim().length > 0 ? v : undefined
}

async function loadProtagonistEntity(): Promise<void> {
  const refStr = protagonistRefStr.value
  const version = ++entityLoadVersion
  if (!refStr) {
    entityRaw.value = null
    entityError.value = null
    entityLoading.value = false
    void loadPortraitBinary(undefined)
    return
  }

  entityLoading.value = true
  entityError.value = null
  try {
    const file = await getTsianClient().workspace.read(refToEntityPath(refStr), "save-runtime")
    if (version !== entityLoadVersion) return
    if (file === null) {
      entityRaw.value = null
      entityError.value = "not-found"
      void loadPortraitBinary(undefined)
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(file.content)
    } catch {
      entityRaw.value = null
      entityError.value = "load-failed"
      void loadPortraitBinary(undefined)
      return
    }

    if (!isRecord(parsed)) {
      entityRaw.value = null
      entityError.value = "load-failed"
      void loadPortraitBinary(undefined)
      return
    }

    entityRaw.value = parsed
    entityError.value = null
    void loadPortraitBinary(portraitPath.value)
  } catch {
    if (version !== entityLoadVersion) return
    entityRaw.value = null
    entityError.value = "load-failed"
    void loadPortraitBinary(undefined)
  } finally {
    if (version === entityLoadVersion) entityLoading.value = false
  }
}

watch(
  () => [protagonistRefStr.value, runtime.value?.updatedAtTurn ?? -1] as const,
  () => {
    void loadProtagonistEntity()
  },
  { immediate: true },
)

const characterEntity = computed<CharacterEntity | null>(() => {
  if (!entityRaw.value) return null
  return parseCharacter(entityRaw.value)
})

const characterName = computed(() => {
  const parsedName = characterEntity.value?.name
  if (parsedName && parsedName.trim().length > 0) return parsedName
  const rawName = stringField(entityRaw.value, "name")
  if (rawName) return rawName
  return runtime.value?.protagonistRef?.name ?? ""
})

const characterBrief = computed(() => {
  const parsedBrief = characterEntity.value?.brief
  if (parsedBrief && parsedBrief.trim().length > 0) return parsedBrief
  return stringField(entityRaw.value, "brief") ?? ""
})

const hasCharacter = computed(() => Boolean(protagonistRefStr.value && characterName.value))

const characterGauges = computed(() => characterEntity.value?.gauges ?? [])

const portraitPath = computed(() => {
  const parsedPath = characterEntity.value?.portrait?.path
  if (parsedPath && parsedPath.trim().length > 0) return parsedPath
  const portrait = entityRaw.value?.portrait
  if (!isRecord(portrait)) return undefined
  const rawPath = portrait.path
  return typeof rawPath === "string" && rawPath.trim().length > 0 ? rawPath : undefined
})

const defaultAvatarSrc = computed(() => {
  if (characterEntity.value) return pickDefaultAvatarUrl(characterEntity.value)

  const identity = entityRaw.value?.identity
  const identityGender = isRecord(identity) && typeof identity.gender === "string"
    ? identity.gender
    : undefined
  const gender = stringField(entityRaw.value, "gender")

  return pickDefaultAvatarUrl({
    identity: identityGender ? { gender: identityGender } : undefined,
    gender,
  })
})

const portraitSrc = computed(() => hasCharacter.value ? (portraitUrl.value ?? defaultAvatarSrc.value) : "")

watch(
  portraitPath,
  (path) => {
    void loadPortraitBinary(path)
  },
  { immediate: true },
)

function revokePortraitUrl(): void {
  if (portraitUrl.value) {
    URL.revokeObjectURL(portraitUrl.value)
    portraitUrl.value = null
  }
}

async function loadPortraitBinary(path: string | undefined): Promise<void> {
  const version = ++portraitLoadVersion
  if (!path) {
    revokePortraitUrl()
    return
  }

  try {
    const file = await getTsianClient().workspace.read(path, "save-runtime")
    if (version !== portraitLoadVersion) return
    if (file === null) {
      revokePortraitUrl()
      return
    }
    const blob = file.binary
    if (!blob || blob.size === 0) {
      revokePortraitUrl()
      return
    }
    const nextUrl = URL.createObjectURL(blob)
    if (version !== portraitLoadVersion) {
      URL.revokeObjectURL(nextUrl)
      return
    }
    revokePortraitUrl()
    portraitUrl.value = nextUrl
  } catch {
    if (version !== portraitLoadVersion) return
    revokePortraitUrl()
  }
}

onBeforeUnmount(() => {
  revokePortraitUrl()
})

// GSAP width 动画（collapsed 变化时）—— 同 AppNav 模式。
watch(
  () => props.collapsed,
  (collapsed) => {
    if (!barRef.value) return
    gsap.to(barRef.value, {
      width: collapsed ? STATUS_BAR_COLLAPSED_WIDTH : STATUS_BAR_EXPANDED_WIDTH,
      duration: 0.3,
      ease: "power2.inOut",
    })
  },
)

onMounted(() => {
  // 初始宽度对齐 collapsed 状态（无动画）—— 同 AppNav onMounted 模式。
  if (barRef.value) {
    barRef.value.style.width = props.collapsed
      ? `${STATUS_BAR_COLLAPSED_WIDTH}px`
      : `${STATUS_BAR_EXPANDED_WIDTH}px`
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

    <template v-else>
      <!-- 折叠态：当前角色小肖像入口（点击展开）。 -->
      <StatusBarCharacter
        v-if="collapsed"
        :character="characterSnapshot"
        :collapsed="true"
        :has-character="hasCharacter"
        :name="characterName"
        :brief="characterBrief"
        :portrait-src="portraitSrc"
        :loading="entityLoading"
        :entity-error="entityError"
        @toggle="emit('toggle')"
        @open-character="emit('open-character')"
      />

      <!-- 展开态：命册侧卷。 -->
      <div v-else class="sb-expanded-body">
        <StatusBarScene :runtime="runtime" />
        <StatusBarCharacter
          :character="characterSnapshot"
          :collapsed="false"
          :has-character="hasCharacter"
          :name="characterName"
          :brief="characterBrief"
          :portrait-src="portraitSrc"
          :loading="entityLoading"
          :entity-error="entityError"
          @toggle="emit('toggle')"
          @open-character="emit('open-character')"
        />
        <StatusBarIdentity :entity="characterEntity" />
        <StatusBarMetrics :gauges="characterGauges" :metrics="metrics" />
        <StatusBarPinned
          :key="`pinned-${protagonistRefStr ?? 'none'}-${runtime?.updatedAtTurn ?? 0}`"
          :protagonist-ref="protagonistRefStr"
        />
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
  width: 312px;
  z-index: 19;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-right: 1px solid rgba(181, 137, 61, 0.28);
  background:
    radial-gradient(circle at 45% 12%, rgba(181, 137, 61, 0.12), transparent 34%),
    radial-gradient(circle at 15% 52%, rgba(155, 58, 46, 0.08), transparent 36%),
    linear-gradient(180deg, rgba(18, 10, 8, 0.88), rgba(7, 4, 5, 0.82)),
    rgba(10, 5, 6, 0.78);
  backdrop-filter: blur(12px);
  box-shadow:
    inset -1px 0 0 rgba(232, 169, 72, 0.06),
    18px 0 48px rgba(0, 0, 0, 0.28);
}
.status-bar::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(90deg, rgba(232, 169, 72, 0.035), transparent 26%),
    radial-gradient(circle at 50% 82%, rgba(232, 169, 72, 0.05), transparent 34%);
  opacity: 0.9;
}
.status-bar.collapsed {
  box-shadow:
    inset -1px 0 0 rgba(232, 169, 72, 0.08),
    10px 0 28px rgba(0, 0, 0, 0.22);
}

.sb-expanded-body {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 14px 14px 24px;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.sb-expanded-body::-webkit-scrollbar {
  display: none;
}

/* loading / fatal 占位：垂直居中淡入文案 */
.sb-loading,
.sb-fatal {
  position: relative;
  z-index: 1;
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
  color: var(--prose-faint);
  letter-spacing: 0.08em;
  text-align: center;
  font-style: italic;
  animation: sb-fade 1.2s ease-in-out infinite alternate;
}
.sb-fatal-text {
  animation: none;
  color: var(--prose-muted);
}
@keyframes sb-fade {
  0% { opacity: 0.72; }
  100% { opacity: 1; }
}
</style>
