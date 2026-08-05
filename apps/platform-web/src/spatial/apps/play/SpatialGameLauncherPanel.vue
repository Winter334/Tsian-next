<template>
  <section class="spatial-play-launcher" aria-label="游戏存档启动器">
    <header class="spatial-play-launcher__header">
      <div class="spatial-play-launcher__cover">
        <SpatialImage
          :source="coverSource"
          :alt="card.manifest.cover?.alt || ''"
          :icon="Gamepad2"
          fallback-label="游戏卡封面不可用"
        />
      </div>
      <div class="spatial-app__identity spatial-play-launcher__identity">
        <span class="spatial-app__eyebrow">CURRENT GAME CARD · {{ isLoadedCard ? "LOADED" : "NOT LOADED" }}</span>
        <h2>{{ cardTitle }}</h2>
        <span class="spatial-app__meta">v{{ card.manifest.version || "未知" }} · {{ cardSaves.length }} 个存档</span>
      </div>
      <div class="spatial-app__commands spatial-play-launcher__commands">
        <SpatialActionButton :disabled="busy" @click="openImportPicker">
          <template #icon><Upload /></template>导入
        </SpatialActionButton>
        <SpatialActionButton :disabled="busy" @click="syncFromCloud">
          <template #icon><CloudDownload /></template>同步云端
        </SpatialActionButton>
        <SpatialActionButton variant="primary" :disabled="busy || creating" @click="startCreate">
          <template #icon><Plus /></template>新建存档
        </SpatialActionButton>
      </div>
      <input
        ref="importInputRef"
        class="spatial-play-launcher__file"
        type="file"
        accept=".zip,.tsian-save.zip,application/zip"
        @change="handleImportSelected"
      />
    </header>

    <main class="spatial-play-launcher__body">
      <form v-if="creating" class="spatial-play-launcher__editor" @submit.prevent="confirmCreate">
        <label class="spatial-app__field">
          <span>存档名称</span>
          <input
            ref="createInputRef"
            v-model="createName"
            type="text"
            :placeholder="defaultNewName"
            :disabled="busy"
            @keyup.esc="cancelCreate"
          />
        </label>
        <div class="spatial-app__actions">
          <SpatialActionButton type="submit" variant="primary" :disabled="busy">
            <template #icon><Check /></template>创建
          </SpatialActionButton>
          <SpatialActionButton :disabled="busy" @click="cancelCreate">
            <template #icon><X /></template>取消
          </SpatialActionButton>
        </div>
      </form>

      <div v-if="cardSaves.length === 0 && !creating" class="spatial-app__empty spatial-play-launcher__empty">
        <Gamepad2 aria-hidden="true" />
        <strong>还没有存档</strong>
        <span>新建或导入一个存档后即可进入游戏前端。</span>
      </div>

      <ul v-else class="spatial-play-launcher__list">
        <li
          v-for="save in cardSaves"
          :key="save.id"
          class="spatial-play-save"
          :class="{ 'spatial-play-save--active': save.id === activeSaveId }"
        >
          <template v-if="renamingId !== save.id">
            <div class="spatial-play-save__identity">
              <div class="spatial-play-save__title">
                <h3>{{ save.name }}</h3>
                <span v-if="save.id === activeSaveId" class="spatial-play-save__badge">当前</span>
                <span v-if="saveNeedsVersionConfirmation(save)" class="spatial-play-save__badge spatial-play-save__badge--warning">旧版</span>
              </div>
              <p>创建 {{ formatDateTime(save.createdAt) }} · 更新 {{ formatDateTime(save.updatedAt) }}</p>
            </div>
            <div class="spatial-app__actions spatial-play-save__actions">
              <SpatialActionButton variant="primary" :disabled="busy" @click="requestContinue(save)">
                <template #icon><Play /></template>继续
              </SpatialActionButton>
              <SpatialActionButton :disabled="busy" @click="startRename(save)">
                <template #icon><Pencil /></template>重命名
              </SpatialActionButton>
              <SpatialActionButton :disabled="busy" @click="backupToCloud(save)">
                <template #icon><CloudUpload /></template>备份
              </SpatialActionButton>
              <SpatialActionButton :disabled="busy" @click="exportSave(save)">
                <template #icon><Download /></template>导出
              </SpatialActionButton>
              <SpatialActionButton variant="danger" :disabled="busy" @click="requestDelete(save)">
                <template #icon><Trash2 /></template>删除
              </SpatialActionButton>
            </div>
          </template>

          <form v-else class="spatial-play-save__rename" @submit.prevent="confirmRename">
            <label class="spatial-app__field">
              <span>重命名存档</span>
              <input
                ref="renameInputRef"
                v-model="renameName"
                type="text"
                :disabled="busy"
                @keyup.esc="cancelRename"
              />
            </label>
            <div class="spatial-app__actions">
              <SpatialActionButton type="submit" variant="primary" :disabled="busy">
                <template #icon><Check /></template>确定
              </SpatialActionButton>
              <SpatialActionButton :disabled="busy" @click="cancelRename">
                <template #icon><X /></template>取消
              </SpatialActionButton>
            </div>
          </form>
        </li>
      </ul>
    </main>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue"
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
import { useGameLauncherController } from "@/controllers/play/use-game-launcher-controller"
import { downloadBrowserBlob } from "@/lib/browser-download"
import { formatDateTime } from "@/lib/game-card-display"
import type { LocalGameCardRecord, LocalSaveRecord } from "@/storage/db"
import SpatialImage from "../media/SpatialImage.vue"
import { spatialImageInputForGameCard } from "../media/spatial-image"
import SpatialActionButton from "../primitives/SpatialActionButton.vue"
import "../spatial-apps.css"

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

const createInputRef = ref<HTMLInputElement | null>(null)
const importInputRef = ref<HTMLInputElement | null>(null)
const renameInputRef = ref<HTMLInputElement | null>(null)
const coverSource = computed(() => spatialImageInputForGameCard(props.card))

const {
  busy,
  creating,
  createName,
  renamingId,
  renameName,
  cardSaves,
  cardTitle,
  defaultNewName,
  saveNeedsVersionConfirmation,
  requestContinue,
  startCreate: startCreateState,
  cancelCreate,
  confirmCreate,
  startRename: startRenameState,
  cancelRename,
  confirmRename,
  backupToCloud,
  exportSave,
  importSave,
  syncFromCloud,
  requestDelete,
} = useGameLauncherController({
  card: () => props.card,
  saves: () => props.saves,
  onContinue: (saveId) => emit("continue", saveId),
  onChanged: () => emit("changed"),
  downloadBackup: ({ blob, filename }) => downloadBrowserBlob(blob, filename),
})

function startCreate(): void {
  startCreateState()
  void nextTick(() => createInputRef.value?.focus())
}

function startRename(save: LocalSaveRecord): void {
  startRenameState(save)
  void nextTick(() => renameInputRef.value?.focus())
}

function openImportPicker(): void {
  importInputRef.value?.click()
}

async function handleImportSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ""
  if (file) await importSave(file)
}
</script>
