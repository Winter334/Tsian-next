<script setup lang="ts">
/** CharacterView — 角色页状态、场景读取、移动人物抽屉与主滚动所有者。 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from "reka-ui"
import { useRuntime } from "../../composables/useRuntime"
import { getTsianClient } from "../../composables/useTsian"
import { sceneIdToPath } from "../../composables/useScene"
import { parseScene } from "../../lib/parse-entity"
import type { EntityData } from "../../lib/runtime-types"
import CharacterList from "./CharacterList.vue"
import CharacterSlot from "./CharacterSlot.vue"
import type { CharacterMode } from "./CharacterStage.vue"

const { runtimeData } = useRuntime()
const runtime = computed(() => runtimeData.value.runtime)
const runtimeError = computed(() => runtimeData.value.error)
const runtimeStatus = computed(() => runtimeData.value.status)
const currentSceneRef = computed(() => runtime.value?.activeSceneRefs[0]?.ref ?? "")
const protagonistRef = computed(() => runtime.value?.protagonistRef?.ref ?? null)

const sceneData = ref<EntityData | null>(null)
const sceneError = ref<"load-failed" | "not-found" | null>(null)
const sceneLoading = ref(false)
let sceneRequestVersion = 0

const selectedRef = ref<string | null>(null)
const activeMode = ref<CharacterMode>("character")
const trackScroll = ref<Record<CharacterMode, number>>({ character: 0, items: 0 })
const portraitRefreshToken = ref(0)
const characterDrawerOpen = ref(false)
const characterDrawerReturnFocus = ref<HTMLButtonElement | null>(null)
const characterSlot = ref<InstanceType<typeof CharacterSlot> | null>(null)
const desktopMedia = window.matchMedia("(min-width: 721px)")
const pageScroll = ref<HTMLElement | null>(null)
const heroCollapsed = ref(false)

const presentRefs = computed<Array<{ ref: string }>>(() => {
  const raw = sceneData.value?.entity?.present
  if (!Array.isArray(raw)) return []
  const out: Array<{ ref: string }> = []
  for (const item of raw) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue
    const entityRef = (item as Record<string, unknown>).ref
    if (typeof entityRef === "string" && entityRef.length > 0) out.push({ ref: entityRef })
  }
  return out
})

const hasPresent = computed(() => presentRefs.value.length > 0)

watch(
  () => [currentSceneRef.value, runtime.value?.updatedAtTurn ?? -1] as const,
  ([entityRef]) => void loadScene(entityRef),
  { immediate: true },
)
watch(protagonistRef, () => reconcileSelection())

onMounted(() => {
  desktopMedia.addEventListener("change", closeCharacterDrawerOnDesktop)
})

onBeforeUnmount(() => {
  sceneRequestVersion += 1
  desktopMedia.removeEventListener("change", closeCharacterDrawerOnDesktop)
})

async function loadScene(entityRef: string): Promise<void> {
  const version = ++sceneRequestVersion
  sceneData.value = null
  sceneError.value = null
  if (!entityRef) {
    sceneLoading.value = false
    selectedRef.value = null
    return
  }

  sceneLoading.value = true
  try {
    const file = await getTsianClient().workspace.read(sceneIdToPath(entityRef), "save-runtime")
    if (version !== sceneRequestVersion) return
    if (file === null) {
      sceneError.value = "not-found"
      return
    }
    let raw: unknown
    try {
      raw = JSON.parse(file.content)
    } catch {
      sceneError.value = "load-failed"
      return
    }
    sceneData.value = parseScene(raw)
    if (version !== sceneRequestVersion) return
    reconcileSelection()
  } catch {
    if (version === sceneRequestVersion) sceneError.value = "load-failed"
  } finally {
    if (version === sceneRequestVersion) sceneLoading.value = false
  }
}

/** 保留仍在场的选择；否则在场主角优先，再取第一位在场角色。 */
function reconcileSelection(): void {
  const refs = new Set(presentRefs.value.map((entry) => entry.ref))
  if (selectedRef.value && refs.has(selectedRef.value)) return
  const protagonist = protagonistRef.value
  selectedRef.value = protagonist && refs.has(protagonist)
    ? protagonist
    : (presentRefs.value[0]?.ref ?? null)
}

