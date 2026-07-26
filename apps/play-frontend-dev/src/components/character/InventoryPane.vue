<script setup lang="ts">
/** InventoryPane — 在面板内导航容器，并用单物品 Dialog 展示详情。 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import type { CharacterEquipment } from "../../lib/character-types"
import type { ContainerContent, ContainerEntity, InventoryEntity, InventoryEntityLoadStatus, ItemEntity } from "../../lib/item-types"
import { isContainerEntity } from "../../lib/item-types"
import { loadInventoryEntity } from "../../lib/load-inventory-entity"
import { parseExtensionsOnly } from "../../lib/parse-entity"
import { emptyDisplayItems } from "../../lib/runtime-types"
import type { DisplayItems } from "../../lib/runtime-types"
import InventoryBreadcrumb from "../inventory/InventoryBreadcrumb.vue"
import InventoryGrid from "../inventory/InventoryGrid.vue"
import type { InventoryGridItem } from "../inventory/InventoryGrid.vue"
import ItemDetailModal from "../inventory/ItemDetailModal.vue"
import type { EquippedSlotContext } from "../inventory/ItemDetailModal.vue"

const props = defineProps<{
  containers?: Array<{ ref: string; count?: number }>
  equipment?: CharacterEquipment
  highlightedItemRef: string | null
  requestedItemRef: string | null
  refreshToken: number
}>()

const emit = defineEmits<{
  "highlight-item": [ref: string | null]
  "request-consumed": []
}>()

interface RefSlot {
  ref: string
  count?: number
  entity: InventoryEntity | null
  status: InventoryEntityLoadStatus | "loading" | "cycle"
}

const path = ref<Array<{ ref: string; name: string }>>([])
const currentContainer = ref<ContainerEntity | null>(null)
const slots = ref<RefSlot[]>([])
const panelLoading = ref(false)
const panelMessage = ref("")
let navigationVersion = 0

const selectedItem = ref<ItemEntity | null>(null)
const selectedItemRef = ref("")
const selectedItemOpen = ref(false)
const selectedItemLoading = ref(false)
const selectedDisplayItems = ref<DisplayItems>(emptyDisplayItems())
const itemReturnFocus = ref<HTMLElement | null>(null)
let itemRequestVersion = 0

const equipmentByRef = computed(() => {
  const map = new Map<string, EquippedSlotContext[]>()
  for (const [slotType, slots] of Object.entries(props.equipment ?? {})) {
    slots.forEach((slot, slotIndex) => {
      if (slot.ref === null) return
      const contexts = map.get(slot.ref) ?? []
      contexts.push({ name: `${slotType}第${slotIndex + 1}槽`, slot })
      map.set(slot.ref, contexts)
    })
  }
  return map
})

const gridItems = computed<InventoryGridItem[]>(() => slots.value.map((slot) => ({
  ...slot,
  equippedSlots: equipmentByRef.value.get(slot.ref)?.map((context) => context.name),
  highlighted: slot.ref === props.highlightedItemRef,
})))

const atRoot = computed(() => path.value.length === 0)
const panelTitle = computed(() => currentContainer.value?.name ?? "持有容器")

watch(
  () => props.containers,
  () => void resetToRoot(),
  { deep: true },
)

watch(
  () => props.refreshToken,
  () => void refreshCurrentLayer(),
)

watch(
  () => props.requestedItemRef,
  (entityRef) => {
    if (!entityRef) return
    void openItemByRef(entityRef).finally(() => emit("request-consumed"))
  },
)

onMounted(() => void resetToRoot())
onBeforeUnmount(() => {
  navigationVersion += 1
  itemRequestVersion += 1
})

async function resetToRoot(): Promise<void> {
  path.value = []
  currentContainer.value = null
  panelMessage.value = ""
  await loadSlots(props.containers ?? [], ++navigationVersion)
}

async function refreshCurrentLayer(): Promise<void> {
  const version = ++navigationVersion
  if (atRoot.value) {
    currentContainer.value = null
    await loadSlots(props.containers ?? [], version)
    return
  }
  const current = path.value[path.value.length - 1]
  if (!current) return
  panelLoading.value = true
  const result = await loadInventoryEntity(current.ref)
  if (version !== navigationVersion) return
  if (!result.entity || !isContainerEntity(result.entity)) {
    panelMessage.value = "当前容器已不可读。"
    panelLoading.value = false
    return
  }
  currentContainer.value = result.entity
  path.value = path.value.map((segment, index) => index === path.value.length - 1
    ? { ...segment, name: result.entity?.name ?? segment.name }
    : segment)
  panelMessage.value = ""
  await loadSlots(result.entity.contents, version)
}

async function loadSlots(contents: ContainerContent[], version: number): Promise<void> {
  panelLoading.value = true
  const currentPathRefs = new Set(path.value.map((segment) => segment.ref))
  const nextSlots: RefSlot[] = contents.map((entry) => ({
    ref: entry.ref,
    count: entry.count,
    entity: null,
    status: currentPathRefs.has(entry.ref) ? "cycle" : "loading",
  }))
  slots.value = nextSlots

  const results = await Promise.all(nextSlots.map(async (slot, index) => {
    if (slot.status === "cycle") {
      return { index, entity: null, status: "cycle" as const }
    }
    const result = await loadInventoryEntity(slot.ref)
    return { index, entity: result.entity, status: result.status }
  }))

  if (version !== navigationVersion) return
  const next = nextSlots.slice()
  for (const result of results) {
    const current = next[result.index]
    if (!current) continue
    next[result.index] = { ...current, entity: result.entity, status: result.status }
  }
  slots.value = next
  panelLoading.value = false
}

async function selectGridItem(item: InventoryGridItem, trigger: HTMLElement): Promise<void> {
  if (!item.entity) return
  if (isContainerEntity(item.entity)) {
    if (item.status !== "ready") return
    await enterContainer(item.ref, item.entity)
  } else if (item.status === "ready" || item.status === "schema-corrupt") {
    itemReturnFocus.value = trigger
    openItem(item.ref, item.entity)
  }
}

async function enterContainer(entityRef: string, container: ContainerEntity): Promise<void> {
  if (path.value.some((segment) => segment.ref === entityRef)) {
    panelMessage.value = "检测到循环容器引用，无法继续进入。"
    return
  }
  path.value = [...path.value, { ref: entityRef, name: container.name }]
  currentContainer.value = container
  panelMessage.value = ""
  await loadSlots(container.contents, ++navigationVersion)
}

async function navigate(index: number): Promise<void> {
  if (index < 0 || index >= path.value.length) return
  const version = ++navigationVersion
  panelLoading.value = true
  const target = path.value[index]
  const result = await loadInventoryEntity(target.ref)
  if (version !== navigationVersion) return
  if (!result.entity || !isContainerEntity(result.entity)) {
    panelMessage.value = "该容器已不可读。"
    panelLoading.value = false
    return
  }
  path.value = path.value.slice(0, index + 1)
  currentContainer.value = result.entity
  panelMessage.value = ""
  await loadSlots(result.entity.contents, version)
}

function openItem(entityRef: string, entity: ItemEntity): void {
  selectedItemRef.value = entityRef
  selectedItem.value = entity
  selectedDisplayItems.value = entity.extensions
    ? parseExtensionsOnly({ extensions: entity.extensions }).displayItems
    : emptyDisplayItems()
  selectedItemLoading.value = false
  selectedItemOpen.value = true
  emit("highlight-item", entityRef)
}

async function openItemByRef(entityRef: string): Promise<void> {
  const activeElement = document.activeElement
  itemReturnFocus.value = activeElement instanceof HTMLElement ? activeElement : null
  const version = ++itemRequestVersion
  selectedItemRef.value = entityRef
  selectedItem.value = null
  selectedDisplayItems.value = emptyDisplayItems()
  selectedItemLoading.value = true
  selectedItemOpen.value = true
  emit("highlight-item", entityRef)

  const result = await loadInventoryEntity(entityRef)
  if (version !== itemRequestVersion) return
  if (result.entity && !isContainerEntity(result.entity)) {
    selectedItem.value = result.entity
    selectedDisplayItems.value = result.entity.extensions
      ? parseExtensionsOnly({ extensions: result.entity.extensions }).displayItems
      : emptyDisplayItems()
  }
  selectedItemLoading.value = false
}

function updateItemOpen(open: boolean): void {
  selectedItemOpen.value = open
  if (!open) {
    itemRequestVersion += 1
    selectedItem.value = null
    selectedItemRef.value = ""
    selectedItemLoading.value = false
    selectedDisplayItems.value = emptyDisplayItems()
    emit("highlight-item", null)
  }
}
</script>

<template>
  <div class="inventory-pane">
    <header class="inventory-head">
      <div>
        <span class="inventory-kicker">CONTAINER GRAPH</span>
        <h2>{{ panelTitle }}</h2>
      </div>
      <button v-if="!atRoot" type="button" class="root-button" @click="resetToRoot">全部容器</button>
    </header>

    <InventoryBreadcrumb :path="path" @navigate="navigate" />
    <p v-if="panelMessage" class="panel-message" role="status">{{ panelMessage }}</p>

    <div v-if="panelLoading && slots.length === 0" class="inventory-empty">读取容器…</div>
    <div v-else-if="atRoot && !containers?.length" class="inventory-empty">
      <strong>未持有容器</strong>
      <span>这个角色尚未记录可查看的背包或储物器具。</span>
    </div>
    <InventoryGrid
      v-else
      :items="gridItems"
      :empty-text="atRoot ? '未持有容器' : '空容器'"
      @select="selectGridItem"
      @highlight="emit('highlight-item', $event)"
    />

    <ItemDetailModal
      :open="selectedItemOpen"
      :entity="selectedItem"
      :entity-ref="selectedItemRef"
      :loading="selectedItemLoading"
      :display-items="selectedDisplayItems"
      :equipped-slots="equipmentByRef.get(selectedItemRef) ?? []"
      :return-focus="itemReturnFocus"
      @update:open="updateItemOpen"
    />
  </div>
</template>

<style scoped>
.inventory-pane {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.inventory-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--line);
}

.inventory-kicker {
  font-family: var(--font-mono);
  font-size: 0.54rem;
  letter-spacing: 0.16em;
  color: var(--whisper);
}

.inventory-head h2 {
  margin: 3px 0 0;
  font-family: var(--font-display);
  font-size: 1.18rem;
  letter-spacing: 0.07em;
  color: var(--ember-bright);
}

.root-button {
  border: 0;
  border-bottom: 1px solid var(--line);
  padding: 5px 2px;
  background: transparent;
  color: var(--prose-muted);
  font-family: var(--font-mono);
  font-size: 0.64rem;
  cursor: pointer;
}

.root-button:hover,
.root-button:focus-visible {
  color: var(--ember-bright);
  outline: 2px solid var(--ember-bright);
  outline-offset: 2px;
}

.panel-message {
  margin: 0;
  padding: 7px 9px;
  border-left: 2px solid var(--blood);
  background: rgba(155, 58, 46, 0.08);
  font-size: 0.7rem;
  color: var(--prose-muted);
}

.inventory-empty {
  min-height: 220px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  text-align: center;
  color: var(--prose-faint);
}

.inventory-empty strong {
  font-family: var(--font-display);
  font-size: 1rem;
  letter-spacing: 0.08em;
  color: var(--prose-muted);
}

.inventory-empty span {
  max-width: 18rem;
  font-size: 0.72rem;
  line-height: 1.7;
}
</style>
