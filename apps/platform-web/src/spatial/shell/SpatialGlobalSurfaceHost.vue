<template>
  <SpatialToastHost
    @sources-changed="(sourceIds) => { toastSourceIds = [...sourceIds] }"
    @source-dirty="(sourceId) => emit('sourceDirty', sourceId)"
  />
  <SpatialModalShield v-if="modalActive" @backdrop="handleBackdrop" />
  <SpatialAssistantConfigPanel
    v-if="assistantConfigState"
    :interactive="assistantConfigInteractive && !dialogActive && !confirmActive"
    @change="notifySpatialAssistantConfigChanged"
    @close="emit('requestAssistantConfigClose')"
    @move="(delta) => emit('moveAssistantConfig', delta)"
    @source-dirty="(sourceId) => emit('sourceDirty', sourceId)"
  />
  <SpatialDialogFormHost
    :interactive="dialogInteractive && !confirmActive"
    :input-enabled="!confirmActive"
    @source-dirty="(sourceId) => emit('sourceDirty', sourceId)"
    @request-close="(confirm) => emit('requestDialogClose', confirm)"
  />
  <SpatialConfirmHost
    :interactive="confirmInteractive"
    :include-shield="false"
    @source-dirty="(sourceId) => emit('sourceDirty', sourceId)"
    @request-close="(value) => emit('requestConfirmClose', value)"
  />
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { useConfirmState } from "@/composables/useConfirm"
import { useDialogFormState } from "@/composables/useDialogForm"
import SpatialAssistantConfigPanel from "../apps/assistant/SpatialAssistantConfigPanel.vue"
import {
  notifySpatialAssistantConfigChanged,
  useSpatialAssistantConfigState,
} from "../apps/assistant/spatial-assistant-config-surface"
import SpatialConfirmHost from "./SpatialConfirmHost.vue"
import SpatialDialogFormHost from "./SpatialDialogFormHost.vue"
import SpatialModalShield from "./SpatialModalShield.vue"
import SpatialToastHost from "./SpatialToastHost.vue"
import {
  SPATIAL_ASSISTANT_CONFIG_SOURCE_ID,
  SPATIAL_DIALOG_PANEL_SOURCE_ID,
  SPATIAL_MODAL_SHIELD_SOURCE_ID,
} from "./spatial-global-surfaces"
import { SPATIAL_CONFIRM_PANEL_SOURCE_ID } from "./spatial-confirm"

const props = withDefaults(defineProps<{
  assistantConfigInteractive?: boolean
  confirmInteractive?: boolean
  dialogInteractive?: boolean
}>(), {
  assistantConfigInteractive: false,
  confirmInteractive: false,
  dialogInteractive: false,
})

const emit = defineEmits<{
  sourcesChanged: [sourceIds: readonly string[]]
  sourceDirty: [sourceId: string]
  requestConfirmClose: [value: boolean | string | null]
  requestDialogClose: [confirm: boolean]
  requestAssistantConfigClose: []
  moveAssistantConfig: [delta: { x: number; y: number }]
}>()

const confirmState = useConfirmState()
const dialogState = useDialogFormState()
const assistantConfigState = useSpatialAssistantConfigState()
const toastSourceIds = ref<readonly string[]>([])
const confirmActive = computed(() => Boolean(confirmState.value))
const dialogActive = computed(() => Boolean(dialogState.value))
const modalActive = computed(() => (
  confirmActive.value || dialogActive.value || Boolean(assistantConfigState.value)
))
const sourceIds = computed<readonly string[]>(() => [
  ...toastSourceIds.value,
  ...(modalActive.value ? [SPATIAL_MODAL_SHIELD_SOURCE_ID] : []),
  ...(assistantConfigState.value ? [SPATIAL_ASSISTANT_CONFIG_SOURCE_ID] : []),
  ...(dialogState.value ? [SPATIAL_DIALOG_PANEL_SOURCE_ID] : []),
  ...(confirmState.value ? [SPATIAL_CONFIRM_PANEL_SOURCE_ID] : []),
])

watch(
  sourceIds,
  (current) => emit("sourcesChanged", [...current]),
  { immediate: true, flush: "post" },
)

function handleBackdrop(): void {
  const current = confirmState.value
  if (!current || !props.confirmInteractive) return
  emit("requestConfirmClose", current.kind === "confirm" ? false : null)
}
</script>
