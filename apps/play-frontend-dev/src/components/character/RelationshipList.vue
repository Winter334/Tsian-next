<script setup lang="ts">
/**
 * RelationshipList — 关系列表（概况页关系区）。
 *
 * design §4.4 / R15 / R9：
 * - 逐项 useEntity(edges[i].to) 取 name/brief。
 * - 单行：name + brief；点击 emit `select(ref)`。
 * - 不显示 raw ref/id，也不显示当前态度（态度由剧情读出）。
 * - entity 读取失败时该行降级显示"（未知）"，不阻断整列。
 *
 * 注意：本组件对每个 edge 独立 useEntity（非单例），父组件需在 edges 变化时
 * 通过 :key 触发 remount，或本组件内部对 useEntity 调用保持稳定。
 * 简化方案：父组件传 edges 数组，本组件 v-for 渲染子项 RelationshipRow，
 * 子项内部 useEntity。这样每个 row 的 useEntity 绑定到自己的 ref。
 */
import { watch } from "vue"
import type { RelationshipEdge } from "../../lib/character-types"
import RelationshipRow from "./RelationshipRow.vue"

const props = defineProps<{
  edges: RelationshipEdge[]
}>()

const emit = defineEmits<{
  select: [ref: string]
}>()

function onSelect(ref: string) {
  emit("select", ref)
}

// 监听 edges 变化（仅触发响应式依赖；实际加载由子组件 RelationshipRow 自行处理）
watch(() => props.edges, () => {
  /* no-op：子组件 :key=to 自管理 useEntity 生命周期 */
})
</script>

<template>
  <div v-if="edges.length > 0" class="relationship-list">
    <RelationshipRow
      v-for="edge in edges"
      :key="edge.to"
      :edge="edge"
      @select="onSelect"
    />
  </div>
  <p v-else class="empty-state">暂无关系</p>
</template>

<style scoped>
.relationship-list {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.empty-state {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 0.78rem;
  color: var(--prose-faint);
  font-style: italic;
}
</style>
