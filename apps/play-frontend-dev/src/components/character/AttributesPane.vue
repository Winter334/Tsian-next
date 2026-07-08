<script setup lang="ts">
/**
 * AttributesPane — 属性标签页（角色卡右侧详情区）。
 *
 * design §4.5 / D7 / R13：
 * - 基础维度（AttributeCard × N）：键名由世界架构师按世界观定义（默认六维兜底）。
 *   每张卡片：name + 大数字。缺省维度展示"—"。
 * - 特殊量表（GaugeBar × N）：entity.gauges → name + progress bar + value。
 * - 不展示基准 5（基准只进入规则语义，UI 不解释）。
 * - 不展示 HP/MP 默认标签（gauges 是自由命名）。
 * - 不混入功法/神通/境界/装备（这些归后续能力/装备页）。
 */
import { computed } from "vue"
import type { CharacterAttributes, CharacterGauge } from "../../lib/character-types"
import AttributeCard from "./AttributeCard.vue"
import GaugeBar from "./GaugeBar.vue"

const props = defineProps<{
  attributes?: CharacterAttributes
  gauges?: CharacterGauge[]
  /** 当前角色 entity ref；透传给 AttributeCard / GaugeBar 用于构造 pin target。 */
  entityRef: string | null
}>()

interface AttrRow {
  name: string
  value: number | null
}

const attrRows = computed<AttrRow[]>(() => {
  const attrs = props.attributes
  if (!attrs) return []
  return Object.entries(attrs).map(([key, v]) => ({
    name: key,
    value: typeof v === "number" && Number.isFinite(v) ? v : null,
  }))
})

const gaugeList = computed(() => props.gauges ?? [])
const hasGauges = computed(() => gaugeList.value.length > 0)
</script>

<template>
  <div class="overview-main">
    <div class="overview-section full">
      <div class="section-title">基础维度</div>
      <div class="attribute-grid">
        <AttributeCard
          v-for="a in attrRows"
          :key="a.name"
          :name="a.name"
          :value="a.value"
          :entity-ref="entityRef"
        />
      </div>
    </div>

    <div v-if="hasGauges" class="overview-section full">
      <div class="section-title">特殊量表</div>
      <div class="gauge-list">
        <GaugeBar
          v-for="g in gaugeList"
          :key="g.id"
          :gauge="g"
          :entity-ref="entityRef"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.overview-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.overview-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.overview-section.full {
  grid-column: 1 / -1;
}
.section-title {
  font-family: var(--font-mono);
  font-size: 0.65rem;
  letter-spacing: 0.08em;
  color: var(--prose-faint);
  text-transform: uppercase;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--line);
}
.attribute-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.gauge-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
</style>
