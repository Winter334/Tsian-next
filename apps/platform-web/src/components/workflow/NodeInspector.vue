<script setup lang="ts">
import { computed } from 'vue'
import { nodeTypeMap } from './node-registry'
import AiCallForm from './inspector/AiCallForm.vue'
import ResultForm from './inspector/ResultForm.vue'
import SwitchForm from './inspector/SwitchForm.vue'
import ApplyPatchForm from './inspector/ApplyPatchForm.vue'
import ComputeForm from './inspector/ComputeForm.vue'
import OutputsEditor from './inspector/OutputsEditor.vue'

const props = defineProps<{
  nodeId: string | null
  nodes: any[]
  onUpdateConfig: (nodeId: string, config: Record<string, unknown>) => void
  onUpdateRetry: (nodeId: string, retry: { maxRetries: number } | undefined) => void
  onDeleteNode: (nodeId: string) => void
  onUpdateOutputs: (nodeId: string, outputs: any[]) => void
  onUpdateLabel: (nodeId: string, label: string) => void
}>()

// 找到选中节点
const selectedNode = computed(() => {
  if (!props.nodeId) return null
  return props.nodes.find((n: any) => n.id === props.nodeId) ?? null
})

// 节点类型信息
const typeInfo = computed(() => {
  if (!selectedNode.value) return null
  return nodeTypeMap.get(selectedNode.value.data.nodeType) ?? null
})

// 修改重试次数
function handleRetryChange(event: Event) {
  if (!props.nodeId) return
  const val = parseInt((event.target as HTMLInputElement).value, 10)
  props.onUpdateRetry(props.nodeId, val > 0 ? { maxRetries: val } : undefined)
}

// 修改配置字段（通用兜底用）
function handleConfigFieldChange(key: string, value: unknown) {
  if (!props.nodeId || !selectedNode.value) return
  const newConfig = { ...selectedNode.value.data.config, [key]: value }
  props.onUpdateConfig(props.nodeId, newConfig)
}

// 表单组件统一回调：替换整个 config
function handleUpdateConfig(newConfig: Record<string, unknown>) {
  if (!props.nodeId) return
  props.onUpdateConfig(props.nodeId, newConfig)
}

// 输出端口编辑回调
function handleUpdateOutputs(newOutputs: any[]) {
  if (!props.nodeId) return
  props.onUpdateOutputs(props.nodeId, newOutputs)
}

// 修改节点名称
function handleLabelChange(event: Event) {
  if (!props.nodeId) return
  const val = (event.target as HTMLInputElement).value.trim()
  props.onUpdateLabel(props.nodeId, val)
}

// 删除节点
function handleDelete() {
  if (!props.nodeId) return
  props.onDeleteNode(props.nodeId)
}
</script>

<template>
  <!-- 无选中时 -->
  <div v-if="!nodeId" class="flex h-full items-center justify-center p-4">
    <p class="text-center font-mono text-xs text-text-dim">
      点击节点查看属性
    </p>
  </div>

  <!-- 有选中时 -->
  <div v-else-if="selectedNode" class="flex h-full flex-col overflow-hidden">
    <!-- 头部：节点类型 + ID + 删除按钮 -->
    <div class="border-b border-neon-deep/40 p-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div
            class="h-3 w-3"
            :style="{ backgroundColor: typeInfo?.color ?? '#608996' }"
          />
          <span class="font-mono text-xs font-bold uppercase text-text-main">
            {{ selectedNode.data.nodeType }}
          </span>
        </div>
        <button
          class="font-mono text-xs text-danger hover:text-danger/80 transition-colors"
          @click="handleDelete"
        >
          删除
        </button>
      </div>
      <p class="mt-1 font-mono text-[10px] text-text-dim">
        ID: {{ nodeId }}
      </p>
    </div>

    <!-- 配置区域（滚动） -->
    <div class="flex-1 overflow-y-auto p-3 space-y-4">
      <!-- 通用字段：节点名称 -->
      <div>
        <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
          节点名称
        </label>
        <input
          type="text"
          :value="selectedNode.data.label ?? ''"
          :placeholder="typeInfo?.label ?? selectedNode.data.nodeType"
          class="mt-1 w-full border border-neon-deep/40 bg-void px-2 py-1 font-mono text-xs text-text-main outline-none focus:border-neon placeholder:text-text-dim/40"
          @change="handleLabelChange"
        />
      </div>

      <!-- 通用字段：重试次数 -->
      <div>
        <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
          重试次数
        </label>
        <input
          type="number"
          :value="selectedNode.data.retry?.maxRetries ?? 0"
          min="0"
          max="10"
          class="mt-1 w-full border border-neon-deep/40 bg-void px-2 py-1 font-mono text-xs text-text-main outline-none focus:border-neon"
          @change="handleRetryChange"
        />
      </div>

      <div class="border-t border-neon-deep/20" />

      <!-- 按类型渲染配置表单 -->
      <AiCallForm
        v-if="selectedNode.data.nodeType === 'ai-call'"
        :config="selectedNode.data.config"
        :on-update="handleUpdateConfig"
      />
      <ResultForm
        v-else-if="selectedNode.data.nodeType === 'result'"
        :config="selectedNode.data.config"
        :on-update="handleUpdateConfig"
      />
      <SwitchForm
        v-else-if="selectedNode.data.nodeType === 'switch'"
        :config="selectedNode.data.config"
        :on-update="handleUpdateConfig"
      />
      <ApplyPatchForm
        v-else-if="selectedNode.data.nodeType === 'apply-patch'"
        :config="selectedNode.data.config"
        :on-update="handleUpdateConfig"
      />
      <ComputeForm
        v-else-if="selectedNode.data.nodeType === 'compute'"
        :config="selectedNode.data.config"
        :on-update="handleUpdateConfig"
      />

      <!-- 通用兜底（未知类型） -->
      <div v-else>
        <pre class="border border-neon-deep/20 bg-void p-2 font-mono text-[10px] text-text-dim overflow-x-auto">{{ JSON.stringify(selectedNode.data.config, null, 2) }}</pre>
      </div>

      <!-- 输出端口编辑器（仅 ai-call 和 compute） -->
      <template v-if="selectedNode.data.nodeType === 'ai-call' || selectedNode.data.nodeType === 'compute'">
        <div class="border-t border-neon-deep/20 pt-3">
          <OutputsEditor
            :outputs="selectedNode.data.outputs ?? []"
            :on-update="handleUpdateOutputs"
          />
        </div>
      </template>
    </div>
  </div>
</template>
