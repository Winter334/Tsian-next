<script setup lang="ts">
/**
 * StatusBarCharacter — 状态栏"玩家概要"区（展开 + 折叠双形态）。
 *
 * 展开态采用纵向命册布局：大肖像居中 + 角色名 + 两行简介。
 * 折叠态采用小竖幅肖像入口，点击展开状态栏。
 */
interface CharacterSnapshot {
  ref: string
  name: string
}

const props = defineProps<{
  /** 兼容旧调用与 HMR：状态栏主角快照，展示逻辑以 name/hasCharacter 为准。 */
  character: CharacterSnapshot | null
  collapsed: boolean
  hasCharacter: boolean
  name: string
  brief: string
  portraitSrc: string
  loading: boolean
  entityError: "load-failed" | "not-found" | null
}>()

const emit = defineEmits<{
  toggle: []
  "open-character": []
}>()

void props
</script>

<template>
  <!-- 折叠态：当前角色小肖像，点击展开状态栏 -->
  <button
    v-if="collapsed"
    class="sb-char-collapsed"
    :class="{ empty: !hasCharacter }"
    :aria-label="hasCharacter ? `展开状态栏 — ${name}` : '展开状态栏'"
    @click="emit('toggle')"
  >
    <span class="collapsed-orbit" aria-hidden="true"></span>
    <span class="collapsed-portrait">
      <img v-if="portraitSrc" :src="portraitSrc" alt="" />
      <span v-else class="collapsed-glyph">?</span>
    </span>
    <span class="collapsed-dot" aria-hidden="true"></span>
  </button>

  <!-- 展开态：大肖像玩家概要，点击进角色卡 -->
  <button
    v-else
    class="sb-char-expanded"
    :class="{ empty: !hasCharacter }"
    :aria-label="hasCharacter ? `查看角色卡 — ${name}` : '未设定角色'"
    @click="hasCharacter ? emit('open-character') : emit('toggle')"
  >
    <span class="section-title-row">
      <span class="section-title">玩家概要</span>
      <span class="section-line"></span>
    </span>

    <span class="hero-wrap">
      <span class="hero-aura" aria-hidden="true"></span>
      <span class="hero-portrait">
        <img v-if="portraitSrc" :src="portraitSrc" :alt="hasCharacter ? name : '未设定角色'" />
        <span v-else class="hero-glyph">?</span>
      </span>
    </span>

    <span class="char-name">{{ hasCharacter ? name : "未设定角色" }}</span>
    <span v-if="hasCharacter && brief" class="char-brief">{{ brief }}</span>
    <span v-else-if="loading" class="char-brief muted">读取角色档案…</span>
    <span v-else-if="entityError" class="char-brief muted">角色档案暂不可读</span>
  </button>
</template>

<style scoped>
/* ── 通用分区标题 ── */
.section-title-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
}
.section-title {
  flex-shrink: 0;
  font-family: var(--font-display);
  font-size: 0.86rem;
  color: var(--ember-bright);
  letter-spacing: 0.08em;
  text-shadow: 0 0 10px rgba(232, 169, 72, 0.12);
}
.section-line {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, rgba(232, 169, 72, 0.42), transparent);
  opacity: 0.58;
}

