<script setup lang="ts">
/**
 * StatusBarScene — 状态栏"天时地利"区（仅展开态渲染）。
 *
 * 使用 runtime 的 location / activeSceneRefs / worldTime / weather 组织为纵向卷宗信息。
 */
import { computed } from "vue"
import type { Runtime } from "../../lib/runtime-types"

const props = defineProps<{
  runtime: Runtime | null
}>()

const activeScene = computed(() => props.runtime?.activeSceneRefs[0] ?? null)

const locationName = computed(() => {
  const loc = props.runtime?.location?.name
  if (loc && loc.trim().length > 0) return loc
  const sceneName = activeScene.value?.name
  if (sceneName && sceneName.trim().length > 0) return sceneName
  const sceneRef = activeScene.value?.ref
  if (sceneRef && sceneRef.trim().length > 0) return sceneRef
  return "地点未知"
})

const sceneName = computed(() => {
  const scene = activeScene.value
  if (!scene) return "场景未知"
  const name = scene.name?.trim()
  if (name && name !== locationName.value) return name
  return ""
})

const worldTime = computed(() => {
  const t = props.runtime?.worldTime
  return typeof t === "string" && t.trim().length > 0 ? t : "时间未知"
})

const weather = computed(() => {
  const w = props.runtime?.weather
  return typeof w === "string" && w.trim().length > 0 ? w : "天象未明"
})
</script>

<template>
  <section class="sb-scene">
    <header class="section-title-row">
      <h3 class="section-title">天时地利</h3>
      <span class="section-line" />
    </header>

    <div class="scene-main">
      <p class="scene-location">{{ locationName }}</p>
      <p v-if="sceneName" class="scene-sub">{{ sceneName }}</p>
    </div>

    <div class="scene-facts">
      <span class="scene-fact">
        <span class="fact-label">时</span>
        <span class="fact-value">{{ worldTime }}</span>
      </span>
      <span class="scene-fact">
        <span class="fact-label">象</span>
        <span class="fact-value">{{ weather }}</span>
      </span>
    </div>
  </section>
</template>

<style scoped>
.sb-scene {
  padding: 4px 0 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-bottom: 1px solid rgba(181, 137, 61, 0.14);
}
.section-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.section-title {
  margin: 0;
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
.scene-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.scene-location {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 0.96rem;
  color: var(--prose);
  line-height: 1.45;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.scene-sub {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 0.76rem;
  color: var(--prose-muted);
  line-height: 1.45;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.scene-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.scene-fact {
  min-width: 0;
  padding: 7px 8px;
  border: 1px solid rgba(181, 137, 61, 0.14);
  border-radius: 8px;
  background: rgba(6, 6, 8, 0.18);
  display: flex;
  align-items: center;
  gap: 7px;
}
.fact-label {
  flex-shrink: 0;
  font-family: var(--font-display);
  font-size: 0.78rem;
  color: var(--ember-bright);
}
.fact-value {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: var(--font-mono);
  font-size: 0.66rem;
  color: var(--prose-muted);
  letter-spacing: 0.02em;
}
</style>
