<template>
  <div
    class="spatial-json-node"
    :class="wrapLines ? 'spatial-json-node--wrap' : 'spatial-json-node--nowrap'"
    role="treeitem"
    :aria-level="depth + 1"
  >
    <template v-if="isContainer">
      <div class="spatial-json-node__row">
        <button
          v-if="entries.length"
          type="button"
          class="spatial-json-node__toggle"
          :aria-expanded="isExpanded"
          :aria-label="containerToggleLabel"
          @click="emit('toggle-container', nodePath)"
        >
          {{ isExpanded ? "▾" : "▸" }}
        </button>
        <span v-else class="spatial-json-node__spacer" aria-hidden="true" />
        <span v-if="keyName !== undefined" class="spatial-json-node__prefix">
          <span :class="arrayIndex ? 'spatial-json-node__index' : 'spatial-json-node__key'">{{ formattedKey }}</span>:
        </span>
        <span class="spatial-json-node__muted">
          {{ entries.length === 0 ? emptySummary : isExpanded ? openingBracket : collapsedSummary }}<template v-if="!isExpanded && !isLast">,</template>
        </span>
      </div>
      <template v-if="isExpanded && entries.length">
        <div class="spatial-json-node__children" role="group">
          <SpatialJsonTreeNode
            v-for="(entry, index) in entries"
            :key="entry.path"
            :value="entry.value"
            :node-path="entry.path"
            :key-name="entry.key"
            :array-index="isArray"
            :depth="depth + 1"
            :expanded-paths="expandedPaths"
            :expanded-strings="expandedStrings"
            :wrap-lines="wrapLines"
            :is-last="index === entries.length - 1"
            @toggle-container="emit('toggle-container', $event)"
            @toggle-string="emit('toggle-string', $event)"
          />
        </div>
        <div class="spatial-json-node__row">
          <span class="spatial-json-node__spacer" aria-hidden="true" />
          <span class="spatial-json-node__muted">{{ closingBracket }}<template v-if="!isLast">,</template></span>
        </div>
      </template>
    </template>

    <div v-else class="spatial-json-node__row">
      <span class="spatial-json-node__spacer" aria-hidden="true" />
      <span v-if="keyName !== undefined" class="spatial-json-node__prefix">
        <span :class="arrayIndex ? 'spatial-json-node__index' : 'spatial-json-node__key'">{{ formattedKey }}</span>:
      </span>
      <template v-if="typeof value === 'string'">
        <span class="spatial-json-node__string" :class="wrapLines ? 'spatial-json-node__string--wrap' : ''">{{ displayedString }}</span>
        <button
          v-if="isLongString"
          type="button"
          class="spatial-json-node__expand-string"
          :aria-expanded="isStringExpanded"
          @click="emit('toggle-string', nodePath)"
        >
          {{ isStringExpanded ? "收起" : "展开" }}
        </button>
      </template>
      <span v-else-if="typeof value === 'number'" class="spatial-json-node__number">{{ value }}</span>
      <span v-else-if="typeof value === 'boolean'" class="spatial-json-node__boolean">{{ value }}</span>
      <span v-else class="spatial-json-node__null">{{ value === null ? "null" : String(value) }}</span>
      <span v-if="!isLast" class="spatial-json-node__muted">,</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import {
  JSON_TREE_STRING_PREVIEW_LENGTH,
  isJsonTreeContainer,
  isLongJsonString,
  jsonTreeEntries,
} from "@/components/debug/json-tree"

defineOptions({ name: "SpatialJsonTreeNode" })

const props = withDefaults(defineProps<{
  value: unknown
  nodePath: string
  keyName?: string
  arrayIndex?: boolean
  depth: number
  expandedPaths: ReadonlySet<string>
  expandedStrings: ReadonlySet<string>
  wrapLines: boolean
  isLast?: boolean
}>(), {
  keyName: undefined,
  arrayIndex: false,
  isLast: true,
})

const emit = defineEmits<{
  "toggle-container": [path: string]
  "toggle-string": [path: string]
}>()

const isContainer = computed(() => isJsonTreeContainer(props.value))
const isArray = computed(() => Array.isArray(props.value))
const entries = computed(() => isJsonTreeContainer(props.value)
  ? jsonTreeEntries(props.value, props.nodePath)
  : [])
const isExpanded = computed(() => props.expandedPaths.has(props.nodePath))
const isLongString = computed(() => isLongJsonString(props.value))
const isStringExpanded = computed(() => props.expandedStrings.has(props.nodePath))
const openingBracket = computed(() => isArray.value ? "[" : "{")
const closingBracket = computed(() => isArray.value ? "]" : "}")
const formattedKey = computed(() => props.arrayIndex ? props.keyName : JSON.stringify(props.keyName))
const emptySummary = computed(() => `${isArray.value ? "[]" : "{}"} 0 项`)
const collapsedSummary = computed(() => `${isArray.value ? "[…]" : "{…}"} ${entries.value.length} 项`)
const containerToggleLabel = computed(() => {
  const node = props.keyName === undefined ? "根节点" : `节点 ${props.keyName}`
  return `${isExpanded.value ? "折叠" : "展开"}${node}，${entries.value.length} 项`
})
const displayedString = computed(() => {
  if (typeof props.value !== "string") return ""
  if (!isLongString.value || isStringExpanded.value) return formatExpandedString(props.value)
  const preview = props.value.replace(/\s+/g, " ").trim().slice(0, JSON_TREE_STRING_PREVIEW_LENGTH)
  return JSON.stringify(`${preview}…`)
})

function formatExpandedString(value: string): string {
  let result = "\""
  for (const character of value.replace(/\r\n?/g, "\n")) {
    if (character === "\"") result += "\\\""
    else if (character === "\\") result += "\\\\"
    else if (character === "\n" || character === "\t") result += character
    else if (character.charCodeAt(0) < 0x20) result += `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
    else result += character
  }
  return `${result}\"`
}
</script>

<style scoped>
.spatial-json-node {
  min-width: 0;
  color: var(--spatial-window-ink);
  font: 10px/1.55 "JetBrains Mono", monospace;
}
.spatial-json-node--nowrap { min-width: max-content; }
.spatial-json-node__row { display: flex; min-height: 20px; min-width: 0; align-items: flex-start; }
.spatial-json-node__toggle,.spatial-json-node__spacer { display: grid; width: 20px; height: 20px; flex: 0 0 20px; place-items: center; }
.spatial-json-node__toggle,.spatial-json-node__expand-string { border: 0; color: var(--spatial-window-tab); background: transparent; }
.spatial-json-node__prefix { flex: 0 0 auto; margin-right: 4px; color: var(--spatial-app-muted); }
.spatial-json-node__key { color: #39775a; }
.spatial-json-node__index { color: #65766d; }
.spatial-json-node__string { flex: 0 0 auto; color: #9a681f; white-space: pre; }
.spatial-json-node__string--wrap { min-width: 0; flex: 1 1 auto; overflow-wrap: anywhere; white-space: pre-wrap; }
.spatial-json-node__number { color: #24769b; }
.spatial-json-node__boolean { color: #75539c; }
.spatial-json-node__null,.spatial-json-node__muted { color: var(--spatial-app-muted); }
.spatial-json-node__null { font-style: italic; }
.spatial-json-node__expand-string { flex: 0 0 auto; margin-left: 5px; font-size: 9px; }
.spatial-json-node__children { min-width: 0; margin-left: 10px; border-left: 1px solid var(--spatial-app-border); padding-left: 10px; }
</style>
