<script setup lang="ts">
/** CharacterCard — 两种模式共享同一角色舞台的页面骨架。 */
import { computed, ref } from "vue"
import type { ComponentPublicInstance } from "vue"
import type { CharacterEntity, RelationshipFile } from "../../lib/character-types"
import type { DisplayItems } from "../../lib/runtime-types"
import { emptyDisplayItems } from "../../lib/runtime-types"
import { parseExtensionsOnly } from "../../lib/parse-entity"
import { pickDefaultAvatarUrl } from "../../lib/character-avatar"
import CharacterListItem from "./CharacterListItem.vue"
import CharacterStage, { type CharacterMode } from "./CharacterStage.vue"
import InventoryPane from "./InventoryPane.vue"
import OverviewPane from "./OverviewPane.vue"

const props = defineProps<{
  entity: CharacterEntity | null
  loading: boolean
  relationships: RelationshipFile | null
  entityRef: string | null
  protagonistRef: string | null
  activeMode: CharacterMode
  trackScrollTop: number
  mobileHeroCollapsed: boolean
  portraitRefreshToken: number
}>()

const emit = defineEmits<{
  select: [ref: string]
  "portrait-updated": []
  "open-character-drawer": [trigger: HTMLButtonElement]
  "update:active-mode": [mode: CharacterMode]
  "update:track-scroll": [mode: CharacterMode, value: number]
}>()

const displayItems = computed<DisplayItems>(() => {
  if (!props.entity?.extensions) return emptyDisplayItems()
  return parseExtensionsOnly({ extensions: props.entity.extensions }).displayItems
})

const localId = computed(() => {
  if (!props.entityRef) return ""
  const idx = props.entityRef.indexOf(":")
  return idx >= 0 ? props.entityRef.slice(idx + 1) : props.entityRef
})

const defaultAvatarUrl = computed(() => pickDefaultAvatarUrl(props.entity ?? {}))
const effectivePinRef = computed(() =>
  props.entityRef && props.entityRef === props.protagonistRef ? props.entityRef : null,
)
const highlightedItemRef = ref<string | null>(null)
const requestedItemRef = ref<string | null>(null)
const mobileCharacterTrigger = ref<ComponentPublicInstance | null>(null)

function focusCharacterDrawerTrigger(): void {
  const element = mobileCharacterTrigger.value?.$el
  if (element instanceof HTMLButtonElement) element.focus()
}

defineExpose({ focusCharacterDrawerTrigger })

function selectItem(entityRef: string): void {
  highlightedItemRef.value = entityRef
  requestedItemRef.value = entityRef
}

function updateTrackScroll(mode: CharacterMode, value: number): void {
  emit("update:track-scroll", mode, value)
}
</script>

<template>
  <section class="char-card">
    <header class="mode-bar" :class="{ 'hero-collapsed': mobileHeroCollapsed }">
      <div class="mode-heading">
        <div class="mobile-character-trigger">
          <CharacterListItem
            ref="mobileCharacterTrigger"
            :entity-ref="entityRef ?? ''"
            :selected="true"
            :protagonist="entityRef === protagonistRef"
            :portrait-refresh-token="portraitRefreshToken"
            aria-label="打开在场人物抽屉"
            @select="(_, trigger) => emit('open-character-drawer', trigger)"
          />
        </div>
        <span class="mode-kicker">SMOKE-INK DOSSIER</span>
        <span class="mode-title">角色卷宗</span>
        <span v-if="mobileHeroCollapsed && entity" class="mobile-character-copy">
          <strong>{{ entity.name }}</strong>
          <small>{{ [entity.identity?.role, entity.identity?.affiliation, entity.identity?.realm].filter(Boolean).join(' · ') || entity.brief }}</small>
        </span>
      </div>
      <div class="mode-switch" role="group" aria-label="角色详情模式">
        <button
          v-for="mode in (['character', 'items'] as const)"
          :key="mode"
          type="button"
          class="mode-button"
          :class="{ active: activeMode === mode }"
          :aria-pressed="activeMode === mode"
          @click="emit('update:active-mode', mode)"
        >
          {{ mode === "character" ? "角色" : "物品" }}
        </button>
      </div>
    </header>

    <template v-if="entity && entityRef">
      <CharacterStage
        class="stage-panel"
        :entity="entity"
        :relationships="relationships"
        :entity-ref="entityRef"
        :active-mode="activeMode"
        :scroll-top="trackScrollTop"
        :fallback-src="defaultAvatarUrl"
        :effective-pin-ref="effectivePinRef"
        :highlighted-item-ref="highlightedItemRef"
        @portrait-updated="emit('portrait-updated')"
        @update:scroll-top="updateTrackScroll"
        @select-item="selectItem"
        @highlight-item="highlightedItemRef = $event"
      />

      <aside class="content-panel" :aria-label="activeMode === 'character' ? '角色档案' : '容器物品'">
        <Transition name="content-switch" mode="out-in">
          <OverviewPane
            v-if="activeMode === 'character'"
            key="character"
            :entity="entity"
            :relationships="relationships"
            :display-items="displayItems"
            :entity-ref="effectivePinRef"
            @select="emit('select', $event)"
          />
          <InventoryPane
            v-else
            key="items"
            :containers="entity.containers"
            :equipment="entity.equipment"
            :highlighted-item-ref="highlightedItemRef"
            :requested-item-ref="requestedItemRef"
            @highlight-item="highlightedItemRef = $event"
            @request-consumed="requestedItemRef = null"
          />
        </Transition>
      </aside>
    </template>

    <div v-else class="entity-missing">
      <span class="missing-glyph">{{ localId.charAt(0) || "?" }}</span>
      <span class="missing-name">{{ localId || "未知" }}</span>
      <span class="missing-hint">{{ loading ? "读取中…" : "档案缺失" }}</span>
    </div>
  </section>
