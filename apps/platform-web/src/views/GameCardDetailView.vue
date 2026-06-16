<template>
  <section class="grid min-h-full grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden">
      <nav class="retro-toolbar flex gap-1 overflow-x-auto border-b px-3 pt-2" aria-label="Game Card sections">
        <button
          type="button"
          class="retro-focus inline-flex h-9 shrink-0 items-center gap-2 border border-b-0 border-neon-deep/45 bg-elevated px-3 font-mono text-xs text-text-dim hover:text-text-main"
          @click="router.push('/library')"
        >
          <ArrowLeft class="h-3.5 w-3.5" aria-hidden="true" />
          Library
        </button>
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="retro-focus inline-flex h-9 shrink-0 items-center gap-2 border border-b-0 px-3 font-mono text-xs"
          :class="activeTab === tab.id
            ? 'border-neon-deep bg-void text-neon'
            : 'border-neon-deep/45 bg-elevated text-text-dim hover:text-text-main'"
          @click="activeTab = tab.id"
        >
          <component :is="tab.icon" class="h-3.5 w-3.5" aria-hidden="true" />
          {{ tab.label }}
        </button>
      </nav>

      <div v-if="loading" class="retro-inset m-3 grid min-h-[480px] place-items-center p-4">
        <p class="font-mono text-xs uppercase tracking-[0.22em] text-neon">
          Loading card properties
        </p>
      </div>

      <div v-else-if="errorMessage" class="retro-inset m-3 grid min-h-[480px] place-items-center p-4">
        <div class="max-w-lg border border-danger/40 bg-danger/10 p-4">
          <p class="font-mono text-xs uppercase tracking-wider text-danger">
            Card unavailable
          </p>
          <p class="mt-2 text-sm leading-6 text-text-dim">
            {{ errorMessage }}
          </p>
        </div>
      </div>

      <div v-else-if="card" class="m-3 overflow-auto">
        <div v-if="activeTab === 'overview'" class="grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
          <section class="poster-pane retro-inset relative min-h-[560px] overflow-hidden">
            <img
              v-if="coverUrl"
              :src="coverUrl"
              :alt="card.manifest.cover?.alt || ''"
              class="absolute inset-0 h-full w-full object-cover"
            />
            <div v-else class="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_30%_20%,rgba(243,197,109,0.22),transparent_28%),linear-gradient(135deg,#3f4d3a,#1e2420)]">
              <Gamepad2 class="h-20 w-20 text-neon-muted" aria-hidden="true" />
            </div>
            <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-void via-void/86 to-transparent p-5 md:p-7">
              <div class="max-w-3xl">
                <p class="font-mono text-xs uppercase tracking-[0.22em] text-neon">
                  {{ frontendStatusLabel }}
                </p>
                <h1 class="mt-2 text-3xl font-black leading-tight text-text-main md:text-5xl">
                  {{ cardTitle }}
                </h1>
                <p class="mt-4 max-w-2xl text-sm leading-7 text-text-main md:text-base">
                  {{ cardDescription }}
                </p>
                <dl class="mt-5 grid gap-3 text-sm text-text-dim sm:grid-cols-3">
                  <div>
                    <dt class="font-mono text-[10px] uppercase tracking-wider text-neon-muted">Author</dt>
                    <dd class="mt-1 truncate text-text-main">{{ cardAuthor }}</dd>
                  </div>
                  <div>
                    <dt class="font-mono text-[10px] uppercase tracking-wider text-neon-muted">Version</dt>
                    <dd class="mt-1 truncate text-text-main">{{ card.manifest.version }}</dd>
                  </div>
                  <div>
                    <dt class="font-mono text-[10px] uppercase tracking-wider text-neon-muted">Source</dt>
                    <dd class="mt-1 truncate text-text-main">{{ card.source }}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </section>

          <section class="retro-inset grid content-start gap-4 p-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p class="font-mono text-xs uppercase tracking-wider text-neon">
                  Save Slots
                </p>
                <p class="mt-1 text-sm leading-6 text-text-dim">
                  {{ frontendStatusDescription }}
                </p>
              </div>
              <span class="border border-neon-deep/50 bg-elevated px-2 py-1 font-mono text-[11px] text-text-dim">
                {{ cardSaves.length }} slot{{ cardSaves.length === 1 ? "" : "s" }}
              </span>
            </div>

            <div class="grid gap-2 sm:grid-cols-[1fr_auto]">
              <input
                v-model="newSaveName"
                type="text"
                class="retro-focus h-9 min-w-0 border border-neon-deep/55 bg-elevated px-3 text-sm text-text-main placeholder:text-text-dim/60"
                placeholder="New save name"
                @keyup.enter="createSave"
              />
              <button
                type="button"
                class="retro-button retro-focus inline-flex h-9 items-center justify-center gap-2 px-3 font-mono text-xs"
                @click="createSave"
              >
                <Plus class="h-3.5 w-3.5" aria-hidden="true" />
                New Save
              </button>
            </div>

            <p v-if="feedback" class="border border-neon-deep/40 bg-neon/10 px-3 py-2 text-sm text-neon">
              {{ feedback }}
            </p>

            <div class="border border-neon-deep/35 bg-elevated/35 p-3">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="min-w-0">
                  <p class="font-mono text-[11px] uppercase tracking-wider text-neon-muted">
                    Workspace Folder
                  </p>
                  <p class="mt-1 text-sm leading-6 text-text-dim">
                    Card content and save runtime files are browsed from the Workspace tab.
                  </p>
                </div>
                <button
                  type="button"
                  class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
                  @click="activeTab = 'workspace'"
                >
                  <FolderOpen class="h-3.5 w-3.5" aria-hidden="true" />
                  Open Folder
                </button>
              </div>
            </div>

            <div class="grid gap-2">
              <p v-if="cardSaves.length === 0" class="border border-neon-deep/35 bg-elevated/50 p-3 text-sm text-text-dim">
                No save slots have been created for this Game Card.
              </p>

              <article
                v-for="save in cardSaves"
                :key="save.id"
                class="slot-row grid gap-3 border p-3"
                :class="selectedSaveId === save.id ? 'border-neon bg-neon/10' : 'border-neon-deep/40 bg-elevated/45'"
              >
                <div class="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    class="retro-focus min-w-0 text-left"
                    @click="selectSave(save.id)"
                  >
                    <span class="block truncate text-sm font-bold text-text-main">
                      {{ save.name }}
                    </span>
                    <span class="mt-1 block font-mono text-[11px] leading-5 text-text-dim">
                      Source: {{ cardTitle }} · Created {{ formatDateTime(save.createdAt) }}
                    </span>
                    <span class="block font-mono text-[11px] leading-5 text-text-dim">
                      Last used {{ formatDateTime(save.updatedAt) }}
                    </span>
                  </button>
                  <span
                    v-if="save.id === activeSaveId"
                    class="shrink-0 border border-neon px-2 py-1 font-mono text-[10px] uppercase text-neon"
                  >
                    Active
                  </span>
                </div>
                <div class="flex flex-wrap gap-2">
                  <button
                    type="button"
                    class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
                    @click="selectSave(save.id)"
                  >
                    <CheckCircle2 class="h-3.5 w-3.5" aria-hidden="true" />
                    Select
                  </button>
                  <button
                    type="button"
                    class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
                    :disabled="!isPlayable"
                    @click="continueSave(save.id)"
                  >
                    <Play class="h-3.5 w-3.5" aria-hidden="true" />
                    Continue
                  </button>
                  <button
                    type="button"
                    class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs text-danger"
                    @click="deleteSave(save.id)"
                  >
                    <Trash2 class="h-3.5 w-3.5" aria-hidden="true" />
                    Delete
                  </button>
                </div>
              </article>
            </div>
          </section>
        </div>

        <div v-else-if="activeTab === 'saves'" class="retro-inset grid gap-4 p-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p class="font-mono text-xs uppercase tracking-wider text-neon">
                Save Slot Manager
              </p>
              <p class="mt-1 text-sm text-text-dim">
                Slots are playthrough data for this Game Card only.
              </p>
            </div>
            <button
              type="button"
              class="retro-button retro-focus inline-flex h-9 items-center gap-2 px-3 font-mono text-xs"
              @click="createSave"
            >
              <Plus class="h-3.5 w-3.5" aria-hidden="true" />
              New Save
            </button>
          </div>
          <div class="grid gap-2">
            <article
              v-for="save in cardSaves"
              :key="save.id"
              class="grid gap-3 border border-neon-deep/40 bg-elevated/45 p-3 md:grid-cols-[1fr_auto]"
            >
              <div class="min-w-0">
                <h3 class="truncate text-base font-bold text-text-main">{{ save.name }}</h3>
                <p class="mt-1 font-mono text-xs text-text-dim">
                  Source: {{ cardTitle }} · Created {{ formatDateTime(save.createdAt) }} · Updated {{ formatDateTime(save.updatedAt) }}
                </p>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <button type="button" class="retro-button retro-focus h-8 px-3 font-mono text-xs" @click="selectSave(save.id)">Select</button>
                <button type="button" class="retro-button retro-focus h-8 px-3 font-mono text-xs" :disabled="!isPlayable" @click="continueSave(save.id)">Continue</button>
                <button type="button" class="retro-button retro-focus h-8 px-3 font-mono text-xs text-danger" @click="deleteSave(save.id)">Delete</button>
              </div>
            </article>
            <p v-if="cardSaves.length === 0" class="border border-neon-deep/35 bg-elevated/50 p-3 text-sm text-text-dim">
              No save slots have been created for this Game Card.
            </p>
          </div>
        </div>

        <div v-else-if="activeTab === 'workspace'" class="retro-inset grid gap-3 p-3">
          <div class="retro-toolbar flex flex-wrap items-center justify-between gap-2 border px-3 py-2">
            <div class="flex min-w-0 items-center gap-2">
              <FolderOpen class="h-4 w-4 shrink-0 text-neon" aria-hidden="true" />
              <p class="truncate font-mono text-xs text-text-main">
                {{ cardTitle }} / Workspace
              </p>
            </div>
            <span class="font-mono text-[11px] uppercase tracking-wider text-text-dim">
              Large Icons
            </span>
          </div>

          <div class="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
            <aside class="border border-neon-deep/35 bg-elevated/35 p-2">
              <button
                v-for="folder in workspaceFolders"
                :key="folder.id"
                type="button"
                class="retro-focus flex w-full items-center gap-2 border border-transparent px-2 py-2 text-left font-mono text-xs text-text-dim first:border-neon first:bg-neon/10 first:text-neon hover:border-neon-deep/45 hover:text-text-main"
              >
                <component :is="folder.icon" class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span class="truncate">{{ folder.label }}</span>
              </button>
            </aside>

            <div class="grid content-start grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-4 border border-neon-deep/35 bg-void/50 p-4">
              <article
                v-for="folder in workspaceFolders"
                :key="`tile-${folder.id}`"
                class="grid justify-items-center gap-2 border border-transparent p-2 text-center hover:border-neon-deep/45 hover:bg-elevated/30"
              >
                <span class="grid h-14 w-16 place-items-center border border-neon-deep/50 bg-elevated text-neon">
                  <component :is="folder.icon" class="h-7 w-7" aria-hidden="true" />
                </span>
                <h3 class="line-clamp-2 font-mono text-[11px] leading-4 text-text-main">
                  {{ folder.label }}
                </h3>
                <p class="font-mono text-[10px] text-text-dim">
                  {{ folder.meta }}
                </p>
              </article>
            </div>
          </div>
        </div>

        <div v-else class="retro-inset grid min-h-[360px] place-items-center p-6 text-center">
          <div class="max-w-md">
            <component :is="activePlaceholder.icon" class="mx-auto h-10 w-10 text-neon-muted" aria-hidden="true" />
            <h3 class="mt-4 text-lg font-bold text-text-main">
              {{ activePlaceholder.title }}
            </h3>
            <p class="mt-2 text-sm leading-6 text-text-dim">
              {{ activePlaceholder.copy }}
            </p>
          </div>
        </div>
      </div>

      <footer class="retro-statusbar flex min-h-9 flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
        <p class="font-mono text-[11px] text-text-dim">
          {{ frontendStatusLabel }}
        </p>
        <p class="min-w-0 truncate font-mono text-[11px] text-text-dim">
          Active save: {{ activeSaveName }}
        </p>
      </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import { useRouter } from "vue-router"
