<script setup lang="ts">
/** CharacterStage — 固定立绘中心与共享双轨滚动层。 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue"
import type { CharacterEntity, CharacterEquipmentSlot, RelationshipFile } from "../../lib/character-types"
import type { ItemEntity } from "../../lib/item-types"
import { loadInventoryEntity } from "../../lib/load-inventory-entity"
import AttributeCard from "./AttributeCard.vue"
import CharacterPortrait from "./CharacterPortrait.vue"
import CharacterStageHighlights from "./CharacterStageHighlights.vue"
import EquipmentSlot from "./EquipmentSlot.vue"
import GaugeBar from "./GaugeBar.vue"

export type CharacterMode = "character" | "items"

const props = defineProps<{
  entity: CharacterEntity
  relationships: RelationshipFile | null
  entityRef: string
  activeMode: CharacterMode
  scrollTop: number
  fallbackSrc: string
  effectivePinRef: string | null
  highlightedItemRef: string | null
  equipmentInteractive: boolean
}>()

export interface IndexedEquipmentSlot {
  slotType: string
  slotIndex: number
  slot: CharacterEquipmentSlot
}

const emit = defineEmits<{
  "portrait-updated": []
  "update:scroll-top": [mode: CharacterMode, value: number]
  "select-item": [ref: string]
  "highlight-item": [ref: string | null]
  "activate-equipment": [selection: IndexedEquipmentSlot, trigger: HTMLElement]
}>()

const trackScroll = ref<HTMLElement | null>(null)
const itemByRef = ref<Record<string, ItemEntity | null>>({})
const loadingRefs = ref<Set<string>>(new Set())
let equipmentLoadVersion = 0

const attributes = computed(() => Object.entries(props.entity.attributes ?? {}))
const equipment = computed<IndexedEquipmentSlot[]>(() => Object.entries(props.entity.equipment ?? {}).flatMap(
  ([slotType, slots]) => slots.map((slot, slotIndex) => ({ slotType, slotIndex, slot })),
))
const leftAttributes = computed(() => attributes.value.filter((_, index) => index % 2 === 0))
const rightAttributes = computed(() => attributes.value.filter((_, index) => index % 2 === 1))
const leftEquipment = computed(() => equipment.value.filter((_, index) => index % 2 === 0))
const rightEquipment = computed(() => equipment.value.filter((_, index) => index % 2 === 1))

const identityLine = computed(() => {
  const identity = props.entity.identity
  return [identity?.role, identity?.affiliation, identity?.realm].filter(Boolean).join(" · ")
})

const hasTracks = computed(() => props.activeMode === "character"
  ? attributes.value.length > 0
  : equipment.value.length > 0)

watch(
  () => props.activeMode,
  async () => {
    await nextTick()
    if (trackScroll.value) trackScroll.value.scrollTop = props.scrollTop
  },
  { immediate: true },
)

watch(
  () => props.scrollTop,
  (value) => {
    const el = trackScroll.value
    if (el && Math.abs(el.scrollTop - value) > 1) el.scrollTop = value
  },
)

watch(
  equipment,
  () => {
    void loadEquipmentItems()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  equipmentLoadVersion += 1
})

async function loadEquipmentItems(): Promise<void> {
  const version = ++equipmentLoadVersion
  const refs = Array.from(new Set(equipment.value.flatMap(({ slot }) => slot.ref ? [slot.ref] : [])))
  loadingRefs.value = new Set(refs)
  const next: Record<string, ItemEntity | null> = {}

  await Promise.all(refs.map(async (entityRef) => {
    const result = await loadInventoryEntity(entityRef)
    next[entityRef] = result.entity?.type !== "container" ? (result.entity as ItemEntity | null) : null
  }))

  if (version !== equipmentLoadVersion) return
  itemByRef.value = next
  loadingRefs.value = new Set()
}

function onTrackScroll(): void {
  if (!trackScroll.value) return
  emit("update:scroll-top", props.activeMode, trackScroll.value.scrollTop)
}
</script>

<template>
  <section class="character-stage" :class="`mode-${activeMode}`">
    <div class="stage-body">
      <div
        ref="trackScroll"
        class="track-scroll"
        tabindex="0"
        aria-label="角色舞台信息轨道"
        @scroll="onTrackScroll"
      >
        <div v-if="hasTracks" class="track-grid">
          <div class="track-column track-left">
            <template v-if="activeMode === 'character'">
              <AttributeCard
                v-for="([name, value]) in leftAttributes"
                :key="name"
                :name="name"
                :value="value"
                :entity-ref="effectivePinRef"
              />
            </template>
            <template v-else>
              <EquipmentSlot
                v-for="entry in leftEquipment"
                :key="`${entry.slotType}:${entry.slotIndex}`"
                :name="entry.slotType"
                :slot-index="entry.slotIndex"
                :slot="entry.slot"
                :item="entry.slot.ref ? (itemByRef[entry.slot.ref] ?? null) : null"
                :loading="Boolean(entry.slot.ref && loadingRefs.has(entry.slot.ref))"
                :highlighted="Boolean(entry.slot.ref && entry.slot.ref === highlightedItemRef)"
                :interactive="equipmentInteractive"
                @select="emit('select-item', $event)"
                @activate="emit('activate-equipment', entry, $event)"
                @highlight="emit('highlight-item', $event)"
              />
            </template>
          </div>

          <div class="track-center-spacer" aria-hidden="true" />

          <div class="track-column track-right">
            <template v-if="activeMode === 'character'">
              <AttributeCard
                v-for="([name, value]) in rightAttributes"
                :key="name"
                :name="name"
                :value="value"
                :entity-ref="effectivePinRef"
              />
            </template>
            <template v-else>
              <EquipmentSlot
                v-for="entry in rightEquipment"
                :key="`${entry.slotType}:${entry.slotIndex}`"
                :name="entry.slotType"
                :slot-index="entry.slotIndex"
                :slot="entry.slot"
                :item="entry.slot.ref ? (itemByRef[entry.slot.ref] ?? null) : null"
                :loading="Boolean(entry.slot.ref && loadingRefs.has(entry.slot.ref))"
                :highlighted="Boolean(entry.slot.ref && entry.slot.ref === highlightedItemRef)"
                :interactive="equipmentInteractive"
                @select="emit('select-item', $event)"
                @activate="emit('activate-equipment', entry, $event)"
                @highlight="emit('highlight-item', $event)"
              />
            </template>
          </div>
        </div>
        <p v-else class="track-empty">
          {{ activeMode === "character" ? "未记录属性" : "未设置装备槽" }}
        </p>
      </div>

      <div class="stage-center">
        <div class="stage-identity">
          <h1>{{ entity.name }}</h1>
          <p v-if="identityLine">{{ identityLine }}</p>
          <p v-else>{{ entity.brief }}</p>
        </div>

        <CharacterPortrait
          :name="entity.name"
          :portrait-path="entity.portrait?.path"
          :fallback-src="fallbackSrc"
          :can-upload="true"
          :entity-ref="entityRef"
          @portrait-updated="emit('portrait-updated')"
        />

        <div v-if="entity.gauges?.length" class="stage-gauges">
          <GaugeBar
            v-for="gauge in entity.gauges"
            :key="gauge.id"
            :gauge="gauge"
            :entity-ref="effectivePinRef"
          />
        </div>

        <CharacterStageHighlights
          v-if="entity.status?.length || entity.traits?.length"
          class="stage-highlights-band"
          :status="entity.status"
          :traits="entity.traits"
          :entity-ref="effectivePinRef"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.character-stage {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background:
    radial-gradient(ellipse at 50% 46%, rgba(155, 58, 46, 0.11), transparent 45%),
    radial-gradient(ellipse at 50% 45%, rgba(181, 137, 61, 0.075), transparent 62%);
}

.stage-body {
  position: relative;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.track-scroll {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  scrollbar-width: none;
  outline: none;
  mask-image: linear-gradient(transparent 0, black 5%, black 94%, transparent 100%);
}

.track-scroll::-webkit-scrollbar {
  display: none;
}

.track-scroll:focus-visible {
  box-shadow: inset 0 0 0 1px rgba(232, 169, 72, 0.42);
}

.track-grid {
  min-height: calc(100% + 1px);
  display: grid;
  grid-template-columns: minmax(68px, 90px) minmax(280px, 1fr) minmax(68px, 90px);
  gap: clamp(5px, 0.9vw, 12px);
  align-items: start;
  padding: 54px 6px 118px;
  box-sizing: border-box;
}

.track-column {
  min-width: 0;
  display: grid;
  grid-template-columns: 1fr;
  gap: 9px;
}

.mode-items .track-right {
  padding-top: 50px;
}

.stage-center {
  position: absolute;
  z-index: 2;
  top: 12px;
  left: 50%;
  width: min(58%, 430px);
  max-height: min(84%, 760px);
  transform: translateX(-50%);
  display: grid;
  grid-template-rows: auto minmax(0, auto) auto;
  justify-items: center;
  gap: 8px;
  pointer-events: none;
}

.stage-center :deep(button),
.stage-center :deep(.pin-btn) {
  pointer-events: auto;
}

.stage-identity {
  max-width: 100%;
  text-align: center;
  text-shadow: 0 2px 16px rgba(6, 6, 8, 0.94);
}

.stage-identity h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(1.45rem, 2.5vw, 2.1rem);
  line-height: 1.05;
  letter-spacing: 0.09em;
  color: var(--ember-bright);
}

.stage-identity p {
  margin: 5px 0 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.08em;
  color: var(--prose-muted);
}

.stage-center :deep(.portrait-stack) {
  width: min(100%, 420px);
  height: auto;
  min-height: 0;
  display: grid;
  place-items: center;
}

.stage-center :deep(.portrait-frame) {
  width: 100%;
  height: auto;
  max-width: 100%;
  max-height: min(58dvh, 660px);
}

.stage-highlights-band {
  position: absolute;
  top: calc(100% + 10px);
  left: 50%;
  width: clamp(420px, 156%, 680px);
  max-height: min(24dvh, 240px);
  transform: translateX(-50%);
  pointer-events: auto;
}

.stage-gauges {
  width: 100%;
  display: grid;
  gap: 7px;
  padding: 9px 10px 7px;
  box-sizing: border-box;
  background: linear-gradient(90deg, transparent, rgba(6, 6, 8, 0.78) 12%, rgba(6, 6, 8, 0.78) 88%, transparent);
  pointer-events: auto;
}

.stage-gauges :deep(.gauge-row) {
  grid-template-columns: 70px minmax(40px, 1fr) 48px;
  gap: 7px;
  font-size: 0.68rem;
}

.track-empty {
  position: absolute;
  top: 50%;
  left: 12px;
  right: 12px;
  margin: 0;
  transform: translateY(-50%);
  text-align: center;
  font-size: 0.74rem;
  color: var(--prose-faint);
  font-style: italic;
}

@media (max-width: 720px) {
  .character-stage {
    overflow: visible;
    background:
      radial-gradient(ellipse at 50% 22%, rgba(155, 58, 46, 0.13), transparent 30%),
      radial-gradient(ellipse at 50% 28%, rgba(181, 137, 61, 0.08), transparent 46%);
  }

  .stage-body {
    height: auto;
    overflow: visible;
    display: flex;
    flex-direction: column;
  }

  .stage-center {
    position: relative;
    z-index: 2;
    order: -1;
    inset: auto;
    left: auto;
    width: 100%;
    transform: none;
    display: grid;
    grid-template-rows: auto minmax(34dvh, 40dvh) auto auto;
    justify-items: center;
    gap: 8px;
    padding: 14px 0 8px;
    box-sizing: border-box;
  }

  .stage-identity h1 {
    font-size: clamp(1.55rem, 8vw, 2.15rem);
  }

  .stage-identity p {
    max-width: 82vw;
  }

  .stage-center :deep(.portrait-stack) {
    width: min(76vw, 320px);
    height: 100%;
  }

  .stage-center :deep(.portrait-frame) {
    width: 100%;
    height: 100%;
  }

  .stage-highlights-band {
    position: static;
    width: min(92vw, 430px);
    max-height: none;
    margin: 0 auto 10px;
    transform: none;
  }

  .stage-gauges {
    width: 100%;
  }

  .track-scroll {
    position: static;
    overflow: visible;
    mask-image: none;
  }

  .track-grid {
    min-height: 0;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    padding: 20px 2px 4px;
  }

  .track-column {
    gap: 10px;
  }

  .mode-items .track-right {
    padding-top: 30px;
  }

  .track-center-spacer {
    display: none;
  }

  .track-empty {
    position: static;
    min-height: 110px;
    display: grid;
    place-items: center;
    transform: none;
  }
}

@media (max-height: 680px) and (max-width: 720px) {
  .stage-center {
    grid-template-rows: auto minmax(220px, 34dvh) auto auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .track-scroll {
    scroll-behavior: auto;
  }
}
</style>
