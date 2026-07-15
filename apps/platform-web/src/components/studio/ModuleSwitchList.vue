<template>
  <article class="grid gap-3 border border-neon-deep/35 bg-panel/55 p-3">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="text-sm font-bold text-text-main">规则模块</p>
        <p class="mt-1 text-xs leading-5 text-text-dim">
          这个宏条目会按宏来源分组展开可选规则模块。
        </p>
      </div>
      <p class="font-mono text-[11px] text-text-dim">
        {{ enabledCount }} / {{ totalModuleCount }} 已启用
      </p>
    </div>

    <p
      v-if="duplicateStems.length > 0"
      class="border border-amber-400/30 bg-amber-500/10 p-2 text-xs leading-5 text-amber-100"
    >
      可见模块中有同名文件：{{ duplicateStems.join("、") }}。这些开关按文件名同步，切换任一项会同步影响同名模块。
    </p>

    <div v-if="groups.length > 0" class="grid gap-3">
      <section
        v-for="group in groups"
        :key="group.key"
        class="grid gap-2 border border-neon-deep/25 bg-elevated/25 p-3"
      >
        <div class="flex flex-wrap items-start justify-between gap-2 border-b border-neon-deep/20 pb-2">
          <div class="min-w-0">
            <p class="truncate text-sm font-bold text-text-main">{{ group.label }}</p>
            <p class="mt-1 truncate font-mono text-[11px] text-text-dim/80">{{ group.macroPath }}</p>
          </div>
          <p class="font-mono text-[10px] text-text-dim">
            {{ enabledCountForGroup(group) }} / {{ group.modules.length }} 已启用
          </p>
        </div>

        <div v-if="group.modules.length > 0" class="grid gap-2 md:grid-cols-2">
          <article
            v-for="module in group.modules"
            :key="`${group.key}:${module.path}`"
            class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border border-neon-deep/25 bg-panel/45 p-3 transition-colors hover:bg-panel/65"
          >
            <div class="min-w-0">
              <p class="truncate text-sm font-bold text-text-main">{{ module.title }}</p>
              <p class="mt-1 truncate font-mono text-[11px] text-text-dim/80">{{ module.path }}</p>
              <div class="mt-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  class="retro-button retro-focus inline-flex h-6 items-center px-2 font-mono text-[10px] uppercase tracking-wider"
                  @click="emit('edit-module', module.path)"
                >
                  编辑
                </button>
                <button
                  type="button"
                  class="retro-button retro-focus inline-flex h-6 items-center px-2 font-mono text-[10px] uppercase tracking-wider"
                  @click="emit('open-module-directory', module.path)"
                >
                  目录
                </button>
              </div>
            </div>
            <Switch
              class="mt-0.5"
              :model-value="enabledSet.has(module.stem)"
              :aria-label="module.title"
              @update:model-value="(value) => toggleModule(module.stem, Boolean(value))"
            />
          </article>
        </div>

        <p v-else class="border border-neon-deep/20 bg-panel/35 p-3 text-sm text-text-dim">
          这个宏路径当前没有匹配到规则模块。
        </p>
      </section>
    </div>

    <p v-else class="border border-neon-deep/25 bg-elevated/35 p-3 text-sm text-text-dim">
      当前条目没有可显示的规则模块分组。
    </p>
  </article>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { Switch } from "@/components/ui/switch"
import type { ModuleSwitchGroup } from "./message-sequence"
import { duplicateVisibleModuleStems, normalizeEnabledModules } from "./message-sequence"

const props = defineProps<{
  groups: ModuleSwitchGroup[]
  enabledModules: string[]
}>()

const emit = defineEmits<{
  (event: "update:enabledModules", value: string[]): void
  (event: "edit-module", path: string): void
  (event: "open-module-directory", path: string): void
}>()

const enabledSet = computed(() => normalizeEnabledModules(props.enabledModules))
const totalModuleCount = computed(() => props.groups.reduce((total, group) => total + group.modules.length, 0))
const enabledCount = computed(() => props.groups.reduce(
  (total, group) => total + enabledCountForGroup(group),
  0,
))
const duplicateStems = computed(() => duplicateVisibleModuleStems(props.groups))

function enabledCountForGroup(group: ModuleSwitchGroup): number {
  return group.modules.filter((module) => enabledSet.value.has(module.stem)).length
}

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
