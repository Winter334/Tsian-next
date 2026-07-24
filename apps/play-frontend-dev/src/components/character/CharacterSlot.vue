<script setup lang="ts">
/** CharacterSlot — 选中角色的数据读取边界。 */
import { computed, ref, watch } from "vue"
import { useEntity } from "../../composables/useEntity"
import { useRelationships } from "../../composables/useRelationships"
import { parseCharacter } from "../../lib/parse-character"
import CharacterCard from "./CharacterCard.vue"
import type { CharacterMode } from "./CharacterStage.vue"

const props = defineProps<{
  selectedRef: string | null
  protagonistRef: string | null
  activeMode: CharacterMode
  trackScrollTop: number
  mobileHeroCollapsed: boolean
  portraitRefreshToken: number
  runtimeRevision: number
}>()

const emit = defineEmits<{
  select: [ref: string]
  "portrait-updated": []
  "open-character-drawer": [trigger: HTMLButtonElement]
  "update:active-mode": [mode: CharacterMode]
  "update:track-scroll": [mode: CharacterMode, value: number]
}>()

const entityRef = computed(() => props.selectedRef ?? "")
const { data: entityData, error: entityError, load: loadEntity } = useEntity(entityRef.value)
const { data: relationshipsData, load: loadRelationships } = useRelationships(entityRef.value)

watch(
  () => props.runtimeRevision,
  () => {
    if (!entityRef.value) return
    void loadEntity()
    void loadRelationships()
  },
  { immediate: true },
)

const character = computed(() => {
  if (entityError.value !== null || !entityData.value) return null
  return parseCharacter(entityData.value.entity)
})

const loading = computed(() => entityError.value === null && !entityData.value && Boolean(entityRef.value))

const characterCard = ref<InstanceType<typeof CharacterCard> | null>(null)

function focusCharacterDrawerTrigger(): void {
  characterCard.value?.focusCharacterDrawerTrigger()
}

defineExpose({ focusCharacterDrawerTrigger })

function onPortraitUpdated(): void {
  void loadEntity()
  emit("portrait-updated")
}

function updateTrackScroll(mode: CharacterMode, value: number): void {
  emit("update:track-scroll", mode, value)
}
</script>

<template>
  <CharacterCard
    ref="characterCard"
    :entity="character"
    :loading="loading"
    :relationships="relationshipsData"
    :entity-ref="selectedRef"
    :protagonist-ref="protagonistRef"
    :active-mode="activeMode"
    :track-scroll-top="trackScrollTop"
    :mobile-hero-collapsed="mobileHeroCollapsed"
    :portrait-refresh-token="portraitRefreshToken"
    @select="emit('select', $event)"
    @portrait-updated="onPortraitUpdated"
    @open-character-drawer="emit('open-character-drawer', $event)"
    @update:active-mode="emit('update:active-mode', $event)"
    @update:track-scroll="updateTrackScroll"
  />
</template>
