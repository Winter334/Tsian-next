<template>
  <!-- 外层容器：适配父容器 h-full/flex -->
  <section class="flex h-full flex-col overflow-hidden">
    <!-- 三栏主体（全高） -->
    <div class="flex flex-1 overflow-hidden">
      <!-- 左栏：节点面板 Palette（readonly 时隐藏） -->
      <aside v-if="!props.readonly" class="flex w-56 flex-col border-r border-neon-deep/40 bg-panel">
        <div class="border-b border-neon-deep/40 p-3">
          <p class="font-mono text-xs uppercase tracking-wider text-neon-muted">
            节点面板
          </p>
        </div>
        <div class="flex-1 space-y-2 overflow-y-auto p-3">
          <div
            v-for="info in nodeTypeRegistry"
            :key="info.type"
            class="flex cursor-grab items-center gap-2 border border-neon-deep/30 bg-elevated p-2 transition-colors hover:border-neon-deep/60 active:cursor-grabbing"
            draggable="true"
            @dragstart="onDragStart($event, info.type)"
          >
            <component
              :is="paletteIcons[info.icon]"
              class="h-4 w-4 shrink-0"
              :style="{ color: info.color }"
            />
            <div class="min-w-0 flex-1">
              <p class="truncate text-xs font-semibold text-text-main">
                {{ info.label }}
              </p>
              <p class="truncate text-[10px] text-text-dim">
                {{ info.description }}
              </p>
            </div>
          </div>
        </div>
        <!-- 导入导出按钮 -->
        <div class="space-y-2 border-t border-neon-deep/40 p-3">
          <button
            type="button"
            class="w-full border border-neon-deep/40 bg-elevated px-3 py-1.5 font-mono text-xs text-text-main transition-colors hover:border-neon-deep/60 hover:text-neon"
            @click="exportToJson"
          >
            导出 JSON
          </button>
          <button
            type="button"
            class="w-full border border-neon-deep/40 bg-elevated px-3 py-1.5 font-mono text-xs text-text-main transition-colors hover:border-neon-deep/60 hover:text-neon"
            @click="handleImport"
          >
            导入 JSON
          </button>
        </div>
      </aside>

      <!-- 中栏：工具栏 + Vue Flow 画布 -->
      <div class="relative flex flex-1 flex-col">
        <!-- 编辑模式工具栏 -->
        <EditorToolbar
          v-if="!props.readonly"
          :has-selection="!!selectedNodeId"
          :save-status="props.saveStatus"
          :source-label="props.sourceLabel"
          @auto-layout="autoLayout"
          @delete-selected="removeSelected"
          @clear-canvas="clearCanvas"
          @reset-workflow="$emit('resetWorkflow')"
          @save-workflow="emit('saveWorkflow', toWorkflowDefinition())"
        />
        <!-- readonly 模式极简工具栏 -->
        <div
          v-if="props.readonly"
          class="flex items-center gap-2 border-b border-neon-deep/40 bg-panel px-3 py-1.5"
        >
          <span class="mr-2 font-mono text-[10px] uppercase tracking-[0.2em] text-neon-muted">
            SYS // PREVIEW
          </span>
          <span
            v-if="props.sourceLabel"
            class="border border-neon-deep/30 bg-void px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-neon"
          >
            {{ props.sourceLabel }}
          </span>
          <span class="border border-neon-deep/30 bg-void px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-dim">
            {{ nodes.length }} 节点 / {{ edges.length }} 边
          </span>
          <span class="flex-1" />
          <button
            type="button"
            class="border border-neon-deep/40 bg-elevated px-3 py-1 font-mono text-xs text-text-main transition-colors hover:border-neon-deep/60 hover:text-neon"
            @click="autoLayout"
          >
            自动布局
          </button>
        </div>
        <div class="relative flex-1">
          <VueFlow
            v-model:nodes="nodes"
            v-model:edges="edges"
            :node-types="nodeTypes"
            :edge-types="edgeTypes"
            :nodes-draggable="!props.readonly"
            :nodes-connectable="!props.readonly"
            :elements-selectable="!props.readonly"
            fit-view-on-init
            class="workflow-canvas"
            @node-click="onNodeClick"
            @edge-click="onEdgeClick"
            @pane-click="onPaneClick"
            @connect="!props.readonly && onConnect($event)"
            @dragover.prevent="!props.readonly && onDragOver($event)"
            @drop="!props.readonly && onDrop($event)"
          >
            <Background :gap="20" :size="1" pattern-color="#1C2633" />
            <MiniMap
              position="bottom-right"
              :node-color="miniMapNodeColor"
              class="!bg-panel !border !border-neon-deep/40"
            />
            <Controls
              position="bottom-left"
              class="!bg-panel !border !border-neon-deep/40"
            />
          </VueFlow>
          <!-- 校验浮动条（左上角，避开左下角 Controls） -->
          <ValidationBar
            v-if="!props.readonly"
            :errors="validationErrors"
            :node-count="nodes.length"
            :edge-count="edges.length"
            class="absolute left-2 top-2 z-10"
          />
        </div>
      </div>

      <!-- 右栏：节点属性检查器（readonly 时隐藏） -->
      <aside v-if="!props.readonly" class="flex w-80 shrink-0 flex-col border-l border-neon-deep/40 bg-panel">
        <NodeInspector
          v-if="selectedNodeId"
          :node-id="selectedNodeId"
          :nodes="nodes"
          :prompt-preset-options="props.promptPresetOptions"
          :world-book-options="props.worldBookOptions"
          :on-update-config="updateNodeConfig"
          :on-update-label="updateNodeLabel"
          :on-update-retry="updateNodeRetry"
          :on-delete-node="handleDeleteNode"
          :on-update-outputs="updateNodeOutputs"
        />
        <div v-else-if="selectedEdge" class="flex h-full flex-col overflow-hidden">
          <div class="border-b border-neon-deep/40 p-3">
            <p class="font-mono text-xs font-bold uppercase text-text-main">
              边属性
            </p>
            <p class="mt-1 break-all font-mono text-[10px] text-text-dim">
              {{ selectedEdge.source }} → {{ selectedEdge.target }}
            </p>
          </div>
          <div class="flex-1 space-y-4 overflow-y-auto p-3">
            <div>
              <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
                输入变量名 varName
              </label>
              <input
                type="text"
                :value="selectedEdge.data?.varName ?? 'value'"
                class="mt-1 w-full border border-neon-deep/40 bg-void px-2 py-1 font-mono text-xs text-text-main outline-none focus:border-neon"
                @change="handleEdgeVarNameChange"
              />
            </div>
            <div>
              <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
                条件 condition
              </label>
              <input
                type="text"
                :value="selectedEdge.data?.condition ?? ''"
                placeholder="可选"
                class="mt-1 w-full border border-neon-deep/40 bg-void px-2 py-1 font-mono text-xs text-text-main outline-none focus:border-neon placeholder:text-text-dim/40"
                @change="handleEdgeConditionChange"
              />
            </div>
            <p class="border border-neon-deep/20 bg-void p-2 font-mono text-[10px] leading-relaxed text-text-dim">
              端口决定视觉连线位置；varName 决定运行时把上游输出写入目标节点 inputs 的哪个字段。
            </p>
          </div>
        </div>
        <!-- 空态占位 -->
        <div v-else class="flex flex-1 flex-col items-center justify-center p-6">
          <p class="font-mono text-xs text-text-dim opacity-60">
            点击节点以编辑属性
          </p>
        </div>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, markRaw, onBeforeUnmount, ref, watch } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { MiniMap } from '@vue-flow/minimap'