/* ── 折叠态：命册签小肖像 ── */
.sb-char-collapsed {
  position: relative;
  z-index: 1;
  width: 48px;
  min-height: 128px;
  padding: 10px 0 0;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.collapsed-orbit {
  width: 20px;
  height: 20px;
  border: 1px solid rgba(232, 169, 72, 0.30);
  transform: rotate(45deg);
  box-shadow: 0 0 10px rgba(181, 137, 61, 0.12);
}
.collapsed-orbit::before {
  content: "";
  display: block;
  width: 4px;
  height: 4px;
  margin: 7px;
  border-radius: 50%;
  background: var(--ember-bright);
  box-shadow: 0 0 8px rgba(232, 169, 72, 0.42);
}
.collapsed-portrait {
  width: 34px;
  aspect-ratio: 3 / 4.15;
  overflow: hidden;
  border: 1px solid rgba(181, 137, 61, 0.38);
  border-radius: 7px;
  background:
    radial-gradient(circle at 50% 34%, rgba(181, 137, 61, 0.10), transparent 62%),
    var(--void-deep);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.025),
    0 8px 18px rgba(0, 0, 0, 0.24);
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}
.collapsed-portrait img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.collapsed-glyph {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  color: var(--prose-faint);
}
.collapsed-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ember);
  box-shadow: 0 0 8px rgba(181, 137, 61, 0.42);
  opacity: 0.78;
}
.sb-char-collapsed:hover .collapsed-portrait,
.sb-char-collapsed:focus-visible .collapsed-portrait {
  border-color: rgba(232, 169, 72, 0.72);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.035),
    0 0 14px rgba(181, 137, 61, 0.28),
    0 8px 18px rgba(0, 0, 0, 0.24);
  transform: translateY(-1px);
}
.sb-char-collapsed.empty .collapsed-portrait {
  opacity: 0.72;
}

/* ── 展开态：大肖像玩家概要 ── */
.sb-char-expanded {
  position: relative;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 9px;
  padding: 14px 0 18px;
  border: none;
  border-bottom: 1px solid rgba(181, 137, 61, 0.14);
  background: transparent;
  cursor: pointer;
  text-align: center;
  color: inherit;
}
.sb-char-expanded::before {
  content: "";
  position: absolute;
  left: 34px;
  right: 34px;
  top: 44px;
  height: 148px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(232, 169, 72, 0.10), transparent 68%);
  opacity: 0.82;
  pointer-events: none;
}
.hero-wrap {
  position: relative;
  width: 126px;
  margin-top: 4px;
  aspect-ratio: 3 / 4.15;
}
.hero-aura {
  position: absolute;
  inset: -18px -24px;
  border-radius: 50%;
  background:
    radial-gradient(circle, rgba(181, 137, 61, 0.15), transparent 58%),
    radial-gradient(circle at 60% 72%, rgba(155, 58, 46, 0.12), transparent 60%);
  filter: blur(1px);
  opacity: 0.9;
}
.hero-portrait {
  position: absolute;
  inset: 0;
  overflow: hidden;
  border: 1px solid rgba(232, 169, 72, 0.40);
  border-radius: 10px;
  background:
    radial-gradient(circle at 50% 36%, rgba(181, 137, 61, 0.12), transparent 62%),
    var(--void-deep);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.03),
    0 16px 34px rgba(0, 0, 0, 0.28),
    0 0 18px rgba(181, 137, 61, 0.12);
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}
.hero-portrait::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent 64%, rgba(6, 6, 8, 0.42));
  pointer-events: none;
}
.hero-portrait img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.hero-glyph {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  font-size: 2.4rem;
  color: var(--prose-faint);
}
.sb-char-expanded:hover .hero-portrait,
.sb-char-expanded:focus-visible .hero-portrait {
  border-color: rgba(232, 169, 72, 0.72);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.035),
    0 18px 38px rgba(0, 0, 0, 0.30),
    0 0 24px rgba(181, 137, 61, 0.18);
  transform: translateY(-1px);
}
.char-name {
  position: relative;
  z-index: 1;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: var(--font-display);
  font-size: 1.12rem;
  color: var(--ember-bright);
  letter-spacing: 0.08em;
  text-shadow: 0 0 12px rgba(232, 169, 72, 0.16);
}
.char-brief {
  position: relative;
  z-index: 1;
  max-width: 232px;
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  font-family: var(--font-serif);
  font-size: 0.74rem;
  line-height: 1.55;
  color: var(--prose-muted);
}
.char-brief.muted {
  color: var(--prose-faint);
  font-style: italic;
}
.sb-char-expanded.empty .hero-portrait,
.sb-char-expanded.empty .char-name {
  opacity: 0.72;
}
</style>
