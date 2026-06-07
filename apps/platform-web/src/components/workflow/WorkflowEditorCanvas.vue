<template>
  <section
    ref="editorRootRef"
    class="relative flex h-full flex-col overflow-hidden bg-void"
    @click="closeContextMenu"
  >
    <EditorToolbar
      v-if="!props.readonly"
      :has-selection="hasSelection"
      :save-status="props.saveStatus"
      :source-label="props.sourceLabel"
      @add-node="openNodeMenuFromToolbar"
      @auto-layout="autoLayout"
      @delete-selected="removeSelectedElement"
      @export-json="exportToJson"
      @import-json="handleImport"
      @clear-canvas="clearCanvas"
      @reset-workflow="$emit('resetWorkflow')"
      @save-workflow="emit('saveWorkflow', toWorkflowDefinition())"
    />

    <div
      v-if="props.readonly"
      class="flex items-center gap-2 border-b border-neon-deep/40 bg-panel px-3 py-1.5"
    >
      <span class="mr-2 font-mono text-[10px] uppercase tracking-[0.2em] text-neon-muted">
        工作流预览
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

    <div ref="canvasWrapRef" class="relative min-h-0 flex-1 overflow-hidden">
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
        @node-double-click="onNodeDoubleClick"
        @node-context-menu="onNodeContextMenu"
        @edge-click="onEdgeClick"
        @edge-double-click="onEdgeDoubleClick"
        @edge-context-menu="onEdgeContextMenu"
        @pane-click="onPaneClick"
        @pane-context-menu="onPaneContextMenu"
        @connect="!props.readonly && onConnect($event)"
      >
        <Background :gap="20" :size="1" pattern-color="#1C2633" />
        <MiniMap
          position="top-right"
          :node-color="miniMapNodeColor"
          class="!bg-panel !border !border-neon-deep/40"
        />
        <Controls
          position="top-left"
          class="!bg-panel !border !border-neon-deep/40"
        />
      </VueFlow>

      <div
        v-if="contextMenu && !props.readonly"
        class="absolute z-30 min-w-56 overflow-hidden border border-neon-muted/50 bg-panel shadow-xl"
        :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
        @click.stop
      >
        <template v-if="contextMenu.kind === 'pane'">
          <p class="border-b border-neon-muted/30 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.25em] text-neon-muted">
            添加节点
          </p>
          <div class="max-h-[420px] overflow-y-auto p-1">
            <button
              type="button"
              class="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-neon/10"
              @click="addStateDatabaseFromContextMenu"
            >
              <span class="mt-1 h-2 w-2 shrink-0 bg-[#00FF88]" />
              <span class="min-w-0">
                <span class="block font-mono text-xs font-bold text-text-main">状态数据库</span>
                <span class="block truncate font-mono text-[10px] text-text-dim">stateModel</span>
              </span>
            </button>
            <button
              v-for="info in nodeTypeRegistry"
              :key="info.type"
              type="button"
              class="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-neon/10"
              @click="addNodeFromContextMenu(info.type)"
            >
              <span class="mt-1 h-2 w-2 shrink-0" :style="{ backgroundColor: info.color }" />
              <span class="min-w-0">
                <span class="block font-mono text-xs font-bold text-text-main">{{ info.label }}</span>
                <span class="block truncate font-mono text-[10px] text-text-dim">{{ info.type }}</span>
              </span>
            </button>
          </div>
        </template>

        <template v-else-if="contextMenu.kind === 'node'">
          <p class="border-b border-neon-muted/30 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.25em] text-neon-muted">
            节点
          </p>
          <button
            v-if="isStateAnchorNodeId(contextMenu.nodeId)"
            type="button"
            class="block w-full px-3 py-2 text-left font-mono text-xs text-text-main transition-colors hover:bg-neon/10 hover:text-neon"
            @click="openStateDatabaseEditor(contextMenu.nodeId)"
          >
            编辑数据库
          </button>
          <button
            v-else
            type="button"
            class="block w-full px-3 py-2 text-left font-mono text-xs text-text-main transition-colors hover:bg-neon/10 hover:text-neon"
            @click="openNodeEditor(contextMenu.nodeId)"
          >
            编辑节点
          </button>
          <button
            type="button"
            class="block w-full px-3 py-2 text-left font-mono text-xs text-danger transition-colors hover:bg-danger/10"
            @click="deleteNodeFromContextMenu(contextMenu.nodeId)"
          >
            删除节点
          </button>
        </template>

        <template v-else>
          <p class="border-b border-neon-muted/30 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.25em] text-neon-muted">
            边
          </p>
          <button
            v-if="!isStateLinkEdgeId(contextMenu.edgeId)"
            type="button"
            class="block w-full px-3 py-2 text-left font-mono text-xs text-text-main transition-colors hover:bg-neon/10 hover:text-neon"
            @click="openEdgeEditor(contextMenu.edgeId)"
          >
            编辑边
          </button>
          <button
            type="button"
            class="block w-full px-3 py-2 text-left font-mono text-xs text-danger transition-colors hover:bg-danger/10"
            @click="deleteEdgeFromContextMenu(contextMenu.edgeId)"
          >
            删除边
          </button>
        </template>
      </div>

      <div
        v-if="!props.readonly"
        class="absolute inset-x-0 bottom-0 z-20 border-t border-neon-muted/40 bg-panel/95 backdrop-blur"
      >
        <button
          type="button"
          class="flex w-full items-center gap-3 px-4 py-2 text-left"
          @click="drawerExpanded = !drawerExpanded"
        >
          <component
            :is="drawerExpanded ? ChevronDown : ChevronUp"
            class="h-4 w-4 shrink-0 text-neon"
          />
          <span
            class="font-mono text-xs font-bold uppercase tracking-wider"
            :class="validationErrors.length > 0 ? 'text-danger' : 'text-[#00FF88]'"
          >
            {{ validationErrors.length > 0 ? `${validationErrors.length} 错误` : '校验通过' }}
          </span>
          <span class="font-mono text-[11px] text-text-dim">
            {{ nodes.length }} 节点 / {{ edges.length }} 边
          </span>
          <span class="min-w-0 flex-1 truncate font-mono text-[11px] text-text-dim">
            {{ validationErrors[0] ?? props.sourceLabel }}
          </span>
        </button>

        <div v-if="drawerExpanded" class="max-h-[34dvh] overflow-hidden border-t border-neon-muted/20">
          <div class="flex gap-2 border-b border-neon-muted/20 bg-void/40 px-4 py-2">
            <button
              v-for="tab in drawerTabs"
              :key="tab.id"
              type="button"
              class="border px-3 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors"
              :class="drawerTab === tab.id
                ? 'border-neon bg-neon/10 text-neon'
                : 'border-neon-muted/30 bg-panel text-text-dim hover:border-neon-muted hover:text-text-main'"
              @click="drawerTab = tab.id"
            >
              {{ tab.label }}
            </button>
          </div>
          <div class="max-h-[calc(34dvh-44px)] overflow-y-auto p-4">
            <div v-if="drawerTab === 'diagnostics'" class="grid gap-2">
              <p
                v-if="validationErrors.length === 0"
                class="font-mono text-xs text-[#00FF88]"
              >
                工作流校验通过。
              </p>
              <p
                v-for="error in validationErrors"
                v-else
                :key="error"
                class="border border-danger/40 bg-danger/10 px-3 py-2 font-mono text-xs text-danger"
              >
                {{ error }}
              </p>
            </div>

            <div v-else-if="drawerTab === 'summary'" class="grid gap-3 font-mono text-xs text-text-dim">
              <div class="grid gap-1 sm:grid-cols-3">
                <p class="border border-neon-muted/30 bg-void/50 px-3 py-2">
                  节点 // <span class="text-text-main">{{ nodes.length }}</span>
                </p>
                <p class="border border-neon-muted/30 bg-void/50 px-3 py-2">
                  边 // <span class="text-text-main">{{ edges.length }}</span>
                </p>
                <p class="border border-neon-muted/30 bg-void/50 px-3 py-2">
                  来源 // <span class="text-text-main">{{ props.sourceLabel }}</span>
                </p>
              </div>
              <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <p
                  v-for="item in nodeTypeCounts"
                  :key="item.type"
                  class="border border-neon-muted/20 bg-void/30 px-3 py-2"
                >
                  {{ item.label }} // <span class="text-text-main">{{ item.count }}</span>
                </p>
              </div>
            </div>

            <div v-else class="grid gap-3 font-mono text-xs text-text-dim">
              <div class="grid gap-2 sm:grid-cols-4">
                <p class="border border-neon-muted/30 bg-void/50 px-3 py-2">
                  集合 // <span class="text-text-main">{{ stateContractReport.collections.length }}</span>
                </p>
                <p class="border border-neon-muted/30 bg-void/50 px-3 py-2">
                  已定义 // <span class="text-[#00FF88]">{{ stateContractCoveredCount }}</span>
                </p>
                <p class="border border-neon-muted/30 bg-void/50 px-3 py-2">
                  仅存储 // <span class="text-warning">{{ stateContractStorageOnlyCount }}</span>
                </p>
                <p class="border border-neon-muted/30 bg-void/50 px-3 py-2">
                  问题 // <span :class="stateContractReport.issues.length ? 'text-danger' : 'text-[#00FF88]'">{{ stateContractReport.issues.length }}</span>
                </p>
              </div>

              <div
                v-if="stateContractReport.issues.length"
                class="grid gap-1"
              >
                <p
                  v-for="issue in stateContractReport.issues"
                  :key="`${issue.nodeId}-${issue.message}`"
                  class="border border-danger/40 bg-danger/10 px-3 py-2 text-danger"
                >
                  {{ issue.nodeId }} // {{ issue.message }}
                </p>
              </div>

              <p
                v-if="stateContractReport.dynamicWriteNodeIds.length"
                class="border border-neon-muted/30 bg-void/50 px-3 py-2 text-text-dim"
              >
                运行时决定目标的写入节点 // {{ stateContractReport.dynamicWriteNodeIds.join(', ') }}
              </p>

              <p
                v-if="stateContractReport.collections.length === 0"
                class="border border-neon-muted/30 bg-void/50 px-3 py-2"
              >
                未发现状态数据库集合。
              </p>

              <div class="grid gap-2 lg:grid-cols-2">
                <article
                  v-for="collection in stateContractReport.collections"
                  :key="collection.key"
                  class="grid gap-2 border border-neon-muted/25 bg-void/40 px-3 py-2"
                >
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="text-text-main">{{ collection.namespace }}/{{ collection.collection }}</span>
                    <span
                      class="border px-2 py-0.5 text-[10px] uppercase"
                      :class="collection.storageOnly
                        ? 'border-warning/50 text-warning'
                        : 'border-[#00FF88]/50 text-[#00FF88]'"
                    >
                      {{ collection.storageOnly ? '仅存储' : '已定义' }}
                    </span>
                  </div>
                  <p v-if="collection.schemaId" class="text-[10px] text-text-dim">
                    模型 // {{ collection.schemaId }}@{{ collection.schemaVersion ?? '?' }}
                  </p>
                  <div class="grid gap-1 text-[10px]">
                    <p>读取 // <span class="text-text-main">{{ formatNodeList(collection.readNodeIds) }}</span></p>
                    <p>写入 // <span class="text-text-main">{{ formatNodeList(collection.writeNodeIds) }}</span></p>
                    <p>定义 // <span class="text-text-main">{{ formatNodeList(collection.schemaNodeIds) }}</span></p>
                  </div>
                  <div
                    v-if="collection.schemaCollection"
                    class="grid gap-1 border-t border-neon-muted/15 pt-2 text-[10px]"
                  >
                    <p class="uppercase tracking-wider text-text-dim">字段</p>
                    <div
                      v-for="field in collectionFieldPathRows(collection.schemaCollection)"
                      :key="field.name"
                      class="grid gap-1 border border-neon-muted/15 bg-panel/40 px-2 py-1"
                    >
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="text-text-main">{{ field.label }}</span>
                        <span class="text-text-dim">({{ field.name }})</span>
                        <span class="border border-neon-muted/30 px-1.5 py-0.5 text-[9px] text-neon">
                          {{ field.typeLabel }}
                        </span>
                        <span
                          v-if="field.required"
                          class="border border-warning/40 px-1.5 py-0.5 text-[9px] text-warning"
                        >
                          必填
                        </span>
                      </div>
                      <p v-if="field.description" class="text-text-dim">
                        {{ field.description }}
                      </p>
                      <p class="truncate text-text-dim">
                        路径 // <span class="text-text-main">{{ field.path }}</span>
                      </p>
                    </div>
                    <p
                      v-if="collectionFieldPathRows(collection.schemaCollection).length === 0"
                      class="text-text-dim"
                    >
                      无字段定义
                    </p>
                  </div>
                </article>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <WorkflowNodeEditorDialog
      v-if="!props.readonly"
      :open="!!nodeEditorNodeId"
      :node-id="nodeEditorNodeId"
      :nodes="nodes"
      :state-model="currentStateModel"
      :prompt-preset-options="props.promptPresetOptions"
      :world-book-options="props.worldBookOptions"
      :on-update-config="updateNodeConfig"
      :on-update-label="updateNodeLabel"
      :on-update-retry="updateNodeRetry"
      :on-update-inputs="updateNodeInputs"
      :on-delete-node="handleDeleteNode"
      :on-update-outputs="updateNodeOutputs"
      :on-close="closeNodeEditor"
    />

    <StateDatabaseEditorDialog
      v-if="!props.readonly"
      :open="!!stateDatabaseEditorNodeId"
      :anchor-node-id="stateDatabaseEditorNodeId"
      :nodes="nodes"
      :state-model="currentStateModel"
      :on-update-anchor="updateStateDatabaseAnchor"
      :on-update-state-schema="updateStateModelSchema"
      :on-rename-collection-reference="renameStateModelCollectionReference"
      :on-remove-collection-reference="removeStateModelCollectionReference"
      :on-close="closeStateDatabaseEditor"
    />

    <WorkflowEdgeEditorDialog
      v-if="!props.readonly"
      :open="!!edgeEditorEdgeId"
      :edge="edgeEditorEdge"
      :nodes="nodes"
      :on-update="updateEdgeData"
      :on-delete="deleteEdge"
      :on-close="closeEdgeEditor"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, markRaw, onBeforeUnmount, provide, ref, watch } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { MiniMap } from '@vue-flow/minimap'
