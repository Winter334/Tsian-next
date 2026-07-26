<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from "reka-ui"
import type { EquipmentCandidate } from "../../lib/load-character-inventory"
import type { EquipmentMutationResult } from "../../lib/equipment-action"
import type { EquipmentSlotSelection } from "../../composables/useEquipmentManagement"
import ItemIcon from "../inventory/ItemIcon.vue"

const props = defineProps<{
  open: boolean
  selection: EquipmentSlotSelection | null
  candidates: EquipmentCandidate[]
  loading: boolean
  selectedItemRef: string | null
  preview: EquipmentMutationResult | null
  previewPending: boolean
  commitPending: boolean
  errorMessage: string
  successMessage: string
}>()

const emit = defineEmits<{
  "update:open": [open: boolean]
  preview: [operation: "equip" | "unequip", itemRef?: string]
  commit: []
}>()

const candidateButtons = ref<Array<HTMLButtonElement | null>>([])
const closeButton = ref<HTMLButtonElement | null>(null)
const mobilePreviewEnd = ref<HTMLElement | null>(null)

const displayCandidates = computed(() => props.candidates.map((candidate) => {
  const item = candidate.item
  let reason = ""
  if (candidate.status !== "ready") reason = "物品档案不可读"
  else if (item?.type !== "equipment" || item.equipmentStatus !== "ready") reason = "不是可用装备"
  else if (item.equipment?.slotType !== props.selection?.slotType) reason = `适用于${item.equipment?.slotType ?? "其它"}槽`
  return { ...candidate, available: reason.length === 0, reason }
}))

const deltaEntries = computed(() => Object.entries(props.preview?.attributes.delta ?? {}))

watch(() => props.open, async (open) => {
  if (!open) return
  await nextTick()
  closeButton.value?.focus()
})

watch(() => props.preview, async (preview) => {
  if (!preview || !props.open || !window.matchMedia("(max-width: 720px)").matches) return
  await nextTick()
  mobilePreviewEnd.value?.scrollIntoView({ block: "end" })
})

function restoreFocus(event: Event): void {
  const trigger = props.selection?.trigger
  if (!trigger?.isConnected) return
  event.preventDefault()
  trigger.focus()
}

function moveCandidateFocus(index: number, direction: 1 | -1): void {
  if (candidateButtons.value.length === 0) return
  let next = index
  for (let step = 0; step < candidateButtons.value.length; step += 1) {
    next = (next + direction + candidateButtons.value.length) % candidateButtons.value.length
    const button = candidateButtons.value[next]
    if (button) {
      button.focus()
      return
    }
  }
}
</script>

