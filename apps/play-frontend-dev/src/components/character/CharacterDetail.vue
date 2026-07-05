<script setup lang="ts">
/**
 * CharacterDetail — 角色卡右侧详情区（tabs + panes）。
 *
 * design §4.3 / §4.4 / R7：
 * - tab state：overview | attributes | inventory，默认 overview。
 * - tabs：概况 / 属性 / 背包。
 * - 切换 tab 时只换 pane 内容（立绘栏不变，由 CharacterCard 持有）。
 * - active tab 用 --ember 下边框（参考预览 HTML）。
 *
 * props 由 CharacterCard 透传：entity + relationships + displayItems。
 */
import { ref } from "vue"
import type { CharacterEntity, RelationshipFile } from "../../lib/character-types"
import type { DisplayItems } from "../../lib/runtime-types"
import OverviewPane from "./OverviewPane.vue"
import AttributesPane from "./AttributesPane.vue"
import InventoryPane from "./InventoryPane.vue"

const props = defineProps<{
  entity: CharacterEntity
  relationships: RelationshipFile | null
  displayItems: DisplayItems
}>()

const emit = defineEmits<{
  select: [ref: string]
}>()

type Tab = "overview" | "attributes" | "inventory"
const activeTab = ref<Tab>("overview")

function setTab(t: Tab) {
  activeTab.value = t
}

function onSelect(ref: string) {
  emit("select", ref)
}
</script>

<template>
  <div class="detail-column">
    <div class="card-toolbar">
      <div class="card-title-block">
        <div class="card-kicker">CHARACTER DOSSIER</div>
        <div class="card-title">角色档案</div>
      </div>
      <div class="tabs">
        <button
          class="tab"
          :class="{ active: activeTab === 'overview' }"
          type="button"
          @click="setTab('overview')"
        >概况</button>
        <button
          class="tab"
          :class="{ active: activeTab === 'attributes' }"
          type="button"
          @click="setTab('attributes')"
        >属性</button>
        <button
          class="tab"
          :class="{ active: activeTab === 'inventory' }"
          type="button"
          @click="setTab('inventory')"
        >背包</button>
      </div>
    </div>

    <div class="tab-content">
      <OverviewPane
        v-if="activeTab === 'overview'"
        :entity="entity"
        :relationships="relationships"
        :display-items="displayItems"
        @select="onSelect"
      />
      <AttributesPane
        v-else-if="activeTab === 'attributes'"
        :attributes="entity.attributes"
        :gauges="entity.gauges"
      />
      <InventoryPane v-else />
    </div>
  </div>
</template>

<style scoped>
.detail-column {
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: 100%;
}
.card-toolbar {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid var(--line);
}
.card-title-block {
  padding-bottom: 12px;
}
.card-kicker {
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.18em;
  color: var(--whisper);
  margin-bottom: 4px;
}
.card-title {
  font-family: var(--font-display);
  font-size: 1.25rem;
  color: var(--ember-bright);
  letter-spacing: 0.06em;
}
.tabs {
  display: flex;
  gap: 0;
  align-self: stretch;
}
.tab {
  background: transparent;
  border: none;
  color: var(--prose-dim);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  letter-spacing: 0.12em;
  padding: 14px 20px 12px;
  cursor: pointer;
  position: relative;
  transition: color 0.2s;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.tab:hover {
  color: var(--prose);
}
.tab.active {
  color: var(--ember-bright);
  border-bottom-color: var(--ember);
}
.tab-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-top: 22px;
}
</style>
