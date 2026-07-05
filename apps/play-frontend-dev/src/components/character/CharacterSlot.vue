<script setup lang="ts">
/**
 * CharacterSlot — 选中角色的 entity/relationships 读取 + CharacterCard 渲染。
 *
 * design §4.1：CharacterView 通过 :key=selectedRef 触发本组件 remount，重新读取
 * 选中角色数据。useEntity / useRelationships 在 setup 期绑定 selectedRef；
 * remount 后重新 setup，自动读取新角色的 entity/relationships。
 *
 * 不抛错：useEntity / useRelationships 内部 catch，error 走 error ref
 * （type-safety §"play-frontend Workspace Data Consumption"）。
 * entity 读取失败 → parseCharacter 返回 null → CharacterCard 降级显示 localId + "档案缺失"。
 */
import { computed, onMounted } from "vue"
import { useEntity } from "../../composables/useEntity"
import { useRelationships } from "../../composables/useRelationships"
import { parseCharacter } from "../../lib/parse-character"
import CharacterCard from "./CharacterCard.vue"

const props = defineProps<{
  selectedRef: string | null
}>()

const emit = defineEmits<{
  select: [ref: string]
}>()

const entityRef = computed(() => props.selectedRef ?? "")

const { data: entityData, error: entityError, load: loadEntity } = useEntity(entityRef.value)
const { data: relationshipsData, load: loadRelationships } = useRelationships(entityRef.value)

onMounted(() => {
  if (entityRef.value) {
    void loadEntity()
    void loadRelationships()
  }
})

// 把 entity raw JSON 解析为 CharacterEntity 强类型。
const character = computed(() => {
  if (entityError.value !== null || !entityData.value) return null
  return parseCharacter(entityData.value.entity)
})

const loading = computed(() => entityError.value === null && !entityData.value && Boolean(entityRef.value))

function onSelect(ref: string) {
  emit("select", ref)
}
</script>

<template>
  <CharacterCard
    :entity="character"
    :loading="loading"
    :relationships="relationshipsData"
    :entity-ref="selectedRef"
    @select="onSelect"
  />
</template>
