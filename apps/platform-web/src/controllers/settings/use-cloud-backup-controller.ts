import type { CloudBackupSummary } from "@tsian/contracts"
import { computed, onMounted, ref, watch } from "vue"
import { useAuth } from "@/composables/useAuth"
import { confirm } from "@/composables/useConfirm"
import { toast } from "@/composables/useToast"
import { getPlatformConfig, type PlatformConfigCloudBackup } from "@/config/platform-config"
import { deleteCloudBackup, listAllCloudBackups } from "@/platform-host"

export function formatCloudBackupBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function useCloudBackupController() {
  const { loggedIn } = useAuth()
  const form = ref<PlatformConfigCloudBackup>({ ...getPlatformConfig().cloudBackup })
  const backups = ref<CloudBackupSummary[]>([])
  const usageBytes = ref(0)
  const quotaBytes = ref(100 * 1024 * 1024)
  const loading = ref(false)
  const errorMessage = ref("")
  const usageLabel = computed(() => formatCloudBackupBytes(usageBytes.value))
  const quotaLabel = computed(() => formatCloudBackupBytes(quotaBytes.value))

  async function refresh(): Promise<void> {
    if (!loggedIn.value) { backups.value = []; usageBytes.value = 0; return }
    loading.value = true; errorMessage.value = ""
    try {
      const response = await listAllCloudBackups()
      backups.value = response.backups; usageBytes.value = response.usageBytes; quotaBytes.value = response.quotaBytes
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : "读取云端备份失败。"
    } finally { loading.value = false }
  }

  async function requestDelete(backup: CloudBackupSummary): Promise<void> {
    if (!await confirm({ title: "删除云端备份？", message: `删除云端备份「${backup.name}」？\n\n本机存档不会被删除。`, confirmText: "删除", cancelText: "取消", severity: "danger" })) return
    loading.value = true
    try { await deleteCloudBackup(backup.id); toast.success("已删除云端备份。"); await refresh() }
    catch (error) { toast.error(error instanceof Error ? error.message : "删除云端备份失败。") }
    finally { loading.value = false }
  }
  watch(loggedIn, () => { void refresh() })
  onMounted(() => { void refresh() })
  return { loggedIn, form, backups, loading, errorMessage, usageLabel, quotaLabel, refresh, requestDelete }
}
