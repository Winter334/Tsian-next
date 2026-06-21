<template>
  <Teleport to="body">
    <!-- 透明拦截遮罩:视觉无遮罩(无背景色),功能上隔绝浮窗外的所有
         鼠标操作(含双击)。z-55 低于浮窗(z-60)与 Select 下拉(z-70),
         所以浮窗内交互和下拉选择正常工作,其它区域点击被物理拦截。 -->
    <div
      v-if="hasSlot || state"
      class="fixed inset-0 z-[55]"
      @pointerdown="onOverlayPointerDown"
    />
    <div
      v-if="hasSlot || state"
      ref="windowRef"
      class="floating-window fixed z-[60] w-full border border-neon/40 bg-[#2d2a23] shadow-[0_18px_48px_rgba(0,0,0,0.5)]"
      :class="[hasSlot ? windowWidthClass : state?.options.widthClass, { 'animate-shake': shaking }]"
      :style="{ '--drag-x': dragX + 'px', '--drag-y': dragY + 'px' }"
      role="dialog"
      aria-modal="true"
      :aria-label="hasSlot ? title : state?.options.title"
    >
    <!-- Title bar (drag handle) -->
    <header
      class="floating-window-titlebar flex cursor-grab select-none items-center justify-between border-b border-neon-deep/40 bg-[#26231d] px-3 py-2 active:cursor-grabbing"
      @pointerdown="startDrag"
    >
      <p class="font-mono text-xs uppercase tracking-wider text-neon truncate">
        {{ hasSlot ? title : state?.options.title }}
      </p>
      <button
        type="button"
        class="retro-focus grid h-6 w-6 place-items-center text-text-dim hover:text-danger"
        :title="'关闭'"
        aria-label="关闭"
        @click="handleClose"
      >
        <X class="h-4 w-4" aria-hidden="true" />
      </button>
    </header>

    <!-- Content -->
    <div class="p-4">
      <!-- Slot mode: custom content -->
      <slot v-if="hasSlot" />

      <!-- Form mode: field-driven form -->
      <div v-else-if="state" class="grid gap-3">
        <label
          v-for="field in state.options.fields"
          :key="field.name"
          class="grid gap-1.5"
        >
          <span class="font-mono text-[11px] uppercase tracking-wider text-text-dim">{{ field.label }}</span>

          <input
            v-if="isInputType(field)"
            ref="inputRefs"
            :type="fieldType(field)"
            :value="values[field.name]"
            :placeholder="field.placeholder"
            :class="inputClass(field)"
            @input="setValue(field.name, ($event.target as HTMLInputElement).value)"
            @keydown.enter.prevent="confirm"
            @keydown.esc.prevent="cancel"
          />

          <textarea
            v-else-if="fieldType(field) === 'textarea'"
            ref="inputRefs"
            :value="values[field.name]"
            :rows="field.rows ?? 4"
            :placeholder="field.placeholder"
            spellcheck="false"
            :class="inputClass(field)"
            @input="setValue(field.name, ($event.target as HTMLTextAreaElement).value)"
            @keydown.esc.prevent="cancel"
          />

          <Select
            v-else-if="fieldType(field) === 'select'"
            :model-value="values[field.name]"
            @update:model-value="(value) => setValue(field.name, value as string)"
          >
            <SelectTrigger class="h-9 w-full">
              <SelectValue :placeholder="field.placeholder ?? '请选择'" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="option in field.options ?? []"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </label>

        <p v-if="error" class="font-mono text-[11px] text-danger">{{ error }}</p>

        <!-- Connectivity test result -->
        <div
          v-if="testResult"
          class="font-mono text-[11px]"
          :class="testResult.ok ? 'text-neon' : 'text-danger'"
        >
          {{ testResult.ok ? "✓ " : "✗ " }}{{ testResult.message }}
        </div>
      </div>
    </div>

    <!-- Footer (form mode only) -->
    <div v-if="!hasSlot && state" class="flex items-center justify-between gap-2 border-t border-neon-deep/30 px-4 py-3">
      <button
        v-if="state.options.test"
        type="button"
        class="retro-button retro-focus inline-flex h-8 items-center gap-1.5 px-3 font-mono text-xs disabled:opacity-45"
        :disabled="testing"
        @click="runTest"
      >
        <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': testing }" aria-hidden="true" />
        {{ state.options.testLabel || "测试连通性" }}
      </button>
      <div class="flex gap-2" :class="{ 'ml-auto': !state.options.test }">
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center px-3 font-mono text-xs"
          @click="cancel"
        >
          {{ state.options.cancelText }}
        </button>
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center px-3 font-mono text-xs"
          @click="confirm"
        >
          {{ state.options.confirmText }}
        </button>
      </div>
    </div>
  </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useSlots, watch } from "vue"
