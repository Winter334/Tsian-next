<template>
  <!-- 平台大厅：平台状态、快速入口与未来玩家信息预留 -->
  <section class="grid gap-6 mt-6">
    <Card class="relative overflow-hidden bg-panel border-neon-deep/40">
      <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(0,240,255,0.16),transparent_32%),linear-gradient(135deg,rgba(0,240,255,0.08),transparent_42%)]" />
      <CardContent class="relative grid gap-6 p-6 md:grid-cols-[1.2fr_0.8fr] md:p-8">
        <div class="grid gap-4 content-center">
          <p class="font-mono text-xs tracking-[0.35em] uppercase text-neon glow-text">
            TSIAN PLATFORM
          </p>
          <div class="grid gap-3">
            <h2 class="max-w-3xl text-4xl font-black tracking-tight text-text-main md:text-5xl">
              此间大厅
            </h2>
            <p class="max-w-2xl text-base leading-relaxed text-text-dim">
              本地运行时、模组入口与平台状态集中在这里。当前原型暂未接入账户系统，玩家档案与平台公告区域先保留为占位。
            </p>
          </div>
        </div>

        <div class="grid content-center gap-3 border border-neon-deep/30 bg-void/60 p-4">
          <div class="flex items-center justify-between gap-3 font-mono text-xs text-text-dim">
            <span>ACTIVE SAVE</span>
            <Badge
              variant="outline"
              class="border-neon-deep/60 text-neon-deep font-mono"
            >
              {{ activeSaveId ? "ONLINE" : "EMPTY" }}
            </Badge>
          </div>
          <div>
            <h3 class="text-xl font-bold text-text-main">{{ activeSaveName }}</h3>
            <p class="mt-1 text-sm text-text-dim">{{ activeSaveMeta }}</p>
          </div>
        </div>
      </CardContent>
    </Card>

    <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card
        class="bg-panel border-neon-deep/40 transition-all"
        :class="activeSaveId ? 'hover:border-neon hover:glow-box' : 'opacity-70'"
      >
        <CardHeader class="pb-3">
          <p class="font-mono text-xs tracking-wider uppercase text-neon-muted">快速入口 01</p>
          <CardTitle class="text-xl text-text-main">继续上次游戏</CardTitle>
        </CardHeader>
        <CardContent class="pt-0">
          <p class="text-sm leading-normal text-text-dim">
            {{ activeSaveId ? "直接进入当前激活存档。" : "暂无可继续的激活存档。" }}
          </p>
        </CardContent>
        <CardFooter>
          <Button
            :disabled="!activeSaveId"
            variant="outline"
            class="border-neon-deep text-neon bg-neon/5 hover:bg-neon/15 hover:shadow-neon-glow transition-all font-mono tracking-wide disabled:cursor-not-allowed disabled:opacity-40"
            @click="continueActiveSave"
          >
            进入游戏
          </Button>
        </CardFooter>
      </Card>

      <Card class="bg-panel border-neon-deep/40 transition-all hover:border-neon hover:glow-box">
        <CardHeader class="pb-3">
          <p class="font-mono text-xs tracking-wider uppercase text-neon-muted">快速入口 02</p>
          <CardTitle class="text-xl text-text-main">进入模组库</CardTitle>
        </CardHeader>
        <CardContent class="pt-0">
          <p class="text-sm leading-normal text-text-dim">
            浏览已获取模组，进入详情页管理该模组自己的存档。
          </p>
        </CardContent>
        <CardFooter>
          <Button
            variant="outline"
            class="border-neon text-neon bg-neon/5 hover:bg-neon/15 hover:shadow-neon-glow transition-all font-mono tracking-wide"
            @click="goModLibrary"
          >
            打开模组库
          </Button>
        </CardFooter>
      </Card>

      <Card class="bg-panel border-neon-deep/40 transition-all hover:border-neon-deep/70">
        <CardHeader class="pb-3">
          <p class="font-mono text-xs tracking-wider uppercase text-neon-muted">快速入口 03</p>
          <CardTitle class="text-xl text-text-main">平台设置</CardTitle>
        </CardHeader>
        <CardContent class="pt-0">
          <p class="text-sm leading-normal text-text-dim">
            配置聊天、检索、嵌入模型与本地检索参数。
          </p>
        </CardContent>
        <CardFooter>
          <Button
            variant="outline"
            class="border-neon-deep text-neon bg-neon/5 hover:bg-neon/15 hover:shadow-neon-glow transition-all font-mono tracking-wide"
            @click="goSettings"
          >
            打开设置
          </Button>
        </CardFooter>
      </Card>
    </div>

    <div class="grid grid-cols-1 gap-4 lg:grid-cols-[0.9fr_1.1fr]">
      <Card class="bg-panel border-neon-deep/40">
        <CardHeader class="pb-3">
          <p class="font-mono text-xs tracking-wider uppercase text-neon glow-text">
            平台状态
          </p>
          <CardTitle class="text-xl text-text-main">本地概览</CardTitle>
        </CardHeader>
        <CardContent class="grid grid-cols-3 gap-3 pt-0">
          <div class="border border-neon-deep/30 bg-elevated/50 p-3">
            <p class="font-mono text-[10px] uppercase tracking-wider text-text-dim">MODS</p>
            <p class="mt-2 font-mono text-2xl font-bold text-neon glow-text">{{ builtinMods.length }}</p>
          </div>
          <div class="border border-neon-deep/30 bg-elevated/50 p-3">
            <p class="font-mono text-[10px] uppercase tracking-wider text-text-dim">SAVES</p>
            <p class="mt-2 font-mono text-2xl font-bold text-neon glow-text">{{ saveOptions.length }}</p>
          </div>
          <div class="border border-neon-deep/30 bg-elevated/50 p-3">
            <p class="font-mono text-[10px] uppercase tracking-wider text-text-dim">ACTIVE</p>
            <p class="mt-2 font-mono text-2xl font-bold text-neon glow-text">{{ activeSaveId ? "1" : "0" }}</p>
          </div>
        </CardContent>
      </Card>

      <Card class="bg-panel border-neon-deep/40">
        <CardHeader class="pb-3">
          <p class="font-mono text-xs tracking-wider uppercase text-neon glow-text">
            预留频道
          </p>
          <CardTitle class="text-xl text-text-main">玩家信息 / 平台公告</CardTitle>
        </CardHeader>
        <CardContent class="grid gap-3 pt-0">
          <div class="border border-dashed border-neon-deep/40 bg-void/50 p-4 crt-scanlines">
            <p class="font-mono text-sm text-text-main">公告系统预留中</p>
            <p class="mt-2 text-sm leading-normal text-text-dim">
              未来账户、玩家身份、平台公告和工坊消息会放在这个区域。当前原型只展示本地运行时状态。
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { ModStaticContent } from "@tsian/contracts"
import { computed, onMounted, ref } from "vue"
import { useRouter } from "vue-router"
import {
  getPlatformActiveSaveId,
  listPlatformSaves,
  playFrontendBridge,
} from "../platform-host"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"

