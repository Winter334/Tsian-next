<script setup lang="ts">
/**
 * InventoryPane — 角色卡背包 tab 内容（替换占位为真实实现）。
 *
 * design §6.1 / task 07-04 D7：
 * - props：`{ containers, protagonistRef }`
 *   - containers：character.containers 数组（`{ref, count?}`），缺省或空 → 空态。
 *   - protagonistRef：主角 ref（本任务当前未用于展示区分，占位透传，供未来"仅主角可查看"策略）。
 * - 顶层：每个 container ref 用 useEntity 拉取 → 展示 InventoryGrid（container variant）。
 * - 点击容器 → 打开 ItemDetailModal，breadcrumb 从当前容器开始；模态内容器可继续深入嵌套。
 * - 模态内点击嵌套容器 → breadcrumb push，modalEntityRef 更新，重新拉取。
 * - 模态内点击面包屑 → breadcrumb slice 到 index，重新拉取。
 * - 关闭模态 → 清 modalEntityRef / breadcrumb / gridItems。
 *
 * 不抛错：useEntity 内部处理读取异常；parseContainer/parseItem 失败返回 null。
 * 模态内 entity 是 null 但 loading=false → 展示"档案缺失"。
 */
import { computed, onMounted, ref, watch } from "vue"
import { useEntity } from "../../composables/useEntity"
import type {
  ContainerContent,
  ContainerEntity,
  InventoryEntity,
} from "../../lib/item-types"
import { isContainerEntity } from "../../lib/item-types"
import { parseContainer, parseItem } from "../../lib/parse-item"
import { parseExtensionsOnly } from "../../lib/parse-entity"
import type { DisplayItems } from "../../lib/runtime-types"
import { emptyDisplayItems } from "../../lib/runtime-types"
import InventoryGrid, {
  type InventoryGridItem,
} from "../inventory/InventoryGrid.vue"
import ItemDetailModal from "../inventory/ItemDetailModal.vue"

const props = defineProps<{
  containers?: Array<{ ref: string; count?: number }>
  protagonistRef: string | null
}>()

/** 单个 ref 的读取槽位。 */
interface RefSlot {
  ref: string
  count?: number
  entity: InventoryEntity | null
  status: "ready" | "missing" | "loading"
}

/** 拉取一个 ref 的实体并解析为 InventoryEntity。 */
async function fetchInventoryEntity(entityRef: string): Promise<{
  entity: InventoryEntity | null
  status: "ready" | "missing"
}> {
  const { data, error, load } = useEntity(entityRef)
  await load()
  if (error.value !== null || data.value === null) {
    return { entity: null, status: "missing" }
  }
  const raw = data.value.entity
  const container = parseContainer(raw)
  if (container) return { entity: container, status: "ready" }
  const item = parseItem(raw)
  if (item) return { entity: item, status: "ready" }
  return { entity: null, status: "missing" }
}

// ============ 顶层容器网格 ============

const topSlots = ref<RefSlot[]>([])

const topGridItems = computed<InventoryGridItem[]>(() =>
  topSlots.value.map((s) => ({
    ref: s.ref,
    count: s.count,
    entity: s.entity,
    status: s.status,
  })),
)

const hasContainers = computed(
  () => Array.isArray(props.containers) && props.containers.length > 0,
)

async function loadTopContainers() {
  const list = props.containers ?? []
  // 先构建 loading 占位，保证 UI 顺序稳定
  topSlots.value = list.map((c) => ({
    ref: c.ref,
    count: c.count,
    entity: null,
    status: "loading" as const,
  }))
  // 并行拉取
  const results = await Promise.all(
    list.map(async (c, idx) => {
      const { entity, status } = await fetchInventoryEntity(c.ref)
      return { idx, entity, status }
    }),
  )
  const next = topSlots.value.slice()
  for (const r of results) {
    if (r.idx >= 0 && r.idx < next.length) {
      next[r.idx] = {
        ref: next[r.idx].ref,
        count: next[r.idx].count,
        entity: r.entity,
        status: r.status,
      }
    }
  }
  topSlots.value = next
}

onMounted(() => {
  void loadTopContainers()
})

watch(
  () => props.containers,
  () => {
    void loadTopContainers()
  },
  { deep: true },
)

// ============ 模态状态 ============

const modalOpen = ref(false)
const modalEntityRef = ref<string>("")
const modalEntity = ref<InventoryEntity | null>(null)
const modalLoading = ref(false)
const modalDisplayItems = ref<DisplayItems>(emptyDisplayItems())
/** 模态内容器 contents 网格已解析。 */
const modalGridSlots = ref<RefSlot[]>([])

const breadcrumb = ref<Array<{ ref: string; name: string }>>([])

