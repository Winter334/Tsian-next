<template>
  <nav
    class="spatial-launcher-surface"
    data-spatial-source="shell:launcher"
    data-spatial-z="10"
    data-spatial-depth="28"
    data-spatial-yaw="-0.055"
    data-spatial-scale="0.985"
    data-spatial-curve-half-angle="0.035"
    aria-label="Spatial 应用启动器"
  >
    <div class="spatial-dock-scroll spatial-launcher-surface__apps" aria-label="应用">
      <button
        v-for="launcher in launchers"
        :key="launcher.id"
        type="button"
        class="spatial-dock-button spatial-launcher-button"
        :class="{ 'spatial-launcher-button--active': launcher.id === activeAppId }"
        :aria-label="`打开${launcher.label}`"
        :aria-current="launcher.id === activeAppId ? 'page' : undefined"
        :title="launcher.label"
        @click="emit('open', launcher.id)"
      >
        <component :is="launcher.icon" aria-hidden="true" />
      </button>
    </div>
  </nav>
</template>

<script setup lang="ts">
import type { PlatformAppId, PlatformLauncherDescriptor } from "@/platform-apps"

defineProps<{
  launchers: readonly PlatformLauncherDescriptor[]
  activeAppId: PlatformAppId | ""
}>()

const emit = defineEmits<{
  (event: "open", id: PlatformAppId): void
}>()
</script>
