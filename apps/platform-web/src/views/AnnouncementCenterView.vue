<template>
  <section class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
    <div class="retro-toolbar flex items-center justify-between gap-2 border-b px-3 py-2">
      <div>
        <p class="font-mono text-xs uppercase tracking-wider text-neon">Signal Board</p>
        <p class="text-xs text-text-dim">平台公告与更新记录</p>
      </div>
      <button
        type="button"
        class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
        :disabled="loading"
        @click="refreshAnnouncements()"
      >
        <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': loading }" aria-hidden="true" />
        刷新
      </button>
    </div>

    <main class="grid min-h-0 gap-3 overflow-hidden p-3 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside class="retro-inset min-h-0 overflow-auto p-2">
        <div v-if="loading && announcements.length === 0" class="grid h-full place-items-center text-xs text-text-dim">
          加载公告中…
        </div>
        <div v-else-if="announcements.length === 0" class="grid h-full place-items-center text-center text-sm text-text-dim">
          暂无公告
        </div>
        <div v-else class="grid gap-1.5">
          <button
            v-for="item in announcements"
            :key="item.id"
            type="button"
            class="retro-focus border px-2.5 py-2 text-left transition-colors"
            :class="selectedId === item.id
              ? 'border-neon/65 bg-neon/10 text-text-main'
              : 'border-neon-deep/30 bg-panel/30 text-text-dim hover:border-neon-deep/60 hover:text-text-main'"
            @click="selectAnnouncement(item.id)"
          >
            <div class="flex items-center gap-2">
              <span class="h-2 w-2 shrink-0 border border-neon-deep/50" :class="isRead(item.id) ? 'bg-transparent' : 'bg-neon'" aria-hidden="true" />
              <span class="min-w-0 flex-1 truncate text-sm">{{ item.title }}</span>
            </div>
            <p class="mt-1 font-mono text-[10px] text-text-dim">{{ formatTime(item.createdAt) }}</p>
          </button>
        </div>
      </aside>

      <article class="retro-inset min-h-0 overflow-auto p-4">
        <div v-if="selectedAnnouncement" class="mx-auto max-w-3xl">
          <header class="border-b border-neon-deep/30 pb-3">
            <h1 class="text-xl font-semibold text-text-main">{{ selectedAnnouncement.title }}</h1>
            <p class="mt-1 font-mono text-xs text-text-dim">{{ formatTime(selectedAnnouncement.createdAt) }}</p>
          </header>
          <div class="announcement-prose mt-4" v-html="renderAnnouncementMarkdown(selectedAnnouncement.body)" />
        </div>
        <div v-else class="grid h-full place-items-center text-sm text-text-dim">
          选择左侧公告查看详情
        </div>
      </article>
    </main>

    <p v-if="errorMessage" class="border-t border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
      {{ errorMessage }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { RefreshCw } from "lucide-vue-next"
import { useAnnouncements } from "@/composables/useAnnouncements"
import { renderAnnouncementMarkdown } from "@/lib/announcement-markdown"

const { announcements, loading, errorMessage, refreshAnnouncements, markRead, isRead } = useAnnouncements()
const selectedId = ref("")
const selectedAnnouncement = computed(() => announcements.value.find((item) => item.id === selectedId.value) ?? null)

watch(
  () => announcements.value[0]?.id,
  (id) => {
    if (id && !selectedId.value) {
      selectAnnouncement(id)
    }
  },
  { immediate: true },
)

function selectAnnouncement(id: string): void {
  selectedId.value = id
  markRead(id)
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}
</script>