import { Controls } from '@vue-flow/controls'
import { Graph, layout } from '@dagrejs/dagre'
import { validateWorkflowDefinition } from '@tsian/workflow-engine'
import type { NodeMouseEvent, NodeTypesObject, EdgeTypesObject, Connection, Edge, EdgeMouseEvent } from '@vue-flow/core'
import type { WorkflowDefinition, WorkflowNodeType } from '@tsian/contracts'
import {
  Brain,
  Flag,
  GitBranch,
  FileEdit,
  Code,
  Database,
  Save,
  FileText,
} from 'lucide-vue-next'
import { useWorkflowEditor } from '../../composables/useWorkflowEditor'
import { nodeTypeRegistry } from './node-registry'
import WorkflowNode from './WorkflowNode.vue'
import NeonEdge from './NeonEdge.vue'
import ValidationBar from './ValidationBar.vue'
import EditorToolbar from './EditorToolbar.vue'
import NodeInspector from './NodeInspector.vue'

// 引入 Vue Flow 默认样式
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/minimap/dist/style.css'
import '@vue-flow/controls/dist/style.css'

interface WorkflowResourceOption {
  id: string
  name: string
  description?: string
}

const props = withDefaults(defineProps<{
  initialDefinition?: WorkflowDefinition
  saveStatus: 'saved' | 'dirty' | 'saving' | 'error'
  sourceLabel: string
  readonly?: boolean
  promptPresetOptions?: WorkflowResourceOption[]
  worldBookOptions?: WorkflowResourceOption[]
}>(), {
  readonly: false,
  promptPresetOptions: () => [],
  worldBookOptions: () => [],
})

