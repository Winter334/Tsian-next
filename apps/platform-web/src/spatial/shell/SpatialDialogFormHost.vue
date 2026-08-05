<template>
  <section
    v-if="state"
    ref="panelRef"
    class="spatial-modal-panel-source spatial-dialog-form-source"
    :data-spatial-source="SPATIAL_DIALOG_PANEL_SOURCE_ID"
    data-spatial-layer="overlay"
    :data-spatial-z="SPATIAL_DIALOG_PANEL_Z_INDEX"
    :data-spatial-input="inputEnabled ? undefined : 'none'"
    :data-spatial-preferred-width="preferredWidth"
    data-spatial-parallax-factor="0"
    data-spatial-depth="0"
    data-spatial-yaw="0"
    data-spatial-pitch="0"
    data-spatial-scale="1"
    data-spatial-curve-half-angle="0.24"
    role="dialog"
    :aria-modal="inputEnabled ? 'true' : undefined"
    :aria-hidden="inputEnabled ? undefined : 'true'"
    :aria-labelledby="titleId"
    :aria-busy="testing || !interactive"
    tabindex="-1"
    @keydown="onPanelKeydown"
    @click="markPanelDirtyAfterUpdate"
  >
    <header class="spatial-modal-panel-source__header">
      <span class="spatial-modal-panel-source__kind">form</span>
      <h2 :id="titleId">{{ state.options.title }}</h2>
      <SpatialActionButton
        icon-only
        class="spatial-modal-panel-source__close"
        aria-label="取消并关闭"
        title="取消并关闭"
        :disabled="!interactive"
        @click="cancel"
      >
        <template #icon><X /></template>
      </SpatialActionButton>
    </header>

    <div class="spatial-dialog-form-source__content">
      <label
        v-for="field in state.options.fields"
        :key="field.name"
        class="spatial-dialog-form-source__field"
      >
        <span>{{ field.label }}</span>

        <input
          v-if="isInputType(field)"
          ref="inputRefs"
          :type="fieldType(field)"
          :value="values[field.name]"
          :placeholder="field.placeholder"
          :class="{ 'spatial-dialog-form-source__control--mono': field.mono }"
          :disabled="!interactive"
          @input="setValue(field.name, ($event.target as HTMLInputElement).value)"
          @keydown.enter.prevent.stop="confirmAction"
        >

        <textarea
          v-else-if="fieldType(field) === 'textarea'"
          ref="inputRefs"
          :value="values[field.name]"
          :rows="field.rows ?? 4"
          :placeholder="field.placeholder"
          :class="{ 'spatial-dialog-form-source__control--mono': field.mono }"
          :disabled="!interactive"
          spellcheck="false"
          @input="setValue(field.name, ($event.target as HTMLTextAreaElement).value)"
        />

        <SpatialSelect
          v-else
          :model-value="values[field.name] ?? ''"
          :options="field.options ?? []"
          :aria-label="field.label"
          :placeholder="field.placeholder ?? '请选择'"
          :disabled="!interactive"
          @update:model-value="(value) => setValue(field.name, value)"
          @open-change="markPanelDirtyAfterUpdate"
        />
      </label>

      <p v-if="error" :id="errorId" class="spatial-dialog-form-source__error" role="alert">
        {{ error }}
      </p>

      <p
        v-if="testResult"
        class="spatial-dialog-form-source__test-result"
        :class="{ 'spatial-dialog-form-source__test-result--error': !testResult.ok }"
        :role="testResult.ok ? 'status' : 'alert'"
      >
        {{ testResult.ok ? "✓ " : "✗ " }}{{ testResult.message }}
      </p>
    </div>

    <footer class="spatial-modal-panel-source__actions">
      <SpatialActionButton
        v-if="state.options.test"
        data-spatial-dialog-test
        :disabled="!interactive || testing"
        @click="runTest"
      >
        <template #icon><RefreshCw /></template>
        {{ testing ? "测试中…" : state.options.testLabel || "测试连通性" }}
      </SpatialActionButton>
      <span class="spatial-dialog-form-source__action-spacer" />
      <SpatialActionButton
        data-spatial-dialog-cancel
        :disabled="!interactive"
        @click="cancel"
      >{{ state.options.cancelText }}</SpatialActionButton>
      <SpatialActionButton
        data-spatial-dialog-submit
        variant="primary"
        :disabled="!interactive"
        @click="confirmAction"
      >{{ state.options.confirmText }}</SpatialActionButton>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import { RefreshCw, X } from "lucide-vue-next"
import {
  resetDialogFormValues,
  setDialogFormValue,
  useDialogFormState,
  useDialogFormValues,
  type DialogFormField,
  type DialogFormFieldType,
  type DialogFormTestResult,
} from "@/composables/useDialogForm"
import SpatialActionButton from "../apps/primitives/SpatialActionButton.vue"
import SpatialSelect from "../apps/primitives/SpatialSelect.vue"
import {
  SPATIAL_DIALOG_PANEL_SOURCE_ID,
  SPATIAL_DIALOG_PANEL_Z_INDEX,
  spatialDialogPreferredWidth,
} from "./spatial-global-surfaces"
import { useSpatialModalFocus } from "./use-spatial-modal-focus"
import "../apps/spatial-apps.css"