</template>

<style scoped>
.char-card {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(430px, 1.1fr) minmax(320px, 0.9fr);
  grid-template-rows: auto minmax(0, 1fr);
  gap: 0 22px;
  padding: 12px 22px 16px;
  overflow: hidden;
  box-sizing: border-box;
}

.mode-bar {
  grid-column: 1 / -1;
  min-height: 50px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid var(--line);
}

.mode-heading {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.mobile-character-trigger,
.mobile-character-copy {
  display: none;
}

.mode-kicker {
  font-family: var(--font-mono);
  font-size: 0.54rem;
  letter-spacing: 0.16em;
  color: var(--whisper);
}

.mode-title {
  font-family: var(--font-display);
  font-size: 1.08rem;
  letter-spacing: 0.08em;
  color: var(--prose-muted);
}

.mode-switch {
  display: flex;
  align-self: stretch;
}

.mode-button {
  position: relative;
  min-width: 72px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--prose-muted);
  font-family: var(--font-display);
  font-size: 0.9rem;
  letter-spacing: 0.12em;
  cursor: pointer;
}

.mode-button:hover,
.mode-button:focus-visible,
.mode-button.active {
  color: var(--ember-bright);
}

.mode-button.active {
  border-bottom-color: var(--ember);
  background: linear-gradient(transparent, rgba(181, 137, 61, 0.08));
}

.mode-button:focus-visible {
  outline: 2px solid var(--ember-bright);
  outline-offset: -4px;
}

.stage-panel,
.content-panel {
  min-width: 0;
  min-height: 0;
}

.content-panel {
  overflow-y: auto;
  padding: 18px 10px 32px 0;
  scrollbar-width: none;
  mask-image: linear-gradient(black 0, black 94%, transparent 100%);
}

.content-panel::-webkit-scrollbar {
  display: none;
}

.entity-missing {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--prose-faint);
}

.missing-glyph {
  font-family: var(--font-display);
  font-size: 4rem;
  color: var(--ember-bright);
  opacity: 0.5;
}

.missing-name {
  font-family: var(--font-display);
  font-size: 1.35rem;
}

.missing-hint {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  letter-spacing: 0.1em;
}

.content-switch-enter-active,
.content-switch-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.content-switch-enter-from {
  opacity: 0;
  transform: translateY(5px);
}

.content-switch-leave-to {
  opacity: 0;
  transform: translateY(-3px);
}

@media (max-width: 720px) {
  .char-card {
    width: 100%;
    min-height: 100%;
    display: block;
    padding: 0 14px 24px;
    overflow: visible;
  }

  .mode-bar {
    position: sticky;
    z-index: 8;
    top: 0;
    min-height: 56px;
    margin: 0 -14px;
    padding: 0 12px;
    background:
      linear-gradient(90deg, rgba(181, 137, 61, 0.06), transparent 44%),
      rgba(6, 6, 8, 0.94);
    backdrop-filter: blur(12px);
  }

  .mode-heading {
    min-width: 0;
    align-items: center;
    gap: 8px;
  }

  .mode-kicker,
  .mode-title {
    display: none;
  }

  .mobile-character-trigger {
    display: block;
    width: 42px;
    min-width: 42px;
    min-height: 42px;
  }

  .mobile-character-trigger :deep(.char-list-item) {
    width: 42px;
    min-height: 42px;
    grid-template-columns: 1fr;
    padding: 3px;
    border-radius: 50%;
  }

  .mobile-character-trigger :deep(.char-list-thumb) {
    width: 34px;
  }

  .mobile-character-trigger :deep(.char-list-copy),
  .mobile-character-trigger :deep(.char-list-marker) {
    display: none;
  }

  .mode-bar.hero-collapsed .mobile-character-copy {
    min-width: 0;
    display: grid;
    gap: 1px;
  }

  .mobile-character-copy strong,
  .mobile-character-copy small {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .mobile-character-copy strong {
    font-family: var(--font-display);
    font-size: 0.88rem;
    letter-spacing: 0.05em;
    color: var(--ember-bright);
  }

  .mobile-character-copy small {
    max-width: 34vw;
    font-family: var(--font-mono);
    font-size: 0.52rem;
    color: var(--prose-faint);
  }

  .mode-switch {
    flex-shrink: 0;
    min-height: 48px;
  }

  .mode-button {
    min-width: 58px;
    font-size: 0.82rem;
  }

  .stage-panel,
  .content-panel {
    min-height: auto;
  }

  .content-panel {
    overflow: visible;
    padding: 22px 0 32px;
    mask-image: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .content-switch-enter-active,
  .content-switch-leave-active {
    transition: none;
  }
}
</style>
