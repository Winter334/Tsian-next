<template>
  <div
    v-if="state"
    class="spatial-modal-shield-source"
    :data-spatial-source="SPATIAL_CONFIRM_SHIELD_SOURCE_ID"
    data-spatial-layer="overlay"
    data-spatial-render="none"
    :data-spatial-z="SPATIAL_CONFIRM_SHIELD_Z_INDEX"
    data-spatial-parallax-factor="0"
    data-spatial-curve-half-angle="0"
    aria-hidden="true"
    @pointerdown.stop
    @click.stop="cancel"
    @contextmenu.prevent.stop
    @wheel.prevent.stop
  />

  <section
    v-if="state"
    ref="panelRef"
    class="spatial-confirm-source"
    :class="{ 'spatial-confirm-source--danger': isDanger }"
    :data-spatial-source="SPATIAL_CONFIRM_PANEL_SOURCE_ID"
    data-spatial-layer="overlay"
    :data-spatial-z="SPATIAL_CONFIRM_PANEL_Z_INDEX"
    data-spatial-parallax-factor="0"
    data-spatial-depth="0"
    data-spatial-yaw="0"
    data-spatial-pitch="0"
    data-spatial-scale="1"
    data-spatial-curve-half-angle="0.24"
    role="dialog"
    aria-modal="true"
    :aria-labelledby="titleId"
    :aria-describedby="messageVisible ? messageId : undefined"
    :aria-busy="!interactive"
    tabindex="-1"
    @keydown="onPanelKeydown"
  >
    <header class="spatial-confirm-source__header">
      <span class="spatial-confirm-source__kind">{{ state.kind }}</span>
      <h2 :id="titleId">{{ state.options.title }}</h2>
      <SpatialActionButton
        icon-only
        class="spatial-confirm-source__close"
        aria-label="取消并关闭"
        title="取消并关闭"
        :disabled="!interactive"
        @click="cancel"
      >
        <template #icon><X /></template>
      </SpatialActionButton>
    </header>

    <div class="spatial-confirm-source__content">
      <div class="spatial-confirm-source__message-row">
        <span
          class="spatial-confirm-source__icon"
          :class="{ 'spatial-confirm-source__icon--danger': isDanger }"
          aria-hidden="true"
        >
          <TriangleAlert v-if="isDanger" />
          <HelpCircle v-else />
        </span>
        <p
          v-if="messageVisible"
          :id="messageId"
          class="spatial-confirm-source__message"
        >{{ state.options.message }}</p>
      </div>

      <label v-if="state.kind === 'prompt'" class="spatial-confirm-source__prompt">
        <span>输入内容</span>
        <input
          ref="promptInputRef"
          v-model="promptValue"
          type="text"
          :placeholder="state.options.placeholder"
          :aria-invalid="promptError ? 'true' : undefined"
          :aria-describedby="promptError ? errorId : undefined"
          :disabled="!interactive"
          @input="markPanelDirty"
          @keydown.enter.prevent.stop="confirmAction"
        >
        <small v-if="promptError" :id="errorId" role="alert">{{ promptError }}</small>
      </label>
    </div>

    <footer class="spatial-confirm-source__actions">
      <SpatialActionButton
        data-spatial-confirm-cancel
        :disabled="!interactive"
        @click="cancel"
      >{{ state.options.cancelText }}</SpatialActionButton>

      <template v-if="state.kind === 'choice'">
        <SpatialActionButton
          v-for="option in state.options.options"
          :key="option.value"
          class="spatial-confirm-source__choice"
          :variant="option.severity === 'danger' ? 'danger' : 'default'"
          :disabled="!interactive"
          @click="choose(option.value)"
        >{{ option.label }}</SpatialActionButton>
      </template>

      <SpatialActionButton
        v-else
        data-spatial-confirm-primary
        :variant="isDanger ? 'danger' : 'primary'"
        :disabled="!interactive"
        @click="confirmAction"
      >{{ state.options.confirmText }}</SpatialActionButton>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import { HelpCircle, TriangleAlert, X } from "lucide-vue-next"
