<template>
  <section
    ref="root"
    class="spatial-app spatial-library"
    data-spatial-source-animation
    aria-label="我的应用"
    @click="closeContextMenu(false)"
    @contextmenu.prevent="openBlankContextMenu"
  >
    <header class="spatial-app__header">
      <div class="spatial-app__identity">
        <span class="spatial-app__eyebrow">LOCAL APPLICATIONS · {{ cards.length }}</span>
        <h1>我的应用</h1>
      </div>
      <div class="spatial-app__commands">
        <SpatialActionButton @click.stop="void router.push('/market')">
          <template #icon><Store /></template>创意工坊
        </SpatialActionButton>
        <SpatialActionButton :disabled="importing" @click.stop="openPackagePicker">
          <template #icon><Download /></template>{{ importing ? "导入中…" : "导入卡包" }}
        </SpatialActionButton>
        <SpatialActionButton variant="primary" :disabled="creating" @click.stop="createDefaultCard">
          <template #icon><Plus /></template>{{ creating ? "创建中…" : "创建游戏" }}
        </SpatialActionButton>
      </div>
    </header>

    <main class="spatial-app__scroll spatial-library__content">
      <div v-if="actionError && !loading && !errorMessage" class="spatial-app__banner spatial-app__banner--error" role="alert">
        {{ actionError }}
      </div>
      <div v-if="loading" class="spatial-app__empty" role="status">正在读取应用库…</div>
      <div v-else-if="errorMessage" class="spatial-app__banner spatial-app__banner--error" role="alert">
        <strong>应用库不可用</strong><span>{{ errorMessage }}</span>
      </div>
      <div v-else-if="cards.length === 0" class="spatial-app__empty spatial-library__empty">
        <FolderOpen aria-hidden="true" />
        <strong>我的应用还是空的</strong>
        <span>创建一张默认游戏卡，或从本地卡包与创意工坊安装。</span>
        <div class="spatial-app__actions">
          <SpatialActionButton variant="primary" :disabled="creating" @click="createDefaultCard">创建游戏</SpatialActionButton>
          <SpatialActionButton :disabled="importing" @click="openPackagePicker">导入卡包</SpatialActionButton>
        </div>
      </div>
      <TransitionGroup v-else name="spatial-list" tag="div" appear class="spatial-library__grid" role="group" aria-label="已安装的游戏卡">
        <article
          v-for="(card, index) in cards"
          :key="card.id"
          class="spatial-library-card"
          :class="{ 'spatial-library-card--selected': selectedCardId === card.id }"
          :style="{ '--spatial-entry-index': Math.min(index, 5) }"
          role="button"
          tabindex="0"
          :aria-label="`打开${getGameCardTitle(card)}`"
          @focus="selectedCardId = card.id"
          @mouseenter="selectedCardId = card.id"
          @click="openCard(card.id)"
          @keydown.enter.self.prevent="openCard(card.id)"
          @keydown.space.self.prevent="openCard(card.id)"
          @keydown.self="handleCardContextKey(card, $event)"
          @contextmenu.prevent.stop="openCardContextMenu(card, $event)"
        >
          <div class="spatial-library-card__cover">
            <SpatialImage
              :source="coverSources[card.id]"
              :alt="card.manifest.cover?.alt || ''"
              :icon="Gamepad2"
              fallback-label="游戏卡封面不可用"
            />
            <span v-if="activeGameCardId === card.id" class="spatial-library-card__badge">已加载</span>
            <span v-if="cardUpdateInfo(card)" class="spatial-library-card__badge spatial-library-card__badge--update">可更新</span>
          </div>
          <div class="spatial-library-card__body">
            <h2>{{ getGameCardTitle(card) }}</h2>
            <p>{{ getGameCardSummary(card) }}</p>
            <div class="spatial-app__actions">
              <SpatialActionButton
                icon-only
                :disabled="copyingId === card.id"
                :aria-label="`复制${getGameCardTitle(card)}`"
                title="复制"
                @click.stop="copyCard(card)"
              ><template #icon><Copy /></template></SpatialActionButton>
              <SpatialActionButton
                v-if="canLoadCard(card)"
                icon-only
                :disabled="loadingCard"
                :aria-label="`加载${getGameCardTitle(card)}`"
                title="加载"
                @click.stop="loadCard(card)"
              ><template #icon><CheckCircle2 /></template></SpatialActionButton>
              <SpatialActionButton
                v-if="cardUpdateInfo(card)"
                :disabled="Boolean(updatingCardId)"
                @click.stop="updateCardFromWorkshop(card)"
              >{{ updatingCardId === card.id ? "更新中…" : "更新" }}</SpatialActionButton>
            </div>
          </div>
        </article>
      </TransitionGroup>
    </main>

    <footer class="spatial-library__status spatial-app__status">
      <span>{{ cards.length }} 个应用</span>
      <span v-if="feedback">{{ feedback }}</span>
      <span v-else-if="cards.length && !activeGameCardId">尚未加载游戏卡</span>
    </footer>

    <input ref="packageInput" class="spatial-library__file" type="file" accept=".tsian-card.zip,application/zip" @change="handlePackageSelected" />

    <Transition name="spatial-pop">
      <div
        v-if="contextMenu"
        ref="contextMenuRef"
        class="spatial-app__menu"
        role="menu"
        :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
        @click.stop
        @keydown.esc.stop.prevent="closeContextMenu(true)"
      >
        <template v-if="contextMenu.card">
          <button type="button" role="menuitem" @click="openFromMenu(contextMenu.card)">打开属性</button>
          <button v-if="canLoadCard(contextMenu.card)" type="button" role="menuitem" @click="loadFromMenu(contextMenu.card)">加载</button>
          <button type="button" role="menuitem" @click="copyFromMenu(contextMenu.card)">复制</button>
          <button v-if="cardUpdateInfo(contextMenu.card)" type="button" role="menuitem" @click="updateFromMenu(contextMenu.card)">从创意工坊更新</button>
          <button v-if="canDeleteCard(contextMenu.card)" type="button" role="menuitem" class="spatial-library__danger" @click="deleteFromMenu(contextMenu.card)">删除</button>
        </template>
        <template v-else>
          <button type="button" role="menuitem" @click="createFromMenu">创建游戏</button>
          <button type="button" role="menuitem" @click="importFromMenu">导入卡包</button>
          <button type="button" role="menuitem" @click="openMarketFromMenu">创意工坊</button>
        </template>
      </div>
    </Transition>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue"
