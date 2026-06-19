<template>
  <div
    v-if="state"
    class="fixed inset-0 z-[60] grid place-items-center bg-black/55 p-4"
    @click.self="cancel"
  >
    <div
      class="w-full border border-neon/40 bg-[#2d2a23] p-4 shadow-[0_18px_48px_rgba(0,0,0,0.5)]"
      :class="state.options.widthClass"
      role="dialog"
      aria-modal="true"
      :aria-label="state.options.title"
    >
      <p class="font-mono text-xs uppercase tracking-wider text-neon">{{ state.options.title }}</p>

      <div class="mt-3 grid gap-3">
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

      <div class="mt-4 flex items-center justify-between gap-2">
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
        <div class="flex gap-2">
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
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from "vue"
import { RefreshCw } from "lucide-vue-next"
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

const state = useDialogFormState()
const values = useDialogFormValues()

const error = ref("")
const inputRefs = ref<HTMLElement[]>([])
const testing = ref(false)
const testResult = ref<DialogFormTestResult | null>(null)

watch(
  () => state.value,
  (current) => {
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
