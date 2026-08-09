<script setup lang="ts">
import type { CharacterBranch } from "../../../lib/opening-interview"

const emit = defineEmits<{ select: [branch: CharacterBranch] }>()
</script>

<template>
  <section class="branch-choice">
    <p class="eyebrow">选择本局角色</p>
    <h2>你想以谁的视角进入故事？</h2>
    <p class="intro">这里只决定角色类型。具体人物、身份和本局偏好会在接下来的对话里逐步确认。</p>

    <div class="branch-grid">
      <button class="branch-card retro-focus" type="button" @click="emit('select', 'canon')">
        <span class="branch-index">01</span>
        <strong>原著角色</strong>
        <span>从小说已有角色中选择，也可以在对话中指定其他人物。</span>
      </button>
      <button class="branch-card retro-focus" type="button" @click="emit('select', 'original')">
        <span class="branch-index">02</span>
        <strong>原创角色</strong>
        <span>通过简短问答创建角色，不需要预先填写完整表单。</span>
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
  display: flex;
  min-height: 190px;
  flex-direction: column;
  align-items: flex-start;
  gap: 14px;
  padding: 24px;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  background: rgba(10, 5, 6, 0.6);
  color: var(--prose-muted);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.2s, transform 0.2s, box-shadow 0.2s;
}
.branch-card:hover {
  border-color: var(--ember);
  transform: translateY(-3px);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35), 0 0 18px rgba(232, 169, 72, 0.08);
}
.branch-index {
  color: var(--ember);
  font-family: var(--font-mono);
  font-size: 0.7rem;
}
.branch-card strong {
  color: var(--prose);
  font-family: var(--font-display, serif);
  font-size: 1.3rem;
}
.branch-card > span:last-child {
  font-family: var(--font-serif);
  line-height: 1.65;
}
@media (max-width: 640px) {
  .branch-grid { grid-template-columns: 1fr; }
  .branch-card { min-height: 150px; }
}
</style>