<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="equipment-overlay" />
      <DialogContent class="equipment-dialog" @close-auto-focus="restoreFocus">
        <header class="equipment-head">
          <div>
            <span class="equipment-kicker">LOADOUT PROJECTION</span>
            <DialogTitle class="equipment-title">{{ selection?.slotType ?? "装备" }} · 第{{ (selection?.slotIndex ?? 0) + 1 }}槽</DialogTitle>
            <DialogDescription class="equipment-description">
              选择可达装备，先查看属性变化，再确认写入。
            </DialogDescription>
          </div>
          <DialogClose as-child>
            <button ref="closeButton" type="button" class="equipment-close" aria-label="关闭装备管理">×</button>
          </DialogClose>
        </header>

        <div class="equipment-body">
          <section class="candidate-panel" aria-labelledby="candidate-heading">
            <div class="section-heading">
              <h3 id="candidate-heading">持有装备</h3>
              <span>{{ displayCandidates.length }} 项</span>
            </div>
            <div v-if="loading" class="candidate-empty" role="status">正在读取容器图…</div>
            <div v-else-if="displayCandidates.length === 0" class="candidate-empty">没有可展示的物品</div>
            <div v-else class="candidate-list" role="listbox" :aria-label="`${selection?.slotType ?? ''}槽候选装备`">
              <button
                v-for="(candidate, index) in displayCandidates"
                :key="candidate.ref"
                :ref="(element) => candidateButtons[index] = element as HTMLButtonElement | null"
                type="button"
                class="candidate-card"
                :class="{ selected: candidate.ref === selectedItemRef, unavailable: !candidate.available }"
                role="option"
                :aria-selected="candidate.ref === selectedItemRef"
                :aria-disabled="!candidate.available"
                :aria-describedby="!candidate.available ? `candidate-reason-${index}` : undefined"
                @click="candidate.available && emit('preview', 'equip', candidate.ref)"
                @keydown.down.prevent="moveCandidateFocus(index, 1)"
                @keydown.right.prevent="moveCandidateFocus(index, 1)"
                @keydown.up.prevent="moveCandidateFocus(index, -1)"
                @keydown.left.prevent="moveCandidateFocus(index, -1)"
              >
                <span class="candidate-icon" aria-hidden="true"><ItemIcon :entity="candidate.item" :entity-ref="candidate.ref" /></span>
                <span class="candidate-copy">
                  <strong>{{ candidate.item?.name ?? candidate.ref }}</strong>
                  <small :id="`candidate-reason-${index}`">{{ candidate.reason || (candidate.availableCount === null ? "大量可达" : `${candidate.availableCount} 件可达`) }}</small>
                </span>
              </button>
            </div>
            <button
              v-if="selection?.slot.ref"
              type="button"
              class="unequip-button"
              @click="emit('preview', 'unequip')"
            >
              卸下当前装备
            </button>
          </section>

          <section class="preview-panel" aria-labelledby="preview-heading">
            <div class="section-heading"><h3 id="preview-heading">属性预览</h3><span>权威计算</span></div>
            <div v-if="previewPending" class="preview-empty" role="status">正在计算装备投影…</div>
            <div v-else-if="!preview" class="preview-empty">选择装备或卸下当前装备后，这里会显示变更。</div>
            <template v-else>
              <div class="slot-change">
                <span>{{ preview.slot.beforeRef ? "已占用" : "空槽" }}</span>
                <b aria-hidden="true">→</b>
                <span>{{ preview.slot.afterRef ? "新装备" : "空槽" }}</span>
              </div>
              <dl v-if="deltaEntries.length" class="delta-list">
                <template v-for="([name, delta]) in deltaEntries" :key="name">
                  <dt>{{ name }}</dt>
                  <dd :class="delta > 0 ? 'positive' : 'negative'">
                    {{ preview.attributes.before[name] }} → {{ preview.attributes.after[name] }}
                    <small>({{ delta > 0 ? "+" : "" }}{{ delta }})</small>
                  </dd>
                </template>
              </dl>
              <p v-else class="unchanged">有效属性不会变化。</p>
            </template>
            <p v-if="errorMessage" class="equipment-message error" role="alert">{{ errorMessage }}</p>
            <p v-else-if="successMessage" class="equipment-message success" role="status">{{ successMessage }}</p>
            <span ref="mobilePreviewEnd" class="mobile-preview-end" aria-hidden="true" />
          </section>
        </div>

        <footer class="equipment-actions">
          <DialogClose class="secondary-action">取消</DialogClose>
          <button type="button" class="primary-action" :disabled="!preview || previewPending || commitPending" @click="emit('commit')">
            {{ commitPending ? "正在写入…" : (preview?.operation === "unequip" ? "确认卸下" : selection?.slot.ref ? "确认替换" : "确认装备") }}
          </button>
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.equipment-overlay { position: fixed; inset: 0; z-index: 170; background: rgba(3,3,5,.84); backdrop-filter: blur(8px); }
.equipment-dialog { position: fixed; z-index: 171; top: 50%; left: 50%; width: min(880px, calc(100vw - 42px)); max-height: min(780px, calc(100dvh - 42px)); transform: translate(-50%,-50%); display: grid; grid-template-rows: auto minmax(0,1fr) auto; gap: 18px; padding: 24px 26px 20px; box-sizing: border-box; border: 1px solid var(--line-strong); border-radius: 5px 17px 5px 17px; background: radial-gradient(circle at 17% 10%, rgba(181,137,61,.12), transparent 37%), linear-gradient(110deg, rgba(155,58,46,.07), transparent 34%), rgba(9,7,8,.99); box-shadow: 0 34px 90px rgba(0,0,0,.72); outline: none; }
.equipment-dialog:focus-visible { box-shadow: 0 0 0 2px var(--ember-bright), 0 34px 90px rgba(0,0,0,.72); }
.equipment-head,.equipment-actions,.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.equipment-kicker { font: .55rem var(--font-mono); letter-spacing: .18em; color: var(--whisper); }
.equipment-title { margin: 4px 0 0; font: 1.55rem var(--font-display); letter-spacing: .07em; color: var(--ember-bright); }
.equipment-description { margin-top: 4px; font-size: .74rem; color: var(--prose-faint); }
.equipment-close { width: 36px; height: 36px; border: 1px solid var(--line); border-radius: 50%; background: rgba(6,6,8,.6); color: var(--prose-muted); font-size: 1.35rem; cursor: pointer; }
.equipment-body { min-height: 0; display: grid; grid-template-columns: minmax(0,1.1fr) minmax(260px,.9fr); gap: 22px; }
.candidate-panel,.preview-panel { min-height: 0; display: flex; flex-direction: column; }
.preview-panel { padding-left: 22px; border-left: 1px solid var(--line); overflow-y: auto; scrollbar-width: thin; }
.section-heading { padding-bottom: 9px; border-bottom: 1px solid var(--line); }
.section-heading h3 { margin: 0; font: .69rem var(--font-mono); letter-spacing: .12em; color: var(--prose-muted); }
.section-heading span { font: .57rem var(--font-mono); color: var(--whisper); }
.candidate-list { min-height: 0; overflow-y: auto; display: grid; gap: 8px; padding: 10px 4px 10px 0; scrollbar-width: thin; }
.candidate-card { width: 100%; min-height: 68px; display: grid; grid-template-columns: 48px 1fr; align-items: center; gap: 12px; padding: 8px 12px; border: 1px solid rgba(181,137,61,.18); border-radius: 4px 11px 4px 11px; background: rgba(16,12,13,.72); color: var(--prose-muted); text-align: left; cursor: pointer; }
.candidate-card:hover,.candidate-card:focus-visible,.candidate-card.selected { border-color: rgba(232,169,72,.65); background: rgba(181,137,61,.1); outline: none; box-shadow: inset 3px 0 var(--ember); }
.candidate-card:focus-visible { outline: 2px solid var(--ember-bright); outline-offset: 2px; }
.candidate-card.unavailable { opacity: .58; cursor: help; }
.candidate-icon { width: 42px; aspect-ratio: 1; }
.candidate-copy { min-width: 0; display: grid; gap: 4px; }
.candidate-copy strong,.candidate-copy small { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.candidate-copy strong { font: .88rem var(--font-display); letter-spacing: .05em; color: var(--ember-bright); }
.candidate-copy small { font: .59rem var(--font-mono); color: var(--prose-faint); }
.unequip-button { margin-top: 9px; min-height: 38px; border: 1px dashed rgba(155,58,46,.55); background: rgba(155,58,46,.08); color: #cf8d82; cursor: pointer; }
.candidate-empty,.preview-empty { flex: 1; min-height: 180px; display: grid; place-items: center; text-align: center; color: var(--prose-faint); font-size: .75rem; }
.slot-change { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 10px; margin: 16px 0; padding: 12px; border: 1px solid var(--line); background: rgba(6,6,8,.42); text-align: center; font: .7rem var(--font-mono); color: var(--prose-muted); }
.slot-change b { color: var(--ember-bright); }
.delta-list { display: grid; grid-template-columns: minmax(70px,auto) 1fr; gap: 9px 16px; margin: 0; font: .74rem var(--font-mono); }
.delta-list dt { color: var(--prose-muted); }
.delta-list dd { margin: 0; text-align: right; color: var(--prose); }
.delta-list small { margin-left: 5px; }
.delta-list .positive small { color: #9fc49b; }
.delta-list .negative small { color: #d68b7f; }
.unchanged { color: var(--prose-faint); font-size: .76rem; }
.equipment-message { margin-top: auto; padding: 10px 12px; border-left: 2px solid; font-size: .72rem; line-height: 1.6; }
.equipment-message.error { border-color: var(--blood); background: rgba(155,58,46,.09); color: #d8a49b; }
.equipment-message.success { border-color: #6f9d6d; background: rgba(111,157,109,.08); color: #acd0a9; }
.mobile-preview-end { display: none; }
.equipment-actions { justify-content: flex-end; }
.secondary-action,.primary-action { min-height: 40px; padding: 8px 20px; border-radius: 4px; font: .7rem var(--font-mono); letter-spacing: .08em; cursor: pointer; }
.secondary-action { border: 1px solid var(--line); background: transparent; color: var(--prose-muted); }
.primary-action { border: 1px solid rgba(232,169,72,.62); background: linear-gradient(135deg, rgba(181,137,61,.3), rgba(155,58,46,.19)); color: var(--ember-bright); }
.primary-action:disabled { opacity: .42; cursor: not-allowed; }
.equipment-close:focus-visible,.unequip-button:focus-visible,.secondary-action:focus-visible,.primary-action:focus-visible { outline: 2px solid var(--ember-bright); outline-offset: 2px; }
@media (max-width: 720px) { .equipment-dialog { top: auto; bottom: calc(62px + env(safe-area-inset-bottom)); left: 0; width: 100vw; max-height: calc(100dvh - 86px - env(safe-area-inset-bottom)); transform: none; padding: 20px 16px 16px; border-radius: 17px 17px 0 0; } .equipment-head { min-height: 0; } .equipment-description { max-width: 250px; } .equipment-body { display: block; overflow-y: auto; } .candidate-list { max-height: 36dvh; overflow-y: auto; } .preview-panel { margin-top: 18px; padding: 18px 0 0; border-top: 1px solid var(--line); border-left: 0; overflow: visible; } .preview-empty { min-height: 110px; } .mobile-preview-end { display: block; height: 1px; } .equipment-actions { position: relative; z-index: 1; background: rgba(9,7,8,.99); } }
@media (prefers-reduced-motion: reduce) { .candidate-card { transition: none; } }
</style>
