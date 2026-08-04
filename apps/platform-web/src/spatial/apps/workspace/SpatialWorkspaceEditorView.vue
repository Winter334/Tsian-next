<template>
  <section class="spatial-app spatial-workspace-editor" aria-label="工作区编辑器">
    <header class="spatial-app__header"><div class="spatial-app__identity"><span class="spatial-app__eyebrow">{{ modeLabel }}</span><h1>{{ draftPath || "untitled.txt" }}<span v-if="hasDraftChanges"> *</span></h1></div><div class="spatial-app__commands"><SpatialActionButton v-if="!readOnly" variant="primary" :disabled="loading || saving" @click="saveDraft"><template #icon><Save /></template>{{ saving ? "保存中…" : "保存" }}</SpatialActionButton></div></header>
    <main class="spatial-workspace-editor__body"><p v-if="loading" class="spatial-app__empty">正在打开文件…</p><p v-else-if="loadError" class="spatial-app__banner spatial-app__banner--error">{{ loadError }}</p><WorkspaceCodeEditor v-else v-model="content" variant="spatial" :path="draftPath" :readonly="readOnly" /></main>
    <footer class="spatial-workspace-editor__status" :data-tone="statusKind"><span>{{ statusMessage }}</span><small>{{ mediaTypeLabel }} · {{ content.length }} 字符</small></footer>
  </section>
</template>

<script setup lang="ts">
import { Save } from "lucide-vue-next"
import { useRoute, useRouter } from "vue-router"
import WorkspaceCodeEditor from "@/components/workspace/WorkspaceCodeEditor.vue"
import { useWorkspaceEditorController, type WorkspaceEditorMode } from "@/controllers/workspace/use-workspace-editor-controller"
import SpatialActionButton from "../primitives/SpatialActionButton.vue"
import "../spatial-apps.css"

const props = withDefaults(defineProps<{ cardId?: string; path?: string; mode?: WorkspaceEditorMode; editorId?: string; minimized?: boolean }>(), { path: "", mode: "edit" })
const route = useRoute(); const router = useRouter()
const { draftPath, content, loading, saving, readOnly, loadError, hasDraftChanges, modeLabel, mediaTypeLabel, statusMessage, statusKind, saveDraft } = useWorkspaceEditorController({ cardId: () => props.cardId, path: () => props.path, mode: () => props.mode, editorId: () => props.editorId, minimized: () => props.minimized, route, router })
</script>

<style scoped>
.spatial-workspace-editor { grid-template-rows:auto minmax(0,1fr) auto; }
.spatial-workspace-editor__body { min-width:0; min-height:0; overflow:hidden; }
.spatial-workspace-editor__status { display:flex; min-width:0; min-height:36px; padding:8px 12px; align-items:center; justify-content:space-between; gap:8px; border-top:1px solid var(--spatial-app-border); color:var(--spatial-app-muted); font-size:10px; }
.spatial-workspace-editor__status[data-tone="danger"] { color:var(--spatial-window-accent); }
.spatial-workspace-editor__status[data-tone="success"] { color:var(--spatial-window-ink); }
.spatial-workspace-editor__status span,.spatial-workspace-editor__status small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.spatial-workspace-editor__status small { color:var(--spatial-app-muted); font-family:"JetBrains Mono",monospace; }
</style>
