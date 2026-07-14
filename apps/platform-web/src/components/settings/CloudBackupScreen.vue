<template>
  <div class="grid h-full min-h-0 place-items-start overflow-auto p-5">
    <div class="grid w-full max-w-2xl gap-4">
      <div class="border-b border-neon-deep/25 pb-3">
        <p class="font-mono text-[10px] uppercase tracking-wider text-neon">云备份</p>
        <h2 class="mt-1 text-sm font-bold text-text-main">云备份</h2>
        <p class="mt-1.5 text-xs leading-5 text-text-dim">
          备份当前进度，换设备也能继续玩。只备份当前进度，不备份回滚点和游戏卡本身。
        </p>
      </div>

      <div
        class="border px-3 py-2 text-xs"
        :class="loggedIn ? 'border-neon/40 bg-neon/5 text-neon' : 'border-neon-deep/40 bg-elevated/40 text-text-dim'"
      >
        <template v-if="loggedIn">已登录，可以使用云备份。</template>
        <template v-else>登录后可使用云备份；本地导入/导出不需要登录。</template>
      </div>

      <label class="retro-inset flex items-center justify-between gap-3 p-3">
        <div class="min-w-0">
          <p class="text-xs font-bold text-text-main">自动备份</p>
          <p class="mt-0.5 text-[11px] leading-4 text-text-dim">
            开启后，正在玩的存档会在回合结束后自动备份到云端。不会批量上传旧存档。
          </p>
        </div>
        <input
          v-model="form.autoBackupEnabled"
          type="checkbox"
          class="h-4 w-4 accent-[var(--color-neon)]"
        />
      </label>

      <div class="flex items-center gap-2 border-t border-neon-deep/25 pt-3">
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-4 font-mono text-xs"
          @click="handleSave"
        >
          <Save class="h-3.5 w-3.5" aria-hidden="true" />
          保存
        </button>
        <span v-if="savedFlash" class="text-[11px] text-neon">已保存</span>
      </div>

      <section class="retro-inset grid gap-3 p-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p class="text-xs font-bold text-text-main">空间</p>
            <p class="mt-0.5 text-[11px] text-text-dim">已用 {{ usageLabel }} / {{ quotaLabel }}</p>
          </div>
          <button
            type="button"
            class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
            :disabled="loading || !loggedIn"
            @click="refresh"
          >
            <RefreshCw class="h-3.5 w-3.5" aria-hidden="true" />
            刷新
          </button>
        </div>

        <div v-if="!loggedIn" class="text-xs leading-5 text-text-dim">
          需要登录后查看云端备份列表。
        </div>
        <div v-else-if="loading" class="text-xs leading-5 text-text-dim">正在读取云端备份…</div>
        <div v-else-if="errorMessage" class="text-xs leading-5 text-danger">{{ errorMessage }}</div>
        <div v-else-if="backups.length === 0" class="text-xs leading-5 text-text-dim">暂无云端备份。</div>
        <ul v-else class="grid gap-2">
          <li
            v-for="backup in backups"
            :key="backup.id"
            class="flex flex-wrap items-center justify-between gap-2 border border-neon-deep/35 bg-elevated/45 p-2"
          >
            <div class="min-w-0">
              <p class="truncate text-xs font-bold text-text-main">{{ backup.name }}</p>
              <p class="mt-0.5 font-mono text-[10px] text-text-dim">
                {{ backup.cardId }} · {{ formatDateTime(Date.parse(backup.updatedAt)) }} · {{ formatBytes(backup.sizeBytes) }}
              </p>
            </div>
            <button
              type="button"
              class="retro-button retro-focus inline-flex h-7 items-center gap-1.5 px-2.5 font-mono text-[11px] text-danger"
              :disabled="loading"
              @click="requestDelete(backup)"
            >
              <Trash2 class="h-3 w-3" aria-hidden="true" />
              删除
            </button>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CloudBackupSummary } from "@tsian/contracts"
import { computed, onMounted, ref } from "vue"
import { RefreshCw, Save, Trash2 } from "lucide-vue-next"
import { useAuth } from "@/composables/useAuth"
import { confirm } from "@/composables/useConfirm"
import type { PlatformConfigCloudBackup } from "@/config/platform-config"
import { getPlatformConfig } from "@/config/platform-config"
import { formatDateTime } from "@/lib/game-card-display"
import { toast } from "@/composables/useToast"
import { deleteCloudBackup, listAllCloudBackups } from "@/platform-host"

const emit = defineEmits<{
  (e: "save", input: PlatformConfigCloudBackup): void
}>()

const { loggedIn } = useAuth()
const cfg = getPlatformConfig().cloudBackup
const form = ref<PlatformConfigCloudBackup>({ ...cfg })
const backups = ref<CloudBackupSummary[]>([])
const usageBytes = ref(0)
const quotaBytes = ref(100 * 1024 * 1024)
const loading = ref(false)
const errorMessage = ref("")
const savedFlash = ref(false)

const usageLabel = computed(() => formatBytes(usageBytes.value))
const quotaLabel = computed(() => formatBytes(quotaBytes.value))

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function handleSave(): void {
  emit("save", { ...form.value })
  savedFlash.value = true
  window.setTimeout(() => {
    savedFlash.value = false
  }, 1500)
}

async function refresh(): Promise<void> {
  if (!loggedIn.value) {
    backups.value = []
    usageBytes.value = 0
    return
  }
  loading.value = true
  errorMessage.value = ""
  try {
    const response = await listAllCloudBackups()
    backups.value = response.backups
    usageBytes.value = response.usageBytes
    quotaBytes.value = response.quotaBytes
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "读取云端备份失败。"
  } finally {
    loading.value = false
  }
}

async function requestDelete(backup: CloudBackupSummary): Promise<void> {
  const confirmed = await confirm({
    title: "删除云端备份？",
    message: `删除云端备份「${backup.name}」？\n\n本机存档不会被删除。`,
    confirmText: "删除",
    cancelText: "取消",
    severity: "danger",
  })
  if (!confirmed) {
    return
  }
  loading.value = true
  try {
    await deleteCloudBackup(backup.id)
    toast.success("已删除云端备份。")
    await refresh()
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "删除云端备份失败。")
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void refresh()
})
</script>
