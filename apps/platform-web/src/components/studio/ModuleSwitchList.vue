<template>
  <article class="grid gap-3 border border-neon-deep/35 bg-panel/55 p-3">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="text-sm font-bold text-text-main">规则模块</p>
        <p class="mt-1 text-xs leading-5 text-text-dim">
          这个宏条目会按模块开关展开可选规则模块。
        </p>
      </div>
      <p class="font-mono text-[11px] text-text-dim">
        {{ enabledCount }} / {{ modules.length }} 已启用
      </p>
    </div>

    <div v-if="modules.length > 0" class="grid gap-2 md:grid-cols-2">
      <article
        v-for="module in modules"
        :key="module.path"
        class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border border-neon-deep/25 bg-elevated/35 p-3 transition-colors hover:bg-elevated/55"
      >
        <div class="min-w-0">
          <p class="truncate text-sm font-bold text-text-main">{{ module.title }}</p>
          <p class="mt-1 truncate font-mono text-[11px] text-text-dim/80">{{ module.path }}</p>
        </div>
        <Switch
          class="mt-0.5"
          :model-value="enabledSet.has(module.stem)"
          :aria-label="module.title"
          @update:model-value="(value) => toggleModule(module.stem, Boolean(value))"
        />
      </article>
    </div>

    <p v-else class="border border-neon-deep/25 bg-elevated/35 p-3 text-sm text-text-dim">
      当前 Agent 没有可切换的规则模块。
    </p>
  </article>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { Switch } from "@/components/ui/switch"
import type { PlatformStudioModuleInfo } from "@/platform-host"
import { normalizeEnabledModules } from "./message-sequence"

const props = defineProps<{
  modules: PlatformStudioModuleInfo[]
  enabledModules: string[]
}>()

const emit = defineEmits<{
  (event: "update:enabledModules", value: string[]): void
}>()

const enabledSet = computed(() => normalizeEnabledModules(props.enabledModules))
const enabledCount = computed(() => props.modules.filter((module) => enabledSet.value.has(module.stem)).length)

function toggleModule(stem: string, enabled: boolean): void {
  const next = new Set(enabledSet.value)
  if (enabled) {
    next.add(stem)
  } else {
    next.delete(stem)
  }
  emit("update:enabledModules", Array.from(next))
}
</script>
