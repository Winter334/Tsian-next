<template>
  <section class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-void text-text-main">
    <!-- 卡片头 -->
    <header class="retro-toolbar flex flex-wrap items-center gap-3 border-b border-neon-deep/40 px-4 py-3">
      <div class="relative h-12 w-12 shrink-0 overflow-hidden border border-neon-deep/55 bg-elevated">
        <img
          v-if="coverUrl"
          :src="coverUrl"
          :alt="card.manifest.cover?.alt || ''"
          class="h-full w-full object-cover"
        />
        <div v-else class="grid h-full place-items-center bg-[radial-gradient(circle_at_30%_20%,rgba(243,197,109,0.22),transparent_28%),linear-gradient(135deg,#3f4d3a,#1e2420)]">
          <Gamepad2 class="h-5 w-5 text-neon-muted" aria-hidden="true" />
        </div>
      </div>
      <div class="min-w-0 flex-1">
        <p class="font-mono text-[10px] uppercase tracking-[0.22em] text-neon-muted">当前游戏卡</p>
        <h2 class="truncate text-lg font-bold leading-tight text-text-main">{{ cardTitle }}</h2>
      </div>
      <span
        class="border px-2 py-1 font-mono text-[10px] uppercase"
        :class="isLoadedCard ? 'border-neon text-neon' : 'border-neon-deep/50 text-text-dim'"
      >
        {{ isLoadedCard ? "loaded" : "not loaded" }}
      </span>
    </header>

    <!-- 存档列表 -->
    <div class="retro-inset m-3 min-h-0 overflow-auto p-3">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p class="font-mono text-xs uppercase tracking-wider text-neon">存档槽</p>
          <p class="mt-0.5 text-xs text-text-dim">{{ cardSaves.length }} 个存档 · 仅显示本卡</p>
        </div>
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-9 items-center gap-2 px-3 font-mono text-xs"
          @click="startCreate"
        >
          <Plus class="h-3.5 w-3.5" aria-hidden="true" />
          新建存档
        </button>
      </div>

      <!-- 新建存档行 -->
      <div v-if="creating" class="mb-2 border border-neon bg-neon/10 p-3">
        <label class="grid gap-1.5">
          <span class="font-mono text-[10px] uppercase tracking-wider text-neon-muted">存档名称</span>
          <div class="flex gap-2">
            <input
              ref="createInputRef"
              v-model="createName"
              type="text"
              class="retro-focus h-8 min-w-0 flex-1 border border-neon-deep/55 bg-panel px-2 font-mono text-xs text-text-main placeholder:text-text-dim/60"
              :placeholder="defaultNewName"
              @keyup.enter="confirmCreate"
              @keyup.esc="cancelCreate"
            />
            <button
              type="button"
              class="retro-button retro-focus inline-flex h-8 shrink-0 items-center gap-1.5 px-3 font-mono text-xs"
              :disabled="busy"
              @click="confirmCreate"
            >
              <Check class="h-3.5 w-3.5" aria-hidden="true" />
              创建
            </button>
            <button
              type="button"
              class="retro-button retro-focus inline-flex h-8 shrink-0 items-center gap-1.5 px-3 font-mono text-xs"
              :disabled="busy"
              @click="cancelCreate"
            >
              <X class="h-3.5 w-3.5" aria-hidden="true" />
              取消
            </button>
          </div>
        </label>
      </div>

      <!-- 存档项 -->
      <div v-if="cardSaves.length === 0 && !creating" class="border border-neon-deep/35 bg-elevated/50 p-4 text-center text-sm text-text-dim">
        这张游戏卡还没有存档，新建一个开始游玩。
      </div>

      <ul class="grid gap-2">
        <li
          v-for="save in cardSaves"
          :key="save.id"
          class="border border-neon-deep/40 bg-elevated/45 p-3 transition-colors hover:border-neon-deep/70"
          :class="{ 'border-neon/60 bg-neon/5': save.id === activeSaveId }"
        >
          <!-- 显示态 -->
          <div v-if="renamingId !== save.id" class="flex flex-wrap items-center justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <h3 class="truncate text-base font-bold text-text-main">{{ save.name }}</h3>
                <span
                  v-if="save.id === activeSaveId"
                  class="shrink-0 border border-neon/60 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-neon"
                >
                  当前
                </span>
              </div>
              <p class="mt-1 font-mono text-[11px] text-text-dim">
                创建于 {{ formatDateTime(save.createdAt) }} · 更新于 {{ formatDateTime(save.updatedAt) }}
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                class="retro-button retro-focus inline-flex h-8 items-center gap-1.5 px-3 font-mono text-xs"
                :disabled="busy"
                @click="emit('continue', save.id)"
              >
                <Play class="h-3.5 w-3.5" aria-hidden="true" />
                继续
              </button>
              <button
                type="button"
                class="retro-button retro-focus inline-flex h-8 items-center gap-1.5 px-2.5 font-mono text-xs"
                :disabled="busy"
                @click="startRename(save)"
              >
                <Pencil class="h-3.5 w-3.5" aria-hidden="true" />
                重命名
              </button>
              <button
                type="button"
                class="retro-button retro-focus inline-flex h-8 items-center gap-1.5 px-2.5 font-mono text-xs text-danger"
                :disabled="busy"
                @click="requestDelete(save)"
              >
                <Trash2 class="h-3.5 w-3.5" aria-hidden="true" />
                删除
              </button>
            </div>
          </div>

          <!-- 重命名态 -->
          <div v-else class="flex items-center gap-2">
            <input
              ref="renameInputRef"
              v-model="renameName"
              type="text"
              class="retro-focus h-8 min-w-0 flex-1 border border-neon-deep/55 bg-panel px-2 font-mono text-xs text-text-main"
              @keyup.enter="confirmRename"
              @keyup.esc="cancelRename"
            />
            <button
              type="button"
              class="retro-button retro-focus inline-flex h-8 shrink-0 items-center gap-1.5 px-3 font-mono text-xs"
              :disabled="busy"
              @click="confirmRename"
            >
              <Check class="h-3.5 w-3.5" aria-hidden="true" />
              确定
            </button>
            <button
              type="button"
              class="retro-button retro-focus inline-flex h-8 shrink-0 items-center gap-1.5 px-3 font-mono text-xs"
              :disabled="busy"
              @click="cancelRename"
            >
              <X class="h-3.5 w-3.5" aria-hidden="true" />
              取消
            </button>
          </div>
        </li>
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue"
import { confirm } from "@/composables/useConfirm"
import { toast } from "@/composables/useToast"
import {
  Check,
  Gamepad2,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from "lucide-vue-next"
import type { LocalGameCardRecord, LocalSaveRecord } from "@/storage/db"
import {
  formatDateTime,
  getGameCardCoverUrl,
  getGameCardTitle,
} from "@/lib/game-card-display"
import {
  createPlatformSaveFromGameCard,
  deletePlatformSave,
  renamePlatformSave,
} from "../../platform-host"

const props = defineProps<{
  card: LocalGameCardRecord
  saves: LocalSaveRecord[]
  activeSaveId: string
  isLoadedCard: boolean
}>()

const emit = defineEmits<{
  continue: [saveId: string]
  changed: []
}>()

const cardSaves = computed(() =>
  props.saves
    .filter((save) => save.gameCardId === props.card.manifest.id)
    .sort((left, right) => right.updatedAt - left.updatedAt),
)

const cardTitle = computed(() => getGameCardTitle(props.card))
const coverUrl = computed(() => getGameCardCoverUrl(props.card))
const defaultNewName = computed(() => `${cardTitle.value} 存档 ${cardSaves.value.length + 1}`)

const busy = ref(false)
const creating = ref(false)
const createName = ref("")
const createInputRef = ref<HTMLInputElement | null>(null)

const renamingId = ref("")
const renameName = ref("")
const renameInputRef = ref<HTMLInputElement | null>(null)

function startCreate() {
  creating.value = true
  createName.value = ""
  void nextTick(() => createInputRef.value?.focus())
}

function cancelCreate() {
  creating.value = false
  createName.value = ""
}

async function confirmCreate() {
  if (busy.value) {
    return
  }
  busy.value = true
  try {
    const name = createName.value.trim() || defaultNewName.value
    const created = await createPlatformSaveFromGameCard(props.card.id, { name })
    creating.value = false
    createName.value = ""
    toast.success(`已创建存档：${created.name}`)
    emit("changed")
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "创建存档失败。")
  } finally {
    busy.value = false
  }
}

