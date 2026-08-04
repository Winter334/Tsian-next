<template>
  <section class="grid h-full grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
    <div class="retro-toolbar flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
      <div class="min-w-0">
        <p class="font-mono text-xs uppercase tracking-wider text-neon">{{ modeLabel }}</p>
        <h1 class="mt-1 truncate text-sm font-bold text-text-main">{{ draftPath || "untitled.txt" }}<span v-if="hasDraftChanges" class="text-neon">*</span></h1>
      </div>
      <button v-if="!readOnly" type="button" class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs" :disabled="loading || saving" @click="saveDraft"><Save class="h-3.5 w-3.5" aria-hidden="true" />{{ saving ? "保存中" : "保存" }}</button>
    </div>
    <main class="min-h-0 overflow-hidden bg-[#101411]">
      <div v-if="loading" class="grid h-full place-items-center"><p class="font-mono text-xs uppercase tracking-[0.22em] text-neon">正在打开文件</p></div>
      <div v-else-if="loadError" class="grid h-full place-items-center p-4"><div class="max-w-lg border border-danger/40 bg-danger/10 p-4"><p class="font-mono text-xs uppercase tracking-wider text-danger">文件不可用</p><p class="mt-2 text-sm leading-6 text-text-dim">{{ loadError }}</p></div></div>
      <WorkspaceCodeEditor v-else v-model="content" :path="draftPath" :readonly="readOnly" />
    </main>
    <footer class="retro-statusbar grid min-h-9 gap-2 border-t px-3 py-2 lg:grid-cols-[1fr_auto] lg:items-center"><p class="min-w-0 truncate text-sm" :class="statusTone">{{ statusMessage }}</p><p class="font-mono text-[11px] text-text-dim">{{ mediaTypeLabel }} · {{ content.length }} 字符</p></footer>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { Save } from "lucide-vue-next"
import { useRoute, useRouter } from "vue-router"
import WorkspaceCodeEditor from "@/components/workspace/WorkspaceCodeEditor.vue"
import { useWorkspaceEditorController, type WorkspaceEditorMode } from "@/controllers/workspace/use-workspace-editor-controller"

const props = withDefaults(defineProps<{ cardId?: string; path?: string; mode?: WorkspaceEditorMode; editorId?: string; minimized?: boolean }>(), { path: "", mode: "edit" })
const route = useRoute()
const router = useRouter()
const { draftPath, content, loading, saving, readOnly, loadError, hasDraftChanges, modeLabel, mediaTypeLabel, statusMessage, statusKind, saveDraft } = useWorkspaceEditorController({
  cardId: () => props.cardId,
  path: () => props.path,
  mode: () => props.mode,
  editorId: () => props.editorId,
  minimized: () => props.minimized,
  route,
  router,
})
const statusTone = computed(() => ({
  danger: "text-danger",
  success: "text-neon",
  muted: "text-text-dim",
})[statusKind.value])
</script>