import { Controls } from '@vue-flow/controls'
import { Graph, layout } from '@dagrejs/dagre'
import { validateWorkflowDefinition } from '@tsian/workflow-engine'
import type { NodeMouseEvent, NodeTypesObject, EdgeTypesObject, Connection, Edge, EdgeMouseEvent } from '@vue-flow/core'
import type { WorkflowDefinition, WorkflowNodeType } from '@tsian/contracts'
import { ChevronDown, ChevronUp } from 'lucide-vue-next'
import {
  readStatePortIdFromHandle,
  STATE_ANCHOR_NODE_ID_PREFIX,
  STATE_DATABASE_NODE_VUE_TYPE,
  STATE_LINK_EDGE_VUE_TYPE,
  WORKFLOW_EDGE_VUE_TYPE,
  WORKFLOW_NODE_VUE_TYPE,
  useWorkflowEditor,
} from '../../composables/useWorkflowEditor'
import { nodeTypeRegistry } from './node-registry'
import WorkflowNode from './WorkflowNode.vue'
import NeonEdge from './NeonEdge.vue'
import StateDatabaseNode from './StateDatabaseNode.vue'
import StateLinkEdge from './StateLinkEdge.vue'
import StateDatabaseEditorDialog from './StateDatabaseEditorDialog.vue'
import EditorToolbar from './EditorToolbar.vue'
import WorkflowNodeEditorDialog from './WorkflowNodeEditorDialog.vue'
import WorkflowEdgeEditorDialog from './WorkflowEdgeEditorDialog.vue'
import { analyzeWorkflowStateContract } from './state-contract'
import { collectWorkflowEditorDiagnostics } from './workflow-diagnostics'
import {
  collectionFieldPathRows,
  workflowStateModelContextKey,
} from './state-model-view'

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