const props = withDefaults(defineProps<{
  interactive?: boolean
  inputEnabled?: boolean
}>(), {
  interactive: true,
  inputEnabled: true,
})

const emit = defineEmits<{
  sourcesChanged: [sourceIds: readonly string[]]
  sourceDirty: [sourceId: string]
  requestClose: [confirm: boolean]
}>()

const state = useDialogFormState()
const values = useDialogFormValues()
const panelRef = ref<HTMLElement | null>(null)
const inputRefs = ref<HTMLElement[]>([])
const error = ref("")
const testing = ref(false)
const testResult = ref<DialogFormTestResult | null>(null)
const modalFocus = useSpatialModalFocus(panelRef)
const titleId = "spatial-dialog-form-title"
const errorId = "spatial-dialog-form-error"
let requestGeneration = 0

const preferredWidth = computed(() => spatialDialogPreferredWidth(
  state.value?.options.widthClass ?? "max-w-sm",
))

watch(
  () => state.value,
  (current, previous) => {
    requestGeneration += 1
    error.value = ""
    testing.value = false
    testResult.value = null
    inputRefs.value = []
    if (current) {
      if (!previous) modalFocus.captureInvoker()
      const seed: Record<string, string> = {}
      for (const field of current.options.fields) seed[field.name] = field.defaultValue ?? ""
      resetDialogFormValues(seed)
      emit("sourcesChanged", [SPATIAL_DIALOG_PANEL_SOURCE_ID])
      void nextTick(() => {
        markPanelDirty()
        if (props.interactive && props.inputEnabled) {
          modalFocus.focusInitial(inputRefs.value[0])
        } else if (props.inputEnabled) {
          modalFocus.focusPanel()
        }
      })
      return
    }
    emit("sourcesChanged", [])
    modalFocus.restoreInvoker(props.inputEnabled)
  },
  { immediate: true, flush: "post" },
)

watch(
  () => [props.interactive, props.inputEnabled] as const,
  ([interactive, inputEnabled], previous) => {
    if (!state.value || !inputEnabled) return
    void nextTick(async () => {
      markPanelDirty()
      if (!interactive) {
        if (previous?.[0]) modalFocus.focusPanel()
        return
      }
      if (previous?.[1] === false) {
        // Give a closing top modal one tick to restore its exact invoker. If
        // that target belonged to this dialog, preserve it; otherwise this
        // dialog was opened behind the top modal and needs initial focus now.
        await nextTick()
        if (!panelRef.value?.contains(document.activeElement)) {
          modalFocus.focusInitial(inputRefs.value[0])
        }
        return
      }
      modalFocus.focusInitial(inputRefs.value[0])
    })
  },
)

function fieldType(field: DialogFormField): DialogFormFieldType {
  return field.type ?? "text"
}

function isInputType(field: DialogFormField): boolean {
  const type = fieldType(field)
  return type === "text" || type === "password" || type === "number"
}

function setValue(name: string, value: string): void {
  if (!props.interactive) return
  setDialogFormValue(name, value)
  error.value = ""
  markPanelDirtyAfterUpdate()
}

function onPanelKeydown(event: KeyboardEvent): void {
  event.stopPropagation()
  if (event.key === "Escape") {
    event.preventDefault()
    cancel()
  } else if (event.key === "Tab") {
    modalFocus.trapTab(event)
  }
}

function cancel(): void {
  if (!props.interactive) return
  error.value = ""
  emit("requestClose", false)
}

function confirmAction(): void {
  if (!props.interactive) return
  const current = state.value
  if (!current) return
  const validationError = current.options.validate(values.value)
  if (validationError) {
    error.value = validationError
    markPanelDirtyAfterUpdate()
    return
  }
  emit("requestClose", true)
}

async function runTest(): Promise<void> {
  const current = state.value
  if (!props.interactive || !current?.options.test || testing.value) return
  const generation = requestGeneration
  testing.value = true
  testResult.value = null
  markPanelDirtyAfterUpdate()
  try {
    const result = await current.options.test({ ...values.value })
    if (generation === requestGeneration && state.value === current) testResult.value = result
  } catch (cause) {
    if (generation === requestGeneration && state.value === current) {
      testResult.value = {
        ok: false,
        message: cause instanceof Error ? cause.message : "测试失败。",
      }
    }
  } finally {
    if (generation === requestGeneration && state.value === current) {
      testing.value = false
      markPanelDirtyAfterUpdate()
    }
  }
}

function markPanelDirty(): void {
  emit("sourceDirty", SPATIAL_DIALOG_PANEL_SOURCE_ID)
}

function markPanelDirtyAfterUpdate(): void {
  void nextTick(markPanelDirty)
}
</script>
