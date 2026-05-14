<template>
  <!-- 调试页：骨架占位，真实数据消费由 B5 接入 bridge.debug -->
  <section class="page-section">
    <div class="section-copy">
      <p class="section-eyebrow">调试</p>
      <h2>调试面板</h2>
      <p>本页是平台兜底入口（Ctrl+Shift+D 唤起），真实调试数据消费由 B5 接入 `bridge.debug`。</p>
    </div>

    <article class="panel-card">
      <h3>等待 B5 接入 bridge.debug</h3>
      <p>当前仅做样式占位；B5 落地后这里将列出工作流节点输出 / AI debug / 检索 debug / token usage 等。</p>
    </article>
  </section>
</template>

<script setup lang="ts">
// 骨架占位：本视图当前无逻辑
</script>

<style scoped>
.page-section {
  display: grid;
  gap: var(--ts-space-6);
  margin-top: var(--ts-space-6);
}

.section-copy {
  display: grid;
  gap: var(--ts-space-2);
}

.section-eyebrow {
  margin: 0 0 var(--ts-space-3);
  color: var(--ts-color-accent-default);
  font-size: var(--ts-text-xs);
  letter-spacing: var(--ts-tracking-wide);
  text-transform: uppercase;
}

h2 {
  margin: 0;
  font-family: var(--ts-font-serif);
  font-size: var(--ts-text-2xl);
  line-height: var(--ts-leading-tight);
  color: var(--ts-color-text-primary);
}

h3 {
  margin: 0 0 var(--ts-space-3);
  font-family: var(--ts-font-serif);
  font-size: var(--ts-text-xl);
  line-height: 1.3;
  color: var(--ts-color-text-primary);
}

.section-copy p,
.panel-card p {
  margin: 0;
  color: var(--ts-color-text-secondary);
  font-size: var(--ts-text-base);
  line-height: var(--ts-leading-normal);
}

.panel-card {
  padding: var(--ts-space-4);
  border: 1px solid var(--ts-color-border-default);
  border-radius: var(--ts-radius-xl);
  background: var(--ts-color-surface-raised);
  box-shadow: var(--ts-shadow-2);
}
</style>