import { useRouter } from "vue-router"
import { CheckCircle2, Copy, Download, FolderOpen, Gamepad2, Plus, Store } from "lucide-vue-next"
import { useGameCardLibraryController } from "@/controllers/game-cards/use-game-card-library-controller"
import { getGameCardSummary, getGameCardTitle } from "@/lib/game-card-display"
import type { LocalGameCardRecord } from "@/storage/db"
import SpatialImage from "../media/SpatialImage.vue"
import { spatialImageInputForGameCard, type SpatialImageInput } from "../media/spatial-image"
import SpatialActionButton from "../primitives/SpatialActionButton.vue"
import "../spatial-apps.css"

interface ContextMenuState {
  x: number
  y: number
  card: LocalGameCardRecord | null
}

const router = useRouter()
const root = ref<HTMLElement | null>(null)
const packageInput = ref<HTMLInputElement | null>(null)
const contextMenu = ref<ContextMenuState | null>(null)
const contextMenuRef = ref<HTMLElement | null>(null)
let keyboardMenuInvoker: HTMLElement | null = null

function openCard(cardId: string): void {
  void router.push({ name: "game-card-detail", params: { cardId } })
}

const {
  cards,
  selectedCardId,
  activeGameCardId,
  loading,
  importing,
  loadingCard,
  creating,
  copyingId,
  updatingCardId,
  errorMessage,
  actionError,
  feedback,
  createDefaultCard,
  canLoadCard,
  canDeleteCard,
  cardUpdateInfo,
  loadCard,
  copyCard,
  updateCardFromWorkshop,
  importPackage,
  deleteCard,
} = useGameCardLibraryController({ openCard })

const coverSources = computed<Record<string, SpatialImageInput>>(() => Object.fromEntries(
  cards.value.map((card) => [card.id, spatialImageInputForGameCard(card)]),
))

function openPackagePicker(): void {
  packageInput.value?.click()
}

async function handlePackageSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ""
  if (file) await importPackage(file)
}

function openBlankContextMenu(event: MouseEvent): void {
  if ((event.target as Element).closest("button, input, article")) return
  keyboardMenuInvoker = null
  contextMenu.value = menuState(event.clientX, event.clientY, null)
}

function openCardContextMenu(card: LocalGameCardRecord, event: MouseEvent): void {
  selectedCardId.value = card.id
  keyboardMenuInvoker = null
  contextMenu.value = menuState(event.clientX, event.clientY, card)
}

function openKeyboardContextMenu(card: LocalGameCardRecord, event: KeyboardEvent): void {
  const invoker = event.currentTarget as HTMLElement
  const rect = invoker.getBoundingClientRect()
  keyboardMenuInvoker = invoker
  contextMenu.value = menuState(rect.left + 20, rect.top + 34, card)
  void nextTick(() => contextMenuRef.value?.querySelector<HTMLButtonElement>("button")?.focus())
}

function handleCardContextKey(card: LocalGameCardRecord, event: KeyboardEvent): void {
  if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return
  event.preventDefault()
  openKeyboardContextMenu(card, event)
}

function closeContextMenu(restoreFocus: boolean): void {
  contextMenu.value = null
  if (restoreFocus) keyboardMenuInvoker?.focus()
  keyboardMenuInvoker = null
}