type DrawerTabId = 'diagnostics' | 'summary' | 'state-contract'

type ContextMenuState =
  | {
    kind: 'pane'
    x: number
    y: number
    flowPosition: { x: number; y: number }
  }
  | {
    kind: 'node'
    x: number
    y: number
    nodeId: string
  }
  | {
    kind: 'edge'
    x: number
    y: number
    edgeId: string
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
  addStateDatabaseAnchor,
  addStateModelLink,
  updateStateModelSchema,
  updateStateDatabaseAnchor,
  renameStateModelCollectionReference,
  removeStateModelCollectionReference,
  clearStateModel,
  refreshStateModelNodeMetadata,
  removeSelected,
  toWorkflowDefinition,
  loadWorkflowDefinition,
  updateNodeConfig,
  updateNodeLabel,
  updateNodeRetry,
  updateNodeInputs,
  updateNodeOutputs,
  updateEdgeData,
  exportToJson,
  importFromJson,
} = useWorkflowEditor()

const { screenToFlowCoordinate } = useVueFlow()
const editorRootRef = ref<HTMLElement | null>(null)
const canvasWrapRef = ref<HTMLElement | null>(null)
const selectedEdgeId = ref<string | null>(null)
const nodeEditorNodeId = ref<string | null>(null)
const stateDatabaseEditorNodeId = ref<string | null>(null)
const edgeEditorEdgeId = ref<string | null>(null)
const contextMenu = ref<ContextMenuState | null>(null)
const drawerExpanded = ref(false)
const drawerTab = ref<DrawerTabId>('diagnostics')

