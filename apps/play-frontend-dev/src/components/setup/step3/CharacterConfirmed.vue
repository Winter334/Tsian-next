<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from "vue"
import gsap from "gsap"
import type { SelectedCharacter } from "../../../lib/source"

/**
 * CharacterConfirmed — 角色已选定确认屏。
 *
 * 展示角色名片 + 一次性脉冲环（"角色被点燃"仪式）+ 标记字粒子上升。
 * 进场：单卡 scale 0.92→1（0.5s, delay:0.1）。
 * 确认瞬间脉冲：:key 重挂播 ring-pulse 1.2s ease-out（14px→56px, opacity 0.7→0）。
 */
const props = defineProps<{
  character: SelectedCharacter
}>()

const emit = defineEmits<{
  back: []
  next: []
}>()

const cardRef = ref<HTMLElement | null>(null)
const pulseKey = ref(0)

onMounted(async () => {
  await nextTick()
  // 脉冲环：进场时播一次
  pulseKey.value++
  // 名片进场
  if (cardRef.value) {
    gsap.fromTo(cardRef.value,
      { opacity: 0, scale: 0.92 },
      { opacity: 1, scale: 1, duration: 0.5, ease: "power2.out", delay: 0.1 },
    )
  }
})

onUnmounted(() => {
  if (cardRef.value) gsap.killTweensOf(cardRef.value)
})
</script>

<template>
  <div class="character-confirmed">
    <!-- 角色名片 + 脉冲环 -->
    <div ref="cardRef" class="card-wrapper">
      <!-- 一次性脉冲环 -->
      <div :key="pulseKey" class="pulse-ring" aria-hidden="true" />

      <div class="char-card">
        <!-- 标记字（点燃 + 粒子上升，与 CanonCharacterSelect 选中态呼应） -->
        <span class="card-mark" aria-hidden="true">
          {{ character.name.charAt(0) }}
          <span class="mark-particle" />
          <span class="mark-particle p2" />
          <span class="mark-particle p3" />
        </span>

        <!-- 角色信息 -->
        <span class="card-body">
          <span class="card-name">
            {{ character.name }}
            <span v-if="character.gender" class="card-gender">{{ character.gender }}</span>
          </span>
          <span class="card-brief">{{ character.brief }}</span>
        </span>

        <!-- 四角括号 -->
        <span class="bracket tl" aria-hidden="true" />
        <span class="bracket tr" aria-hidden="true" />
        <span class="bracket bl" aria-hidden="true" />
        <span class="bracket br" aria-hidden="true" />
      </div>
    </div>

    <!-- 提示文案 -->
    <Transition name="hint-fade">
      <p class="confirmed-hint">已选定角色</p>
    </Transition>
  </div>
</template>

<style scoped>
.character-confirmed {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  padding: 40px 20px 20px;
}

/* ── 名片容器 ── */
.card-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ── 一次性脉冲环 ── */
.pulse-ring {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1px solid var(--ember-bright);
  transform: translate(-50%, -50%);
  opacity: 0;
  animation: ring-pulse 1.2s ease-out forwards;
  pointer-events: none;
  z-index: 0;
}
@keyframes ring-pulse {
  0% {
    width: 14px;
    height: 14px;
    opacity: 0.7;
  }
  100% {
    width: 56px;
    height: 56px;
    opacity: 0;
  }
}

/* ── 角色名片（复用 branch-card 视觉模式）── */
.char-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 24px 22px;
  min-width: 240px;
  background: linear-gradient(135deg, rgba(20, 14, 8, 0.85), rgba(10, 5, 6, 0.9));
  border: 1px solid var(--ember);
  border-radius: 6px;
  color: var(--prose);
  font-family: var(--font-serif);
  box-shadow:
    inset 0 0 24px rgba(232, 169, 72, 0.08),
    0 0 12px rgba(232, 169, 72, 0.1);
  z-index: 1;
}

/* ── 标记字（点燃态）── */
.card-mark {
  position: relative;
  font-family: var(--font-display);
  font-size: 1.6rem;
  font-weight: 700;
  color: var(--ember-bright);
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--ember-bright);
  border-radius: 4px;
  background: rgba(232, 169, 72, 0.06);
  text-shadow: 0 0 8px rgba(232, 169, 72, 0.4);
  box-shadow: 0 0 12px rgba(232, 169, 72, 0.3);
}

/* ── 粒子上升 ── */
.mark-particle {
  position: absolute;
  top: -2px;
  left: 50%;
  width: 1.5px;
  height: 1.5px;
  border-radius: 50%;
  background: var(--ember-bright);
  box-shadow: 0 0 2px var(--ember);
  animation: mark-particle-rise 3s ease-out infinite;
}
.mark-particle.p2 {
  animation-delay: 1s;
  left: 35%;
}
.mark-particle.p3 {
  animation-delay: 2s;
  left: 65%;
}
@keyframes mark-particle-rise {
  0% { opacity: 0; transform: translate(-50%, 0); }
  20% { opacity: 0.7; }
  100% { opacity: 0; transform: translate(-50%, -14px); }
}

/* ── 角色信息 ── */
.card-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.card-name {
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--ember-bright);
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.card-gender {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  font-weight: 400;
  color: var(--ember);
  border: 1px solid var(--ember);
  border-radius: 3px;
  padding: 0 4px;
  letter-spacing: 0.05em;
}
.card-brief {
  font-size: 0.82rem;
  color: var(--prose-dim);
  line-height: 1.5;
  max-width: 280px;
}

/* ── 四角括号 ── */
.bracket {
  position: absolute;
  width: 8px;
  height: 8px;
  border: 1px solid var(--ember-bright);
  opacity: 0.6;
}
.bracket.tl { top: 5px; left: 5px; border-right: none; border-bottom: none; }
.bracket.tr { top: 5px; right: 5px; border-left: none; border-bottom: none; }
.bracket.bl { bottom: 5px; left: 5px; border-right: none; border-top: none; }
.bracket.br { bottom: 5px; right: 5px; border-left: none; border-top: none; }

/* ── 提示文案 ── */
.confirmed-hint {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--whisper);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.hint-fade-enter-active {
  transition: opacity 0.3s ease;
}
.hint-fade-enter-from {
  opacity: 0;
}
</style>