import { RefreshCw, X } from "lucide-vue-next"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  resetDialogFormValues,
  resolveDialogForm,
  setDialogFormValue,
  useDialogFormState,
  useDialogFormValues,
  type DialogFormField,
  type DialogFormFieldType,
  type DialogFormTestResult,
} from "@/composables/useDialogForm"

interface Props {
  /** Slot mode title. When a slot is provided, the window renders slot content. */
  title?: string
  /** Slot mode width class, e.g. "max-w-lg". Ignored in form mode. */
  widthClass?: string
}

const props = withDefaults(defineProps<Props>(), {
  title: "",
  widthClass: "max-w-md",
})
const emit = defineEmits<{
  (event: "close"): void
}>()

const slots = useSlots()
const hasSlot = computed(() => !!slots.default)

// Form-mode state (composable-driven). Slot mode bypasses this.
const state = useDialogFormState()
const values = useDialogFormValues()

const error = ref("")
const inputRefs = ref<HTMLElement[]>([])
const testing = ref(false)
const testResult = ref<DialogFormTestResult | null>(null)

// --- Drag state ---
const windowRef = ref<HTMLElement | null>(null)
const dragX = ref(0)
const dragY = ref(0)
const shaking = ref(false)
let dragStartX = 0
let dragStartY = 0
let dragStartDragX = 0
let dragStartDragY = 0
let dragRect: DOMRect | null = null
let dragPointerId: number | null = null
let shakeTimer: ReturnType<typeof setTimeout> | null = null

const windowWidthClass = computed(() => props.widthClass)

function resetDrag(): void {
  dragX.value = 0
  dragY.value = 0
}

function startDrag(event: PointerEvent): void {
  // Ignore right-click / middle-click so they don't start a drag.
  if (event.button !== 0) {
    return
  }
  // Don't start a drag when the pointer lands on an interactive control inside
  // the title bar (the X close button). setPointerCapture would otherwise
  // redirect subsequent pointer events to the header and swallow the button's
  // click.
  const target = event.target as HTMLElement | null
  if (target && target.closest("button, a, input, [data-no-drag]")) {
    return
  }
  const el = windowRef.value
  if (!el) {
    return
  }
  dragStartX = event.clientX
  dragStartY = event.clientY
  dragStartDragX = dragX.value
  dragStartDragY = dragY.value
  dragRect = el.getBoundingClientRect()
  dragPointerId = event.pointerId
  el.setPointerCapture(event.pointerId)
  el.addEventListener("pointermove", onDragMove)
  el.addEventListener("pointerup", onDragEnd)
  el.addEventListener("pointercancel", onDragEnd)
}

function onDragMove(event: PointerEvent): void {
  if (dragPointerId === null || !dragRect) {
    return
  }
  const deltaX = event.clientX - dragStartX
  const deltaY = event.clientY - dragStartY
  const vw = window.innerWidth
  const vh = window.innerHeight
  // Keep at least 120px of the title bar visible horizontally and the title
  // bar reachable vertically (Windows-style: the window can partially slide
  // off but you can always grab it back).
  const minX = -dragRect.left - (dragRect.width - 120)
  const maxX = vw - dragRect.right - 0 + (dragRect.width - 120)
  const minY = -dragRect.top
  const maxY = vh - dragRect.bottom + 40
  const clampedX = Math.max(minX, Math.min(maxX, deltaX))
  const clampedY = Math.max(minY, Math.min(maxY, deltaY))
  dragX.value = dragStartDragX + clampedX
  dragY.value = dragStartDragY + clampedY
}