import {
  Activity,
  ArrowLeft,
  Blocks,
  Bot,
  CheckCircle2,
  Disc3,
  FileCog,
  FolderOpen,
  Gamepad2,
  HardDrive,
  MonitorCog,
  Play,
  Plus,
  Save,
  Trash2,
} from "lucide-vue-next"
import type { Component } from "vue"
import type { LocalGameCardRecord, LocalSaveRecord } from "@/storage/db"
import {
  formatDateTime,
  getFrontendStatusDescription,
  getFrontendStatusLabel,
  getGameCardAuthor,
  getGameCardCoverUrl,
  getGameCardDescription,
  getGameCardTitle,
  hasPlayableFrontend,
} from "@/lib/game-card-display"
import {
  createPlatformSaveFromGameCard,
  deletePlatformSave,
  getPlatformActiveSaveId,
  getPlatformGameCard,
  listPlatformSaves,
  selectPlatformSave,
} from "../platform-host"

type TabId = "overview" | "saves" | "workspace" | "frontend" | "agents" | "diagnostics"

interface TabItem {
  id: TabId
  label: string
  icon: Component
}

const props = defineProps<{
  cardId: string
}>()

const router = useRouter()
const tabs: TabItem[] = [
  { id: "overview", label: "Overview", icon: Disc3 },
  { id: "saves", label: "Saves", icon: Save },
  { id: "workspace", label: "Workspace", icon: Blocks },
  { id: "frontend", label: "Frontend", icon: MonitorCog },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "diagnostics", label: "Diagnostics", icon: Activity },
]

