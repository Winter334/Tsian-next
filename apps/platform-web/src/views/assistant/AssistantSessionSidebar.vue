<template>
  <aside class="flex min-h-0 flex-col border-r border-neon-deep/30 bg-[#2a271f]">
    <div class="flex items-center justify-between border-b border-neon-deep/25 px-3 py-2.5">
      <p class="font-mono text-[10px] uppercase tracking-wider text-text-dim">会话</p>
      <button
        type="button"
        class="retro-focus grid h-6 w-6 place-items-center border border-neon-deep/40 bg-panel/50 text-text-dim transition-colors hover:border-neon/55 hover:text-neon"
        :disabled="sessionCreating"
        title="新建会话"
        @click="$emit('create')"
      >
        <Plus v-if="!sessionCreating" class="h-3.5 w-3.5" aria-hidden="true" />
        <Loader2 v-else class="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      </button>
    </div>

    <div class="min-h-0 flex-1 overflow-auto py-1">
      <div
        v-for="session in sessions"
        :key="session.id"
        class="group relative flex items-center transition-colors"
        :class="session.id === activeSessionId ? 'bg-neon/10' : 'hover:bg-panel/40'"
      >
        <button
          type="button"
          class="retro-focus min-w-0 flex-1 px-3 py-2 text-left"
          :class="session.id === activeSessionId ? 'text-neon' : 'text-text-dim group-hover:text-text-main'"
          @click="$emit('select', session.id)"
        >
          <span class="flex items-center gap-1.5">
            <Loader2
              v-if="runningSessionIds.has(session.id)"
              class="h-3 w-3 shrink-0 animate-spin text-neon"
              title="生成中"
              aria-label="生成中"
            />
            <span class="block truncate text-xs font-bold">{{ session.title }}</span>
          </span>
          <span class="mt-0.5 block font-mono text-[10px] text-text-dim/80">
            {{ formatSessionTime(session.updatedAt) }}
            <span v-if="runningSessionIds.has(session.id) && session.id !== activeSessionId" class="text-neon">· 后台生成中</span>
          </span>
        </button>
        <div
          class="flex shrink-0 items-center gap-1 pr-2 transition-opacity"
          :class="session.id === activeSessionId ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
        >
          <button
            type="button"
            class="retro-focus grid h-6 w-6 place-items-center border border-neon-deep/40 bg-panel/50 text-text-dim transition-colors hover:border-neon/55 hover:text-neon"
            :disabled="sessionRenaming"
            title="重命名会话"
            @click.stop="$emit('startRename', session.id)"
          >
            <Pencil class="h-3 w-3" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="retro-focus grid h-6 w-6 place-items-center border border-danger/40 bg-danger/8 text-danger/85 transition-colors hover:bg-danger/20 hover:text-danger"
            :disabled="sessionDeleting"
            title="删除会话"
            @click.stop="$emit('delete', session.id)"
          >
            <Trash2 class="h-3 w-3" aria-hidden="true" />
          </button>
        </div>
        <span
          v-if="session.id === activeSessionId"
          class="absolute inset-y-1 left-0 w-0.5 bg-neon"
          aria-hidden="true"
        />
      </div>
      <p
        v-if="sessions.length === 0 && !sessionCreating"
        class="px-3 py-6 text-center text-xs text-text-dim/70"
      >
        暂无会话
      </p>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { Loader2, Pencil, Plus, Trash2 } from "lucide-vue-next"
import type { AssistantSessionSummary } from "@/storage"
import { formatSessionTime } from "./format"

defineProps<{
  sessions: AssistantSessionSummary[]
  activeSessionId: string | null
  runningSessionIds: Set<string>
  sessionCreating: boolean
  sessionRenaming: boolean
  sessionDeleting: boolean
}>()

defineEmits<{
  create: []
  select: [id: string]
  startRename: [id: string]
  delete: [id: string]
}>()
</script>