function menuState(clientX: number, clientY: number, card: LocalGameCardRecord | null): ContextMenuState {
  const rect = root.value?.getBoundingClientRect() ?? { left: 0, top: 0, width: 640, height: 480 }
  return {
    x: Math.min(Math.max(clientX - rect.left, 8), Math.max(8, rect.width - 190)),
    y: Math.min(Math.max(clientY - rect.top, 8), Math.max(8, rect.height - (card ? 190 : 112))),
    card,
  }
}

function openFromMenu(card: LocalGameCardRecord): void {
  closeContextMenu(false)
  openCard(card.id)
}

async function loadFromMenu(card: LocalGameCardRecord): Promise<void> {
  closeContextMenu(true)
  await loadCard(card)
}

async function copyFromMenu(card: LocalGameCardRecord): Promise<void> {
  closeContextMenu(true)
  await copyCard(card)
}

async function updateFromMenu(card: LocalGameCardRecord): Promise<void> {
  closeContextMenu(true)
  await updateCardFromWorkshop(card)
}

async function deleteFromMenu(card: LocalGameCardRecord): Promise<void> {
  closeContextMenu(true)
  await deleteCard(card)
}

function createFromMenu(): void {
  contextMenu.value = null
  void createDefaultCard()
}

function importFromMenu(): void {
  contextMenu.value = null
  openPackagePicker()
}

function openMarketFromMenu(): void {
  contextMenu.value = null
  void router.push("/market")
}
</script>

<style scoped>
.spatial-library {
  position: relative;
  grid-template-rows: auto minmax(0, 1fr) auto;
}

.spatial-library__content {
  padding: 14px;
}

.spatial-library__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  align-content: start;
  gap: 12px;
}

.spatial-library-card {
  position: relative;
  display: block;
  min-width: 0;
  aspect-ratio: 1 / 1;
  overflow: hidden;
  border: 1px solid var(--spatial-app-border);
  background: var(--spatial-app-surface-strong);
  cursor: pointer;
}

.spatial-library-card:hover,
.spatial-library-card[data-spatial-hover],
.spatial-library-card--selected {
  border-color: var(--spatial-window-tab);
  background: var(--spatial-app-surface-strong);
}

.spatial-library-card:focus-visible h2 {
  color: var(--spatial-window-accent);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.spatial-library-card__cover {
  position: absolute;
  z-index: 0;
  inset: 0;
  min-height: 0;
}

.spatial-library-card__badge {
  position: absolute;
  z-index: 3;
  top: 7px;
  left: 7px;
  padding: 3px 6px;
  color: var(--spatial-window-frame);
  background: var(--spatial-window-tab);
  font-family: "JetBrains Mono", monospace;
  font-size: 8px;
}

.spatial-library-card__badge--update {
  right: 7px;
  left: auto;
  background: var(--spatial-window-accent);
}

.spatial-library-card__body {
  position: absolute;
  z-index: 2;
  right: 0;
  bottom: 0;
  left: 0;
  display: grid;
  min-width: 0;
  padding: 10px;
  align-content: start;
  gap: 7px;
  color: var(--spatial-window-frame);
  background: color-mix(in srgb, var(--spatial-window-tab) 92%, transparent);
}

.spatial-library-card h2,
.spatial-library-card p {
  margin: 0;
}

.spatial-library-card h2 {
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.spatial-library-card p {
  display: -webkit-box;
  overflow: hidden;
  color: color-mix(in srgb, var(--spatial-window-frame) 76%, transparent);
  font-size: 10px;
  line-height: 1.5;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

@media (hover: hover) and (pointer: fine) {
  .spatial-library-card__body {
    visibility: hidden;
    pointer-events: none;
  }

  .spatial-library-card:hover .spatial-library-card__body,
  .spatial-library-card[data-spatial-hover] .spatial-library-card__body,
  .spatial-library-card:focus-visible .spatial-library-card__body,
  .spatial-library-card:focus-within .spatial-library-card__body {
    visibility: visible;
    pointer-events: auto;
  }
}

.spatial-library__status {
  display: flex;
  min-height: 30px;
  padding: 7px 14px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-top: 1px solid var(--spatial-app-border);
  background: var(--spatial-app-surface-muted);
}

.spatial-library__file {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  opacity: 0;
}

.spatial-library__empty {
  min-height: 260px;
  place-content: center;
  justify-items: center;
  text-align: center;
}

.spatial-library__empty > svg {
  width: 34px;
  height: 34px;
  color: var(--spatial-window-accent);
}

.spatial-library__danger {
  color: var(--spatial-window-accent) !important;
}

@container (max-width: 560px) {
  .spatial-app__header {
    align-items: flex-start;
    flex-direction: column;
  }

  .spatial-library__grid {
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  }
}
</style>
