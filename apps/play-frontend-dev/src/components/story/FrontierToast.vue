<script setup lang="ts">
/**
 * FrontierToast — 素材边界拓展状态 Toast。
 *
 * 复用 SyncToast 的暗色玻璃条 + ember 扫光签名动效，三态文案描述 frontier 推进：
 *   advancing → "正在拓展素材边界…"
 *   succeeded → "已拓展素材边界"（1.5s 淡出，同 synced）
 *   failed    → "素材边界拓展失败" + "重试"按钮（不锁 Composer）
 *
 * 纯展示组件：不包含业务逻辑，phase 由 useFrontierAdvance 驱动。
 * 不出现 agent 名称（AIRP 原则 2）——Toast 只描述阶段行为。
 */
defineProps<{
  phase: "advancing" | "succeeded" | "failed"
}>()

const emit = defineEmits<{
  retry: []
}>()
</script>

<template>
  <div
    class="frontier-toast"
    :class="phase"
    role="status"
    aria-live="polite"
  >
    <span class="mark" aria-hidden="true" />
    <span class="label">{{
      phase === 'advancing'
        ? '正在拓展素材边界…'
        : phase === 'succeeded'
          ? '已拓展素材边界'
          : '素材边界拓展失败'
    }}</span>
    <button
      v-if="phase === 'failed'"
      class="retry"
      type="button"
      @click="emit('retry')"
    >重试</button>
  </div>
</template>

<style scoped>
.frontier-toast {
  position: relative;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  max-width: 52em;
  width: fit-content;
  margin: 0 auto;
  padding: 9px 16px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  background: rgba(10, 5, 6, 0.7);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  font-family: var(--font-mono);
  font-size: 0.78rem;
  color: var(--prose-muted);
  letter-spacing: 0.06em;
  animation: toast-in 0.3s cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes toast-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ── 标记点：三态（同 SyncToast 视觉语言）── */
.mark {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ember);
}

/* advancing：ember 脉冲点慢呼吸 */
.frontier-toast.advancing .mark {
  animation: mark-breathe 2.5s ease-in-out infinite;
}
@keyframes mark-breathe {
  0%, 100% {
    box-shadow: 0 0 3px var(--ember-glow);
    opacity: 0.7;
  }
  50% {
    box-shadow: 0 0 8px var(--ember-glow), 0 0 2px var(--ember);
    opacity: 1;
  }
}

/* succeeded：圆点凝为菱形（ember-bright 一闪） */
.frontier-toast.succeeded .mark {
  border-radius: 0;
  transform: rotate(45deg);
  background: var(--ember-bright);
  box-shadow: 0 0 8px var(--ember-bright), 0 0 2px var(--ember);
  animation: mark-flash 0.6s ease-out;
}
@keyframes mark-flash {
  0%   { box-shadow: 0 0 0 var(--ember-bright); }
  50%  { box-shadow: 0 0 14px var(--ember-bright), 0 0 4px var(--ember); }
  100% { box-shadow: 0 0 8px var(--ember-bright), 0 0 2px var(--ember); }
}

/* failed：血珀 ✕ 形态 */
.frontier-toast.failed .mark {
  width: 10px;
  height: 10px;
  background: transparent;
  border-radius: 0;
  position: relative;
}
.frontier-toast.failed .mark::before,
.frontier-toast.failed .mark::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  width: 10px;
  height: 1.5px;
  background: var(--blood);
}
.frontier-toast.failed .mark::before {
  transform: translate(-50%, -50%) rotate(45deg);
}
.frontier-toast.failed .mark::after {
  transform: translate(-50%, -50%) rotate(-45deg);
}
.frontier-toast.failed {
  border-color: var(--blood);
}

/* ── 文案 ── */
.label {
  white-space: nowrap;
}

/* ── 重试：内联 ember 文字按钮 ── */
.retry {
  margin-left: 4px;
  padding: 0 2px;
  border: none;
  background: transparent;
  color: var(--ember);
  font-family: inherit;
  font-size: inherit;
  letter-spacing: inherit;
  cursor: pointer;
  transition: color 0.2s, text-shadow 0.2s;
}
.retry:hover {
  color: var(--ember-bright);
  text-shadow: 0 0 6px var(--ember-glow);
}
.retry:focus-visible {
  outline: 1px solid var(--ember);
  outline-offset: 2px;
  border-radius: 2px;
}

/* ── 签名细节：卡片扫光（同 SyncToast）── */
.frontier-toast::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  mix-blend-mode: screen;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(232, 169, 72, 0.10) 38%,
    rgba(232, 169, 72, 0.22) 50%,
    rgba(232, 169, 72, 0.10) 62%,
    transparent 100%
  );
  background-size: 40% 100%;
  background-repeat: no-repeat;
  background-position: -40% 0;
  animation: card-sweep 1.8s ease-in-out infinite;
}
@keyframes card-sweep {
  0%   { background-position: -40% 0; }
  100% { background-position: 140% 0; }
}

/* succeeded：扫光跑完最后一遍停 */
.frontier-toast.succeeded::after {
  animation: card-sweep 1.8s ease-in-out 1 forwards;
}

/* failed：扫光立即停止 */
.frontier-toast.failed::after {
  animation: none;
  opacity: 0;
}
</style>
