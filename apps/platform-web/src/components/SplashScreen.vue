<script setup lang="ts">
import { onMounted } from 'vue'
import { useTypewriter } from '../composables/useTypewriter'

const emit = defineEmits<{
  exit: []
}>()

const textGroups: string[][] = [
  [
    'INITIALIZING NEURAL LINK...',
    'ESTABLISHING HANDSHAKE',
    'CONNECTION: SECURE',
  ],
  [
    'LOADING SYSTEM MODULES...',
    'MOUNTING VIRTUAL DOMAINS',
    'PHOSPHOR CORE: ACTIVE',
  ],
  [
    'AWAITING USER INPUT...',
    'SYSTEM READY',
  ],
]

const { displayedLines, stop, start } = useTypewriter(textGroups)

onMounted(() => {
  start()
})

const handleExit = () => {
  stop()
  emit('exit')
}
</script>

<template>
  <div
    class="fixed inset-0 flex flex-col items-center justify-center bg-void text-neon font-mono cursor-pointer select-none"
    @click="handleExit"
  >
    <!-- CRT overlays inside splash -->
    <div class="pointer-events-none fixed inset-0 crt-scanlines opacity-30" aria-hidden="true" />
    <div class="pointer-events-none fixed inset-0 bg-noise opacity-20" aria-hidden="true" />

    <!-- Typewriter text area -->
    <div class="z-10 flex flex-col items-center w-full max-w-2xl px-8 text-center">
      <div
        v-for="(line, index) in displayedLines"
        :key="index"
        class="min-h-[1.5rem] text-sm md:text-base leading-relaxed tracking-wide"
      >
        {{ line }}<span
          v-if="index === displayedLines.length - 1"
          class="animate-cursor-blink ml-0.5 inline-block"
        >_</span>
      </div>
      <!-- Show cursor even when no text yet -->
      <div v-if="displayedLines.length === 0" class="min-h-[1.5rem]">
        <span class="animate-cursor-blink inline-block">_</span>
      </div>
    </div>

    <!-- Bottom hint -->
    <div class="absolute bottom-12 z-10 text-xs text-neon/50 tracking-[0.2em] animate-pulse">
      [ CLICK ANYWHERE TO INITIALIZE ]
    </div>
  </div>
</template>