const placeholders: Record<Exclude<TabId, "overview" | "saves">, { title: string, copy: string, icon: Component }> = {
  workspace: {
    title: "Workspace folder",
    copy: "Card content, save runtime files, and platform metadata share one virtual root.",
    icon: FolderOpen,
  },
  frontend: {
    title: "Frontend binding is managed later.",
    copy: "This page reports the current frontend state without exposing import or binding tools in this slice.",
    icon: MonitorCog,
  },
  agents: {
    title: "Agent and Skill management is reserved.",
    copy: "Card-owned Agents and Skills remain reusable card content and are not copied into save slots.",
    icon: Bot,
  },
  diagnostics: {
    title: "Runtime diagnostics stay in the diagnostics surface.",
    copy: "Save-specific traces and checkpoints remain runtime internals for this library flow.",
    icon: Activity,
  },
}

const activeTab = ref<TabId>("overview")
const card = ref<LocalGameCardRecord | null>(null)
const allSaves = ref<LocalSaveRecord[]>([])
const activeSaveId = ref("")
const selectedSaveId = ref("")
const newSaveName = ref("")
const loading = ref(false)
const errorMessage = ref("")
const feedback = ref("")

const cardSaves = computed(() =>
  allSaves.value
    .filter((save) => save.gameCardId === card.value?.manifest.id)
    .sort((left, right) => right.updatedAt - left.updatedAt)
)

