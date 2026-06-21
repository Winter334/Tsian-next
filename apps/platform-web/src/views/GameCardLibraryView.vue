<template>
  <section
    ref="libraryRef"
    class="relative grid min-h-full grid-rows-[minmax(0,1fr)_auto] gap-0 overflow-hidden"
    @click="contextMenu = null"
    @contextmenu.prevent.stop="openBlankContextMenu"
  >
      <div
        class="retro-inset m-3 min-h-[420px] overflow-auto p-3"
        @contextmenu.prevent.stop="openBlankContextMenu"
      >
        <div v-if="loading" class="grid min-h-[360px] place-items-center">
          <p class="font-mono text-xs uppercase tracking-[0.22em] text-neon">
            正在加载游戏卡
          </p>
        </div>

        <div v-else-if="errorMessage" class="grid min-h-[360px] place-items-center px-4">
          <div class="max-w-lg border border-danger/40 bg-danger/10 p-4">
            <p class="font-mono text-xs uppercase tracking-wider text-danger">
              应用库不可用
            </p>
            <p class="mt-2 text-sm leading-6 text-text-dim">
              {{ errorMessage }}
            </p>
          </div>
        </div>

        <div v-else-if="cards.length === 0" class="grid min-h-[360px] place-items-center px-4">
          <div class="grid justify-items-center gap-3 text-center">
            <FolderOpen class="h-10 w-10 text-neon-muted" aria-hidden="true" />
            <p class="font-mono text-sm text-text-main">我的应用还是空的。</p>
            <p class="max-w-xs font-mono text-[11px] leading-5 text-text-dim">
              从模板创建一张可游玩的游戏卡，再用桌面助手定制内容。
            </p>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
                :disabled="creating"
                @click="createDefaultCard"
              >
                <Plus class="h-3.5 w-3.5" aria-hidden="true" />
                创建游戏
              </button>
              <button
                type="button"
                class="retro-focus inline-flex h-8 items-center gap-2 border border-neon-deep/40 bg-elevated px-3 font-mono text-xs text-text-dim transition-colors hover:border-neon/55 hover:text-neon"
                @click="router.push('/market')"
              >
                <Store class="h-3.5 w-3.5" aria-hidden="true" />
                应用市场
              </button>
            </div>
          </div>
        </div>

        <p v-if="importError" class="mb-3 border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {{ importError }}
        </p>

        <div
          v-if="cards.length > 0"
          class="grid grid-cols-[repeat(auto-fill,142px)] content-start justify-start gap-x-4 gap-y-5"
          role="list"
          aria-label="已安装的游戏卡应用"
        >
          <button
            v-for="card in cards"
            :key="card.id"
            type="button"
            class="library-app-icon retro-focus selection-tile group grid min-w-0 gap-2 p-1.5 text-center"
            :class="{ 'selection-tile--active': selectedCardId === card.id }"
            :aria-label="`打开${getGameCardTitle(card)}`"
            role="listitem"
            @focus="selectedCardId = card.id"
            @mouseenter="selectedCardId = card.id"
            @click="openCard(card.id)"
            @contextmenu.prevent.stop="openCardContextMenu(card, $event)"
          >
            <div
              class="library-app-preview relative aspect-square w-full overflow-hidden border border-neon-deep/55 bg-elevated"
            >
              <img
                v-if="getGameCardCoverUrl(card)"
                :src="getGameCardCoverUrl(card) ?? ''"
                :alt="card.manifest.cover?.alt || ''"
                class="h-full w-full object-cover"
              />
              <div v-else class="grid h-full place-items-center bg-[radial-gradient(circle_at_30%_20%,rgba(243,197,109,0.22),transparent_28%),linear-gradient(135deg,#3f4d3a,#1e2420)]">
                <Gamepad2 class="h-10 w-10 text-neon-muted" aria-hidden="true" />
              </div>

              <div
                class="absolute inset-0 grid content-end bg-gradient-to-t from-void via-void/72 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                :class="selectedCardId === card.id ? 'opacity-100' : ''"
              >
                <p class="line-clamp-3 text-left text-[11px] leading-4 text-text-main">
                  {{ getGameCardSummary(card) }}
                </p>
              </div>
              <span
                v-if="activeGameCardId === card.id"
                class="absolute left-2 top-2 border border-neon bg-void/85 px-2 py-1 font-mono text-[10px] uppercase text-neon"
              >
                loaded
              </span>
            </div>

            <span class="library-app-label mx-auto line-clamp-2 max-w-full font-mono text-[11px] leading-4 text-text-main">
                {{ getGameCardTitle(card) }}
            </span>
          </button>
        </div>
      </div>

      <footer class="retro-statusbar flex min-h-9 flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
        <p class="font-mono text-[11px] uppercase tracking-wider text-text-dim">
          {{ cards.length }} 个应用
        </p>
        <p v-if="feedback" class="min-w-0 truncate font-mono text-[11px] text-text-dim">{{ feedback }}</p>
      </footer>

      <input
        ref="packageInput"
        type="file"
        class="hidden"
        accept=".tsian-card.zip,application/zip"
        @change="handlePackageSelected"
      />

      <div
        v-if="contextMenu"
        class="absolute z-50 min-w-36 border border-neon-deep/70 bg-elevated p-1 shadow-neon-glow-active"
        :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
        @click.stop
      >
        <button
          v-if="contextMenu.card"
          type="button"
          class="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs text-text-main hover:bg-neon/10 hover:text-neon"
          @click="openCardFromMenu(contextMenu.card.id)"
        >
          <FolderOpen class="h-3.5 w-3.5" aria-hidden="true" />
          打开
        </button>
        <button
          v-if="contextMenu.card && canLoadCard(contextMenu.card)"
          type="button"
          class="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs text-text-main hover:bg-neon/10 hover:text-neon"
          @click="loadCardFromMenu(contextMenu.card)"
        >
          <CheckCircle2 class="h-3.5 w-3.5" aria-hidden="true" />
          加载
        </button>
        <button
          v-if="contextMenu.card && canDeleteCard(contextMenu.card)"
          type="button"
          class="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs text-danger hover:bg-danger/10"
          @click="deleteCardFromMenu(contextMenu.card)"
        >
          <Trash2 class="h-3.5 w-3.5" aria-hidden="true" />
          删除
        </button>
        <button
          v-if="!contextMenu.card"
          type="button"
          class="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs text-text-main hover:bg-neon/10 hover:text-neon"
          :disabled="creating"
          @click="createCardFromMenu"
        >
          <Plus class="h-3.5 w-3.5" aria-hidden="true" />
          创建游戏
        </button>
        <button
          v-if="!contextMenu.card"
          type="button"
          class="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs text-text-main hover:bg-neon/10 hover:text-neon"
          @click="importFromMenu"
        >
          <Download class="h-3.5 w-3.5" aria-hidden="true" />
          导入卡包
        </button>
      </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { useRouter } from "vue-router"