import SpatialActionButton from "../apps/primitives/SpatialActionButton.vue"
import { useConfirmState } from "@/composables/useConfirm"
import {
  SPATIAL_CONFIRM_PANEL_SOURCE_ID,
  SPATIAL_CONFIRM_PANEL_Z_INDEX,
  SPATIAL_CONFIRM_SHIELD_SOURCE_ID,
  SPATIAL_CONFIRM_SHIELD_Z_INDEX,
  SPATIAL_CONFIRM_SOURCE_IDS,
} from "./spatial-confirm"
import "../apps/spatial-apps.css"

const props = withDefaults(defineProps<{
  interactive?: boolean
}>(), {
  interactive: true,
})

const emit = defineEmits<{
  (event: "sourcesChanged", sourceIds: readonly string[]): void
  (event: "sourceDirty", sourceId: string): void
  (event: "requestClose", value: boolean | string | null): void
}>()

const state = useConfirmState()
const panelRef = ref<HTMLElement | null>(null)
const promptInputRef = ref<HTMLInputElement | null>(null)
const promptValue = ref("")
const promptError = ref("")
let focusReturnTarget: HTMLElement | null = null

const titleId = "spatial-confirm-title"
const messageId = "spatial-confirm-message"
const errorId = "spatial-confirm-error"
const messageVisible = computed(() => (
  state.value?.kind === "confirm"
  || state.value?.kind === "choice"
  || Boolean(state.value?.options.message)
))
const isDanger = computed(() => (
  state.value?.kind === "confirm" && state.value.options.severity === "danger"
))

watch(
  () => state.value,
  (current, previous) => {
    promptError.value = ""
    if (current) {
      if (!previous) {
        focusReturnTarget = document.activeElement instanceof HTMLElement
          && document.activeElement !== document.body
          ? document.activeElement
          : null
      }
      promptValue.value = current.kind === "prompt" ? current.options.defaultValue : ""
      emit("sourcesChanged", SPATIAL_CONFIRM_SOURCE_IDS)
      void nextTick(() => {
        markPanelDirty()
        focusInitialControl()
      })
      return
    }

    emit("sourcesChanged", [])
    const target = focusReturnTarget
    focusReturnTarget = null
    if (target?.isConnected) void nextTick(() => target.focus())
  },
  { immediate: true, flush: "post" },
)

watch(
  () => props.interactive,
  () => {
    if (!state.value) return
    void nextTick(() => {
      markPanelDirty()
      focusInitialControl()
    })
  },
)

function focusableControls(): HTMLElement[] {
  const panel = panelRef.value
  if (!panel) return []
  return [...panel.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )]
}

function cancelButton(): HTMLButtonElement | null {
  return panelRef.value?.querySelector<HTMLButtonElement>("[data-spatial-confirm-cancel]") ?? null
}

function focusInitialControl(): void {
  if (!props.interactive) {
    panelRef.value?.focus()
    return
  }
  if (state.value?.kind === "prompt") {
    promptInputRef.value?.focus()
    promptInputRef.value?.select()
  } else {
    cancelButton()?.focus()
  }
}

function onPanelKeydown(event: KeyboardEvent): void {
  event.stopPropagation()
  if (event.key === "Escape") {
    event.preventDefault()
    cancel()
    return
  }
  if (event.key !== "Tab") return

  const controls = focusableControls()
  const first = controls[0]
  const last = controls[controls.length - 1]
  if (!first || !last) {
    event.preventDefault()
    panelRef.value?.focus()
    return
  }
  const active = document.activeElement
  if (event.shiftKey && (active === first || !panelRef.value?.contains(active))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (active === last || !panelRef.value?.contains(active))) {
    event.preventDefault()
    first.focus()
  }
}

function markPanelDirty(): void {
  emit("sourceDirty", SPATIAL_CONFIRM_PANEL_SOURCE_ID)
}

function cancel(): void {
  if (!props.interactive) return
  promptError.value = ""
  if (state.value?.kind === "prompt" || state.value?.kind === "choice") {
    emit("requestClose", null)
  } else {
    emit("requestClose", false)
  }
}

function choose(value: string): void {
  if (props.interactive) emit("requestClose", value)
}

function confirmAction(): void {
  if (!props.interactive) return
  const current = state.value
  if (!current) return
  if (current.kind === "prompt") {
    const error = current.options.validate(promptValue.value)
    if (error) {
      promptError.value = error
      void nextTick(markPanelDirty)
      return
    }
    emit("requestClose", promptValue.value)
    return
  }
  emit("requestClose", true)
}
</script>
