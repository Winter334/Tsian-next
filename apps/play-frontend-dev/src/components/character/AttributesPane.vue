<script setup lang="ts">
/**
 * AttributesPane — 属性标签页（角色卡右侧详情区）。
 *
 * design §4.5 / D7 / R13：
 * - 基础维度（AttributeCard × 6）：体魄/悟性/气运/根骨/法力/魅力。
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
}>()

interface AttrRow {
  name: string
  value: number | null
}

const ATTR_KEYS: Array<{ key: keyof CharacterAttributes; label: string }> = [
  { key: "体魄", label: "体魄" },
  { key: "悟性", label: "悟性" },
  { key: "气运", label: "气运" },
  { key: "根骨", label: "根骨" },
  { key: "法力", label: "法力" },
  { key: "魅力", label: "魅力" },
]

const attrRows = computed<AttrRow[]>(() => {
  const attrs = props.attributes
  return ATTR_KEYS.map(({ key, label }) => {
    const v = attrs?.[key]
    return {
      name: label,
      value: typeof v === "number" && Number.isFinite(v) ? v : null,
    }
  })
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
  letter-spacing: 0.14em;
  color: var(--whisper);
  text-transform: uppercase;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--line);
}
.attribute-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}
.gauge-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
</style>