import { CheckCircle2, Download, FolderOpen, Gamepad2, Plus, Store, Trash2 } from "lucide-vue-next"
import { confirm } from "@/composables/useConfirm"
import { toast } from "@/composables/useToast"
import type { LocalGameCardRecord } from "@/storage/db"
import {
  getGameCardCoverUrl,
  getGameCardSummary,
  getGameCardTitle,
} from "@/lib/game-card-display"
import {
  createDefaultPlatformGameCard,
  deletePlatformGameCard,
  getPlatformActiveGameCardId,
  importPlatformGameCardPackage,
  listPlatformGameCards,
  listPlatformSaves,
  setPlatformActiveGameCard,
} from "../platform-host"

const router = useRouter()
const cards = ref<LocalGameCardRecord[]>([])
const selectedCardId = ref("")
const activeGameCardId = ref("")
const loading = ref(false)
const importing = ref(false)
const deleting = ref(false)
const loadingCard = ref(false)
const creating = ref(false)
const errorMessage = ref("")
const importError = ref("")
const feedback = ref("")
const packageInput = ref<HTMLInputElement | null>(null)
const libraryRef = ref<HTMLElement | null>(null)

interface ContextMenuState {
  x: number
  y: number
  card: LocalGameCardRecord | null
}

const contextMenu = ref<ContextMenuState | null>(null)

const selectedCard = computed(() =>
  cards.value.find((card) => card.id === selectedCardId.value) ?? cards.value[0] ?? null
)