const emit = defineEmits<{
  change: [definition: WorkflowDefinition]
  resetWorkflow: []
  saveWorkflow: [definition: WorkflowDefinition]
}>()

const {
  nodes,
  edges,
  selectedNodeId,
  addNode,
  removeSelected,
  toWorkflowDefinition,
  loadWorkflowDefinition,
  updateNodeConfig,
  updateNodeLabel,
  updateNodeRetry,
  updateNodeOutputs,
  updateEdgeData,
  exportToJson,
  importFromJson,
} = useWorkflowEditor()

const { project } = useVueFlow()
const selectedEdgeId = ref<string | null>(null)

const selectedEdge = computed(() => {
  if (!selectedEdgeId.value) return null
  return edges.value.find((edge) => edge.id === selectedEdgeId.value) ?? null
})

// ---------------------------------------------------------------------------
// 校验逻辑（防抖 300ms）
// ---------------------------------------------------------------------------

const validationErrors = ref<string[]>([])
const LOAD_SETTLE_MS = 100
let isLoadingDefinition = false
let loadVersion = 0
let loadSettleTimer: ReturnType<typeof setTimeout> | null = null
let lastEmittedDefinitionJson = ''
let lastLoadedDefinitionJson = ''

let validateTimer: ReturnType<typeof setTimeout> | null = null

function clearLoadSettleTimer() {
  if (!loadSettleTimer) return
  clearTimeout(loadSettleTimer)
  loadSettleTimer = null
}

function scheduleFinishDefinitionLoad(version: number) {
  clearLoadSettleTimer()
  loadSettleTimer = setTimeout(() => {
    if (version !== loadVersion) return
    lastEmittedDefinitionJson = JSON.stringify(toWorkflowDefinition())
    isLoadingDefinition = false
    loadSettleTimer = null
  }, LOAD_SETTLE_MS)
}

watch(
  () => props.initialDefinition,
  (definition) => {
    if (!definition) return

    const incomingJson = JSON.stringify(definition)
    if (incomingJson === lastLoadedDefinitionJson || incomingJson === lastEmittedDefinitionJson) {
      lastLoadedDefinitionJson = incomingJson
      return
    }

    const currentLoadVersion = ++loadVersion
    isLoadingDefinition = true
    loadWorkflowDefinition(definition, { autoLayout })
    lastLoadedDefinitionJson = incomingJson
    lastEmittedDefinitionJson = JSON.stringify(toWorkflowDefinition())
    scheduleFinishDefinitionLoad(currentLoadVersion)
  },
  { immediate: true },
)

// ---------------------------------------------------------------------------
// 校验错误中文翻译
// ---------------------------------------------------------------------------

