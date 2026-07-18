<script setup lang="ts">
import { ref, watch, nextTick } from "vue"
import {
  DialogRoot,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "reka-ui"
import gsap from "gsap"

/**
 * RestoreDialog — 恢复检查点确认弹窗。
 *
 * 破坏性操作二次确认。信息极简：不重复检查点详情（点击位置已在对话流里给了上下文），
 * 只确认"恢复到第 N 回？此后 M 轮对话将被抹去。"
 *
 * 进场：GSAP scale 0.92→1 + opacity 0→1（0.3s power2.out）。
 * 退场：Vue Transition 反向（CSS 过渡）。
 */
const props = defineProps<{
  open: boolean
  turn: number
  turnsAfter: number
}>()

const emit = defineEmits<{
  "update:open": [value: boolean]
  confirm: []
}>()

const contentRef = ref<HTMLElement | null>(null)
const restoring = ref(false)
const error = ref("")

// 进场动画：open 变 true 时下一帧 GSAP scale+opacity
watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      error.value = ""
      restoring.value = false
      await nextTick()
      if (contentRef.value) {
        gsap.fromTo(
          contentRef.value,
          { scale: 0.92, opacity: 0 },
          { scale: 1, opacity: 1, duration: 0.3, ease: "power2.out" },
        )
      }
    }
  },
)

async function onConfirm() {
  if (restoring.value) return
  restoring.value = true
  error.value = ""
  try {
    emit("confirm")
  } catch (e) {
    const msg = e && typeof e === "object" && "message" in e
      ? (e as { message: string }).message
      : "恢复失败"
    error.value = msg
    restoring.value = false
  }
}
</script>

<template>
  <DialogRoot :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogPortal>
      <Transition name="overlay-fade">
        <DialogOverlay class="restore-overlay" />
      </Transition>
      <DialogContent
        ref="contentRef"
        class="restore-dialog"
        :class="{ restoring }"
      >
        <!-- 四角括号装饰 -->
        <span class="corner tl" aria-hidden="true" />
        <span class="corner tr" aria-hidden="true" />
        <span class="corner bl" aria-hidden="true" />
        <span class="corner br" aria-hidden="true" />

        <DialogTitle class="restore-title">恢复到此印记？</DialogTitle>
        <DialogDescription class="restore-body">
          恢复到 <strong>第 {{ turn }} 回</strong>，此后
          <span class="warn">{{ turnsAfter }} 轮</span> 对话将被抹去。
          此操作不可撤销。
        </DialogDescription>

        <p v-if="error" class="restore-error">{{ error }}</p>

        <div class="restore-actions">
          <DialogClose class="cancel-btn">取消</DialogClose>
          <button
            class="confirm-btn"
            :disabled="restoring"
            @click="onConfirm"
          >
            {{ restoring ? "恢复中…" : "恢复" }}
          </button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
/* 遮罩：暗色 + 模糊 */
.restore-overlay {
  position: fixed;
  inset: 0;
  background: rgba(6, 6, 8, 0.8);
  backdrop-filter: blur(6px);
  z-index: 100;
}
.overlay-fade-enter-active,
.overlay-fade-leave-active {
  transition: opacity 0.3s ease;
}
.overlay-fade-enter-from,
.overlay-fade-leave-to {
  opacity: 0;
}

/* 弹窗主体 */
.restore-dialog {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: var(--void-deep);
  border: 2px solid var(--ember);
  border-radius: 8px;
  padding: 28px 32px 24px;
  min-width: 340px;
  max-width: 420px;
  z-index: 101;
  box-shadow: 0 0 40px rgba(232, 169, 72, 0.15), 0 8px 32px rgba(0, 0, 0, 0.6);
  /* GSAP 进场会设 opacity，退场由 CSS transition 处理 */
}

/* 四角括号 */
.corner {
  position: absolute;
  width: 10px;
  height: 10px;
  border: 1px solid var(--ember);
  opacity: 0.5;
}
.corner.tl { top: 6px; left: 6px; border-right: none; border-bottom: none; }
.corner.tr { top: 6px; right: 6px; border-left: none; border-bottom: none; }
.corner.bl { bottom: 6px; left: 6px; border-right: none; border-top: none; }
.corner.br { bottom: 6px; right: 6px; border-left: none; border-top: none; }

.restore-title {
  margin: 0 0 14px;
  font-family: var(--font-display);
  font-size: 1.15rem;
  color: var(--ember-bright);
  text-align: center;
  letter-spacing: 0.05em;
}

.restore-body {
  margin: 0 0 20px;
  font-family: var(--font-serif);
  font-size: 0.92rem;
  color: var(--prose);
  line-height: 1.7;
  text-align: center;
}
.restore-body strong {
  color: var(--ember-bright);
  font-weight: 600;
}
.warn {
  color: var(--blood);
  font-weight: 600;
}

.restore-error {
  margin: 0 0 16px;
  font-family: var(--font-mono);
  font-size: 0.78rem;
  color: var(--blood);
  text-align: center;
}

.restore-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
}

/* 取消按钮：幽灵态 */
.cancel-btn {
  background: transparent;
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 8px 20px;
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  color: var(--prose-muted);
  transition: border-color 0.2s, color 0.2s;
}
.cancel-btn:hover {
  border-color: var(--ember);
  color: var(--prose);
}

/* 确认按钮：ember 实心方块 */
.confirm-btn {
  background: linear-gradient(135deg, var(--ember-bright), var(--ember));
  color: var(--void-deep);
  border: none;
  border-radius: 4px;
  padding: 8px 20px;
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  font-weight: 600;
  transition: box-shadow 0.25s, filter 0.25s, transform 0.1s;
}
.confirm-btn:hover:not(:disabled) {
  box-shadow: 0 0 16px var(--ember-glow);
  filter: brightness(1.1);
}
.confirm-btn:active:not(:disabled) {
  transform: scale(0.95);
}
.confirm-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
