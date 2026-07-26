<script setup lang="ts">
/**
 * OverviewPane — 角色模式右侧档案区。
 *
 * 页面级姓名、当前状态、稳定特质和身份由共享舞台持有；这里从简介和阅读型档案开始。
 * 2. 当前形象：entity.appearance 单段字符串；缺省不展示。
 * 3. 关系（RelationshipList）：从 relationships.edges → useEntity 取 name/brief；点击 select。
 * 4. 意图与目标（GoalsBlock）：entity.goals → 三行 label-text。
 * 5. 人物履历：entity.history[] → event 文本列表；无有效条目不展示。
 * 6. 背景摘记：entity.background 单段字符串；缺省不展示。
 * 7. extensions：displayItems.tags/refs/sections/metrics 分别进入对应小区域。
 *
 * 不抛错：父组件保证 entity 非 null；本组件按字段缺省 fallback。
 */
import { computed } from "vue"
import type { CharacterEntity, RelationshipFile } from "../../lib/character-types"
import type { DisplayItems } from "../../lib/runtime-types"
import IdentityFacts from "./IdentityFacts.vue"
import RelationshipList from "./RelationshipList.vue"
import GoalsBlock from "./GoalsBlock.vue"
import PinButton from "./PinButton.vue"

const props = defineProps<{
  entity: CharacterEntity
  relationships: RelationshipFile | null
  displayItems: DisplayItems
  /** 当前角色 entity ref；透传给身份、外貌和目标等可钉选字段。 */
  entityRef: string | null
}>()

const emit = defineEmits<{
  select: [ref: string]
}>()

const aliases = computed(() => props.entity.aliases ?? [])
const hasAppearance = computed(
  () => typeof props.entity.appearance === "string" && props.entity.appearance.length > 0,
)
const hasBackground = computed(
  () => typeof props.entity.background === "string" && props.entity.background.length > 0,
)
const hasGoals = computed(() => Boolean(props.entity.goals))
const historyEvents = computed(() =>
  (props.entity.history ?? []).filter(
    (item): item is { event: string } =>
      typeof item === "object" && item !== null && typeof item.event === "string" && item.event.length > 0,
  ),
)
const hasHistory = computed(() => historyEvents.value.length > 0)
const edges = computed(() => props.relationships?.edges ?? [])
const hasRelationships = computed(() => edges.value.length > 0)

const hasMetrics = computed(() => props.displayItems.metrics.length > 0)
const hasTags = computed(() => props.displayItems.tags.length > 0)
const hasRefs = computed(() => props.displayItems.refs.length > 0)
const hasSections = computed(() => props.displayItems.sections.length > 0)

function onSelect(ref: string) {
  emit("select", ref)
}
</script>

