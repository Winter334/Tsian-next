<template>
  <!-- 模组库：玩家已获取模组列表 -->
  <section class="grid gap-6 mt-6">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div class="grid gap-2">
        <p class="font-mono text-xs tracking-wider uppercase text-neon glow-text">
          模组库
        </p>
        <h2 class="text-2xl font-bold text-text-main">已获取的模组</h2>
        <p class="text-base text-text-dim leading-normal">
          选择一个模组查看详情与管理该模组自己的存档。
        </p>
      </div>
      <Badge
        variant="outline"
        class="border-neon-deep/60 text-neon-deep font-mono"
      >
        {{ builtinMods.length }} MODS
      </Badge>
    </div>

    <div v-if="builtinMods.length > 0" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      <Card
        v-for="mod in builtinMods"
        :key="mod.id"
        class="group cursor-pointer bg-panel border-neon-deep/40 transition-all hover:border-neon hover:glow-box focus-within:border-neon focus-within:glow-box"
        role="button"
        tabindex="0"
        @click="openModDetail(mod.id)"
        @keydown.enter.prevent="openModDetail(mod.id)"
        @keydown.space.prevent="openModDetail(mod.id)"
      >
        <CardHeader class="pb-3">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="font-mono text-xs tracking-wider uppercase text-neon-muted mb-1">
                {{ mod.id }}
              </p>
              <CardTitle class="text-xl text-text-main transition-colors group-hover:text-neon group-hover:glow-text">
                {{ mod.name }}
              </CardTitle>
            </div>
            <Badge
              variant="outline"
              class="border-neon-deep/60 text-neon-deep font-mono shrink-0"
            >
              v{{ mod.version }}
            </Badge>
          </div>
        </CardHeader>

        <CardContent class="grid gap-3 pt-0">
          <p class="text-text-dim leading-normal min-h-12">
            {{ mod.description || "当前模组未提供描述。" }}
          </p>

          <div class="grid gap-1.5">
            <span class="text-xs text-text-dim font-mono">作者：{{ mod.author || "未填写" }}</span>
            <span class="text-xs text-text-dim font-mono">存档：{{ countSavesForMod(mod.id) }}</span>
            <span class="text-xs text-text-dim font-mono">实体类型：{{ mod.entityTypeCount }}</span>
            <span class="text-xs text-text-dim font-mono">预设事件：{{ mod.eventCount }}</span>
          </div>
        </CardContent>

        <CardFooter>
          <span class="font-mono text-xs tracking-wider text-neon transition-transform group-hover:translate-x-1">
            查看详情 →
          </span>
        </CardFooter>
      </Card>
    </div>

    <Card v-else class="bg-panel border-neon-deep/40">
      <CardContent class="py-10 text-center">
        <h4 class="text-lg font-bold text-text-main mb-2">尚未获取模组</h4>
        <p class="text-text-dim">模组导入与工坊获取能力预留中。</p>
      </CardContent>
    </Card>
  </section>
</template>

<script setup lang="ts">
import type { ModStaticContent } from "@tsian/contracts"
import { onMounted, ref } from "vue"
import { useRouter } from "vue-router"
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
