<script setup lang="ts">
/** CharacterSlot — 选中角色的数据读取边界。 */
import { computed, onBeforeUnmount, ref, watch } from "vue"
import { useEntity } from "../../composables/useEntity"
import { useEquipmentManagement, type EquipmentSlotSelection } from "../../composables/useEquipmentManagement"
import { useRelationships } from "../../composables/useRelationships"
import { useTsian } from "../../composables/useTsian"
import { parseCharacter } from "../../lib/parse-character"
import EquipmentManagementDialog from "../equipment/EquipmentManagementDialog.vue"
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
const { tsian } = useTsian()
const { data: entityData, error: entityError, load: loadEntity } = useEntity(entityRef)
const { data: relationshipsData, load: loadRelationships } = useRelationships(entityRef)
const workspaceRefreshToken = ref(0)
let loadedRuntimeRevision: number | null = null

watch(
  () => [entityRef.value, props.runtimeRevision] as const,
  ([refValue, runtimeRevision]) => {
    if (!refValue) return
    const force = loadedRuntimeRevision !== null && runtimeRevision !== loadedRuntimeRevision
    loadedRuntimeRevision = runtimeRevision
    void loadEntity({ force })
    void loadRelationships({ force })
  },
  { immediate: true },
)

const character = computed(() => {
  if (entityError.value !== null || !entityData.value) return null
  return parseCharacter(entityData.value.entity)
})

const loading = computed(() => entityError.value === null && !entityData.value && Boolean(entityRef.value))

async function reloadAuthoritativeCharacter(): Promise<void> {
  if (!entityRef.value) return
  await loadEntity({ force: true })
  workspaceRefreshToken.value += 1
}

const equipment = useEquipmentManagement(
  tsian,
  () => character.value,
  reloadAuthoritativeCharacter,
)
const unsubscribeMutation = tsian.onWorkspaceMutation((event) => {
  void equipment.handleWorkspaceMutation(event)
})

watch(
  entityRef,
  () => {
    if (equipment.open.value) equipment.hide()
  },
)

onBeforeUnmount(() => unsubscribeMutation())

const characterCard = ref<InstanceType<typeof CharacterCard> | null>(null)

function focusCharacterDrawerTrigger(): void {
  characterCard.value?.focusCharacterDrawerTrigger()
}

defineExpose({ focusCharacterDrawerTrigger })

function onPortraitUpdated(): void {
  void loadEntity({ force: true })
  emit("portrait-updated")
}

function showEquipment(selection: EquipmentSlotSelection): void {
  equipment.show(selection)
}

function updateEquipmentOpen(open: boolean): void {
  if (!open) equipment.hide()
}

function updateTrackScroll(mode: CharacterMode, value: number): void {
  emit("update:track-scroll", mode, value)
}
</script>

<template>
  <div class="character-slot-root">
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
      :workspace-refresh-token="workspaceRefreshToken"
      @select="emit('select', $event)"
      @portrait-updated="onPortraitUpdated"
      @open-character-drawer="emit('open-character-drawer', $event)"
      @activate-equipment="showEquipment"
      @update:active-mode="emit('update:active-mode', $event)"
      @update:track-scroll="updateTrackScroll"
    />
    <EquipmentManagementDialog
      :open="equipment.open.value"
      :selection="equipment.selection.value"
      :candidates="equipment.candidates.value"
      :loading="equipment.candidatesLoading.value"
      :selected-item-ref="equipment.selectedItemRef.value"
      :preview="equipment.preview.value"
      :preview-pending="equipment.previewPending.value"
      :commit-pending="equipment.commitPending.value"
      :error-message="equipment.errorMessage.value"
      :success-message="equipment.successMessage.value"
      @update:open="updateEquipmentOpen"
      @preview="equipment.runPreview"
      @commit="equipment.commit"
    />
  </div>
</template>

<style scoped>
.character-slot-root {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

@media (max-width: 720px) {
  .character-slot-root {
    display: block;
    min-height: 100%;
    overflow: visible;
  }
}
</style>
