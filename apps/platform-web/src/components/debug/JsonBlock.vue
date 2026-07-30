<template>
  <section class="grid min-w-0 gap-1.5">
    <header class="flex min-w-0 flex-wrap items-center justify-between gap-2">
      <p class="font-mono text-[10px] uppercase tracking-wider text-text-dim">{{ label }}</p>
      <div v-if="value !== undefined" class="flex flex-wrap items-center gap-1">
        <button type="button" class="json-tree-action retro-focus" @click="expandAll">全部展开</button>
        <button type="button" class="json-tree-action retro-focus" @click="collapseAll">全部折叠</button>
        <button
          type="button"
          class="json-tree-action retro-focus"
          :class="{ 'border-neon/45 text-neon': wrapLines }"
          :aria-pressed="wrapLines"
          @click="wrapLines = !wrapLines"
        >
          自动换行
        </button>
        <button type="button" class="json-tree-action retro-focus" @click="copyJson">复制 JSON</button>
      </div>
    </header>

    <div
      v-if="value !== undefined"
      class="max-h-[34rem] min-w-0 overflow-auto border border-neon-deep/25 bg-black/20 p-2"
      role="tree"
      :aria-label="`${label} JSON 树`"
    >
      <JsonTreeNode
        :value="value"
        node-path="$"
        :depth="0"
        :expanded-paths="expandedPaths"
        :expanded-strings="expandedStrings"
        :wrap-lines="wrapLines"
        @toggle-container="toggleContainer"
        @toggle-string="toggleString"
      />
    </div>
    <p v-else class="text-xs text-text-dim">{{ emptyText }}</p>
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from "vue"
import { toast } from "@/composables/useToast"
import JsonTreeNode from "./JsonTreeNode.vue"
import {
  isJsonTreeContainer,
  isLongJsonString,
  jsonTreeEntries,
} from "./json-tree"

const props = withDefaults(defineProps<{
  label: string
  value?: unknown
  emptyText?: string
}>(), {
  value: undefined,
  emptyText: "无",
})

const expandedPaths = ref<ReadonlySet<string>>(new Set())
const expandedStrings = ref<ReadonlySet<string>>(new Set())
const wrapLines = ref(true)

watch(() => props.value, resetExpansion, { immediate: true })

function resetExpansion(value: unknown): void {
  const defaultPaths = new Set<string>()
  if (isJsonTreeContainer(value)) {
    const rootEntries = jsonTreeEntries(value, "$")
    if (rootEntries.length > 0) defaultPaths.add("$")
    for (const entry of rootEntries) {
      if (isJsonTreeContainer(entry.value) && jsonTreeEntries(entry.value, entry.path).length > 0) {
        defaultPaths.add(entry.path)
      }
    }
  }
  expandedPaths.value = defaultPaths
  expandedStrings.value = new Set()
}

function collectExpandableNodes(
  value: unknown,
  path: string,
  containerPaths: Set<string>,
  stringPaths: Set<string>,
): void {
  if (isLongJsonString(value)) {
    stringPaths.add(path)
    return
  }
  if (!isJsonTreeContainer(value)) return
  const entries = jsonTreeEntries(value, path)
  if (entries.length > 0) containerPaths.add(path)
  for (const entry of entries) {
    collectExpandableNodes(entry.value, entry.path, containerPaths, stringPaths)
  }
}

function expandAll(): void {
  const containerPaths = new Set<string>()
  const stringPaths = new Set<string>()
  collectExpandableNodes(props.value, "$", containerPaths, stringPaths)
  expandedPaths.value = containerPaths
  expandedStrings.value = stringPaths
}

function collapseAll(): void {
  expandedPaths.value = new Set()
  expandedStrings.value = new Set()
}

function toggleContainer(path: string): void {
  const nextPaths = new Set(expandedPaths.value)
  if (nextPaths.has(path)) nextPaths.delete(path)
  else nextPaths.add(path)
  expandedPaths.value = nextPaths
}

function toggleString(path: string): void {
  const nextPaths = new Set(expandedStrings.value)
  if (nextPaths.has(path)) nextPaths.delete(path)
  else nextPaths.add(path)
  expandedStrings.value = nextPaths
}

async function copyJson(): Promise<void> {
  try {
    const json = JSON.stringify(props.value, null, 2)
    if (json === undefined) throw new Error("JSON value is undefined")
    await navigator.clipboard.writeText(json)
    toast.success("已复制完整 JSON。")
  } catch {
    toast.error("复制失败，请重试。")
  }
}
</script>

<style scoped>
.json-tree-action {
  height: 1.65rem;
  border: 1px solid rgb(51 102 80 / 0.35);
  padding: 0 0.45rem;
  color: var(--color-text-dim, #a7aa9d);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.625rem;
  transition: border-color 0.15s ease, color 0.15s ease, background-color 0.15s ease;
}

.json-tree-action:hover {
  border-color: rgb(94 224 139 / 0.55);
  color: var(--color-neon, #5ee08b);
  background: rgb(94 224 139 / 0.06);
}
</style>
