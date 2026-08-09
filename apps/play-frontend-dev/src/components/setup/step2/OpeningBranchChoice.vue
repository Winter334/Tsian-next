<script setup lang="ts">
import type { CharacterBranch } from "../../../lib/opening-interview"

const emit = defineEmits<{ select: [branch: CharacterBranch] }>()
</script>

<template>
  <section class="branch-choice">
    <p class="eyebrow">角色设置</p>
    <h2>选择角色类型</h2>
    <p class="intro">选择使用小说中的已有角色，或创建一个原创角色。</p>

    <div class="branch-grid">
      <button class="branch-card retro-focus" type="button" @click="emit('select', 'canon')">
        <span class="card-watermark" aria-hidden="true">原</span>
        <span class="card-mark" aria-hidden="true">原</span>
        <strong>原著角色</strong>
        <span class="card-copy">从小说已有角色中选择。</span>
        <span class="card-action" aria-hidden="true">选择此类型 <span>→</span></span>
        <span class="card-corner top-left" aria-hidden="true" />
        <span class="card-corner top-right" aria-hidden="true" />
        <span class="card-corner bottom-left" aria-hidden="true" />
        <span class="card-corner bottom-right" aria-hidden="true" />
      </button>
      <button class="branch-card retro-focus" type="button" @click="emit('select', 'original')">
        <span class="card-watermark" aria-hidden="true">创</span>
        <span class="card-mark" aria-hidden="true">创</span>
        <strong>原创角色</strong>
        <span class="card-copy">创建一个新的原创角色。</span>
        <span class="card-action" aria-hidden="true">选择此类型 <span>→</span></span>
        <span class="card-corner top-left" aria-hidden="true" />
        <span class="card-corner top-right" aria-hidden="true" />
        <span class="card-corner bottom-left" aria-hidden="true" />
        <span class="card-corner bottom-right" aria-hidden="true" />
      </button>
    </div>
  </section>
</template>

<style scoped>
.branch-choice {
  width: 100%;
  max-width: 680px;
  margin: 0 auto;
  text-align: center;
}
.eyebrow {
  margin: 0 0 10px;
  color: var(--ember);
  font-family: var(--font-mono);
  font-size: 0.7rem;
  letter-spacing: 0.24em;
}
h2 {
  margin: 0;
  color: var(--prose);
  font-family: var(--font-display, serif);
  font-size: clamp(1.6rem, 4vw, 2.2rem);
}
.intro {
  max-width: 560px;
  margin: 16px auto 30px;
  color: var(--prose-muted);
  font-family: var(--font-serif);
  line-height: 1.7;
}
.branch-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}
.branch-card {
  position: relative;
  isolation: isolate;
  display: flex;
  min-height: 220px;
  overflow: hidden;
  flex-direction: column;
  align-items: flex-start;
  gap: 11px;
  padding: 24px 26px 22px;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  background:
    radial-gradient(circle at 18% 0%, rgba(232, 169, 72, 0.1), transparent 42%),
    linear-gradient(145deg, rgba(25, 16, 10, 0.92), rgba(10, 5, 6, 0.96) 72%);
  color: var(--prose-muted);
  font: inherit;
  text-align: left;
  cursor: pointer;
  box-shadow:
    inset 0 1px 0 rgba(232, 169, 72, 0.08),
    inset 0 0 30px rgba(181, 137, 61, 0.035),
    0 12px 28px rgba(0, 0, 0, 0.26);
  -webkit-tap-highlight-color: transparent;
  transition: border-color 0.22s ease, transform 0.22s ease, box-shadow 0.22s ease;
}

.branch-card::before {
  position: absolute;
  z-index: 0;
  inset: 5px;
  border: 1px solid rgba(181, 137, 61, 0.12);
  border-radius: 5px;
  content: "";
  pointer-events: none;
  transition: border-color 0.22s ease;
}

.branch-card::after {
  position: absolute;
  z-index: 0;
  inset: 0;
  background: linear-gradient(108deg, transparent 28%, rgba(232, 169, 72, 0.075) 50%, transparent 72%);
  content: "";
  opacity: 0;
  pointer-events: none;
  transform: translateX(-45%);
  transition: opacity 0.22s ease, transform 0.45s ease;
}

.branch-card:is(:hover, :focus-visible) {
  border-color: var(--ember);
  transform: translateY(-3px);
  box-shadow:
    inset 0 1px 0 rgba(232, 169, 72, 0.14),
    inset 0 0 34px var(--ember-glow),
    0 16px 34px rgba(0, 0, 0, 0.38),
    0 0 18px rgba(232, 169, 72, 0.1);
}