async function refreshCards() {
  loading.value = true
  errorMessage.value = ""

  try {
    const [loadedCards, loadedActiveGameCardId] = await Promise.all([
      listPlatformGameCards(),
      getPlatformActiveGameCardId(),
    ])
    cards.value = loadedCards
    activeGameCardId.value = loadedActiveGameCardId
    if (!cards.value.some((card) => card.id === selectedCardId.value)) {
      selectedCardId.value = cards.value[0]?.id ?? ""
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "无法加载游戏卡。"
  } finally {
    loading.value = false
  }
}

function openCard(cardId: string) {
  router.push({ name: "game-card-detail", params: { cardId } })
}

async function createDefaultCard() {
  if (creating.value) {
    return
  }
  creating.value = true
  importError.value = ""
  feedback.value = ""
  try {
    const created = await createDefaultPlatformGameCard()
    feedback.value = `已创建并加载：${getGameCardTitle(created)}`
    toast.success(`已创建游戏卡：${getGameCardTitle(created)}`)
    await refreshCards()
    openCard(created.id)
  } catch (error) {
    importError.value = error instanceof Error ? error.message : "创建游戏卡失败。"
  } finally {
    creating.value = false
  }
}

function openPackagePicker() {
  packageInput.value?.click()
}

function canLoadCard(card: LocalGameCardRecord): boolean {
  return card.id !== activeGameCardId.value && !loadingCard.value
}

function canDeleteCard(card: LocalGameCardRecord): boolean {
  return card.source !== "builtin" && !deleting.value
}

function openCardContextMenu(card: LocalGameCardRecord, event: MouseEvent) {
  selectedCardId.value = card.id
  contextMenu.value = contextMenuStateFromMouse(event, card)
}

function openBlankContextMenu(event: MouseEvent) {
  contextMenu.value = contextMenuStateFromMouse(event, null)
}

function contextMenuStateFromMouse(event: MouseEvent, card: LocalGameCardRecord | null): ContextMenuState {
  const menuWidth = 176
  const menuHeight = card ? (canDeleteCard(card) ? 148 : 104) : 96
  const rect = libraryRef.value?.getBoundingClientRect() ?? {
    left: 0,
    top: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  }
  const rawX = event.clientX - rect.left
  const rawY = event.clientY - rect.top
  return {
    x: clampMenuCoordinate(rawX, rect.width, menuWidth),
    y: clampMenuCoordinate(rawY, rect.height, menuHeight),
    card,
  }
}

function clampMenuCoordinate(value: number, containerSize: number, menuSize: number): number {
  return Math.min(Math.max(value, 8), Math.max(8, containerSize - menuSize - 8))
}

function openCardFromMenu(cardId: string) {
  contextMenu.value = null
  openCard(cardId)
}

async function loadCardFromMenu(card: LocalGameCardRecord) {
  contextMenu.value = null
  selectedCardId.value = card.id
  await loadSelectedCard()
}

async function deleteCardFromMenu(card: LocalGameCardRecord) {
  contextMenu.value = null
  selectedCardId.value = card.id
  await deleteSelectedCard()
}

function importFromMenu() {
  contextMenu.value = null
  openPackagePicker()
}

function createCardFromMenu() {
  contextMenu.value = null
  void createDefaultCard()
}

async function loadSelectedCard() {
  const card = selectedCard.value
  if (!card || activeGameCardId.value === card.id) {
    return
  }

  loadingCard.value = true
  importError.value = ""
  feedback.value = ""
  try {
    const loaded = await setPlatformActiveGameCard(card.id)
    activeGameCardId.value = loaded.id
    feedback.value = `已加载：${getGameCardTitle(loaded)}`
  } catch (error) {
    importError.value = error instanceof Error ? error.message : "加载游戏卡失败。"
  } finally {
    loadingCard.value = false
  }
}

async function handlePackageSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ""
  if (!file) {
    return
  }

  importing.value = true
  importError.value = ""
  feedback.value = ""
  try {
    const imported = await importPlatformGameCardPackage(file)
    feedback.value = `已导入：${getGameCardTitle(imported)}`
    selectedCardId.value = imported.id
    await refreshCards()
    openCard(imported.id)
  } catch (error) {
    importError.value = error instanceof Error ? error.message : "导入游戏卡包失败。"
  } finally {
    importing.value = false
  }
}

async function deleteSelectedCard() {
  const card = selectedCard.value
  if (!card || card.source === "builtin") {
    return
  }

  deleting.value = true
  importError.value = ""
  feedback.value = ""
  try {
    const saveCount = (await listPlatformSaves())
      .filter((save) => save.gameCardId === card.manifest.id)
      .length
    const title = getGameCardTitle(card)
    const confirmed = await confirm({
      message: `删除应用「${title}」？\n\n这会同时删除 ${saveCount} 个关联存档，无法撤销。`,
      severity: "danger",
      confirmText: "删除",
    })
    if (!confirmed) {
      return
    }

    await deletePlatformGameCard(card.id)
    toast.success(`已删除应用：${title}`)
    selectedCardId.value = ""
    await refreshCards()
  } catch (error) {
    importError.value = error instanceof Error ? error.message : "删除应用失败。"
  } finally {
    deleting.value = false
  }
}

onMounted(() => {
  void refreshCards()
})
</script>

<style scoped>
.library-app-preview {
  box-shadow:
    inset 1px 1px 0 rgba(246, 236, 215, 0.12),
    inset -1px -1px 0 rgba(0, 0, 0, 0.65);
}

.library-app-label {
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.78);
}
</style>