const validationErrorTranslations: Record<string, string | ((msg: string) => string)> = {
  'must declare config.patchVarName as non-empty string': (msg) => {
    const match = msg.match(/apply-patch node "([^"]+)"/)
    return `apply-patch 节点 "${match?.[1] ?? '?'}" 必须声明非空的 config.patchVarName`
  },
  'requires incoming edge with varName': (msg) => {
    const nodeMatch = msg.match(/apply-patch node "([^"]+)"/)
    const varMatch = msg.match(/varName "([^"]+)"/)
    return `apply-patch 节点 "${nodeMatch?.[1] ?? '?'}" 需要接入 varName 为 "${varMatch?.[1] ?? '?'}" 的入边`
  },
  'duplicate node id': (msg) => {
    const match = msg.match(/duplicate node id "([^"]+)"/)
    return `节点 ID "${match?.[1] ?? '?'}" 重复`
  },
  'workflow contains a cycle': () => '工作流包含循环依赖',
  'edge references unknown source node': (msg) => {
    const match = msg.match(/unknown source node "([^"]+)"/)
    return `边引用了不存在的源节点 "${match?.[1] ?? '?'}"`
  },
  'edge references unknown target node': (msg) => {
    const match = msg.match(/unknown target node "([^"]+)"/)
    return `边引用了不存在的目标节点 "${match?.[1] ?? '?'}"`
  },
  'must contain at least one node of type \'result\'': () => '工作流必须包含至少一个 result 节点',
  'must declare config.name as non-empty string': (msg) => {
    const match = msg.match(/result node "([^"]+)"/)
    return `result 节点 "${match?.[1] ?? '?'}" 必须声明非空的 config.name`
  },
  'duplicate result node config.name': (msg) => {
    const match = msg.match(/config\.name "([^"]+)"/)
    return `result 节点名称 "${match?.[1] ?? '?'}" 重复`
  },
  'has unknown type': (msg) => {
    const nodeMatch = msg.match(/node "([^"]+)"/)
    const typeMatch = msg.match(/unknown type "([^"]+)"/)
    return `节点 "${nodeMatch?.[1] ?? '?'}" 的类型 "${typeMatch?.[1] ?? '?'}" 未知`
  },
}

function translateValidationError(message: string): string {
  for (const [key, translator] of Object.entries(validationErrorTranslations)) {
    if (message.includes(key)) {
      return typeof translator === 'function' ? translator(message) : translator
    }
  }
  return message
}

watch([nodes, edges], () => {
  if (selectedEdgeId.value && !edges.value.some((edge) => edge.id === selectedEdgeId.value)) {
    selectedEdgeId.value = null
  }

  const def = toWorkflowDefinition()
  const defJson = JSON.stringify(def)

  if (isLoadingDefinition) {
    lastEmittedDefinitionJson = defJson
    scheduleFinishDefinitionLoad(loadVersion)
  }

  // readonly 模式下不 emit change
  if (!props.readonly && !isLoadingDefinition && defJson !== lastEmittedDefinitionJson) {
    lastEmittedDefinitionJson = defJson
    emit('change', def)
  }

  if (validateTimer) clearTimeout(validateTimer)
  validateTimer = setTimeout(() => {
    try {
      validateWorkflowDefinition(def)
      validationErrors.value = []
    } catch (e: any) {
      validationErrors.value = [translateValidationError(e.message ?? String(e))]
    }
  }, 300)
}, { deep: true })

onBeforeUnmount(() => {
  clearLoadSettleTimer()
  if (validateTimer) clearTimeout(validateTimer)
})

// ---------------------------------------------------------------------------
// Dagre 自动布局
// ---------------------------------------------------------------------------

function autoLayout() {
  if (nodes.value.length === 0) return

  const g = new Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 120 })

  for (const node of nodes.value) {
    g.setNode(node.id, { width: 200, height: 80 })
  }

  for (const edge of edges.value) {
    g.setEdge(edge.source, edge.target)
  }

  layout(g)

  nodes.value = nodes.value.map((node) => {
    const pos = g.node(node.id)
    return {
      ...node,
      position: { x: pos.x - 100, y: pos.y - 40 },
    }
  })
}

// ---------------------------------------------------------------------------
// 清空画布 / 删除指定节点
// ---------------------------------------------------------------------------

function clearCanvas() {
  nodes.value = []
  edges.value = []
  selectedNodeId.value = null
  selectedEdgeId.value = null
}

function handleDeleteNode(nodeId: string) {
  edges.value = edges.value.filter(
    (e) => e.source !== nodeId && e.target !== nodeId
  )
  nodes.value = nodes.value.filter((n) => n.id !== nodeId)
  if (selectedNodeId.value === nodeId) {
    selectedNodeId.value = null
  }
  if (selectedEdgeId.value && !edges.value.some((edge) => edge.id === selectedEdgeId.value)) {
    selectedEdgeId.value = null
  }
}

