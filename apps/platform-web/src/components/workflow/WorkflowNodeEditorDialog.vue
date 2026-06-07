<template>
  <div
    v-if="open && selectedNode"
    class="fixed inset-0 z-[70] flex items-center justify-center bg-void/80 p-4 backdrop-blur"
    role="dialog"
    aria-modal="true"
    aria-label="节点配置"
    @click.self="handleClose"
  >
    <section class="flex h-[min(86dvh,900px)] w-[min(980px,calc(100vw-2rem))] flex-col overflow-hidden border border-neon-muted/50 bg-panel shadow-2xl">
      <header class="flex items-center justify-between gap-3 border-b border-neon-muted/30 px-4 py-3">
        <div class="min-w-0">
          <p class="font-mono text-[10px] uppercase tracking-[0.3em] text-neon-muted">
            节点配置
          </p>
          <p class="mt-1 truncate font-mono text-sm font-bold text-text-main">
            {{ selectedNode.data.label || selectedNode.data.nodeType }} // {{ selectedNode.id }}
          </p>
        </div>
        <button
          type="button"
          class="border border-neon-muted/40 bg-elevated px-3 py-1.5 font-mono text-xs text-text-main transition-colors hover:border-neon hover:text-neon"
          @click="handleClose"
        >
          关闭
        </button>
      </header>

      <div class="flex items-center gap-2 border-b border-neon-muted/20 bg-void/40 px-4 py-2">
        <button
          type="button"
          class="border px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors"
          :class="activeTab === 'form'
            ? 'border-neon bg-neon/10 text-neon'
            : 'border-neon-muted/30 bg-panel text-text-dim hover:border-neon-muted hover:text-text-main'"
          @click="activeTab = 'form'"
        >
          表单
        </button>
        <button
          type="button"
          class="border px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors"
          :class="activeTab === 'raw'
            ? 'border-neon bg-neon/10 text-neon'
            : 'border-neon-muted/30 bg-panel text-text-dim hover:border-neon-muted hover:text-text-main'"
          @click="activeTab = 'raw'"
        >
          原始配置
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-hidden">
        <div v-if="activeTab === 'form'" class="h-full overflow-y-auto">
          <NodeInspector
            :node-id="nodeId"
            :nodes="nodes"
            :state-model="stateModel"
            :prompt-preset-options="promptPresetOptions"
            :world-book-options="worldBookOptions"
            :on-update-config="onUpdateConfig"
            :on-update-label="onUpdateLabel"
            :on-update-retry="onUpdateRetry"
            :on-delete-node="handleDeleteNode"
            :on-update-outputs="onUpdateOutputs"
          />
        </div>

        <div v-else class="grid h-full grid-rows-[1fr_auto] overflow-hidden">
          <div class="overflow-hidden p-4">
            <textarea
              v-model="rawText"
              spellcheck="false"
              class="h-full w-full resize-none border border-neon-deep/40 bg-void p-3 font-mono text-xs leading-relaxed text-text-main outline-none focus:border-neon"
            />
          </div>
          <footer class="flex flex-wrap items-center justify-between gap-3 border-t border-neon-muted/20 bg-void/40 px-4 py-3">
            <p
              class="min-w-0 flex-1 font-mono text-xs"
              :class="rawError ? 'text-danger' : 'text-text-dim'"
            >
              {{ rawError || '原始配置包含：label / config / inputs / outputs / retry' }}
            </p>
            <div class="flex gap-2">
              <button
                type="button"
                class="border border-neon-muted/40 bg-elevated px-3 py-1.5 font-mono text-xs text-text-main transition-colors hover:border-neon-muted"
                @click="resetRawText"
              >
                重置
              </button>
              <button
                type="button"
                class="border border-neon bg-neon/10 px-3 py-1.5 font-mono text-xs text-neon transition-colors hover:bg-neon/20"
                @click="applyRawPayload"
              >
                应用原始配置
              </button>
            </div>
          </footer>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
  NodeInputDeclaration,
  NodeOutputDeclaration,
  WorkflowStateModel,
} from '@tsian/contracts'
import NodeInspector from './NodeInspector.vue'

interface WorkflowResourceOption {
  id: string
  name: string
  description?: string
}

type RawPayload = {
  label?: string
  config?: Record<string, unknown>
  inputs?: NodeInputDeclaration[]
  outputs?: NodeOutputDeclaration[]
  retry?: { maxRetries: number } | null
}

const RAW_PAYLOAD_KEYS = new Set(['label', 'config', 'inputs', 'outputs', 'retry'])