.branch-card:is(:hover, :focus-visible)::before {
  border-color: rgba(232, 169, 72, 0.26);
}

.branch-card:is(:hover, :focus-visible)::after {
  opacity: 1;
  transform: translateX(45%);
}

.branch-card:focus-visible {
  outline: 2px solid var(--ember-bright);
  outline-offset: 3px;
}

.branch-card:active {
  border-color: var(--ember-bright);
  transform: translateY(0) scale(0.985);
  box-shadow:
    inset 0 0 26px rgba(181, 137, 61, 0.1),
    0 7px 18px rgba(0, 0, 0, 0.34);
}

.branch-card > :not(.card-watermark, .card-corner) {
  position: relative;
  z-index: 1;
}

.card-watermark {
  position: absolute;
  z-index: 0;
  right: -8px;
  bottom: -34px;
  color: var(--ember-bright);
  font-family: var(--font-display, serif);
  font-size: 9rem;
  font-weight: 700;
  line-height: 1;
  opacity: 0.025;
  pointer-events: none;
  transition: opacity 0.22s ease, transform 0.22s ease;
}

.branch-card:is(:hover, :focus-visible) .card-watermark {
  opacity: 0.055;
  transform: translateY(-3px);
}

.card-mark {
  display: inline-flex;
  width: 50px;
  height: 50px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--line-strong);
  border-radius: 5px;
  background: linear-gradient(145deg, rgba(232, 169, 72, 0.09), rgba(181, 137, 61, 0.025));
  color: var(--ember);
  font-family: var(--font-display, serif);
  font-size: 1.65rem;
  font-weight: 700;
  box-shadow: inset 0 0 14px rgba(181, 137, 61, 0.05);
  transition: border-color 0.22s ease, color 0.22s ease, box-shadow 0.22s ease;
}

.branch-card:is(:hover, :focus-visible) .card-mark {
  border-color: var(--ember);
  color: var(--ember-bright);
  box-shadow: inset 0 0 16px var(--ember-glow), 0 0 12px rgba(232, 169, 72, 0.08);
}

.branch-card strong {
  color: var(--prose);
  font-family: var(--font-display, serif);
  font-size: 1.32rem;
  letter-spacing: 0.04em;
}

.card-copy {
  flex: 1;
  font-family: var(--font-serif);
  line-height: 1.65;
}

.card-action {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
  color: var(--prose-faint);
  font-family: var(--font-mono);
  font-size: 0.66rem;
  letter-spacing: 0.12em;
  transition: color 0.22s ease, gap 0.22s ease;
}

.card-action::before {
  width: 20px;
  height: 1px;
  background: var(--line-strong);
  content: "";
}

.branch-card:is(:hover, :focus-visible) .card-action {
  gap: 11px;
  color: var(--ember-bright);
}

.card-corner {
  position: absolute;
  z-index: 2;
  width: 10px;
  height: 10px;
  border-color: var(--ember);
  border-style: solid;
  opacity: 0.42;
  pointer-events: none;
  transition: opacity 0.22s ease;
}

.branch-card:is(:hover, :focus-visible) .card-corner {
  opacity: 0.82;
}

.card-corner.top-left { top: 7px; left: 7px; border-width: 1px 0 0 1px; }
.card-corner.top-right { top: 7px; right: 7px; border-width: 1px 1px 0 0; }
.card-corner.bottom-left { bottom: 7px; left: 7px; border-width: 0 0 1px 1px; }
.card-corner.bottom-right { right: 7px; bottom: 7px; border-width: 0 1px 1px 0; }

@media (max-width: 640px) {
  .intro { margin: 12px auto 22px; }
  .branch-grid { grid-template-columns: 1fr; gap: 12px; }
  .branch-card { min-height: 164px; gap: 8px; padding: 18px 20px 16px; }
  .card-mark { width: 42px; height: 42px; font-size: 1.4rem; }
  .card-watermark { right: 4px; bottom: -25px; font-size: 7rem; }
  .branch-card strong { font-size: 1.18rem; }
  .card-copy { line-height: 1.5; }
}

@media (prefers-reduced-motion: reduce) {
  .branch-card,
  .branch-card::before,
  .branch-card::after,
  .card-watermark,
  .card-mark,
  .card-action,
  .card-corner {
    transition: none;
  }

  .branch-card:is(:hover, :focus-visible),
  .branch-card:active,
  .branch-card:is(:hover, :focus-visible) .card-watermark {
    transform: none;
  }
}
</style>
