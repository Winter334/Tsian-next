<template>
  <section class="spatial-monitor-json">
    <header class="spatial-monitor-json__header">
      <span>{{ label }}</span>
      <div v-if="value !== undefined" class="spatial-monitor-json__actions">
        <SpatialActionButton @click="expandAll">全部展开</SpatialActionButton>
        <SpatialActionButton @click="collapseAll">全部折叠</SpatialActionButton>
        <SpatialActionButton :aria-pressed="wrapLines" @click="wrapLines = !wrapLines">自动换行</SpatialActionButton>
        <SpatialActionButton @click="copyJson">复制 JSON</SpatialActionButton>
      </div>
    </header>
    <div
      v-if="value !== undefined"
      class="spatial-monitor-json__tree"
      role="tree"
      :aria-label="`${label} JSON 树`"
    >
      <SpatialJsonTreeNode
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
    <p v-else class="spatial-app__empty">{{ emptyText }}</p>
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from "vue"
import { toast } from "@/composables/useToast"
import {
  isJsonTreeContainer,
  isLongJsonString,
  jsonTreeEntries,
} from "@/components/debug/json-tree"
import SpatialActionButton from "../primitives/SpatialActionButton.vue"
import SpatialJsonTreeNode from "./SpatialJsonTreeNode.vue"

defineOptions({ name: "SpatialJsonTree" })

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
  const paths = new Set<string>()
  if (isJsonTreeContainer(value)) {
    const rootEntries = jsonTreeEntries(value, "$")
    if (rootEntries.length) paths.add("$")
    for (const entry of rootEntries) {
      if (isJsonTreeContainer(entry.value) && jsonTreeEntries(entry.value, entry.path).length) {
        paths.add(entry.path)
      }
    }
  }
  expandedPaths.value = paths
  expandedStrings.value = new Set()
}

function collectExpandable(
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
  if (entries.length) containerPaths.add(path)
  for (const entry of entries) {
    collectExpandable(entry.value, entry.path, containerPaths, stringPaths)
  }
}

function expandAll(): void {
  const containerPaths = new Set<string>()
  const stringPaths = new Set<string>()
  collectExpandable(props.value, "$", containerPaths, stringPaths)
  expandedPaths.value = containerPaths
  expandedStrings.value = stringPaths
}

function collapseAll(): void {
  expandedPaths.value = new Set()
  expandedStrings.value = new Set()
}

function toggleContainer(path: string): void {
  const next = new Set(expandedPaths.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  expandedPaths.value = next
}

function toggleString(path: string): void {
  const next = new Set(expandedStrings.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  expandedStrings.value = next
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
.spatial-monitor-json {
  display: grid;
  min-width: 0;
  gap: 6px;
  margin-top: 10px;
}

.spatial-monitor-json__header,
.spatial-monitor-json__actions {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 5px;
}

.spatial-monitor-json__header > span {
  color: var(--spatial-app-muted);
  font: 10px "JetBrains Mono", monospace;
  text-transform: uppercase;
}

.spatial-monitor-json__tree {
  max-height: 26rem;
  min-width: 0;
  overflow: auto;
  border: 1px solid var(--spatial-app-border);
  padding: 8px;
  background: color-mix(in srgb, var(--spatial-app-surface) 60%, transparent);
}
</style>