const cardTitle = computed(() => getGameCardTitle(card.value))
const cardDescription = computed(() => getGameCardDescription(card.value))
const cardAuthor = computed(() => getGameCardAuthor(card.value))
const coverUrl = computed(() => getGameCardCoverUrl(card.value))
const frontendStatusLabel = computed(() => getFrontendStatusLabel(card.value))
const frontendStatusDescription = computed(() => getFrontendStatusDescription(card.value))
const isPlayable = computed(() => hasPlayableFrontend(card.value))
const activeSaveName = computed(() =>
  allSaves.value.find((save) => save.id === activeSaveId.value)?.name ?? "None"
)
const workspaceFolders = computed(() => [
  {
    id: "card-content",
    label: "Card Content",
    meta: `${card.value?.contentFiles.length ?? 0} file${card.value?.contentFiles.length === 1 ? "" : "s"}`,
    icon: FolderOpen,
  },
  {
    id: "save-runtime",
    label: "save",
    meta: `${cardSaves.value.length} slot${cardSaves.value.length === 1 ? "" : "s"}`,
    icon: HardDrive,
  },
  {
    id: "platform",
    label: ".tsian",
    meta: "metadata",
    icon: FileCog,
  },
])
const activePlaceholder = computed(() => {
  if (activeTab.value === "overview" || activeTab.value === "saves") {
    return placeholders.workspace
  }
  return placeholders[activeTab.value]
})

