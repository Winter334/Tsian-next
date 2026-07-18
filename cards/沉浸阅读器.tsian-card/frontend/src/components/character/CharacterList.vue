<script setup lang="ts">
/**
 * CharacterList — 左侧在场人物列表 + 关联人物分组（CharacterView 子组件）。
 *
 * design §4.2 / R1 / R9 / R12：
 * - "在场人物" 分组：presentRefs 逐项 useEntity 取 name/brief/portrait；高亮 selectedRef。
 * - "关联人物" 分组：从 relationships.edges[*].to 取 ref；过滤已在 presentRefs
 *   中的；逐项 useEntity 取 name/brief/portrait。
 * - 单行：肖像缩略图 + name + brief（1 行截断）。
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
  /** 头像更新后递增，通知列表项重新读取 entity/缩略图。 */
  portraitRefreshToken: number
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
    <div class="char-list-title">
      <span>在场人物</span>
      <span class="char-list-count">{{ presentRefStrings.length }}</span>
    </div>
    <div v-if="hasPresent" class="char-list-group">
      <CharacterListItem
        v-for="p in presentRefs"
        :key="p.ref"
        :entity-ref="p.ref"
        :selected="selectedRef === p.ref"
        :protagonist="protagonistRef === p.ref"
        :portrait-refresh-token="portraitRefreshToken"
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
          :protagonist="protagonistRef === r.ref"
          :portrait-refresh-token="portraitRefreshToken"
          @select="onSelect"
        />
      </div>
    </template>
  </aside>
</template>

<style scoped>
.char-list {
  position: relative;
  width: 220px;
  flex-shrink: 0;
  height: 100%;
  overflow-y: auto;
  padding: 14px 0 18px;
  border-right: 1px solid rgba(181, 137, 61, 0.18);
  background:
    radial-gradient(circle at 22% 18%, rgba(181, 137, 61, 0.08), transparent 34%),
    linear-gradient(180deg, rgba(16, 7, 8, 0.82), rgba(6, 3, 4, 0.72)),
    rgba(10, 5, 6, 0.68);
  backdrop-filter: blur(10px);
  box-shadow:
    inset -1px 0 0 rgba(232, 169, 72, 0.035),
    18px 0 48px rgba(0, 0, 0, 0.16);
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.char-list::-webkit-scrollbar {
  display: none;
}
.char-list::before {
  content: "";
  position: sticky;
  top: -14px;
  display: block;
  height: 1px;
  margin-bottom: 13px;
  background: linear-gradient(90deg, transparent, rgba(232, 169, 72, 0.28), transparent);
  opacity: 0.55;
}
.char-list-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 0 10px 10px;
  padding: 0 6px 10px;
  border-bottom: 1px solid rgba(181, 137, 61, 0.16);
  color: var(--prose-faint);
  font-family: var(--font-mono);
  font-size: 0.64rem;
  letter-spacing: 0.10em;
  text-transform: uppercase;
}
.char-list-count {
  min-width: 20px;
  padding: 1px 6px;
  border: 1px solid rgba(181, 137, 61, 0.20);
  border-radius: 999px;
  color: var(--ember-bright);
  background: rgba(181, 137, 61, 0.06);
  text-align: center;
  font-size: 0.58rem;
  letter-spacing: 0.04em;
}
.char-list-section {
  margin: 16px 10px 8px;
  padding: 10px 6px 0;
  border-top: 1px solid rgba(181, 137, 61, 0.12);
  color: var(--prose-faint);
  font-family: var(--font-mono);
  font-size: 0.6rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.char-list-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 10px;
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