const drawerTabs: Array<{ id: DrawerTabId; label: string }> = [
  { id: 'diagnostics', label: '诊断' },
  { id: 'summary', label: '摘要' },
  { id: 'state-contract', label: '状态数据库' },
]

const hasSelection = computed(() => !!selectedNodeId.value || !!selectedEdgeId.value)
const editorDefinition = computed(() => toWorkflowDefinition())
const currentStateModel = computed(() => editorDefinition.value.stateModel)

provide(workflowStateModelContextKey, currentStateModel)

const edgeEditorEdge = computed(() => {
  if (!edgeEditorEdgeId.value) return null
  return edges.value.find((edge) => edge.id === edgeEditorEdgeId.value) ?? null
})

const nodeTypeCounts = computed(() => {
  return nodeTypeRegistry
    .map((info) => ({
      type: info.type,
      label: info.label,
      count: nodes.value.filter((node) => node.data?.nodeType === info.type).length,
    }))
    .filter((item) => item.count > 0)
})

const stateContractReport = computed(() =>
  analyzeWorkflowStateContract(editorDefinition.value),
)

const stateContractCoveredCount = computed(() =>
  stateContractReport.value.collections.filter((collection) => !collection.storageOnly).length,
)

const stateContractStorageOnlyCount = computed(() =>
  stateContractReport.value.collections.filter((collection) => collection.storageOnly).length,
)

