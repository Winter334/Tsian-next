<template>
  <section class="grid min-h-full grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
    <div class="retro-toolbar flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
          :disabled="importing"
          @click="openPackagePicker"
        >
          <Download class="h-3.5 w-3.5" aria-hidden="true" />
          安装卡包
        </button>
        <input
          ref="packageInput"
          type="file"
          class="hidden"
          accept=".tsian-card.zip,application/zip"
          @change="handlePackageSelected"
        />
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
          disabled
        >
          <Upload class="h-3.5 w-3.5" aria-hidden="true" />
          上传
        </button>
      </div>
      <label class="flex min-w-[220px] items-center gap-2 border border-neon-deep/45 bg-elevated px-2 py-1">
        <Search class="h-3.5 w-3.5 text-neon-muted" aria-hidden="true" />
        <input
          type="search"
          disabled
          value=""
          placeholder="搜索市场"
          class="min-w-0 flex-1 bg-transparent font-mono text-xs text-text-main placeholder:text-text-dim/60"
        />
      </label>
    </div>

    <main class="m-3 grid min-h-[420px] gap-3 overflow-auto lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside class="retro-inset grid content-start gap-1 p-2">
        <button
          v-for="category in categories"
          :key="category"
          type="button"
          class="retro-focus flex h-8 items-center justify-between border px-2 font-mono text-xs"
          :class="category === '全部游戏卡'
            ? 'border-neon bg-neon/10 text-neon'
            : 'border-transparent text-text-dim hover:border-neon-deep/40 hover:text-text-main'"
        >
          <span>{{ category }}</span>
          <span>0</span>
        </button>
      </aside>

      <section class="retro-inset grid place-items-center p-6">
        <div class="max-w-lg text-center">
          <Store class="mx-auto h-12 w-12 text-neon-muted" aria-hidden="true" />
          <h2 class="mt-4 text-xl font-bold text-text-main">应用市场</h2>
          <p class="mt-2 text-sm leading-6 text-text-dim">
            这里会承载社区游戏卡的发现、上传与安装。已安装的游戏卡可以从“我的应用”打开。
          </p>
          <p v-if="feedback" class="mt-4 border border-neon-deep/40 bg-neon/10 px-3 py-2 text-sm text-neon">
            {{ feedback }}
          </p>
          <p v-if="errorMessage" class="mt-4 border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {{ errorMessage }}
          </p>
          <button
            type="button"
            class="retro-button retro-focus mt-5 inline-flex h-9 items-center gap-2 px-3 font-mono text-xs"
            @click="router.push('/library')"
          >
            <FolderOpen class="h-3.5 w-3.5" aria-hidden="true" />
            打开我的应用
          </button>
        </div>
      </section>
    </main>
  </section>
</template>

<script setup lang="ts">
import { ref } from "vue"
import { useRouter } from "vue-router"
import { Download, FolderOpen, Search, Store, Upload } from "lucide-vue-next"
import { toast } from "@/composables/useToast"
import { getGameCardTitle } from "@/lib/game-card-display"
import { importPlatformGameCardPackage } from "../platform-host"

const router = useRouter()
const categories = ["全部游戏卡", "已安装", "可游玩", "模板", "工具"]
const packageInput = ref<HTMLInputElement | null>(null)
const importing = ref(false)
const feedback = ref("")
const errorMessage = ref("")

function openPackagePicker() {
  packageInput.value?.click()
}

async function handlePackageSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ""
  if (!file) {
    return
  }

  importing.value = true
  feedback.value = ""
  errorMessage.value = ""
  try {
    const imported = await importPlatformGameCardPackage(file)
    feedback.value = `已安装：${getGameCardTitle(imported)}`
    toast.success(`已导入：${getGameCardTitle(imported)}`)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "安装游戏卡包失败。"
  } finally {
    importing.value = false
  }
}
</script>
