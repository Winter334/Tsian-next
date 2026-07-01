<script setup lang="ts">
import { computed } from "vue"
import { renderMarkdown } from "../../lib/markdown"

/**
 * NarrativeMessage — 叙述消息（主角/剧情正文）。
 *
 * prd 屏3：全宽 --prose Serif 行高 1.8；逐字浮现（GSAP blur→sharp+opacity stagger）；
 * markdown 渲染（标题 Cinzel ember-bright / 引用 ember 左条 / 代码 void-deep+ember 边 mono）；
 * ScrollTrigger 滚动逐段点亮（prose-dim→prose）。
 *
 * 流式优化：streaming 期间末端 ember 闪烁光标 + 正文微暖光晕，落定后渐隐光标。
 * 逐字 blur→sharp 与 ScrollTrigger 留优化期接入。
 */
const props = defineProps<{
  content: string
  streaming?: boolean
}>()

const html = computed(() => renderMarkdown(props.content || ""))
</script>

<template>
  <div class="narrative" :class="{ streaming }">
    <!-- prd 屏3：叙述消息无 role 标签（剧情正文无气泡） -->
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div class="msg-body prose" v-html="html" />
    <!-- 流式光标：ember 竖条闪烁，跟随正文末端 -->
    <span v-if="streaming" class="stream-cursor" aria-hidden="true" />
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

/* 流式光标：ember 竖条，与末行行高对齐，呼吸闪烁 */
.stream-cursor {
  display: inline-block;
  width: 2px;
  height: 1.1em;
  margin-left: 3px;
  vertical-align: text-bottom;
  background: var(--ember-bright);
  box-shadow: 0 0 8px var(--ember-glow);
  animation: cursor-blink 1s steps(2, start) infinite;
}
@keyframes cursor-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.15; }
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
  color: var(--prose-dim);
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