function onDragEnd(event: PointerEvent): void {
  const el = windowRef.value
  if (el && dragPointerId !== null) {
    el.releasePointerCapture(dragPointerId)
    el.removeEventListener("pointermove", onDragMove)
    el.removeEventListener("pointerup", onDragEnd)
    el.removeEventListener("pointercancel", onDragEnd)
  }
  dragPointerId = null
  dragRect = null
}

// --- Shake on outside click (Windows-style refuse-to-lose-focus) ---
// 透明遮罩物理隔绝浮窗外的所有鼠标操作(含双击),这里只需触发抖动反馈。
function onOverlayPointerDown(): void {
  if (shaking.value) {
    return
  }
  shaking.value = true
  if (shakeTimer) {
    clearTimeout(shakeTimer)
  }
  shakeTimer = setTimeout(() => {
    shaking.value = false
  }, 320)
}

onBeforeUnmount(() => {
  if (shakeTimer) {
    clearTimeout(shakeTimer)
  }
  const el = windowRef.value
  if (el && dragPointerId !== null) {
    el.removeEventListener("pointermove", onDragMove)
    el.removeEventListener("pointerup", onDragEnd)
    el.removeEventListener("pointercancel", onDragEnd)
  }
})

// Reset drag + form state whenever a new form dialog opens (form mode only).
watch(
  () => state.value,
  (current) => {
    resetDrag()
    error.value = ""
    testResult.value = null
    const seed: Record<string, string> = {}
    for (const field of current?.options.fields ?? []) {
      seed[field.name] = field.defaultValue ?? ""
    }
    resetDialogFormValues(seed)
    if (current && current.options.fields.length > 0) {
      nextTick(() => {
        inputRefs.value[0]?.focus()
      })
    }
  },
)

// Reset drag when the slot-mode window mounts.
onMounted(() => {
  if (hasSlot.value) {
    resetDrag()
  }
})

function handleClose(): void {
  if (hasSlot.value) {
    emit("close")
  } else {
    cancel()
  }
}

async function runTest(): Promise<void> {
  const current = state.value
  if (!current?.options.test || testing.value) {
    return
  }
  testing.value = true
  testResult.value = null
  try {
    testResult.value = await current.options.test({ ...values.value })
  } catch (e) {
    testResult.value = {
      ok: false,
      message: e instanceof Error ? e.message : "测试失败。",
    }
  } finally {
    testing.value = false
  }
}

function fieldType(field: DialogFormField): DialogFormFieldType {
  return field.type ?? "text"
}

function isInputType(field: DialogFormField): boolean {
  const type = fieldType(field)
  return type === "text" || type === "password" || type === "number"
}

function inputClass(field: DialogFormField): string {
  const base = "retro-focus retro-select-surface w-full border border-neon-deep/55 bg-elevated px-3 py-2 text-sm text-text-main placeholder:text-text-dim/60"
  return field.mono ? `${base} font-mono text-xs` : base
}

function setValue(name: string, value: string): void {
  setDialogFormValue(name, value)
  error.value = ""
}

function cancel(): void {
  error.value = ""
  resolveDialogForm(false)
}

function confirm(): void {
  const current = state.value
  if (!current) {
    return
  }
  const validationError = current.options.validate(values.value)
  if (validationError) {
    error.value = validationError
    return
  }
  resolveDialogForm(true)
}
</script>

<style scoped>
.floating-window {
  left: 50%;
  top: 50%;
  transform: translate(calc(-50% + var(--drag-x, 0px)), calc(-50% + var(--drag-y, 0px)));
}

.floating-window.animate-shake {
  animation: floating-window-shake 320ms ease-in-out;
}

@keyframes floating-window-shake {
  0%, 100% {
    transform: translate(calc(-50% + var(--drag-x, 0px)), calc(-50% + var(--drag-y, 0px)));
  }
  20% {
    transform: translate(calc(-50% + var(--drag-x, 0px) - 8px), calc(-50% + var(--drag-y, 0px)));
  }
  40% {
    transform: translate(calc(-50% + var(--drag-x, 0px) + 8px), calc(-50% + var(--drag-y, 0px)));
  }
  60% {
    transform: translate(calc(-50% + var(--drag-x, 0px) - 6px), calc(-50% + var(--drag-y, 0px)));
  }
  80% {
    transform: translate(calc(-50% + var(--drag-x, 0px) + 6px), calc(-50% + var(--drag-y, 0px)));
  }
}
</style>