function onSelect(entityRef: string): void {
  if (!presentRefs.value.some((entry) => entry.ref === entityRef)) return
  if (characterDrawerOpen.value) characterDrawerReturnFocus.value = null
  selectedRef.value = entityRef
  characterDrawerOpen.value = false
  heroCollapsed.value = false
  pageScroll.value?.scrollTo({ top: 0, behavior: "auto" })
}

function openCharacterDrawer(trigger: HTMLButtonElement): void {
  if (desktopMedia.matches) return
  characterDrawerReturnFocus.value = trigger
  characterDrawerOpen.value = true
}

function closeCharacterDrawerOnDesktop(event: MediaQueryListEvent): void {
  if (!event.matches) return
  characterDrawerReturnFocus.value = null
  characterDrawerOpen.value = false
}

async function restoreCharacterDrawerFocus(event: Event): Promise<void> {
  const originalTrigger = characterDrawerReturnFocus.value
  characterDrawerReturnFocus.value = null
  if (originalTrigger?.isConnected) {
    event.preventDefault()
    originalTrigger.focus()
    return
  }

  event.preventDefault()
  await nextTick()
  if (!desktopMedia.matches) characterSlot.value?.focusCharacterDrawerTrigger()
}

function updateTrackScroll(mode: CharacterMode, value: number): void {
  trackScroll.value[mode] = value
}

function onPageScroll(): void {
  const el = pageScroll.value
  if (!el) return
  const threshold = Math.max(170, Math.min(el.clientHeight * 0.34, 320))
  heroCollapsed.value = el.scrollTop > threshold
}

function updateCharacterDrawerOpen(open: boolean): void {
  if (desktopMedia.matches) {
    characterDrawerReturnFocus.value = null
    characterDrawerOpen.value = false
    return
  }
  characterDrawerOpen.value = open
}

const isRuntimeLoading = computed(() =>
  runtimeStatus.value === "loading" || runtimeStatus.value === "idle",
)
const runtimeReady = computed(() => runtimeStatus.value === "ready")
const runtimeFailed = computed(() =>
  runtimeStatus.value === "error" || runtimeError.value !== null,
)
const sceneMissing = computed(() => runtimeReady.value && !currentSceneRef.value)
const sceneFailed = computed(() => sceneError.value !== null)
const scenePresentEmpty = computed(() =>
  sceneData.value !== null && sceneError.value === null && !hasPresent.value,
)
</script>

<template>
  <div ref="pageScroll" class="character-view" @scroll="onPageScroll">
    <div v-if="runtimeFailed" class="cv-empty"><p>存档运行时不可读</p></div>
    <div v-else-if="isRuntimeLoading" class="cv-empty"><p>读取运行时…</p></div>
    <div v-else-if="sceneMissing" class="cv-empty"><p>当前无活跃场景</p></div>
    <div v-else-if="sceneFailed" class="cv-empty"><p>场景数据不可读</p></div>
    <div v-else-if="sceneLoading" class="cv-empty"><p>读取场景…</p></div>
    <div v-else-if="scenePresentEmpty" class="cv-empty"><p>当前场景无在场人物</p></div>

    <template v-else-if="runtimeReady && hasPresent">
      <CharacterList
        class="desktop-character-list"
        :present-refs="presentRefs"
        :selected-ref="selectedRef"
        :protagonist-ref="protagonistRef"
        :portrait-refresh-token="portraitRefreshToken"
        @select="onSelect"
      />
      <Transition name="character-card-switch" mode="out-in">
        <CharacterSlot
          :key="selectedRef ?? 'none'"
          ref="characterSlot"
          :selected-ref="selectedRef"
          :protagonist-ref="protagonistRef"
          :active-mode="activeMode"
          :track-scroll-top="trackScroll[activeMode]"
          :mobile-hero-collapsed="heroCollapsed"
          :portrait-refresh-token="portraitRefreshToken"
          :runtime-revision="runtime?.updatedAtTurn ?? 0"
          @select="onSelect"
          @portrait-updated="portraitRefreshToken += 1"
          @open-character-drawer="openCharacterDrawer"
          @update:active-mode="activeMode = $event"
          @update:track-scroll="updateTrackScroll"
        />
      </Transition>

      <DialogRoot :open="characterDrawerOpen" @update:open="updateCharacterDrawerOpen">
        <DialogPortal>
          <DialogOverlay class="character-drawer-overlay" />
          <DialogContent class="character-drawer" @close-auto-focus="restoreCharacterDrawerFocus">
            <header class="character-drawer-head">
              <div>
                <DialogTitle class="character-drawer-title">在场人物</DialogTitle>
                <DialogDescription class="character-drawer-description">
                  选择后返回当前角色卷宗
                </DialogDescription>
              </div>
              <DialogClose class="character-drawer-close" aria-label="关闭人物抽屉">×</DialogClose>
            </header>
            <CharacterList
              variant="drawer"
              :present-refs="presentRefs"
              :selected-ref="selectedRef"
              :protagonist-ref="protagonistRef"
              :portrait-refresh-token="portraitRefreshToken"
              @select="onSelect"
            />
          </DialogContent>
        </DialogPortal>
      </DialogRoot>
    </template>

    <div v-else class="cv-empty"><p>无可用角色</p></div>
  </div>