interface BuiltinModSummary {
  id: string
  name: string
}

interface SaveOption {
  id: string
  name: string
  modId: string
  updatedAt: number
}

const router = useRouter()
const builtinMods = ref<BuiltinModSummary[]>([])
const saveOptions = ref<SaveOption[]>([])
const activeSaveId = ref("")

const activeSave = computed(() => saveOptions.value.find((save) => save.id === activeSaveId.value) ?? null)

const activeSaveName = computed(() => activeSave.value?.name ?? "暂无激活存档")

const activeSaveMeta = computed(() => {
  if (!activeSave.value) {
    return "从模组库创建或继续一个存档后，这里会显示当前游玩入口。"
  }
  return `${activeSave.value.modId} · 更新于 ${formatDateTime(activeSave.value.updatedAt)}`
})

async function refreshBuiltinMods() {
  const result = await playFrontendBridge.query.query<ModStaticContent>({
    resource: "builtin-mods",
  })
  builtinMods.value = result.items.map((mod) => ({
    id: mod.manifest.id,
    name: mod.manifest.name,
  }))
}

async function refreshSaves() {
  saveOptions.value = (await listPlatformSaves()).map((save) => ({
    id: save.id,
    name: save.name,
    modId: save.modId,
    updatedAt: save.updatedAt,
  }))
  activeSaveId.value = (await getPlatformActiveSaveId()) ?? ""
}

function formatDateTime(input: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(input)
}

function continueActiveSave() {
  if (!activeSaveId.value) {
    return
  }
  router.push("/play")
}

function goModLibrary() {
  router.push("/mod")
}

function goSettings() {
  router.push("/settings")
}

onMounted(async () => {
  await refreshBuiltinMods()
  await refreshSaves()
})
</script>
