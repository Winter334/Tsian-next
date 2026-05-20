<template>
  <section class="flex min-h-full flex-col">
    <header class="mb-8 border-b-2 border-neon/50 pb-5">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div class="grid gap-2">
          <p class="font-mono text-xs uppercase tracking-[0.35em] text-neon-muted">
            SYS.DIR // RESOURCES
          </p>
          <h2 class="text-3xl font-black uppercase tracking-widest text-text-main md:text-4xl">
            全局资源库
          </h2>
          <p class="max-w-2xl font-mono text-sm leading-relaxed text-text-dim">
            平台级提示词预设、世界书与工作流预设入口。当前仅提供结构占位，后续接入真实资源数据。
          </p>
        </div>
        <Badge
          variant="outline"
          class="w-fit rounded-none border-neon/50 bg-neon/10 px-3 py-1 font-mono text-xs uppercase tracking-wider text-neon"
        >
          {{ activeTab.itemCount }} ITEMS
        </Badge>
      </div>
    </header>

    <div class="flex flex-wrap gap-2 border-b border-neon-muted/30">
      <button
        v-for="tab in resourceTabs"
        :key="tab.id"
        type="button"
        class="border-x border-t px-4 py-2 font-mono text-xs uppercase tracking-wider transition-colors"
        :class="activeTabId === tab.id
          ? 'border-neon bg-neon/10 text-neon glow-box'
          : 'border-neon-muted/30 bg-panel text-text-dim hover:border-neon-muted hover:text-text-main'"
        @click="activeTabId = tab.id"
      >
        {{ tab.label }}
        <span class="ml-2 text-[10px] opacity-60">{{ tab.itemCount }}</span>
      </button>
    </div>

    <div class="flex-1 border-x border-b border-neon-muted/30 bg-panel/40 p-6">
      <div class="grid min-h-80 place-items-center border border-dashed border-neon-muted/30 bg-void/35 p-8 text-center">
        <div class="grid max-w-xl gap-3">
          <p class="font-mono text-xs uppercase tracking-[0.3em] text-neon-muted">
            EMPTY // {{ activeTab.code }}
          </p>
          <h3 class="text-2xl font-black uppercase tracking-widest text-text-main">
            {{ activeTab.label }}
          </h3>
          <p class="font-mono text-sm leading-relaxed text-text-dim">
            {{ activeTab.description }}
          </p>
          <div class="mx-auto mt-3 w-fit border border-neon-muted/40 bg-elevated px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-neon-muted">
            0 ITEMS // WAITING FOR DATA LINK
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue"
import { Badge } from "@/components/ui/badge"

type ResourceTabId = "prompt-presets" | "world-books" | "workflow-presets"

interface ResourceTab {
  id: ResourceTabId
  label: string
  code: string
  description: string
  itemCount: number
}

const resourceTabs: ResourceTab[] = [
  {
    id: "prompt-presets",
    label: "提示词预设",
    code: "PROMPT_PRESETS",
    description: "用于管理可复用的系统提示词、正文提示词与维护提示词预设。",
    itemCount: 0,
  },
  {
    id: "world-books",
    label: "世界书",
    code: "WORLD_BOOKS",
    description: "用于管理跨模组复用的世界观条目、术语与设定片段。",
    itemCount: 0,
  },
  {
    id: "workflow-presets",
    label: "工作流预设",
    code: "WORKFLOW_PRESETS",
    description: "用于管理可复用的 AI 主链 DAG 模板与节点编排预设。",
    itemCount: 0,
  },
]

const activeTabId = ref<ResourceTabId>("prompt-presets")
const activeTab = computed(() => resourceTabs.find((tab) => tab.id === activeTabId.value)!)
</script>
