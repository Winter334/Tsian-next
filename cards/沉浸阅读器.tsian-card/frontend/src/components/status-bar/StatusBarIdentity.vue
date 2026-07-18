<script setup lang="ts">
/**
 * StatusBarIdentity — 状态栏"个人信息"区。
 *
 * 从主角 CharacterEntity.identity 提取稳定身份字段，使用分割线 + 轻量字段行展示。
 */
import { computed } from "vue"
import type { CharacterEntity } from "../../lib/character-types"

const props = defineProps<{
  entity: CharacterEntity | null
}>()

interface IdentityRow {
  key: string
  label: string
  value: string
  wide?: boolean
}

const rows = computed<IdentityRow[]>(() => {
  const identity = props.entity?.identity
  if (!identity) return []

  const out: IdentityRow[] = []
  if (identity.gender !== undefined) out.push({ key: "gender", label: "性别", value: String(identity.gender) })
  if (identity.age !== undefined) out.push({ key: "age", label: "年龄", value: String(identity.age) })
  if (identity.role) out.push({ key: "role", label: "身份", value: identity.role })
  if (identity.realm) out.push({ key: "realm", label: "境界", value: identity.realm })
  if (identity.affiliation) out.push({ key: "affiliation", label: "所属", value: identity.affiliation, wide: true })
  return out
})

const isEmpty = computed(() => rows.value.length === 0)
</script>

<template>
  <section class="sb-identity">
    <header class="section-title-row">
      <h3 class="section-title">个人信息</h3>
      <span class="section-line" />
    </header>

    <div v-if="!isEmpty" class="identity-grid">
      <div
        v-for="row in rows"
        :key="row.key"
        class="identity-row"
        :class="{ wide: row.wide }"
      >
        <span class="identity-label">{{ row.label }}</span>
        <span class="identity-value">{{ row.value }}</span>
      </div>
    </div>
    <p v-else class="sb-empty">暂无记录</p>
  </section>
</template>

<style scoped>
.sb-identity {
  padding: 14px 0;
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
.identity-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}
.identity-row {
  min-width: 0;
  padding: 7px 8px;
  border: 1px solid rgba(181, 137, 61, 0.13);
  border-radius: 8px;
  background:
    linear-gradient(135deg, rgba(181, 137, 61, 0.045), rgba(6, 6, 8, 0.12)),
    rgba(6, 6, 8, 0.16);
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.identity-row.wide {
  grid-column: 1 / -1;
}
.identity-label {
  flex-shrink: 0;
  font-family: var(--font-serif);
  font-size: 0.72rem;
  color: var(--prose-faint);
}
.identity-value {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: var(--font-serif);
  font-size: 0.78rem;
  color: var(--prose);
  text-align: right;
}
.sb-empty {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 0.75rem;
  color: var(--prose-faint);
  font-style: italic;
}
</style>
