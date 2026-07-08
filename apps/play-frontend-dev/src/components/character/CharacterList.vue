<script setup lang="ts">
/**
 * CharacterList — 左侧在场人物列表 + 关联人物分组（CharacterView 子组件）。
 *
 * design §4.2 / R1 / R9 / R12：
 * - "在场人物" 分组：presentRefs 逐项 useEntity 取 name/brief；高亮 selectedRef。
 * - "关联人物" 分组：从 relationships.edges[*].to 取 ref；过滤已在 presentRefs
 *   中的；逐项 useEntity 取 name/brief。
 * - 单行：首字头像 + name + brief（1 行截断）。
 * - 点击 emit `select(ref)`。
 * - 不显示 raw ref/id。
 *
 * 每行独立 CharacterListItem（内部 useEntity），:key=entityRef 在 refs 变化时 remount。
 */
import { computed } from "vue"
import type { RelationshipFile } from "../../lib/character-types"
import CharacterListItem from "./CharacterListItem.vue"

const props = defineProps<{
  presentRefs: Array<{ ref: string }>
  selectedRef: string | null
  protagonistRef: string | null
  relationships: RelationshipFile | null
}>()

const emit = defineEmits<{
  select: [ref: string]
}>()

const presentRefStrings = computed(() => props.presentRefs.map((p) => p.ref))

// 关联人物：relationships.edges[*].to 过滤已在 presentRefs 中的，去重。
const relatedRefs = computed<Array<{ ref: string }>>(() => {
  const edges = props.relationships?.edges
  if (!edges || edges.length === 0) return []
  const present = new Set(presentRefStrings.value)
  const seen = new Set<string>()
  const out: Array<{ ref: string }> = []
  for (const e of edges) {
    if (present.has(e.to) || seen.has(e.to)) continue
    seen.add(e.to)
    out.push({ ref: e.to })
  }
  return out
})

const hasPresent = computed(() => presentRefStrings.value.length > 0)
const hasRelated = computed(() => relatedRefs.value.length > 0)

function onSelect(ref: string) {
  emit("select", ref)
}
</script>

<template>
  <aside class="char-list">
    <div class="char-list-title">在场人物</div>
    <div v-if="hasPresent" class="char-list-group">
      <CharacterListItem
        v-for="p in presentRefs"
        :key="p.ref"
        :entity-ref="p.ref"
        :selected="selectedRef === p.ref"
        @select="onSelect"
      />
    </div>
    <p v-else class="char-list-empty">当前场景无在场人物</p>

    <template v-if="hasRelated">
      <div class="char-list-section">关联人物</div>
      <div class="char-list-group">
        <CharacterListItem
          v-for="r in relatedRefs"
          :key="r.ref"
          :entity-ref="r.ref"
          :selected="selectedRef === r.ref"
          @select="onSelect"
        />
      </div>
    </template>
  </aside>
</template>

<style scoped>
.char-list {
  width: 220px;
  flex-shrink: 0;
  background: rgba(10, 5, 6, 0.6);
  backdrop-filter: blur(8px);
  border-right: 1px solid var(--line);
  overflow-y: auto;
  padding: 16px 0;
  height: 100%;
}
.char-list-title {
  font-family: var(--font-mono);
  font-size: 0.65rem;
  letter-spacing: 0.08em;
  color: var(--prose-faint);
  text-transform: uppercase;
  padding: 0 16px 12px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 8px;
}
.char-list-section {
  font-family: var(--font-mono);
  font-size: 0.6rem;
  letter-spacing: 0.08em;
  color: var(--prose-faint);
  padding: 16px 16px 8px;
  text-transform: uppercase;
}
.char-list-group {
  display: flex;
  flex-direction: column;
}
.char-list-empty {
  margin: 0;
  padding: 8px 16px;
  font-family: var(--font-serif);
  font-size: 0.75rem;
  color: var(--prose-faint);
  font-style: italic;
}
</style>
