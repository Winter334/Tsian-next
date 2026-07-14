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
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="retro-button retro-focus inline-flex h-9 items-center gap-2 px-3 font-mono text-xs"
            :disabled="busy"
            @click="openImportPicker"
          >
            <Upload class="h-3.5 w-3.5" aria-hidden="true" />
            导入
          </button>
          <button
            type="button"
            class="retro-button retro-focus inline-flex h-9 items-center gap-2 px-3 font-mono text-xs"
            :disabled="busy"
            @click="syncFromCloud"
          >
            <CloudDownload class="h-3.5 w-3.5" aria-hidden="true" />
            同步云端
          </button>
          <button
            type="button"
            class="retro-button retro-focus inline-flex h-9 items-center gap-2 px-3 font-mono text-xs"
            @click="startCreate"
          >
            <Plus class="h-3.5 w-3.5" aria-hidden="true" />
            新建存档
          </button>
        </div>
        <input
          ref="importInputRef"
          type="file"
          accept=".zip,.tsian-save.zip,application/zip"
          class="hidden"
          @change="handleImportSelected"
        />
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
                  v-if="saveNeedsVersionConfirmation(save)"
                  class="shrink-0 border border-warning/60 bg-warning/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-warning"
                >
                  旧版存档
                </span>
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
                @click="requestContinue(save)"
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
                class="retro-button retro-focus inline-flex h-8 items-center gap-1.5 px-2.5 font-mono text-xs"
                :disabled="busy"
                @click="backupToCloud(save)"
              >
                <CloudUpload class="h-3.5 w-3.5" aria-hidden="true" />
                备份
              </button>
              <button
                type="button"
                class="retro-button retro-focus inline-flex h-8 items-center gap-1.5 px-2.5 font-mono text-xs"
                :disabled="busy"
                @click="exportSave(save)"
              >
                <Download class="h-3.5 w-3.5" aria-hidden="true" />
                导出
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
import { confirm, confirmChoice } from "@/composables/useConfirm"
import { toast } from "@/composables/useToast"
import {
  Check,
  CloudDownload,
  CloudUpload,
  Download,
  Gamepad2,
  Pencil,
  Play,
  Plus,
  Trash2,
  Upload,
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
  deleteCloudBackupForSave,
  deletePlatformSave,
  exportPlatformSaveBackup,
  importPlatformSaveBackup,
  listCloudBackupsForCard,
  pullCloudBackupToLocal,
  renamePlatformSave,
  backupPlatformSaveToCloud,
  CloudBackupConflictError,
  updatePlatformSaveGameCardVersion,
} from "../../platform-host"
import type { CloudBackupSummary } from "@tsian/contracts"

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
const importInputRef = ref<HTMLInputElement | null>(null)

const renamingId = ref("")
const renameName = ref("")
const renameInputRef = ref<HTMLInputElement | null>(null)

function normalizedVersion(value: string | undefined): string {
  return value?.trim() ?? ""
}

function currentCardVersion(): string {
  return normalizedVersion(props.card.manifest.version)
}

function saveVersion(save: LocalSaveRecord): string {
  return normalizedVersion(save.gameCardVersion)
}

function saveNeedsVersionConfirmation(save: LocalSaveRecord): boolean {
  const savedVersion = saveVersion(save)
  return !savedVersion || savedVersion !== currentCardVersion()
}

async function requestContinue(save: LocalSaveRecord) {
  if (busy.value) {
    return
  }

  if (!saveNeedsVersionConfirmation(save)) {
    emit("continue", save.id)
    return
  }

  const confirmed = await confirm({
    title: "继续旧版存档？",
    message: `存档「${save.name}」记录的游戏卡版本是「${saveVersion(save) || "未知版本"}」，当前本地游戏卡版本是「${currentCardVersion() || "未知版本"}」。\n\n继续后会使用当前本地游戏卡的规则、角色能力、前端与模板运行；存档文件会保留。`,
    confirmText: "使用当前版本继续",
    cancelText: "暂不继续",
    severity: "danger",
  })
  if (!confirmed) {
    return
  }

  busy.value = true
  try {
    await updatePlatformSaveGameCardVersion(save.id, currentCardVersion())
    emit("changed")
    emit("continue", save.id)
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "更新存档版本失败，未启动游戏前端。")
  } finally {
    busy.value = false
  }
}

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