// 导入 JSON 处理
async function handleImport() {
  const errors = await importFromJson()
  if (errors.length > 0) {
    validationErrors.value = errors
  }
}

// 自定义节点/边类型注册
const nodeTypes: NodeTypesObject = { 'workflow-node': markRaw(WorkflowNode) as any }
const edgeTypes: EdgeTypesObject = { 'neon-edge': markRaw(NeonEdge) as any }

// 面板图标映射
const paletteIcons: Record<string, any> = {
  Brain,
  Flag,
  GitBranch,
  FileEdit,
  Code,
  Database,
  Save,
  FileText,
}

// 拖拽开始 — 存储节点类型到 dataTransfer
function onDragStart(event: DragEvent, type: WorkflowNodeType) {
  if (event.dataTransfer) {
    event.dataTransfer.setData('application/workflow-node-type', type)
    event.dataTransfer.effectAllowed = 'move'
  }
}

// 拖拽经过画布 — 允许放置
function onDragOver(event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

// 放置到画布 — 在鼠标位置创建新节点
function onDrop(event: DragEvent) {
  const type = event.dataTransfer?.getData('application/workflow-node-type')
  if (!type) return

  const vueFlowEl = document.querySelector('.workflow-canvas')
  if (!vueFlowEl) return
  const bounds = vueFlowEl.getBoundingClientRect()

  const position = project({
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  })

  addNode(type as WorkflowNodeType, position)
}

// 节点点击 → 选中
function onNodeClick({ node }: NodeMouseEvent) {
  selectedNodeId.value = node.id
  selectedEdgeId.value = null
}

// 画布点击 → 取消选中
function onPaneClick() {
  selectedNodeId.value = null
  selectedEdgeId.value = null
}

// 边点击 → 选中边属性
function onEdgeClick({ edge }: EdgeMouseEvent) {
  selectedNodeId.value = null
  selectedEdgeId.value = edge.id
}

function handleEdgeVarNameChange(event: Event) {
  if (!selectedEdge.value) return
  updateEdgeData(selectedEdge.value.id, {
    varName: (event.target as HTMLInputElement).value.trim() || 'value',
    condition: selectedEdge.value.data?.condition,
  })
}

function handleEdgeConditionChange(event: Event) {
  if (!selectedEdge.value) return
  updateEdgeData(selectedEdge.value.id, {
    varName: selectedEdge.value.data?.varName ?? 'value',
    condition: (event.target as HTMLInputElement).value.trim(),
  })
}

// 连接创建 → 添加新边
function onConnect(connection: Connection) {
  if (!connection.source || !connection.target) return

  const targetHandle = connection.targetHandle ?? 'input'
  const varName = targetHandle !== 'input' ? targetHandle : 'value'
  const newEdge: Edge = {
    id: `${connection.source}:${connection.sourceHandle ?? 'raw'}->${connection.target}:${varName}`,
    source: connection.source,
    sourceHandle: connection.sourceHandle ?? 'raw',
    target: connection.target,
    targetHandle,
    type: 'neon-edge',
    data: { varName },
  }
  edges.value = [...edges.value, newEdge]
  selectedEdgeId.value = newEdge.id
  selectedNodeId.value = null
}

// MiniMap 节点颜色
function miniMapNodeColor(node: any): string {
  const colors: Record<string, string> = {
    'ai-call': '#00F0FF',
    'result': '#00FF88',
    'switch': '#FF8C00',
    'apply-patch': '#B388FF',
    'compute': '#FFD600',
    'memory-query': '#4FD1C5',
    'memory-write': '#F472B6',
    'template-compose': '#A3E635',
  }
  return colors[node.data?.nodeType] ?? '#608996'
}
</script>

<style scoped>
/* Vue Flow 画布背景色覆盖 */
.workflow-canvas {
  background-color: var(--color-void, #080C11);
}

/* Vue Flow Controls 按钮主题覆盖 */
:deep(.vue-flow__controls-button) {
  background-color: var(--color-elevated, #1C2633);
  color: var(--color-text-main, #E0F7FA);
  border-color: rgba(0, 139, 139, 0.4);
}

:deep(.vue-flow__controls-button:hover) {
  background-color: var(--color-neon-deep, #008B8B);
}
</style>
