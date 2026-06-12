<template>
  <section class="grid gap-6 mt-6">
    <Card class="relative overflow-hidden bg-panel border-neon-deep/40">
      <CardContent class="relative grid gap-6 p-6 md:grid-cols-[1.2fr_0.8fr] md:p-8">
        <div class="grid gap-4 content-center">
          <p class="font-mono text-xs tracking-[0.35em] uppercase text-neon glow-text">
            AGENT RUNTIME
          </p>
          <div class="grid gap-3">
            <h2 class="max-w-3xl text-4xl font-black tracking-tight text-text-main md:text-5xl">
              此间大厅
            </h2>
            <p class="max-w-2xl text-base leading-relaxed text-text-dim">
              当前平台以会话作为存档容器。没有默认模组也可以直接开局，玩家输入会交给主控 Agent 和正文 Agent 生成叙事回复。
            </p>
          </div>
        </div>

        <div class="grid content-center gap-3 border border-neon-deep/30 bg-void/60 p-4">
          <div class="flex items-center justify-between gap-3 font-mono text-xs text-text-dim">
            <span>ACTIVE SESSION</span>
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

    <div class="grid grid-cols-1 gap-4 lg:grid-cols-[0.9fr_1.1fr]">
      <Card class="bg-panel border-neon-deep/40">
        <CardHeader class="pb-3">
          <p class="font-mono text-xs tracking-wider uppercase text-neon-muted">快速入口</p>
          <CardTitle class="text-xl text-text-main">开始 AIRP 会话</CardTitle>
        </CardHeader>
        <CardContent class="grid gap-4 pt-0">
          <div class="grid gap-2">
            <Label class="text-sm text-text-dim font-mono">Session Name</Label>
            <Input
              v-model="newSessionName"
              type="text"
              placeholder="未命名会话"
              class="bg-elevated border-neon-deep/40 text-text-main placeholder:text-text-dim/50 focus:border-neon focus:ring-neon/20"
              @keyup.enter="createSession"
            />
          </div>
          <div class="flex flex-wrap gap-3">
            <Button
              variant="outline"
              class="border-neon text-neon bg-neon/5 hover:bg-neon/15 hover:shadow-neon-glow transition-all font-mono tracking-wide"
              @click="createSession"
            >
              新建并进入
            </Button>
            <Button
              :disabled="!activeSaveId"
              variant="outline"
              class="border-neon-deep text-neon bg-neon/5 hover:bg-neon/15 hover:shadow-neon-glow transition-all font-mono tracking-wide disabled:cursor-not-allowed disabled:opacity-40"
              @click="continueActiveSave"
            >
              继续当前
            </Button>
          </div>
          <p v-if="feedback" class="text-neon bg-neon/10 border border-neon-deep/40 rounded px-3 py-2 text-sm">
            {{ feedback }}
          </p>
        </CardContent>
      </Card>

      <Card class="bg-panel border-neon-deep/40">
        <CardHeader class="pb-3">
          <p class="font-mono text-xs tracking-wider uppercase text-neon glow-text">
            平台状态
          </p>
          <CardTitle class="text-xl text-text-main">本地概览</CardTitle>
        </CardHeader>
        <CardContent class="grid grid-cols-3 gap-3 pt-0">
          <div class="border border-neon-deep/30 bg-elevated/50 p-3">
            <p class="font-mono text-[10px] uppercase tracking-wider text-text-dim">SESSIONS</p>
            <p class="mt-2 font-mono text-2xl font-bold text-neon glow-text">{{ saveOptions.length }}</p>
          </div>
          <div class="border border-neon-deep/30 bg-elevated/50 p-3">
            <p class="font-mono text-[10px] uppercase tracking-wider text-text-dim">ACTIVE</p>
            <p class="mt-2 font-mono text-2xl font-bold text-neon glow-text">{{ activeSaveId ? "1" : "0" }}</p>
          </div>
          <div class="border border-neon-deep/30 bg-elevated/50 p-3">
            <p class="font-mono text-[10px] uppercase tracking-wider text-text-dim">RUNTIME</p>
            <p class="mt-2 font-mono text-2xl font-bold text-neon glow-text">AI</p>
          </div>
        </CardContent>
      </Card>
    </div>

    <Card class="bg-panel border-neon-deep/40">
      <CardHeader class="pb-3">
        <p class="font-mono text-xs tracking-wider uppercase text-neon-muted">sessions</p>
        <CardTitle class="text-xl text-text-main">本地会话</CardTitle>
      </CardHeader>
      <CardContent class="grid gap-3 pt-0">
        <p v-if="saveOptions.length === 0" class="text-sm text-text-dim">
          当前没有本地会话。新建后会进入内容为空的 Agent Runtime 游玩界面。
        </p>
        <div
          v-for="save in saveOptions"
          :key="save.id"
          class="grid gap-3 border border-neon-deep/30 bg-elevated/40 p-3 md:grid-cols-[1fr_auto]"
        >
          <div class="grid gap-1">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="text-base font-bold text-text-main">{{ save.name }}</h3>
              <Badge
                v-if="save.id === activeSaveId"
                variant="outline"
                class="border-neon text-neon font-mono"
              >
                ACTIVE
              </Badge>
            </div>
            <p class="font-mono text-xs text-text-dim">
              {{ save.id }} · 更新于 {{ formatDateTime(save.updatedAt) }}
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              class="border-neon-deep text-neon bg-neon/5 hover:bg-neon/15 font-mono"
              @click="enterSession(save.id)"
            >
              进入
            </Button>
            <Button
              variant="outline"
              class="border-danger/40 text-danger hover:bg-danger/10 font-mono"
              @click="removeSession(save.id)"
            >
              删除
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { useRouter } from "vue-router"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  createPlatformSave,
  deletePlatformSave,
  getPlatformActiveSaveId,
  listPlatformSaves,
  selectPlatformSave,
} from "../platform-host"

interface SaveOption {
  id: string
  name: string
  updatedAt: number
}

const router = useRouter()
const saveOptions = ref<SaveOption[]>([])
const activeSaveId = ref("")
const newSessionName = ref("")
const feedback = ref("")

const activeSave = computed(() => saveOptions.value.find((save) => save.id === activeSaveId.value) ?? null)
const activeSaveName = computed(() => activeSave.value?.name ?? "暂无激活会话")
const activeSaveMeta = computed(() => {
  if (!activeSave.value) {
    return "新建会话后即可进入内容为空的 AIRP 运行时。"
  }
  return `更新于 ${formatDateTime(activeSave.value.updatedAt)}`
})

async function refreshSaves() {
  saveOptions.value = (await listPlatformSaves()).map((save) => ({
    id: save.id,
    name: save.name,
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

async function createSession() {
  const created = await createPlatformSave({
    name: newSessionName.value,
  })
  newSessionName.value = ""
  feedback.value = `已创建会话：${created.name}`
  await refreshSaves()
  router.push("/play")
}

function continueActiveSave() {
  if (!activeSaveId.value) {
    return
  }
  router.push("/play")
}

async function enterSession(saveId: string) {
  await selectPlatformSave(saveId)
  await refreshSaves()
  router.push("/play")
}

async function removeSession(saveId: string) {
  await deletePlatformSave(saveId)
  feedback.value = "会话已删除。"
  await refreshSaves()
}

onMounted(async () => {
  await refreshSaves()
})
</script>
