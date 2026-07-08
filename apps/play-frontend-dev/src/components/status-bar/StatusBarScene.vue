<script setup lang="ts">
/**
 * StatusBarScene — 状态栏"地点时间"区（仅展开态渲染）。
 *
 * design §5.2：
 * - 场景名 fallback 链：activeSceneRefs[0].name → activeSceneRefs[0].ref → "未知场景"。
 * - 时间：runtime.worldTime，空字符串显示"时间未知"。
 * - 场景名：--font-serif，--prose，稍大；时间：--font-mono，--prose-dim，小字。
 *
 * 不抛错：runtime 为 null 时由父容器决定不渲染本区；本组件只在 runtime 存在时
 * 消费固定字段，并对单字段缺失做 fallback（type-safety §"Runtime Extension Parsing"）。
 */
import { computed } from "vue"
import type { Runtime } from "../../lib/runtime-types"

const props = defineProps<{
  runtime: Runtime | null
}>()

const sceneName = computed(() => {
  const r = props.runtime
  if (!r) return "未知场景"
  const first = r.activeSceneRefs[0]
  if (first?.name && first.name.trim().length > 0) return first.name
  if (first?.ref && first.ref.trim().length > 0) return first.ref
  return "未知场景"
})

const worldTime = computed(() => {
  const t = props.runtime?.worldTime
  return typeof t === "string" && t.trim().length > 0 ? t : "时间未知"
})
</script>

<template>
  <section class="sb-scene">
    <p class="scene-name">{{ sceneName }}</p>
    <p class="scene-time">{{ worldTime }}</p>
  </section>
</template>

<style scoped>
.sb-scene {
  padding: 14px 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.scene-name {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 0.95rem;
  color: var(--prose);
  line-height: 1.4;
  /* 单行截断，超长场景名不撑爆 240px 栏 */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.scene-time {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--prose-muted);
  letter-spacing: 0.04em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
