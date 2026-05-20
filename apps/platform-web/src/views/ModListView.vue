<template>
  <!-- 模组库：玩家已获取模组列表 -->
  <section class="flex min-h-full flex-col">
    <header class="mb-8 border-b-2 border-neon/50 pb-5">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div class="grid gap-2">
          <p class="font-mono text-xs uppercase tracking-[0.35em] text-neon-muted">
            SYS.DIR // MODULES
          </p>
          <h2 class="text-3xl font-black uppercase tracking-widest text-text-main md:text-4xl">
            已获取的模组
          </h2>
          <p class="max-w-2xl font-mono text-sm leading-relaxed text-text-dim">
            选择一个叙事模组进入详情。当前布局为未来封面图与更面向玩家的介绍区域预留结构。
          </p>
        </div>
        <Badge
          variant="outline"
          class="w-fit rounded-none border-neon/50 bg-neon/10 px-3 py-1 font-mono text-xs uppercase tracking-wider text-neon"
        >
          {{ builtinMods.length }} MODS ONLINE
        </Badge>
      </div>
    </header>

    <div class="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
      <Card
        v-for="mod in builtinMods"
        :key="mod.id"
        class="group relative flex cursor-pointer flex-col overflow-hidden rounded-none border-neon-muted/40 bg-panel transition-colors duration-150 hover:border-neon hover:bg-elevated/70 hover:glow-box focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon focus-visible:ring-offset-2 focus-visible:ring-offset-void"
        role="button"
        tabindex="0"
        :aria-label="`查看模组详情：${mod.name}`"
        @click="openModDetail(mod.id)"
        @keydown.enter.prevent="openModDetail(mod.id)"
        @keydown.space.prevent="openModDetail(mod.id)"
      >
        <div class="pointer-events-none absolute inset-x-0 top-0 h-px bg-neon/50 opacity-0 transition-opacity group-hover:opacity-100" />

        <CardHeader class="border-b border-neon-muted/30 bg-void/35 p-4 transition-colors group-hover:bg-void/55">
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <p class="mb-2 truncate font-mono text-[11px] uppercase tracking-wider text-neon-muted">
                {{ mod.id }}
              </p>
              <CardTitle class="text-xl font-black uppercase tracking-wide text-text-main transition-colors group-hover:text-neon group-hover:glow-text">
                {{ mod.name }}
              </CardTitle>
            </div>
            <Badge
              variant="outline"
              class="shrink-0 rounded-none border-neon-muted/50 bg-void/70 font-mono text-[11px] text-neon-muted"
            >
              v{{ mod.version }}
            </Badge>
          </div>
        </CardHeader>

        <CardContent class="flex flex-1 flex-col gap-4 p-4">
          <div class="border border-dashed border-neon-muted/25 bg-void/35 p-3">
            <p class="line-clamp-3 min-h-16 text-sm leading-relaxed text-text-dim">
              {{ mod.description || "当前模组未提供描述。" }}
            </p>
          </div>

          <div class="grid gap-1.5 font-mono text-xs text-text-dim">
            <span>作者：{{ mod.author || "未填写" }}</span>
            <span>存档：{{ countSavesForMod(mod.id) }}</span>
          </div>
        </CardContent>

        <CardFooter class="grid grid-cols-3 border-t border-neon-muted/40 bg-void/45 p-0 font-mono text-[11px] uppercase text-text-dim divide-x divide-neon-muted/30">
          <div class="grid gap-1 px-3 py-3 text-center transition-colors group-hover:bg-neon-muted/10" aria-label="实体类型数量">
            <span class="text-[10px] text-text-dim/70" aria-hidden="true">ENT</span>
            <span class="text-sm font-bold text-neon">{{ mod.entityTypeCount }}</span>
          </div>
          <div class="grid gap-1 px-3 py-3 text-center transition-colors group-hover:bg-neon-muted/10" aria-label="档案数量">
            <span class="text-[10px] text-text-dim/70" aria-hidden="true">ARC</span>
            <span class="text-sm font-bold text-neon">{{ mod.archiveCount }}</span>
          </div>
          <div class="grid gap-1 px-3 py-3 text-center transition-colors group-hover:bg-neon-muted/10" aria-label="预设事件数量">
            <span class="text-[10px] text-text-dim/70" aria-hidden="true">EVT</span>
            <span class="text-sm font-bold text-neon">{{ mod.eventCount }}</span>
          </div>
        </CardFooter>
      </Card>

      <Card
        class="relative flex min-h-72 flex-col items-center justify-center overflow-hidden rounded-none border-2 border-dashed border-neon-muted/45 bg-panel/40 p-6 text-center opacity-80"
        aria-label="创建新模组原型占位，待接入"
        aria-disabled="true"
      >
        <div class="mb-4 grid h-14 w-14 place-items-center border border-neon-muted/50 bg-void/45 text-neon-muted">
          <Plus class="h-7 w-7" />
        </div>
        <p class="font-mono text-xs uppercase tracking-[0.3em] text-neon-muted">
          SYS.NEW // MODULE
        </p>
        <h3 class="mt-3 text-xl font-black uppercase tracking-widest text-text-main">
          原型占位 / 待接入
        </h3>
        <p class="mt-3 max-w-xs font-mono text-sm leading-relaxed text-text-dim">
          创建新模组入口尚未接入；当前卡片是非交互占位，不会跳转也不会写入任何数据。
        </p>
        <span class="mt-4 border border-neon-muted/40 bg-void/55 px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-neon-muted">
          DISABLED // PROTOTYPE
        </span>
      </Card>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { ModStaticContent } from "@tsian/contracts"
import { onMounted, ref } from "vue"
import { useRouter } from "vue-router"
import { Plus } from "lucide-vue-next"
import { listPlatformSaves, playFrontendBridge } from "../platform-host"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"

interface BuiltinModSummary {
  id: string
  name: string
  version: string
  author?: string
  description?: string
  entityTypeCount: number
  archiveCount: number
  eventCount: number
}

interface SaveOption {
  id: string
  modId: string
}

const router = useRouter()
const builtinMods = ref<BuiltinModSummary[]>([])
const saveOptions = ref<SaveOption[]>([])

function countSavesForMod(modId: string): number {
  return saveOptions.value.filter((save) => save.modId === modId).length
}

async function refreshBuiltinMods() {
  const result = await playFrontendBridge.query.query<ModStaticContent>({
    resource: "builtin-mods",
  })
  builtinMods.value = result.items.map((mod) => ({
    id: mod.manifest.id,
    name: mod.manifest.name,
    version: mod.manifest.version,
    author: mod.manifest.author,
    description: mod.manifest.description,
    entityTypeCount: mod.entityTypeDefinitions.length,
    archiveCount: mod.archiveCatalog.length,
    eventCount: mod.eventCatalog.length,
  }))
}

async function refreshSaves() {
  saveOptions.value = (await listPlatformSaves()).map((save) => ({
    id: save.id,
    modId: save.modId,
  }))
}

function openModDetail(modId: string) {
  router.push(`/mod/${modId}`)
}

onMounted(async () => {
  await refreshBuiltinMods()
  await refreshSaves()
})
</script>
