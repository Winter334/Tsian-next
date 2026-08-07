<template>
  <section class="spatial-app spatial-announcements" data-spatial-source-animation aria-label="公告中心">
    <header class="spatial-app__header"><div class="spatial-app__identity"><span class="spatial-app__eyebrow">SIGNAL BOARD</span><h1>公告中心</h1></div><SpatialActionButton :disabled="loading" @click="refreshAnnouncements()"><template #icon><RefreshCw /></template>{{ loading ? '刷新中…' : '刷新' }}</SpatialActionButton></header>
    <p v-if="errorMessage" class="spatial-app__banner spatial-app__banner--error" role="alert">{{ errorMessage }}</p>
    <main class="spatial-announcements__body">
      <aside class="spatial-announcements__list spatial-app__scroll" aria-label="公告列表"><p v-if="loading && !announcements.length" class="spatial-app__empty" role="status">加载公告中…</p><p v-else-if="!announcements.length" class="spatial-app__empty">暂无公告</p><button v-for="item in announcements" v-else :key="item.id" type="button" :aria-pressed="selectedId === item.id" class="spatial-announcements__item" @click="selectAnnouncement(item.id)"><span :data-unread="!isRead(item.id)" aria-hidden="true" /><strong>{{ item.title }}</strong><small>{{ formatTime(item.createdAt) }}</small></button></aside>
      <article class="spatial-announcements__detail spatial-app__scroll"><template v-if="selectedAnnouncement"><header><span class="spatial-app__eyebrow">{{ formatTime(selectedAnnouncement.createdAt) }}</span><h2>{{ selectedAnnouncement.title }}</h2></header><div class="spatial-announcements__markdown" v-html="renderAnnouncementMarkdown(selectedAnnouncement.body)" /></template><p v-else class="spatial-app__empty">选择一条公告查看详情</p></article>
    </main>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { RefreshCw } from "lucide-vue-next"
import { useAnnouncements } from "@/composables/useAnnouncements"
import { renderAnnouncementMarkdown } from "@/lib/announcement-markdown"
import SpatialActionButton from "../primitives/SpatialActionButton.vue"
import "../spatial-apps.css"
const { announcements, loading, errorMessage, refreshAnnouncements, markRead, isRead } = useAnnouncements()
const selectedId = ref("")
const selectedAnnouncement = computed(() => announcements.value.find((item) => item.id === selectedId.value) ?? null)
watch(() => announcements.value[0]?.id, (id) => { if (id && !selectedId.value) selectAnnouncement(id) }, { immediate: true })
function selectAnnouncement(id: string): void { selectedId.value = id; markRead(id) }
function formatTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date) }
</script>

<style scoped>
.spatial-announcements { grid-template-rows: auto minmax(0, 1fr); }.spatial-announcements__body { display: grid; min-height: 0; grid-template-columns: minmax(180px, 32%) minmax(0, 1fr); }.spatial-announcements__list { padding: 8px; border-right: 1px solid var(--spatial-app-border); }.spatial-announcements__item { display: grid; width: 100%; grid-template-columns: 8px minmax(0, 1fr); gap: 4px 7px; border: 1px solid transparent; padding: 8px; text-align: left; background: transparent; }.spatial-announcements__item[aria-pressed="true"] { border-color: var(--spatial-app-border-strong); background: var(--spatial-app-surface-strong); }.spatial-announcements__item > span { grid-row: span 2; width: 6px; height: 6px; margin-top: 4px; border: 1px solid var(--spatial-app-border-strong); }.spatial-announcements__item > span[data-unread="true"] { background: var(--spatial-window-tab); }.spatial-announcements__item strong { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }.spatial-announcements__item small { color: var(--spatial-app-muted); font: 9px "JetBrains Mono", monospace; }.spatial-announcements__detail { padding: 16px; }.spatial-announcements__detail h2 { margin: 4px 0 12px; font-size: 18px; }.spatial-announcements__markdown { font-size: 12px; line-height: 1.65; overflow-wrap: anywhere; }.spatial-announcements__markdown :deep(pre) { max-width: 100%; overflow: auto; padding: 9px; background: var(--spatial-app-surface-strong); } @container (max-width: 520px) { .spatial-announcements__body { grid-template-columns: 1fr; grid-template-rows: minmax(120px, 42%) minmax(0, 1fr); }.spatial-announcements__list { border-right: 0; border-bottom: 1px solid var(--spatial-app-border); } }
</style>
