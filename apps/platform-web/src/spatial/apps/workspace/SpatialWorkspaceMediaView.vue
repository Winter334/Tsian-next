<template>
  <section class="spatial-app spatial-workspace-media" aria-label="媒体查看器">
    <header class="spatial-app__header"><div class="spatial-app__identity"><span class="spatial-app__eyebrow">WORKSPACE MEDIA</span><h1>{{ loadedPath || "未知文件" }}</h1></div><span class="spatial-app__meta">{{ mediaType }}</span></header>
    <main class="spatial-workspace-media__main">
      <p v-if="loading" class="spatial-app__empty" role="status">正在加载文件…</p>
      <p v-else-if="loadError" class="spatial-app__banner spatial-app__banner--error">{{ loadError }}</p>
      <template v-else-if="blobUrl">
        <img v-if="isImage" class="spatial-workspace-media__image" :src="blobUrl" :alt="loadedPath" />
        <div v-else-if="isAudio || isVideo" class="spatial-workspace-media__player">
          <video v-if="isVideo" ref="media" data-spatial-dynamic-media="video" :src="blobUrl" class="spatial-workspace-media__video" />
          <audio v-else ref="media" :src="blobUrl" />
          <div class="spatial-workspace-media__controls">
            <SpatialActionButton :aria-label="playing ? '暂停' : '播放'" @click="togglePlay">
              <template #icon><Pause v-if="playing" /><Play v-else /></template>{{ playing ? "暂停" : "播放" }}
            </SpatialActionButton>
            <span role="status">{{ timeLabel }}</span>
            <input aria-label="播放进度" type="range" min="0" :max="duration || 0" :value="currentTime" :disabled="!canSeek" @input="seek(Number(($event.target as HTMLInputElement).value))" />
            <SpatialActionButton :aria-label="muted ? '取消静音' : '静音'" @click="toggleMuted">
              <template #icon><VolumeX v-if="muted" /><Volume2 v-else /></template>{{ muted ? "取消静音" : "静音" }}
            </SpatialActionButton>
            <input aria-label="音量" type="range" min="0" max="1" step="0.01" :value="volume" @input="setVolume(Number(($event.target as HTMLInputElement).value))" />
            <SpatialActionButton v-if="isVideo" aria-label="全屏" @click="toggleFullscreen">
              <template #icon><Maximize2 /></template>全屏
            </SpatialActionButton>
          </div>
          <p v-if="error" class="spatial-app__banner spatial-app__banner--error" role="alert">{{ error }}</p>
        </div>
        <p v-else class="spatial-app__empty">不支持预览的文件类型：{{ mediaType }}</p>
      </template>
    </main>
  </section>
</template>

<script setup lang="ts">
import { ref } from "vue"
import { Maximize2, Pause, Play, Volume2, VolumeX } from "lucide-vue-next"
import { useWorkspaceMediaController } from "@/controllers/workspace/use-workspace-media-controller"
import SpatialActionButton from "../primitives/SpatialActionButton.vue"
import { useSpatialMediaPlayback } from "./use-spatial-media-playback"
import "../spatial-apps.css"

const props = withDefaults(defineProps<{ cardId?: string; path?: string }>(), { path: "" })
const { loading, loadError, blobUrl, loadedPath, mediaType, isImage, isAudio, isVideo } = useWorkspaceMediaController({ cardId: () => props.cardId, path: () => props.path })
const media = ref<HTMLMediaElement | null>(null)
const { playing, currentTime, duration, volume, muted, error, canSeek, timeLabel, togglePlay, seek, setVolume, toggleMuted, toggleFullscreen } = useSpatialMediaPlayback(media)
</script>

<style scoped>
.spatial-workspace-media { grid-template-rows: auto minmax(0, 1fr); }
.spatial-workspace-media__main { display:grid; min-width:0; min-height:0; padding:14px; place-items:center; overflow:auto; }
.spatial-workspace-media__image,.spatial-workspace-media__video { max-width:100%; max-height:100%; object-fit:contain; }
.spatial-workspace-media__player { display:grid; width:min(100%, 760px); min-height:0; gap:10px; }
.spatial-workspace-media__video { width:100%; min-height:180px; background:var(--spatial-app-surface-strong); opacity:0; }
.spatial-workspace-media__video:fullscreen { max-width:none; max-height:none; background:#000; opacity:1; }
.spatial-workspace-media__controls { display:flex; flex-wrap:wrap; align-items:center; gap:7px; font:10px "JetBrains Mono", monospace; }
.spatial-workspace-media__controls input { min-width:70px; min-height:30px; border:1px solid var(--spatial-app-border-strong); color:var(--spatial-window-ink); background:var(--spatial-app-surface-muted); accent-color:var(--spatial-window-accent); }
</style>