<template>
  <div class="overview-main">
    <!-- 舞台之后从简介与身份字段继续，避免重复姓名标题。 -->
    <div class="identity-panel">
      <div class="char-brief">{{ entity.brief }}</div>
      <div v-if="aliases.length > 0" class="char-aliases">
        <span v-for="a in aliases" :key="a" class="char-alias">{{ a }}</span>
      </div>
      <IdentityFacts :identity="entity.identity" :entity-ref="entityRef" />
    </div>

    <div class="overview-grid">
      <!-- 3. 当前形象 -->
      <div v-if="hasAppearance" class="overview-section full">
        <div class="section-title">当前形象</div>
        <div class="narrative-block">
          <p>{{ entity.appearance }}</p>
          <PinButton
            v-if="entityRef"
            :target="{ entityRef, kind: 'appearance', label: '外貌' }"
          />
        </div>
      </div>

      <!-- 4. 关系 -->
      <div v-if="hasRelationships" class="overview-section">
        <div class="section-title">关系</div>
        <RelationshipList :edges="edges" @select="onSelect" />
      </div>

      <!-- 5. 意图与目标 -->
      <div v-if="hasGoals" class="overview-section full">
        <div class="section-title">意图与目标</div>
        <GoalsBlock :goals="entity.goals" :entity-ref="entityRef" />
      </div>

      <!-- 6. 人物履历 -->
      <div v-if="hasHistory" class="overview-section full">
        <div class="section-title">人物履历</div>
        <ol class="history-list">
          <li v-for="(item, idx) in historyEvents" :key="`history-${idx}`" class="history-row">
            {{ item.event }}
          </li>
        </ol>
      </div>

      <!-- 7. 背景摘记 -->
      <div v-if="hasBackground" class="overview-section full">
        <div class="section-title">背景摘记</div>
        <div class="narrative-block">
          <p>{{ entity.background }}</p>
        </div>
      </div>

      <!-- 8. extensions 分区 -->
      <div v-if="hasMetrics" class="overview-section full">
        <div class="section-title">数值</div>
        <ul class="ext-metric-list">
          <li v-for="(m, idx) in displayItems.metrics" :key="`metric-${idx}`" class="ext-metric-row">
            <div class="ext-metric-head">
              <span class="ext-metric-label">{{ m.label }}</span>
              <span class="ext-metric-value">
                {{ typeof m.value === "number" ? m.value : 0
                }}<span v-if="m.unit" class="ext-metric-unit">{{ m.unit }}</span>
              </span>
            </div>
            <div
              v-if="m.render === 'progress'"
              class="ext-metric-track"
            >
              <div
                class="ext-metric-fill"
                :style="{
                  width: `${Math.max(0, Math.min(100, ((typeof m.value === 'number' ? m.value : 0) - (m.min ?? 0)) / ((m.max ?? 100) - (m.min ?? 0)) * 100))}%`
                }"
              />
            </div>
          </li>
        </ul>
      </div>

      <div v-if="hasTags" class="overview-section">
        <div class="section-title">标签</div>
        <div class="ext-tags">
          <span v-for="(t, idx) in displayItems.tags" :key="`tag-${idx}`" class="ext-tag">
            {{ t.label }}<template v-if="typeof t.value === 'string' && t.value.length > 0">：{{ t.value }}</template>
          </span>
        </div>
      </div>

      <div v-if="hasRefs" class="overview-section">
        <div class="section-title">关联</div>
        <ul class="ext-ref-list">
          <li v-for="(r, idx) in displayItems.refs" :key="`ext-ref-${idx}`" class="ext-ref-row">
            <span class="ext-ref-label">{{ r.label }}</span>
            <span v-if="r.name" class="ext-ref-name">{{ r.name }}</span>
          </li>
        </ul>
      </div>

      <div v-if="hasSections" class="overview-section full">
        <div class="section-title">详情</div>
        <div class="ext-sections">
          <div v-for="(s, idx) in displayItems.sections" :key="`sec-${idx}`" class="ext-section">
            <div v-if="s.title" class="ext-section-title">{{ s.title }}</div>
            <div v-if="s.body" class="ext-section-body">{{ s.body }}</div>
          </div>
        </div>
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
.identity-panel {
  border-bottom: 1px solid var(--line);
  padding-bottom: 16px;
}
.char-brief {
  font-size: 0.92rem;
  line-height: 1.8;
  color: var(--prose-muted);
  max-width: 52em;
}
.char-aliases {
  display: flex;
  gap: 6px;
  margin-top: 10px;
  flex-wrap: wrap;
}
.char-alias {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--prose-muted);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 1px 8px;
}

.overview-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px 28px;
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
.narrative-block {
  position: relative;
  font-size: 0.88rem;
  line-height: 1.85;
  color: var(--prose-muted);
  padding: 2px 22px 0 0;
}
.narrative-block p {
  margin: 0;
}
.narrative-block:hover :deep(.pin-btn) {
  opacity: 0.85;
}
.narrative-block :deep(.pin-btn.active) {
  opacity: 1;
}

.history-list {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.history-row {
  font-size: 0.84rem;
  line-height: 1.75;
  color: var(--prose-muted);
  padding-left: 2px;
}
.history-row::marker {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  color: var(--prose-faint);
}

/* extensions 分区朴素渲染 */
.ext-metric-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ext-metric-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ext-metric-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.ext-metric-label {
  font-family: var(--font-serif);
  font-size: 0.78rem;
  color: var(--prose-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ext-metric-value {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  color: var(--ember-bright);
}
.ext-metric-unit {
  margin-left: 2px;
  font-size: 0.7rem;
  color: var(--prose-muted);
}
.ext-metric-track {
  height: 4px;
  border-radius: 2px;
  background: rgba(181, 137, 61, 0.1);
  overflow: hidden;
}
.ext-metric-fill {
  height: 100%;
  border-radius: 2px;
  background: var(--ember);
  transition: width 0.4s ease;
}

.ext-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ext-tag {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--prose-muted);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 1px 8px;
}

.ext-ref-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ext-ref-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 0.78rem;
}
.ext-ref-label {
  font-family: var(--font-serif);
  color: var(--prose-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ext-ref-name {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--ember-bright);
  margin-left: auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ext-sections {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ext-section-title {
  font-family: var(--font-serif);
  font-size: 0.86rem;
  color: var(--prose);
  margin-bottom: 4px;
}
.ext-section-body {
  font-size: 0.82rem;
  line-height: 1.7;
  color: var(--prose-muted);
}
</style>
