<script setup lang="ts">
/** ItemDetailModal — 普通/装备物品共用的单物品 Reka Dialog。 */
import { computed } from "vue"
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from "reka-ui"
import type { CharacterEquipmentSlot } from "../../lib/character-types"
import type { ItemEntity } from "../../lib/item-types"
import type { DisplayItems } from "../../lib/runtime-types"

export interface EquippedSlotContext {
  name: string
  slot: CharacterEquipmentSlot
}

const props = defineProps<{
  open: boolean
  entity: ItemEntity | null
  entityRef: string
  loading: boolean
  displayItems: DisplayItems
  equippedSlots: EquippedSlotContext[]
  returnFocus?: HTMLElement | null
}>()

const emit = defineEmits<{
  "update:open": [value: boolean]
}>()

const typeLabel = computed(() => {
  switch (props.entity?.type) {
    case "equipment": return "装备"
    case "material": return "材料"
    case "consumable": return "消耗品"
    case "special": return "特殊"
    case "other": return "其它"
    default: return "物品"
  }
})

const localId = computed(() => {
  const idx = props.entityRef.indexOf(":")
  return idx >= 0 ? props.entityRef.slice(idx + 1) : props.entityRef
})

const hasExtensions = computed(() =>
  props.displayItems.metrics.length > 0 ||
  props.displayItems.tags.length > 0 ||
  props.displayItems.refs.length > 0 ||
  props.displayItems.sections.length > 0,
)

function restoreFocus(event: Event): void {
  if (!props.returnFocus?.isConnected) return
  event.preventDefault()
  props.returnFocus.focus()
}
</script>

<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="item-overlay" />
      <DialogContent class="item-dialog" @close-auto-focus="restoreFocus">
        <header class="item-head">
          <div>
            <DialogTitle class="item-title">{{ entity?.name ?? localId }}</DialogTitle>
            <DialogDescription class="item-description">
              {{ entity ? `${typeLabel} · 单物品详情` : "物品档案" }}
            </DialogDescription>
          </div>
          <DialogClose class="item-close" aria-label="关闭物品详情">×</DialogClose>
        </header>

        <div v-if="loading" class="item-fallback">读取物品档案…</div>
        <div v-else-if="!entity" class="item-fallback">物品档案缺失</div>

        <div v-else class="item-scroll">
          <p class="item-brief">{{ entity.brief }}</p>
          <div v-if="entity.tags?.length" class="tag-list">
            <span v-for="tag in entity.tags" :key="tag">{{ tag }}</span>
          </div>

          <section v-if="entity.equipment?.slot" class="item-section">
            <h3>建议槽位</h3>
            <p>{{ entity.equipment.slot }}</p>
          </section>

          <section v-if="entity.equipment?.mods && Object.keys(entity.equipment.mods).length" class="item-section">
            <h3>原始修正规则</h3>
            <dl class="rule-list">
              <template v-for="(rule, name) in entity.equipment.mods" :key="name">
                <dt>{{ name }}</dt><dd>{{ rule }}</dd>
              </template>
            </dl>
            <p class="raw-note">仅展示原始规则，界面不会执行这些表达式。</p>
          </section>

          <section v-if="entity.equipment?.effects?.length" class="item-section">
            <h3>叙事效果</h3>
            <ul><li v-for="effect in entity.equipment.effects" :key="effect">{{ effect }}</li></ul>
          </section>

          <section v-if="equippedSlots.length" class="item-section">
            <h3>当前装备</h3>
            <div v-for="context in equippedSlots" :key="context.name" class="equipped-context">
              <strong>{{ context.name }}</strong>
              <span v-if="Object.keys(context.slot.applied ?? {}).length">
                <template v-for="([name, value], index) in Object.entries(context.slot.applied ?? {})" :key="name">
                  <span v-if="index">、</span>{{ name }}{{ value >= 0 ? "+" : "" }}{{ value }}
                </template>
              </span>
              <span v-else>无已记录实际贡献</span>
            </div>
          </section>

          <section v-if="hasExtensions" class="item-section">
            <h3>附加信息</h3>
            <dl v-if="displayItems.metrics.length" class="rule-list">
              <template v-for="item in displayItems.metrics" :key="item.label">
                <dt>{{ item.label }}</dt><dd>{{ item.value }}{{ item.unit ?? "" }}</dd>
              </template>
            </dl>
            <div v-if="displayItems.tags.length" class="tag-list">
              <span v-for="(item, index) in displayItems.tags" :key="`${item.label}-${index}`">
                {{ item.label }}<template v-if="typeof item.value === 'string'">：{{ item.value }}</template>
              </span>
            </div>
            <dl v-if="displayItems.refs.length" class="rule-list extension-ref-list">
              <template v-for="(item, index) in displayItems.refs" :key="`${item.label}-${index}`">
                <dt>{{ item.label }}</dt>
                <dd>{{ item.name ?? item.ref ?? (typeof item.value === 'string' ? item.value : "未记录") }}</dd>
              </template>
            </dl>
            <p v-for="(item, index) in displayItems.sections" :key="`${item.label}-${index}`">
              <strong>{{ item.title ?? item.label }}</strong><br />{{ item.body }}
            </p>
          </section>
        </div>

        <footer class="item-actions">
          <DialogClose class="item-done">关闭</DialogClose>
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.item-overlay {
  position: fixed;
  inset: 0;
  z-index: 150;
  background: rgba(3, 3, 5, 0.82);
  backdrop-filter: blur(7px);
}

