<template>
  <!--
    平台工具开关卡片（Studio 运行配置页 + 助手配置面板共用）。
    统一尺寸：描述 line-clamp-2 并 reserve min-h 两行高度，开关 mt-auto 钉底，
    所以同组内无论描述长短，卡片高度一致。
    滑块开关独立切（点卡片正文不触发），ⓘ 按钮点开 Popover 看完整描述。
  -->
  <div class="flex h-full flex-col gap-2 border border-neon-deep/30 bg-elevated/45 p-3 hover:bg-elevated">
    <div class="flex items-start justify-between gap-2">
      <span class="text-sm font-bold text-text-main">{{ tool.label }}</span>
      <Popover>
        <PopoverTrigger as-child>
          <button
            type="button"
            class="retro-focus inline-flex h-5 w-5 shrink-0 items-center justify-center border border-neon-deep/40 text-text-dim hover:text-neon"
            :aria-label="`${tool.label} 说明`"
          >
            <Info class="h-3 w-3" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent class="w-72">
          <p class="text-xs leading-5 text-text-main">{{ tool.description }}</p>
        </PopoverContent>
      </Popover>
    </div>
    <span class="line-clamp-2 min-h-[2.5rem] text-xs leading-5 text-text-dim">{{ tool.description }}</span>
    <div class="mt-auto flex items-center justify-end">
      <Switch
        :model-value="enabled"
        :disabled="disabled"
        :aria-label="tool.label"
        @update:model-value="(value) => emit('toggle', Boolean(value))"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Info } from "lucide-vue-next"
import { Switch } from "@/components/ui/switch"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { PlatformToolControl } from "@/agent-runtime/tool-controls"

defineProps<{
  tool: PlatformToolControl
  enabled: boolean
  disabled: boolean
}>()

const emit = defineEmits<{
  (event: "toggle", enabled: boolean): void
}>()
</script>