function startRename(save: LocalSaveRecord) {
  renamingId.value = save.id
  renameName.value = save.name
  void nextTick(() => renameInputRef.value?.focus())
}

function cancelRename() {
  renamingId.value = ""
  renameName.value = ""
}

async function confirmRename() {
  if (busy.value || !renamingId.value) {
    return
  }
  const id = renamingId.value
  const name = renameName.value.trim()
  if (!name) {
    toast.error("存档名不能为空。")
    return
  }
  busy.value = true
  try {
    await renamePlatformSave(id, name)
    renamingId.value = ""
    renameName.value = ""
    toast.success("已重命名存档。")
    emit("changed")
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "重命名存档失败。")
  } finally {
    busy.value = false
  }
}

async function requestDelete(save: LocalSaveRecord) {
  if (busy.value) {
    return
  }
  const confirmed = await confirm({
    message: `删除存档「${save.name}」？\n\n游戏卡「${cardTitle.value}」不会被删除，其他存档不受影响。`,
    severity: "danger",
    confirmText: "删除",
  })
  if (!confirmed) {
    return
  }
  busy.value = true
  try {
    await deletePlatformSave(save.id)
    toast.success(`已删除存档：${save.name}`)
    emit("changed")
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "删除存档失败。")
  } finally {
    busy.value = false
  }
}
</script>
