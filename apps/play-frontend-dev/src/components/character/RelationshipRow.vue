<script setup lang="ts">
/**
 * RelationshipRow — 关系列表单行（概况页关系区子项）。
 *
 * 每行独立 useEntity(edge.to) 取对方实体的 name/brief（design §4.4 / R15）。
 * useEntity 是非单例薄封装：每个 RelationshipRow 实例独立持有 data/error。
 * 父 RelationshipList 通过 :key=edge.to 在 edges 变化时 remount 本行。
 *
 * 不显示 raw ref/id（R9）；点击行 emit `select(ref)`。
 * entity 读取失败 / 缺失 → 该行降级显示"（未知）"，不阻断整列。
 */
import { computed, onMounted } from "vue"
import type { RelationshipEdge } from "../../lib/character-types"
import { useEntity } from "../../composables/useEntity"

const props = defineProps<{
  edge: RelationshipEdge
}>()

const emit = defineEmits<{
  select: [ref: string]
}>()

const { data: entityData, load: loadEntity } = useEntity(props.edge.to)

onMounted(() => {
  void loadEntity()
})

const displayName = computed(() => {
  const name = entityData.value?.entity?.name
  return typeof name === "string" && name.length > 0 ? name : "（未知）"
})

const displayBrief = computed(() => {
  const brief = entityData.value?.entity?.brief
  return typeof brief === "string" && brief.length > 0 ? brief : ""
})

function onClick() {
  emit("select", props.edge.to)
}
</script>

<template>
  <button class="ref-item" type="button" @click="onClick">
    <span class="ref-name">{{ displayName }}</span>
    <span v-if="displayBrief" class="ref-brief">{{ displayBrief }}</span>
  </button>
</template>

<style scoped>
.ref-item {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 8px;
  align-items: baseline;
  font-size: 0.86rem;
  color: var(--prose);
  cursor: pointer;
  padding: 7px 0;
  border-bottom: 1px solid rgba(181, 137, 61, 0.08);
  background: transparent;
  border-left: none;
  border-right: none;
  border-top: none;
  text-align: left;
  transition: color 0.2s;
  font-family: inherit;
}
.ref-item:hover {
  color: var(--ember-bright);
}
.ref-item::before {
  content: "▸";
  color: var(--ember);
  font-size: 0.7rem;
  grid-row: 1 / 3;
  padding-top: 2px;
}
.ref-name {
  color: inherit;
}
.ref-brief {
  grid-column: 2;
  color: var(--whisper);
  font-size: 0.72rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
