<script setup lang="ts">
/** StatusBarBody — 桌面展开侧卷与移动状态抽屉共用的状态内容。 */
import type { CharacterEntity } from "../../lib/character-types"
import type { DisplayItem, Runtime } from "../../lib/runtime-types"
import StatusBarScene from "./StatusBarScene.vue"
import StatusBarCharacter from "./StatusBarCharacter.vue"
import StatusBarIdentity from "./StatusBarIdentity.vue"
import StatusBarPinned from "./StatusBarPinned.vue"
import StatusBarMetrics from "./StatusBarMetrics.vue"
import StatusBarRefs from "./StatusBarRefs.vue"

interface CharacterSnapshot {
  ref: string
  name: string
}

defineProps<{
  runtime: Runtime | null
  characterSnapshot: CharacterSnapshot | null
  characterEntity: CharacterEntity | null
  hasCharacter: boolean
  characterName: string
  characterBrief: string
  portraitSrc: string
  entityLoading: boolean
  entityError: "load-failed" | "not-found" | null
  metrics: DisplayItem[]
  refs: DisplayItem[]
  protagonistRef: string | null
}>()

const emit = defineEmits<{
  toggle: []
  "open-character": []
}>()
</script>

<template>
  <div class="sb-expanded-body">
    <StatusBarScene :runtime="runtime" />
    <StatusBarCharacter
      :character="characterSnapshot"
      :collapsed="false"
      :has-character="hasCharacter"
      :name="characterName"
      :brief="characterBrief"
      :portrait-src="portraitSrc"
      :loading="entityLoading"
      :entity-error="entityError"
      @toggle="emit('toggle')"
      @open-character="emit('open-character')"
    />
    <StatusBarIdentity :entity="characterEntity" />
    <StatusBarMetrics :gauges="characterEntity?.gauges ?? []" :metrics="metrics" />
    <StatusBarPinned
      :key="`pinned-${protagonistRef ?? 'none'}-${runtime?.updatedAtTurn ?? 0}`"
      :protagonist-ref="protagonistRef"
    />
    <StatusBarRefs :refs="refs" />
  </div>
</template>

<style scoped>
.sb-expanded-body {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 14px 14px 24px;
  scrollbar-width: none;
}

.sb-expanded-body::-webkit-scrollbar {
  display: none;
}
</style>
