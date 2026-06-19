<template>
  <div
    v-if="toasts.length > 0"
    class="pointer-events-none fixed right-3 top-3 z-[60] flex w-[320px] flex-col gap-2"
    aria-live="polite"
    aria-atomic="false"
  >
    <transition-group name="toast" tag="div" class="flex flex-col gap-2">
      <div
        v-for="entry in toasts"
        :key="entry.id"
        class="toast-card pointer-events-auto relative flex items-start gap-2.5 border bg-[#2d2a23] px-3 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
        :class="accentBorderClass(entry.type)"
        role="status"
      >
        <span
          class="mt-0.5 grid h-4 w-4 shrink-0 place-items-center"
          :class="accentIconClass(entry.type)"
          aria-hidden="true"
        >
          <component :is="iconFor(entry.type)" class="h-4 w-4" />
        </span>
        <p class="min-w-0 flex-1 break-words text-xs leading-5 text-text-main">{{ entry.message }}</p>
        <button
          type="button"
          class="retro-focus -mr-1 -mt-1 grid h-5 w-5 shrink-0 place-items-center text-text-dim transition-colors hover:text-text-main"
          aria-label="关闭提示"
          @click="toast.dismiss(entry.id)"
        >
          <X class="h-3 w-3" aria-hidden="true" />
        </button>
      </div>
    </transition-group>
  </div>
</template>

<script setup lang="ts">
import { CheckCircle2, Info, TriangleAlert, X, type LucideIcon } from "lucide-vue-next"
import { useToasts, toast, type ToastType } from "@/composables/useToast"

const toasts = useToasts()

function iconFor(type: ToastType): LucideIcon {
  switch (type) {
    case "success":
      return CheckCircle2
    case "error":
      return TriangleAlert
    default:
      return Info
  }
}

function accentBorderClass(type: ToastType): string {
  switch (type) {
    case "success":
      return "border-neon/50"
    case "error":
      return "border-danger/55"
    default:
      return "border-neon-deep/55"
  }
}

function accentIconClass(type: ToastType): string {
  switch (type) {
    case "success":
      return "text-neon"
    case "error":
      return "text-danger"
    default:
      return "text-neon-deep"
  }
}
</script>

<style scoped>
.toast-card {
  border-left-width: 3px;
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.22s ease,
    transform 0.22s ease;
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(12px);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(12px);
}

.toast-leave-active {
  position: absolute;
  right: 0;
  width: 100%;
}
</style>