</template>

<style scoped>
.character-view {
  display: flex;
  height: calc(100% - var(--play-header-height));
  width: 100%;
  min-width: 0;
  margin-top: var(--play-header-height);
  padding-right: var(--play-right-panel);
  padding-left: var(--play-left-panel);
  overflow: hidden;
  box-sizing: border-box;
  transition: padding-right 0.3s var(--play-sidebar-ease), padding-left 0.3s var(--play-sidebar-ease);
}

.cv-empty {
  flex: 1;
  display: grid;
  place-items: center;
}

.cv-empty p {
  margin: 0;
  font-size: 0.86rem;
  color: var(--prose-faint);
  font-style: italic;
  letter-spacing: 0.06em;
}

.character-card-switch-enter-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.character-card-switch-leave-active {
  transition: opacity 0.12s ease;
}

.character-card-switch-enter-from {
  opacity: 0;
  transform: translateX(8px);
}

.character-card-switch-leave-to {
  opacity: 0;
}

.character-drawer-overlay {
  position: fixed;
  inset: 0;
  z-index: 160;
  background: rgba(3, 3, 5, 0.78);
  backdrop-filter: blur(5px);
}

.character-drawer {
  position: fixed;
  z-index: 161;
  inset: 0 auto 0 0;
  width: min(84vw, 330px);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 8px;
  padding: calc(18px + env(safe-area-inset-top)) 14px calc(18px + env(safe-area-inset-bottom));
  box-sizing: border-box;
  border: 0;
  border-right: 1px solid var(--line-strong);
  background:
    radial-gradient(circle at 25% 12%, rgba(181, 137, 61, 0.13), transparent 38%),
    rgba(9, 5, 6, 0.98);
  box-shadow: 24px 0 70px rgba(0, 0, 0, 0.56);
  outline: none;
}

.character-drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 4px 10px;
  border-bottom: 1px solid var(--line);
}

.character-drawer-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.25rem;
  letter-spacing: 0.08em;
  color: var(--ember-bright);
}

.character-drawer-description {
  margin-top: 3px;
  font-family: var(--font-mono);
  font-size: 0.6rem;
  letter-spacing: 0.07em;
  color: var(--prose-faint);
}

.character-drawer-close {
  width: 36px;
  height: 36px;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: rgba(6, 6, 8, 0.5);
  color: var(--prose-muted);
  font-size: 1.35rem;
  cursor: pointer;
}

.character-drawer-close:hover,
.character-drawer-close:focus-visible {
  outline: 2px solid var(--ember-bright);
  outline-offset: 2px;
  color: var(--ember-bright);
}

@media (min-width: 721px) {
  .character-drawer-overlay,
  .character-drawer {
    display: none;
  }
}

@media (max-width: 720px) {
  .character-view {
    display: block;
    height: calc(100% - var(--play-header-height) - var(--play-bottom-nav-height));
    margin-top: var(--play-header-height);
    padding: 0 0 calc(18px + env(safe-area-inset-bottom));
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: none;
    transition: none;
  }

  .character-view::-webkit-scrollbar {
    display: none;
  }

  .desktop-character-list {
    display: none;
  }

  .cv-empty {
    min-height: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .character-card-switch-enter-active,
  .character-card-switch-leave-active {
    transition: none;
  }
}
</style>
