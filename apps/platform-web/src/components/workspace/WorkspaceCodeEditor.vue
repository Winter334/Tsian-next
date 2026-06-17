<template>
  <div ref="editorRoot" class="workspace-code-editor" />
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { basicSetup, EditorView } from "codemirror"
import { Compartment, type Extension } from "@codemirror/state"
import { json } from "@codemirror/lang-json"
import { markdown } from "@codemirror/lang-markdown"
import { javascript } from "@codemirror/lang-javascript"
import { css } from "@codemirror/lang-css"
import { html } from "@codemirror/lang-html"
import { yaml } from "@codemirror/lang-yaml"

const props = defineProps<{
  modelValue: string
  path?: string
  mediaType?: string
  readonly?: boolean
}>()

const emit = defineEmits<{
  "update:modelValue": [value: string]
}>()

const editorRoot = ref<HTMLElement | null>(null)
const languageCompartment = new Compartment()
const editableCompartment = new Compartment()
let editorView: EditorView | null = null
let applyingExternalUpdate = false

const normalizedPath = computed(() => props.path?.toLowerCase() ?? "")
const normalizedMediaType = computed(() => props.mediaType?.toLowerCase() ?? "")

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "#101411",
    color: "#f6ecd7",
    fontSize: "12px",
  },
  ".cm-scroller": {
    fontFamily: "\"JetBrains Mono\", ui-monospace, SFMono-Regular, Menlo, monospace",
    lineHeight: "1.62",
  },
  ".cm-content": {
    caretColor: "#f3c56d",
    padding: "14px 0",
  },
  ".cm-gutters": {
    backgroundColor: "#171d18",
    color: "rgba(246, 236, 215, 0.44)",
    borderRight: "1px solid rgba(115, 140, 104, 0.45)",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(243, 197, 109, 0.08)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "rgba(243, 197, 109, 0.12)",
    color: "#f3c56d",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "rgba(243, 197, 109, 0.24)",
  },
  "&.cm-focused": {
    outline: "1px solid rgba(243, 197, 109, 0.72)",
  },
}, { dark: true })

function languageExtension(): Extension {
  const path = normalizedPath.value
  const mediaType = normalizedMediaType.value

  if (path.endsWith(".json") || mediaType.includes("json")) {
    return json()
  }
  if (path.endsWith(".md") || path.endsWith(".markdown") || mediaType.includes("markdown")) {
    return markdown()
  }
  if (
    path.endsWith(".ts")
    || path.endsWith(".tsx")
    || mediaType.includes("typescript")
  ) {
    return javascript({ typescript: true, jsx: path.endsWith(".tsx") })
  }
  if (
    path.endsWith(".js")
    || path.endsWith(".mjs")
    || path.endsWith(".cjs")
    || path.endsWith(".jsx")
    || mediaType.includes("javascript")
  ) {
    return javascript({ jsx: path.endsWith(".jsx") })
  }
  if (path.endsWith(".css") || mediaType.includes("css")) {
    return css()
  }
  if (path.endsWith(".html") || path.endsWith(".htm") || mediaType.includes("html")) {
    return html()
  }
  if (
    path.endsWith(".yaml")
    || path.endsWith(".yml")
    || mediaType.includes("yaml")
    || mediaType.includes("yml")
  ) {
    return yaml()
  }

  return []
}

function editableExtensions(): Extension {
  return [
    EditorView.editable.of(!props.readonly),
    EditorView.contentAttributes.of({
      spellcheck: "false",
      autocapitalize: "off",
      autocomplete: "off",
    }),
  ]
}

function createEditor() {
  if (!editorRoot.value) {
    return
  }

  editorView = new EditorView({
    parent: editorRoot.value,
    doc: props.modelValue,
    extensions: [
      basicSetup,
      editorTheme,
      languageCompartment.of(languageExtension()),
      editableCompartment.of(editableExtensions()),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || applyingExternalUpdate) {
          return
        }

        emit("update:modelValue", update.state.doc.toString())
      }),
    ],
  })
}

watch(() => props.modelValue, (value) => {
  if (!editorView) {
    return
  }

  const currentValue = editorView.state.doc.toString()
  if (currentValue === value) {
    return
  }

  applyingExternalUpdate = true
  editorView.dispatch({
    changes: {
      from: 0,
      to: currentValue.length,
      insert: value,
    },
  })
  applyingExternalUpdate = false
})

watch([normalizedPath, normalizedMediaType], () => {
  editorView?.dispatch({
    effects: languageCompartment.reconfigure(languageExtension()),
  })
})

watch(() => props.readonly, () => {
  editorView?.dispatch({
    effects: editableCompartment.reconfigure(editableExtensions()),
  })
})

onMounted(() => {
  createEditor()
})

onBeforeUnmount(() => {
  editorView?.destroy()
  editorView = null
})
</script>

<style scoped>
.workspace-code-editor {
  min-height: 0;
  height: 100%;
  overflow: hidden;
}
</style>