.item-dialog {
  position: fixed;
  z-index: 151;
  top: 50%;
  left: 50%;
  width: min(600px, calc(100vw - 44px));
  max-height: min(760px, calc(100dvh - 44px));
  transform: translate(-50%, -50%);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 14px;
  padding: 24px 26px 20px;
  box-sizing: border-box;
  border: 1px solid var(--line-strong);
  border-radius: 5px 14px 5px 14px;
  background:
    linear-gradient(105deg, transparent 49.8%, rgba(181, 137, 61, 0.07) 50%, transparent 50.2%),
    radial-gradient(circle at 20% 8%, rgba(181, 137, 61, 0.11), transparent 38%),
    rgba(10, 7, 8, 0.99);
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.68);
  outline: none;
}

.item-dialog:focus-visible {
  box-shadow: 0 0 0 2px var(--ember-bright), 0 28px 80px rgba(0, 0, 0, 0.68);
}

.item-head,
.item-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.item-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.55rem;
  letter-spacing: 0.07em;
  color: var(--ember-bright);
}

.item-description {
  margin-top: 3px;
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.13em;
  color: var(--prose-faint);
}

.item-close,
.item-done {
  border: 1px solid var(--line);
  background: rgba(6, 6, 8, 0.62);
  color: var(--prose-muted);
  cursor: pointer;
}

.item-close {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  font-size: 1.35rem;
}

.item-done {
  min-height: 36px;
  margin-left: auto;
  padding: 7px 18px;
  border-radius: 5px;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  letter-spacing: 0.1em;
}

.item-close:hover,
.item-close:focus-visible,
.item-done:hover,
.item-done:focus-visible {
  outline: 2px solid var(--ember-bright);
  outline-offset: 2px;
  color: var(--ember-bright);
}

.item-scroll {
  min-height: 0;
  overflow-y: auto;
  padding-right: 5px;
  scrollbar-width: none;
}

.item-scroll::-webkit-scrollbar {
  display: none;
}

.item-brief {
  margin: 0 0 16px;
  line-height: 1.8;
  color: var(--prose-muted);
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag-list span {
  padding: 2px 8px;
  border: 1px solid var(--line);
  border-radius: 10px;
  font-family: var(--font-mono);
  font-size: 0.66rem;
  color: var(--prose-muted);
}

.item-section {
  margin-top: 18px;
}

.item-section h3 {
  margin: 0 0 9px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--line);
  font-family: var(--font-mono);
  font-size: 0.64rem;
  letter-spacing: 0.1em;
  color: var(--prose-faint);
}

.item-section p,
.item-section li {
  font-size: 0.8rem;
  line-height: 1.7;
  color: var(--prose-muted);
}

.item-section ul {
  margin: 0;
  padding-left: 18px;
}

.rule-list {
  display: grid;
  grid-template-columns: minmax(70px, auto) 1fr;
  gap: 6px 14px;
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.72rem;
}

.rule-list dt {
  color: var(--prose-muted);
}

.rule-list dd {
  margin: 0;
  color: var(--ember-bright);
  overflow-wrap: anywhere;
}

.extension-ref-list {
  margin-top: 10px;
}

.raw-note {
  margin: 8px 0 0;
  color: var(--prose-faint) !important;
  font-size: 0.68rem !important;
}

.equipped-context {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  padding: 8px 0;
  border-bottom: 1px dashed rgba(181, 137, 61, 0.14);
  font-size: 0.76rem;
  color: var(--prose-muted);
}

.equipped-context strong {
  color: var(--ember-bright);
}

.item-fallback {
  display: grid;
  place-items: center;
  min-height: 180px;
  color: var(--prose-faint);
}

@media (max-width: 720px) {
  .item-dialog {
    top: auto;
    bottom: 0;
    left: 0;
    width: 100vw;
    max-height: calc(100dvh - 34px);
    transform: none;
    padding: 20px 18px calc(16px + env(safe-area-inset-bottom));
    border-radius: 16px 16px 0 0;
  }
}
</style>
