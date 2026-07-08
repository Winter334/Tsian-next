<script setup lang="ts">
/**
 * SyncToast — 回合后同步状态 Toast。
 *
 * 设计：朴素克制的暗色玻璃条 + 一个签名细节——ember 光带横扫整张卡片表面，
 * 像烛火掠过书页。三态用极简标记区分（● syncing / ◆ synced / ✕ failed），
 * 文案只描述阶段行为本身（"本回合整理中"），不出现任何 agent 名称——
 * 你不展示的东西就无法硬编码。
 *
 * 签名动效：卡片扫光（card-sweep），复用 Composer ink-sweep 的同源缓动，
 * 但作用域是整张卡片表面而非一条底线。syncing 循环 / synced 跑完一遍停 /
 * sync-failed 立即停止。
 *
 * 纯展示组件：不包含业务逻辑，syncPhase 由 useSyncAfterTurn 驱动。
 */
import type { SyncPhase } from "../../types"

defineProps<{
  phase: SyncPhase
}>()

const emit = defineEmits<{
  retry: []
}>()
</script>

<template>
  <div
    class="sync-toast"
    :class="phase"
    role="status"
    aria-live="polite"
  >
    <span class="mark" aria-hidden="true" />
    <span class="label">{{ phase === 'syncing' ? '本回合整理中' : phase === 'synced' ? '已整理' : '整理失败' }}</span>
    <button
      v-if="phase === 'sync-failed'"
      class="retry"
      type="button"
      @click="emit('retry')"
    >重试</button>
  </div>
</template>

<style scoped>
.sync-toast {
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

/* synced / sync-failed → idle 时由父组件 v-if 移除，这里给淡出留过渡。
   实际淡出依赖 phase 切到 idle 后 DOM 移除；scoped 无法控制离开动画，
   留给父组件 transition 处理（当前 v-if 直接移除，可接受）。 */

/* ── 标记点：三态 ── */
.mark {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ember);
}

/* syncing：ember 脉冲点慢呼吸 */
.sync-toast.syncing .mark {
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

/* synced：圆点凝为菱形（ember-bright 一闪） */
.sync-toast.synced .mark {
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

/* sync-failed：血珀 ✕ 形态（用两条线交叉，比单字符更有质感） */
.sync-toast.sync-failed .mark {
  width: 10px;
  height: 10px;
  background: transparent;
  border-radius: 0;
  position: relative;
}
.sync-toast.sync-failed .mark::before,
.sync-toast.sync-failed .mark::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  width: 10px;
  height: 1.5px;
  background: var(--blood);
}
.sync-toast.sync-failed .mark::before {
  transform: translate(-50%, -50%) rotate(45deg);
}
.sync-toast.sync-failed .mark::after {
  transform: translate(-50%, -50%) rotate(-45deg);
}
.sync-toast.sync-failed {
  border-color: var(--blood);
}

/* ── 文案 ── */
.label {
  white-space: nowrap;
}

/* ── 重试：内联 ember 文字按钮，不抢焦点 ── */
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

/* ── 签名细节：卡片扫光（ember 光带横扫整张卡片表面）── */
.sync-toast::after {
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

/* synced：扫光跑完最后一遍停 */
.sync-toast.synced::after {
  animation: card-sweep 1.8s ease-in-out 1 forwards;
}

/* sync-failed：扫光立即停止 */
.sync-toast.sync-failed::after {
  animation: none;
  opacity: 0;
}
</style>
