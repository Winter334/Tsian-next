<template>
  <section class="grid min-h-full grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
    <div class="retro-toolbar flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
          disabled
        >
          <Download class="h-3.5 w-3.5" aria-hidden="true" />
          Install
        </button>
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
          disabled
        >
          <Upload class="h-3.5 w-3.5" aria-hidden="true" />
          Upload
        </button>
      </div>
      <label class="flex min-w-[220px] items-center gap-2 border border-neon-deep/45 bg-elevated px-2 py-1">
        <Search class="h-3.5 w-3.5 text-neon-muted" aria-hidden="true" />
        <input
          type="search"
          disabled
          value=""
          placeholder="Search market"
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
          :class="category === 'All Game Cards'
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
          <h2 class="mt-4 text-xl font-bold text-text-main">App Market</h2>
          <p class="mt-2 text-sm leading-6 text-text-dim">
            Community Game Card discovery will live here. Installed cards are available from My Apps.
          </p>
          <button
            type="button"
            class="retro-button retro-focus mt-5 inline-flex h-9 items-center gap-2 px-3 font-mono text-xs"
            @click="router.push('/library')"
          >
            <FolderOpen class="h-3.5 w-3.5" aria-hidden="true" />
            Open My Apps
          </button>
        </div>
      </section>
    </main>

    <footer class="retro-statusbar flex min-h-9 flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
      <p class="font-mono text-[11px] text-text-dim">0 market items</p>
      <p class="font-mono text-[11px] text-text-dim">Offline catalog</p>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router"
import { Download, FolderOpen, Search, Store, Upload } from "lucide-vue-next"

const router = useRouter()
const categories = ["All Game Cards", "Installed", "Playable", "Templates", "Tools"]
</script>