function safeFileName(value: string, fallback: string): string {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    || fallback
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.rel = "noopener"
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
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

async function backupToCloud(save: LocalSaveRecord) {
  if (busy.value) {
    return
  }
  busy.value = true
  try {
    await backupPlatformSaveToCloud(save.id)
    toast.success("已备份到云端。")
    emit("changed")
  } catch (error) {
    if (error instanceof CloudBackupConflictError) {
      busy.value = false
      const confirmed = await confirm({
        title: "覆盖云端备份？",
        message: `云端备份似乎在其他设备更新过。\n\n继续备份会用本机存档「${save.name}」覆盖云端备份。`,
        confirmText: "覆盖云端",
        cancelText: "取消",
        severity: "danger",
      })
      if (!confirmed) {
        return
      }
      busy.value = true
      try {
        await backupPlatformSaveToCloud(save.id, { force: true })
        toast.success("已覆盖云端备份。")
        emit("changed")
      } catch (forceError) {
        toast.error(forceError instanceof Error ? forceError.message : "备份失败。")
      } finally {
        busy.value = false
      }
      return
    }
    toast.error(error instanceof Error ? error.message : "备份失败。")
  } finally {
    busy.value = false
  }
}

async function exportSave(save: LocalSaveRecord) {
  if (busy.value) {
    return
  }
  busy.value = true
  try {
    const blob = await exportPlatformSaveBackup(save.id)
    downloadBlob(blob, `${safeFileName(save.name, "save")}.tsian-save.zip`)
    toast.success("已导出存档备份。")
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "导出存档失败。")
  } finally {
    busy.value = false
  }
}

function openImportPicker() {
  importInputRef.value?.click()
}

async function handleImportSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ""
  if (!file || busy.value) {
    return
  }
  busy.value = true
  try {
    const imported = await importPlatformSaveBackup(props.card.id, file)
    toast.success(`已导入存档：${imported.name}`)
    emit("changed")
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "导入存档失败。")
  } finally {
    busy.value = false
  }
}

function backupChoiceLabel(backup: CloudBackupSummary): string {
  return `${backup.name} · ${formatDateTime(Date.parse(backup.updatedAt))} · ${formatBytes(backup.sizeBytes)} · v${backup.cardVersion || "未知"}`
}

async function chooseCloudBackup(backups: CloudBackupSummary[]): Promise<CloudBackupSummary | null> {
  if (backups.length === 0) {
    return null
  }
  if (backups.length === 1) {
    return backups[0] ?? null
  }
  const selectedId = await confirmChoice({
    title: "选择云端备份",
    message: "选择要同步到本机的云端备份。",
    options: backups.map((backup) => ({
      value: backup.id,
      label: backupChoiceLabel(backup),
    })),
    cancelText: "取消",
  })
  return backups.find((backup) => backup.id === selectedId) ?? null
}

async function syncFromCloud() {
  if (busy.value) {
    return
  }
  busy.value = true
  try {
    const backups = await listCloudBackupsForCard(props.card.id)
    if (backups.length === 0) {
      toast.info("暂无云端备份。")
      return
    }
    busy.value = false
    const selected = await chooseCloudBackup(backups)
    if (!selected) {
      return
    }
    const existing = props.saves.find((save) => save.cloudBackupId === selected.id)
    if (existing) {
      const confirmed = await confirm({
        title: "同步云端？",
        message: `用云端备份覆盖本机存档「${existing.name}」？\n\n本机当前进度会被云端备份替换。`,
        confirmText: "同步云端",
        cancelText: "取消",
        severity: "danger",
      })
      if (!confirmed) {
        return
      }
    }
    busy.value = true
    const result = await pullCloudBackupToLocal(selected.id, props.card)
    toast.success(result.replaced ? "已同步云端备份。" : `已从云端创建存档：${result.save.name}`)
    emit("changed")
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "同步云端失败。")
  } finally {
    busy.value = false
  }
}

async function requestDelete(save: LocalSaveRecord) {
  if (busy.value) {
    return
  }
  let deleteCloud = false
  if (save.cloudBackupId) {
      const choice = await confirmChoice({
        title: "删除存档？",
        message: `删除本机存档「${save.name}」？\n\n你也可以同时删除它的云端备份。`,
        options: [
          { value: "cloud", label: "同时删除云端", severity: "danger" },
          { value: "local", label: "只删除本机", severity: "danger" },
        ],
        cancelText: "取消",
      })
    if (!choice) {
      return
    }
    deleteCloud = choice === "cloud"
  } else {
    const confirmed = await confirm({
      message: `删除存档「${save.name}」？\n\n游戏卡「${cardTitle.value}」不会被删除，其他存档不受影响。`,
      severity: "danger",
      confirmText: "删除",
    })
    if (!confirmed) {
      return
    }
  }
  busy.value = true
  try {
    if (deleteCloud) {
      await deleteCloudBackupForSave(save)
    }
    await deletePlatformSave(save.id)
    toast.success(deleteCloud ? `已删除存档和云端备份：${save.name}` : `已删除存档：${save.name}`)
    emit("changed")
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "删除存档失败。")
  } finally {
    busy.value = false
  }
}
</script>