async function refreshData() {
  loading.value = true
  errorMessage.value = ""

  try {
    const [loadedCard, saves, loadedActiveSaveId] = await Promise.all([
      getPlatformGameCard(props.cardId),
      listPlatformSaves(),
      getPlatformActiveSaveId(),
    ])

    if (!loadedCard) {
      throw new Error(`Game Card "${props.cardId}" was not found.`)
    }

    card.value = loadedCard
    allSaves.value = saves
    activeSaveId.value = loadedActiveSaveId ?? ""

    const scopedSaves = saves.filter((save) => save.gameCardId === loadedCard.manifest.id)
    if (!scopedSaves.some((save) => save.id === selectedSaveId.value)) {
      selectedSaveId.value = scopedSaves.find((save) => save.id === activeSaveId.value)?.id
        ?? scopedSaves[0]?.id
        ?? ""
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to load Game Card details."
  } finally {
    loading.value = false
  }
}

async function createSave() {
  if (!card.value) {
    return
  }

  const created = await createPlatformSaveFromGameCard(card.value.id, {
    name: newSaveName.value || `${cardTitle.value} Save ${cardSaves.value.length + 1}`,
  })
  newSaveName.value = ""
  selectedSaveId.value = created.id
  feedback.value = `Created save slot: ${created.name}`
  await refreshData()
}

async function selectSave(saveId: string) {
  await selectPlatformSave(saveId)
  selectedSaveId.value = saveId
  feedback.value = "Save slot selected."
  await refreshData()
}

async function continueSave(saveId: string) {
  if (!isPlayable.value) {
    feedback.value = "This Game Card does not have a playable frontend yet."
    return
  }

  await selectPlatformSave(saveId)
  router.push("/play")
}

async function deleteSave(saveId: string) {
  const save = allSaves.value.find((item) => item.id === saveId)
  const saveName = save?.name ?? "this save slot"
  const confirmed = window.confirm(
    `Delete save slot "${saveName}"?\n\nThe reusable Game Card "${cardTitle.value}" will not be deleted.`,
  )
  if (!confirmed) {
    return
  }

  await deletePlatformSave(saveId)
  feedback.value = `Deleted save slot: ${saveName}`
  if (selectedSaveId.value === saveId) {
    selectedSaveId.value = ""
  }
  await refreshData()
}

watch(() => props.cardId, () => {
  activeTab.value = "overview"
  void refreshData()
})

onMounted(() => {
  void refreshData()
})
</script>

<style scoped>
.poster-pane {
  box-shadow:
    inset 1px 1px 0 rgba(0, 0, 0, 0.72),
    inset -1px -1px 0 rgba(246, 236, 215, 0.1);
}

.slot-row {
  box-shadow:
    inset 1px 1px 0 rgba(246, 236, 215, 0.1),
    inset -1px -1px 0 rgba(0, 0, 0, 0.55);
}
</style>