const props = defineProps<{
  open: boolean
  nodeId: string | null
  nodes: any[]
  stateModel?: WorkflowStateModel
  promptPresetOptions?: WorkflowResourceOption[]
  worldBookOptions?: WorkflowResourceOption[]
  onUpdateConfig: (nodeId: string, config: Record<string, unknown>) => void
  onUpdateRetry: (nodeId: string, retry: { maxRetries: number } | undefined) => void
  onUpdateInputs: (nodeId: string, inputs: NodeInputDeclaration[]) => void
  onUpdateOutputs: (nodeId: string, outputs: NodeOutputDeclaration[]) => void
  onUpdateLabel: (nodeId: string, label: string) => void
  onDeleteNode: (nodeId: string) => void
  onClose: () => void
}>()

const activeTab = ref<'form' | 'raw'>('form')
const rawText = ref('')
const rawError = ref('')

const selectedNode = computed(() => {
  if (!props.nodeId) return null
  return props.nodes.find((node: any) => node.id === props.nodeId) ?? null
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rawPayloadFromNode(): RawPayload {
  const node = selectedNode.value
  if (!node) {
    return {
      config: {},
      inputs: [],
      outputs: [],
      retry: null,
    }
  }

  return {
    label: typeof node.data.label === 'string' ? node.data.label : '',
    config: isRecord(node.data.config) ? node.data.config : {},
    inputs: Array.isArray(node.data.inputs) ? node.data.inputs : [],
    outputs: Array.isArray(node.data.outputs) ? node.data.outputs : [],
    retry: node.data.retry ?? null,
  }
}

function resetRawText() {
  rawText.value = JSON.stringify(rawPayloadFromNode(), null, 2)
  rawError.value = ''
}

function normalizeRetry(value: unknown): { maxRetries: number } | undefined {
  if (value === null || value === undefined) return undefined
  if (!isRecord(value) || typeof value.maxRetries !== 'number') {
    throw new Error('retry 必须是 { "maxRetries": 数字 } 或 null')
  }
  const maxRetries = Math.max(0, Math.floor(value.maxRetries))
  return maxRetries > 0 ? { maxRetries } : undefined
}

function readRawPayload(): Required<Pick<RawPayload, 'config' | 'inputs' | 'outputs'>> & {
  label: string
  retry?: { maxRetries: number }
} {
  const parsed = JSON.parse(rawText.value) as unknown
  if (!isRecord(parsed)) {
    throw new Error('原始配置必须是 JSON 对象')
  }

  if ('id' in parsed || 'type' in parsed || 'position' in parsed) {
    throw new Error('原始配置不能包含 id / type / position')
  }
  for (const key of Object.keys(parsed)) {
    if (!RAW_PAYLOAD_KEYS.has(key)) {
      throw new Error('原始配置只能包含 label / config / inputs / outputs / retry')
    }
  }

  const label = parsed.label
  if (label !== undefined && label !== null && typeof label !== 'string') {
    throw new Error('label 必须是字符串')
  }

  const config = parsed.config ?? {}
  if (!isRecord(config)) {
    throw new Error('config 必须是 JSON 对象')
  }

  const inputs = parsed.inputs ?? []
  if (!Array.isArray(inputs)) {
    throw new Error('inputs 必须是数组')
  }

  const outputs = parsed.outputs ?? []
  if (!Array.isArray(outputs)) {
    throw new Error('outputs 必须是数组')
  }

  return {
    label: typeof label === 'string' ? label : '',
    config,
    inputs: inputs as NodeInputDeclaration[],
    outputs: outputs as NodeOutputDeclaration[],
    retry: normalizeRetry(parsed.retry),
  }
}

function applyRawPayload() {
  if (!props.nodeId) return
  try {
    const payload = readRawPayload()
    props.onUpdateLabel(props.nodeId, payload.label)
    props.onUpdateConfig(props.nodeId, payload.config)
    props.onUpdateInputs(props.nodeId, payload.inputs)
    props.onUpdateOutputs(props.nodeId, payload.outputs)
    props.onUpdateRetry(props.nodeId, payload.retry)
    rawError.value = ''
    resetRawText()
  } catch (error) {
    rawError.value = error instanceof Error ? error.message : String(error)
  }
}

function handleDeleteNode(nodeId: string) {
  props.onDeleteNode(nodeId)
  props.onClose()
}

function handleClose() {
  props.onClose()
}

watch(
  () => [props.open, props.nodeId, selectedNode.value?.data],
  () => {
    if (!props.open) return
    resetRawText()
    activeTab.value = 'form'
  },
  { immediate: true },
)
</script>
