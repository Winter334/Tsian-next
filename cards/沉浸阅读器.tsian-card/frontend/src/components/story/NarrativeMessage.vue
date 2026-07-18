<script setup lang="ts">
import { computed } from "vue"
import { renderMarkdown } from "../../lib/markdown"
import EmberForge from "../EmberForge.vue"

/**
 * NarrativeMessage — 叙述消息（主角/剧情正文）。
 *
 * 全宽 --prose Serif 行高 1.8；markdown 渲染。
 * 流式态：正文微暖光晕 + 余烬凝笔粒子（EmberForge）跟在末尾，
 * 暗示 agent 正在凝聚文字。
 */
const props = defineProps<{
  content: string
  streaming?: boolean
}>()

const html = computed(() => renderMarkdown(props.content || ""))
</script>

<template>
  <div class="narrative" :class="{ streaming }">
    <div class="msg-body prose" v-html="html" />
    <EmberForge v-if="streaming" variant="inline" />
  </div>
</template>

<style scoped>
.narrative {
  margin: 32px 0;
}
.msg-body {
  font-family: var(--font-serif);
  font-size: 1.05rem;
  color: var(--prose);
  line-height: 1.8;
}

/* 流式态：正文微暖光晕，提示"正在书写" */
.narrative.streaming .msg-body {
  text-shadow: 0 0 12px rgba(232, 169, 72, 0.18);
  animation: narrative-fade-in 0.4s ease both;
}
@keyframes narrative-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* markdown 元素样式 */
:deep(.md-heading) {
  font-family: var(--font-display);
  color: var(--ember-bright);
  margin: 1.2em 0 0.6em;
}
:deep(h1.md-heading) { font-size: 1.6rem; }
:deep(h2.md-heading) { font-size: 1.35rem; }
:deep(h3.md-heading) { font-size: 1.15rem; }

:deep(.md-quote) {
  border-left: 2px solid var(--ember);
  padding-left: 16px;
  margin: 1em 0;
  color: var(--prose-muted);
  font-style: italic;
}

:deep(.md-code) {
  background: var(--void-deep);
  border: 1px solid var(--ember);
  border-radius: 4px;
  padding: 12px 16px;
  overflow-x: auto;
  margin: 1em 0;
}
:deep(.md-code code) {
  font-family: var(--font-mono);
  font-size: 0.85rem;
  color: var(--prose);
}
:deep(.md-codespan) {
  font-family: var(--font-mono);
  background: var(--void-deep);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 0.9em;
}
</style>