function formatNodeList(nodeIds: string[]): string {
  return nodeIds.length > 0 ? nodeIds.join(', ') : '-'
}

function isStateAnchorNodeId(nodeId: string | null | undefined): boolean {
  return typeof nodeId === 'string' && nodeId.startsWith(STATE_ANCHOR_NODE_ID_PREFIX)
}

function isStateLinkEdgeId(edgeId: string | null | undefined): boolean {
  return typeof edgeId === 'string' &&
    edges.value.some((edge) =>
      edge.id === edgeId &&
      (edge.type === STATE_LINK_EDGE_VUE_TYPE || edge.data?.edgeKind === 'state-link'),
    )
}

function workflowNodeType(nodeId: string | null | undefined): WorkflowNodeType | undefined {
  if (!nodeId || isStateAnchorNodeId(nodeId)) return undefined
  const node = nodes.value.find((item) => item.id === nodeId)
  return node?.data?.nodeType as WorkflowNodeType | undefined
}

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

function runValidation(def: WorkflowDefinition): void {
  const messages: string[] = []
  try {
    validateWorkflowDefinition(def)
  } catch (e: any) {
    messages.push(translateValidationError(e.message ?? String(e)))
  }

  messages.push(
    ...collectWorkflowEditorDiagnostics(def, {
      promptPresetOptions: props.promptPresetOptions,
    }),
  )

  validationErrors.value = Array.from(new Set(messages))
}

