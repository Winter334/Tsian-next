<template>
  <div class="grid h-full min-h-0 place-items-start overflow-auto p-5">
    <div class="grid w-full max-w-3xl gap-3 sm:grid-cols-2">
      <button
        v-for="option in options"
        :key="option.id"
        type="button"
        class="retro-focus retro-inset grid gap-3 p-4 text-left transition-colors hover:border-neon/45"
        :class="{ 'border-neon/60': option.id === currentMode }"
        :aria-pressed="option.id === currentMode"
        @click="emit('select', option.id)"
      >
        <div class="flex items-center justify-between gap-2">
          <strong class="text-sm text-text-main">{{ option.title }}</strong>
          <span v-if="option.id === currentMode" class="font-mono text-[10px] text-neon">当前</span>
        </div>
        <p class="text-xs leading-5 text-text-dim">{{ option.description }}</p>
      </button>
      <p class="sm:col-span-2 text-xs leading-5 text-text-dim">
        切换会先保存完整平台配置，再重新加载页面。窗口会话不会跨界面迁移。
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { PlatformUiMode } from "@/config/platform-config"
import { SPATIAL_ENVIRONMENT_GUIDANCE } from "@/config/platform-ui-mode"

defineProps<{ currentMode: PlatformUiMode }>()

const emit = defineEmits<{
  (event: "select", mode: PlatformUiMode): void
}>()

const options: readonly { id: PlatformUiMode; title: string; description: string }[] = [
  { id: "retro", title: "RetroOS", description: "稳定的平面多窗口桌面，包含当前全部平台功能。" },
  { id: "spatial", title: "Spatial Desktop", description: SPATIAL_ENVIRONMENT_GUIDANCE },
]
</script>
