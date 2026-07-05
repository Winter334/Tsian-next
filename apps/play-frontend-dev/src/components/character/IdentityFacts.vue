<script setup lang="ts">
/**
 * IdentityFacts — 身份锚点 fact chips（概况页身份面板）。
 *
 * design §4.4 / §2.1：
 * - 逐键渲染 fact chip（label + value）。
 * - 缺省键不展示该 chip。
 * - identity 为 undefined 时不渲染任何 chip。
 * - label 用中文小标题（年龄/性别/身份/所属/境界）。
 */
import { computed } from "vue"
import type { CharacterIdentity } from "../../lib/character-types"

const props = defineProps<{
  identity?: CharacterIdentity
}>()

interface FactRow {
  label: string
  value: string
}

const facts = computed<FactRow[]>(() => {
  const id = props.identity
  if (!id) return []
  const rows: FactRow[] = []
  if (id.age !== undefined) {
    rows.push({ label: "年龄", value: String(id.age) })
  }
  if (id.gender) {
    rows.push({ label: "性别", value: id.gender })
  }
  if (id.role) {
    rows.push({ label: "身份", value: id.role })
  }
  if (id.affiliation) {
    rows.push({ label: "所属", value: id.affiliation })
  }
  if (id.realm) {
    rows.push({ label: "境界", value: id.realm })
  }
  return rows
})
</script>

<template>
  <div v-if="facts.length > 0" class="identity-facts">
    <div v-for="f in facts" :key="f.label" class="fact-chip">
      <span class="fact-label">{{ f.label }}</span>
      <span class="fact-value">{{ f.value }}</span>
    </div>
  </div>
</template>

<style scoped>
.identity-facts {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-top: 14px;
}
.fact-chip {
  border: 1px solid var(--line);
  background: rgba(181, 137, 61, 0.025);
  border-radius: 8px;
  padding: 7px 9px;
  min-width: 0;
}
.fact-label {
  display: block;
  font-family: var(--font-mono);
  font-size: 0.58rem;
  letter-spacing: 0.12em;
  color: var(--whisper);
  margin-bottom: 3px;
}
.fact-value {
  display: block;
  font-size: 0.82rem;
  color: var(--prose);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
