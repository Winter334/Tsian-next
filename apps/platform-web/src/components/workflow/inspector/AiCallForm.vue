<template>
  <div class="space-y-3">
    <div>
      <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
        提示词预设
      </label>
      <input
        :value="config.presetId ?? ''"
        list="workflow-prompt-preset-options"
        class="mt-1 w-full border border-neon-deep/40 bg-void px-2 py-1 font-mono text-xs text-text-main outline-none focus:border-neon"
        placeholder="如 builtin.chat"
        @change="update('presetId', ($event.target as HTMLInputElement).value)"
      />
      <datalist id="workflow-prompt-preset-options">
        <option
          v-for="option in promptPresetOptions"
          :key="option.id"
          :value="option.id"
        >
          {{ option.name }}
        </option>
      </datalist>
      <p v-if="selectedPromptPreset" class="mt-0.5 truncate text-[9px] text-text-dim">
        {{ selectedPromptPreset.name }}
      </p>
    </div>

    <div>
      <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
        世界书
      </label>
      <input
        :value="worldBookKeys.join(', ')"
        class="mt-1 w-full border border-neon-deep/40 bg-void px-2 py-1 font-mono text-xs text-text-main outline-none focus:border-neon"
        placeholder="key1, key2, ..."
        @change="updateWorldBookKeys(($event.target as HTMLInputElement).value)"
      />
      <p class="mt-0.5 text-[9px] text-text-dim">逗号分隔</p>
      <div v-if="worldBookOptions.length > 0" class="mt-2 max-h-32 space-y-1 overflow-y-auto border border-neon-deep/20 bg-void/60 p-2">
        <label
          v-for="option in worldBookOptions"
          :key="option.id"
          class="flex cursor-pointer items-start gap-2 font-mono text-[10px] text-text-main"
        >
          <input
            type="checkbox"
            class="mt-0.5 shrink-0 accent-neon"
            :checked="worldBookKeySet.has(option.id)"
            @change="toggleWorldBook(option.id, ($event.target as HTMLInputElement).checked)"
          />
          <span class="min-w-0">
            <span class="block truncate">{{ option.name }}</span>
            <span class="block truncate text-text-dim">{{ option.id }}</span>
          </span>
        </label>
      </div>
    </div>

    <div class="flex items-center gap-2">
      <input
        type="checkbox"
        :checked="!!config.appendUserInput"
        class="accent-neon"
        @change="update('appendUserInput', ($event.target as HTMLInputElement).checked)"
      />
      <label class="font-mono text-xs text-text-main">
        追加用户输入
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface WorkflowResourceOption {
  id: string
  name: string
  description?: string
}

const props = defineProps<{
  config: Record<string, unknown>
  promptPresetOptions: WorkflowResourceOption[]
  worldBookOptions: WorkflowResourceOption[]
  onUpdate: (config: Record<string, unknown>) => void
}>()

const promptPresetOptions = computed(() => props.promptPresetOptions)
const worldBookOptions = computed(() => props.worldBookOptions)

const selectedPromptPreset = computed(() => {
  const presetId = typeof props.config.presetId === 'string' ? props.config.presetId : ''
  return promptPresetOptions.value.find((option) => option.id === presetId) ?? null
})

const worldBookKeys = computed(() => {
  const raw = props.config.worldBookKeys
  return Array.isArray(raw)
    ? raw.filter((item): item is string => typeof item === 'string')
    : []
})

const worldBookKeySet = computed(() => new Set(worldBookKeys.value))

function update(key: string, value: unknown) {
  props.onUpdate({ ...props.config, [key]: value })
}

function updateWorldBookKeys(value: string) {
  const keys = value.split(',').map((s) => s.trim()).filter(Boolean)
  props.onUpdate({ ...props.config, worldBookKeys: keys.length > 0 ? keys : undefined })
}

function toggleWorldBook(id: string, checked: boolean) {
  const next = new Set(worldBookKeys.value)
  if (checked) {
    next.add(id)
  } else {
    next.delete(id)
  }
  const keys = Array.from(next)
  props.onUpdate({ ...props.config, worldBookKeys: keys.length > 0 ? keys : undefined })
}
</script>
