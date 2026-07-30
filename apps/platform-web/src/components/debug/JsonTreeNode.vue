<template>
  <div
    class="json-node min-w-0 font-mono text-[10px] leading-5"
    :class="wrapLines ? 'w-full' : 'min-w-max'"
    role="treeitem"
    :aria-level="depth + 1"
  >
    <template v-if="isContainer">
      <div class="flex min-h-5 min-w-0 items-start">
        <button
          v-if="entries.length > 0"
          type="button"
          class="retro-focus grid h-5 w-5 shrink-0 place-items-center text-text-dim transition-colors hover:text-neon"
          :aria-expanded="isExpanded"
          :aria-label="containerToggleLabel"
          :title="containerToggleLabel"
          @click="emit('toggle-container', nodePath)"
        >
          <ChevronRight
            class="h-3 w-3 transition-transform"
            :class="{ 'rotate-90': isExpanded }"
            aria-hidden="true"
          />
        </button>
        <span v-else class="h-5 w-5 shrink-0" aria-hidden="true" />

        <span v-if="keyName !== undefined" class="shrink-0">
          <span :class="arrayIndex ? 'json-index' : 'json-key'">{{ formattedKey }}</span><span class="text-text-dim">: </span>
        </span>

        <span v-if="entries.length === 0" class="text-text-dim">{{ emptySummary }}</span>
        <span v-else-if="isExpanded" class="text-text-dim">{{ openingBracket }}</span>
        <span v-else class="text-text-dim">{{ collapsedSummary }}</span>
        <span v-if="!isExpanded && !isLast" class="text-text-dim">,</span>
      </div>

      <template v-if="isExpanded && entries.length > 0">
        <div class="ml-2.5 min-w-0 border-l border-neon-deep/30 pl-2.5" role="group">
          <JsonTreeNode
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
            @toggle-container="forwardContainerToggle"
            @toggle-string="forwardStringToggle"
          />
        </div>
        <div class="flex min-h-5 min-w-0 items-start">
          <span class="h-5 w-5 shrink-0" aria-hidden="true" />
          <span class="text-text-dim">{{ closingBracket }}<template v-if="!isLast">,</template></span>
        </div>
      </template>
    </template>

    <div v-else class="flex min-h-5 min-w-0 items-start">
      <span class="h-5 w-5 shrink-0" aria-hidden="true" />
      <span v-if="keyName !== undefined" class="shrink-0">
        <span :class="arrayIndex ? 'json-index' : 'json-key'">{{ formattedKey }}</span><span class="text-text-dim">: </span>
      </span>

      <template v-if="typeof value === 'string'">
        <span
          class="json-string min-w-0"
          :class="[
            wrapLines ? 'flex-1 whitespace-pre-wrap break-words' : 'shrink-0 whitespace-pre',
            isLongString && isStringExpanded ? 'inline-block max-h-56 overflow-auto' : '',
          ]"
        >{{ displayedString }}</span>
        <button
          v-if="isLongString"
          type="button"
          class="retro-focus ml-1.5 shrink-0 px-1 text-[9px] text-neon-muted hover:text-neon"
          :aria-expanded="isStringExpanded"
          :aria-label="isStringExpanded ? '收起长字符串' : '展开长字符串'"
          @click="emit('toggle-string', nodePath)"
        >
          {{ isStringExpanded ? "收起" : "展开" }}
        </button>
      </template>
      <span v-else-if="typeof value === 'number'" class="json-number">{{ value }}</span>
      <span v-else-if="typeof value === 'boolean'" class="json-boolean">{{ value }}</span>
      <span v-else-if="value === null" class="json-null">null</span>
      <span v-else class="json-null">{{ String(value) }}</span>
      <span v-if="!isLast" class="text-text-dim">,</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { ChevronRight } from "lucide-vue-next"
import {
  JSON_TREE_STRING_PREVIEW_LENGTH,
  isJsonTreeContainer,
  isLongJsonString,
  jsonTreeEntries,
} from "./json-tree"

defineOptions({ name: "JsonTreeNode" })

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
  (event: "toggle-container", path: string): void
  (event: "toggle-string", path: string): void
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
  const keyDescription = props.keyName === undefined ? "根节点" : `节点 ${props.keyName}`
  const action = isExpanded.value ? "折叠" : "展开"
  return `${action}${keyDescription}，${entries.value.length} 项`
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

function forwardContainerToggle(path: string): void {
  emit("toggle-container", path)
}

function forwardStringToggle(path: string): void {
  emit("toggle-string", path)
}
</script>

<style scoped>
.json-key {
  color: #9dd8b2;
}

.json-index {
  color: #7f9b8b;
}

.json-string {
  color: #f3c56d;
}

.json-number {
  color: #83c5e8;
}

.json-boolean {
  color: #d9a7f2;
}

.json-null {
  color: #a7aa9d;
  font-style: italic;
}
</style>