const modalGridItems = computed<InventoryGridItem[]>(() =>
  modalGridSlots.value.map((s) => ({
    ref: s.ref,
    count: s.count,
    entity: s.entity,
    status: s.status,
  })),
)

/** 拉取模态当前 ref 的 entity + extensions + contents 网格（若容器）。 */
async function loadModalEntity(entityRef: string) {
  modalLoading.value = true
  modalEntity.value = null
  modalDisplayItems.value = emptyDisplayItems()
  modalGridSlots.value = []
  const { entity, status } = await fetchInventoryEntity(entityRef)
  if (modalEntityRef.value !== entityRef) {
    // 并发切换：忽略过期结果
    return
  }
  if (status !== "ready" || entity === null) {
    modalEntity.value = null
    modalLoading.value = false
    return
  }
  modalEntity.value = entity
  // extensions 分区
  if (entity.extensions) {
    const { displayItems } = parseExtensionsOnly({ extensions: entity.extensions })
    modalDisplayItems.value = displayItems
  }
  // 容器 → 预取 contents
  if (isContainerEntity(entity)) {
    const contents: ContainerContent[] = entity.contents
    modalGridSlots.value = contents.map((c) => ({
      ref: c.ref,
      count: c.count,
      entity: null,
      status: "loading" as const,
    }))
    const results = await Promise.all(
      contents.map(async (c, idx) => {
        const r = await fetchInventoryEntity(c.ref)
        return { idx, entity: r.entity, status: r.status }
      }),
    )
    if (modalEntityRef.value === entityRef) {
      const next = modalGridSlots.value.slice()
      for (const r of results) {
        if (r.idx >= 0 && r.idx < next.length) {
          next[r.idx] = {
            ref: next[r.idx].ref,
            count: next[r.idx].count,
            entity: r.entity,
            status: r.status,
          }
        }
      }
      modalGridSlots.value = next
    }
  }
  modalLoading.value = false
}

/** 从顶层网格 / 嵌套网格 → 打开或深入模态。 */
function openEntity(entityRef: string) {
  // 优先从已解析槽位取 name，避免面包屑短暂显示 localId。
  const displayName = findDisplayName(entityRef)
  modalEntityRef.value = entityRef
  breadcrumb.value = [...breadcrumb.value, { ref: entityRef, name: displayName }]
  modalOpen.value = true
  void loadModalEntity(entityRef)
}

function findDisplayName(entityRef: string): string {
  for (const s of modalGridSlots.value) {
    if (s.ref === entityRef && s.entity) return s.entity.name
  }
  for (const s of topSlots.value) {
    if (s.ref === entityRef && s.entity) return s.entity.name
  }
  const idx = entityRef.indexOf(":")
  return idx >= 0 ? entityRef.slice(idx + 1) : entityRef
}

function onTopSelect(entityRef: string) {
  // 打开新模态：重置 breadcrumb 从顶层新根开始
  breadcrumb.value = []
  openEntity(entityRef)
}

function onModalSelect(entityRef: string) {
  openEntity(entityRef)
}

function onNavigate(index: number) {
  if (index < 0 || index >= breadcrumb.value.length) return
  const target = breadcrumb.value[index]
  breadcrumb.value = breadcrumb.value.slice(0, index + 1)
  modalEntityRef.value = target.ref
  void loadModalEntity(target.ref)
}

function onClose() {
  modalOpen.value = false
  modalEntityRef.value = ""
  modalEntity.value = null
  modalDisplayItems.value = emptyDisplayItems()
  modalGridSlots.value = []
  breadcrumb.value = []
}

// 未来可能基于 protagonistRef 做"仅主角可查看"策略；当前仅作 props 声明。
void props.protagonistRef
</script>

<template>
  <div class="inventory-pane">
    <div v-if="!hasContainers" class="inv-empty">
      <div class="icon">🎒</div>
      <div class="text">未持有容器</div>
    </div>
    <InventoryGrid
      v-else
      :items="topGridItems"
      empty-text="未持有容器"
      @select="onTopSelect"
    />

    <ItemDetailModal
      v-if="modalOpen"
      :entity="modalEntity"
      :entity-ref="modalEntityRef"
      :breadcrumb="breadcrumb"
      :loading="modalLoading"
      :grid-items="modalGridItems"
      :display-items="modalDisplayItems"
      @select="onModalSelect"
      @navigate="onNavigate"
      @close="onClose"
    />
  </div>
</template>

<style scoped>
.inventory-pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.inv-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 0;
  gap: 12px;
  color: var(--prose-faint);
}
.inv-empty .icon {
  font-size: 3rem;
  opacity: 0.3;
}
.inv-empty .text {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  letter-spacing: 0.08em;
}
</style>