watch([nodes, edges, () => props.promptPresetOptions], () => {
  if (selectedEdgeId.value && !edges.value.some((edge) => edge.id === selectedEdgeId.value)) {
    selectedEdgeId.value = null
  }
  if (edgeEditorEdgeId.value && !edges.value.some((edge) => edge.id === edgeEditorEdgeId.value)) {
    edgeEditorEdgeId.value = null
  }
  if (nodeEditorNodeId.value && !nodes.value.some((node) => node.id === nodeEditorNodeId.value)) {
    nodeEditorNodeId.value = null
  }
  if (
    stateDatabaseEditorNodeId.value &&
    !nodes.value.some((node) => node.id === stateDatabaseEditorNodeId.value)
  ) {
    stateDatabaseEditorNodeId.value = null
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
    runValidation(def)
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
  clearStateModel()
  selectedNodeId.value = null
  selectedEdgeId.value = null
  nodeEditorNodeId.value = null
  stateDatabaseEditorNodeId.value = null
  edgeEditorEdgeId.value = null
  closeContextMenu()
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
  if (nodeEditorNodeId.value === nodeId) {
    nodeEditorNodeId.value = null
  }
  if (stateDatabaseEditorNodeId.value === nodeId) {
    stateDatabaseEditorNodeId.value = null
  }
  closeContextMenu()
}

function deleteEdge(edgeId: string) {
  const wasStateLink = isStateLinkEdgeId(edgeId)
  edges.value = edges.value.filter((edge) => edge.id !== edgeId)
  if (wasStateLink) {
    refreshStateModelNodeMetadata()
  }
  if (selectedEdgeId.value === edgeId) {
    selectedEdgeId.value = null
  }
  if (edgeEditorEdgeId.value === edgeId) {
    edgeEditorEdgeId.value = null
  }
  closeContextMenu()
}

function removeSelectedElement() {
  if (selectedNodeId.value) {
    handleDeleteNode(selectedNodeId.value)
    return
  }
  if (selectedEdgeId.value) {
    deleteEdge(selectedEdgeId.value)
  }
}

// 导入 JSON 处理
async function handleImport() {
  const errors = await importFromJson()
  if (errors.length > 0) {
    validationErrors.value = errors
  }
  closeContextMenu()
}

// 自定义节点/边类型注册
const nodeTypes: NodeTypesObject = {
  [WORKFLOW_NODE_VUE_TYPE]: markRaw(WorkflowNode) as any,
  [STATE_DATABASE_NODE_VUE_TYPE]: markRaw(StateDatabaseNode) as any,
}
const edgeTypes: EdgeTypesObject = {
  [WORKFLOW_EDGE_VUE_TYPE]: markRaw(NeonEdge) as any,
  [STATE_LINK_EDGE_VUE_TYPE]: markRaw(StateLinkEdge) as any,
}

// 节点点击 → 选中
function onNodeClick({ node }: NodeMouseEvent) {
  selectedNodeId.value = node.id
  selectedEdgeId.value = null
  closeContextMenu()
}

function onNodeDoubleClick({ node }: NodeMouseEvent) {
  if (props.readonly) return
  if (isStateAnchorNodeId(node.id)) {
    openStateDatabaseEditor(node.id)
    return
  }
  openNodeEditor(node.id)
}

function onNodeContextMenu({ event, node }: NodeMouseEvent) {
  if (props.readonly) return
  const mouse = asMouseEvent(event)
  if (!mouse) return
  mouse.preventDefault()
  mouse.stopPropagation()
  selectedNodeId.value = node.id
  selectedEdgeId.value = null
  const point = menuPoint(mouse)
  contextMenu.value = {
    kind: 'node',
    ...point,
    nodeId: node.id,
  }
}

// 画布点击 → 取消选中
function onPaneClick() {
  selectedNodeId.value = null
  selectedEdgeId.value = null
  closeContextMenu()
}

function onPaneContextMenu(event: MouseEvent) {
  if (props.readonly) return
  event.preventDefault()
  event.stopPropagation()
  const point = menuPoint(event)
  contextMenu.value = {
    kind: 'pane',
    ...point,
    flowPosition: screenToFlowCoordinate({ x: event.clientX, y: event.clientY }),
  }
}

function openNodeMenuFromToolbar() {
  if (props.readonly) return
  const bounds = canvasWrapRef.value?.getBoundingClientRect()
  const screenPoint = bounds
    ? {
      x: bounds.left + Math.max(80, bounds.width / 2),
      y: bounds.top + Math.max(80, bounds.height / 2),
    }
    : {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    }
  contextMenu.value = {
    kind: 'pane',
    x: 8,
    y: 8,
    flowPosition: screenToFlowCoordinate(screenPoint),
  }
}

// 边点击 → 选中边属性
function onEdgeClick({ edge }: EdgeMouseEvent) {
  selectedNodeId.value = null
  selectedEdgeId.value = edge.id
  closeContextMenu()
}

function onEdgeDoubleClick({ edge }: EdgeMouseEvent) {
  if (props.readonly) return
  if (isStateLinkEdgeId(edge.id)) return
  openEdgeEditor(edge.id)
}

function onEdgeContextMenu({ event, edge }: EdgeMouseEvent) {
  if (props.readonly) return
  const mouse = asMouseEvent(event)
  if (!mouse) return
  mouse.preventDefault()
  mouse.stopPropagation()
  selectedNodeId.value = null
  selectedEdgeId.value = edge.id
  const point = menuPoint(mouse)
  contextMenu.value = {
    kind: 'edge',
    ...point,
    edgeId: edge.id,
  }
}

function asMouseEvent(event: MouseEvent | TouchEvent): MouseEvent | null {
  return event instanceof MouseEvent ? event : null
}

function menuPoint(event: MouseEvent): { x: number; y: number } {
  const bounds = canvasWrapRef.value?.getBoundingClientRect()
  if (!bounds) {
    return { x: event.clientX, y: event.clientY }
  }
  return {
    x: Math.max(8, Math.min(event.clientX - bounds.left, bounds.width - 240)),
    y: Math.max(8, Math.min(event.clientY - bounds.top, bounds.height - 80)),
  }
}

function closeContextMenu() {
  contextMenu.value = null
}

function addNodeFromContextMenu(type: WorkflowNodeType) {
  if (!contextMenu.value || contextMenu.value.kind !== 'pane') return
  const nodeId = addNode(type, contextMenu.value.flowPosition)
  selectedNodeId.value = nodeId
  selectedEdgeId.value = null
  nodeEditorNodeId.value = nodeId
  stateDatabaseEditorNodeId.value = null
  edgeEditorEdgeId.value = null
  closeContextMenu()
}

function addStateDatabaseFromContextMenu() {
  if (!contextMenu.value || contextMenu.value.kind !== 'pane') return
  const nodeId = addStateDatabaseAnchor(contextMenu.value.flowPosition)
  selectedNodeId.value = nodeId
  selectedEdgeId.value = null
  nodeEditorNodeId.value = null
  stateDatabaseEditorNodeId.value = nodeId
  edgeEditorEdgeId.value = null
  closeContextMenu()
}

function openNodeEditor(nodeId: string) {
  if (isStateAnchorNodeId(nodeId)) {
    openStateDatabaseEditor(nodeId)
    return
  }
  selectedNodeId.value = nodeId
  selectedEdgeId.value = null
  stateDatabaseEditorNodeId.value = null
  nodeEditorNodeId.value = nodeId
  edgeEditorEdgeId.value = null
  closeContextMenu()
}

function closeNodeEditor() {
  nodeEditorNodeId.value = null
}

function openStateDatabaseEditor(nodeId: string) {
  if (!isStateAnchorNodeId(nodeId)) return
  selectedNodeId.value = nodeId
  selectedEdgeId.value = null
  nodeEditorNodeId.value = null
  stateDatabaseEditorNodeId.value = nodeId
  edgeEditorEdgeId.value = null
  closeContextMenu()
}

function closeStateDatabaseEditor() {
  stateDatabaseEditorNodeId.value = null
}

function deleteNodeFromContextMenu(nodeId: string) {
  handleDeleteNode(nodeId)
  closeContextMenu()
}

function openEdgeEditor(edgeId: string) {
  if (isStateLinkEdgeId(edgeId)) return
  selectedNodeId.value = null
  selectedEdgeId.value = edgeId
  nodeEditorNodeId.value = null
  stateDatabaseEditorNodeId.value = null
  edgeEditorEdgeId.value = edgeId
  closeContextMenu()
}

function closeEdgeEditor() {
  edgeEditorEdgeId.value = null
}

function deleteEdgeFromContextMenu(edgeId: string) {
  deleteEdge(edgeId)
  closeContextMenu()
}

// 连接创建 → 添加新边
function onConnect(connection: Connection) {
  if (!connection.source || !connection.target) return

  const sourceIsStateAnchor = isStateAnchorNodeId(connection.source)
  const targetIsStateAnchor = isStateAnchorNodeId(connection.target)

  if (sourceIsStateAnchor || targetIsStateAnchor) {
    if (sourceIsStateAnchor && !targetIsStateAnchor) {
      const portId = readStatePortIdFromHandle(connection.sourceHandle)
      if (portId && workflowNodeType(connection.target) === 'state-query') {
        const edgeId = addStateModelLink('read', connection.source, portId, connection.target)
        selectedEdgeId.value = edgeId
        selectedNodeId.value = null
        return
      }
    }

    if (targetIsStateAnchor && !sourceIsStateAnchor) {
      const portId = readStatePortIdFromHandle(connection.targetHandle)
      if (portId && workflowNodeType(connection.source) === 'state-write') {
        const edgeId = addStateModelLink('write', connection.target, portId, connection.source)
        selectedEdgeId.value = edgeId
        selectedNodeId.value = null
        return
      }
    }

    validationErrors.value = Array.from(new Set([
      ...validationErrors.value,
      '状态数据库连线只能是：数据库 collection → 状态查询，或状态写入 → 数据库 collection。',
    ]))
    return
  }

  const targetHandle = connection.targetHandle ?? 'input'
  const varName = targetHandle !== 'input' ? targetHandle : 'value'
  const newEdge: Edge = {
    id: `${connection.source}:${connection.sourceHandle ?? 'raw'}->${connection.target}:${varName}`,
    source: connection.source,
    sourceHandle: connection.sourceHandle ?? 'raw',
    target: connection.target,
    targetHandle,
    type: WORKFLOW_EDGE_VUE_TYPE,
    data: { edgeKind: 'workflow', varName },
  }
  edges.value = [...edges.value, newEdge]
  selectedEdgeId.value = newEdge.id
  selectedNodeId.value = null
}

// MiniMap 节点颜色
function miniMapNodeColor(node: any): string {
  if (node.type === STATE_DATABASE_NODE_VUE_TYPE || node.data?.editorKind === 'state-anchor') {
    return '#00FF88'
  }
  const colors: Record<string, string> = {
    'ai-call': '#00F0FF',
    'result': '#00FF88',
    'switch': '#FF8C00',
    'compute': '#FFD600',
    'state-query': '#4FD1C5',
    'state-write': '#F472B6',
    'template-compose': '#A3E635',
    'record-filter': '#38BDF8',
    'record-merge': '#FB7185',
    'record-format': '#FACC15',
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
