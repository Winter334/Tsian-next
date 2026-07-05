<script setup lang="ts">
/**
 * CharacterListItem — 在场/关联人物列表单行（CharacterList 子项）。
 *
 * 每行独立 useEntity(ref) 取对方实体的 name/brief（design §4.2 / R12 / R6）。
 * useEntity 是非单例薄封装：每个 CharacterListItem 实例独立持有 data/error。
 * 父 CharacterList 通过 :key=ref 在 refs 变化时 remount 本行。
 *
 * - 单行：首字头像 + name + brief（1 行截断）。
 * - 高亮 selectedRef。
 * - 点击 emit `select(ref)`。
 * - 不显示 raw ref/id（R9）。
 * - entity 读取失败 / 缺失 → 该行降级显示 ref 的 localId + "档案缺失"，不阻断整列。
 */
import { computed, onMounted } from "vue"
import { useEntity } from "../../composables/useEntity"

const props = defineProps<{
  ref: string
  selected: boolean
}>()

const emit = defineEmits<{
  select: [ref: string]
}>()

const { data: entityData, error: entityError, load: loadEntity } = useEntity(props.ref)

onMounted(() => {
  void loadEntity()
})

const displayName = computed(() => {
  const name = entityData.value?.entity?.name
  return typeof name === "string" && name.length > 0 ? name : localId.value
})

const displayBrief = computed(() => {
  if (entityError.value === "load-failed" || entityError.value === "not-found") {
    return "档案缺失"
  }
  const brief = entityData.value?.entity?.brief
  return typeof brief === "string" && brief.length > 0 ? brief : ""
})

const localId = computed(() => {
  const idx = props.ref.indexOf(":")
  return idx >= 0 ? props.ref.slice(idx + 1) : props.ref
})

const avatarGlyph = computed(() => {
  const name = displayName.value
  return name.length > 0 ? name.charAt(0) : "?"
})

function onClick() {
  emit("select", props.ref)
}
</script>

<template>
  <button
    class="char-list-item"
    :class="{ active: selected }"
    type="button"
    @click="onClick"
  >
    <span class="char-list-avatar">{{ avatarGlyph }}</span>
    <span class="char-list-info">
      <span class="char-list-name">{{ displayName }}</span>
      <span v-if="displayBrief" class="char-list-brief">{{ displayBrief }}</span>
    </span>
  </button>
</template>

<style scoped>
.char-list-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
  color: var(--prose-dim);
  background: transparent;
  border: none;
  border-left: 2px solid transparent;
  text-align: left;
  width: 100%;
  font-family: inherit;
}
.char-list-item:hover {
  background: rgba(181, 137, 61, 0.05);
  color: var(--prose);
}
.char-list-item.active {
  color: var(--ember-bright);
  background: rgba(181, 137, 61, 0.08);
  border-left-color: var(--ember);
  padding-left: 14px;
}
.char-list-avatar {
  width: 36px;
  height: 36px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  background: var(--void-deep);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  font-size: 0.85rem;
  color: var(--ember-bright);
  font-weight: 700;
  flex-shrink: 0;
}
.char-list-item.active .char-list-avatar {
  border-color: var(--ember);
  box-shadow: 0 0 6px rgba(181, 137, 61, 0.3);
}
.char-list-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.char-list-name {
  font-size: 0.82rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.char-list-brief {
  font-size: 0.68rem;
  color: var(--whisper);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
