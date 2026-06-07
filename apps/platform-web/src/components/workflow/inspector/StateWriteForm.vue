<template>
  <div class="space-y-3">
    <div>
      <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
        默认写入 collection
      </label>
      <select
        :value="selectedCollectionValue"
        class="mt-1 w-full border border-neon-deep/40 bg-void px-2 py-1 font-mono text-xs text-text-main outline-none focus:border-neon"
        @change="updateCollectionTarget(($event.target as HTMLSelectElement).value)"
      >
        <option value="">运行时 operation 指定</option>
        <option
          v-for="option in collectionOptions"
          :key="option.value"
          :value="option.value"
        >
          {{ option.displayName }}
        </option>
      </select>
      <div class="mt-1 grid gap-1 font-mono text-[10px] text-text-dim">
        <p class="truncate">
          当前写回 // <span class="text-text-main">{{ currentTargetText }}</span>
        </p>
        <p>
          操作类型 // <span class="text-text-main">{{ operationSemanticsText }}</span>
        </p>
      </div>
    </div>

    <div>
      <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
        操作输入变量
      </label>
      <input
        :value="config.operationsVarName ?? 'operations'"
        class="mt-1 w-full border border-neon-deep/40 bg-void px-2 py-1 font-mono text-xs text-text-main outline-none focus:border-neon"
        placeholder="operations"
        @change="updateOptional('operationsVarName', ($event.target as HTMLInputElement).value)"
      />
    </div>
    <div>
      <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
        默认命名空间
      </label>
      <input
        :value="config.namespace ?? ''"
        class="mt-1 w-full border border-neon-deep/40 bg-void px-2 py-1 font-mono text-xs text-text-main outline-none focus:border-neon"
        placeholder="mod.example"
        @change="updateOptional('namespace', ($event.target as HTMLInputElement).value)"
      />
    </div>
    <div>
      <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
        默认集合
      </label>
      <input
        :value="config.collection ?? ''"
        class="mt-1 w-full border border-neon-deep/40 bg-void px-2 py-1 font-mono text-xs text-text-main outline-none focus:border-neon"
        placeholder="fragments"
        @change="updateOptional('collection', ($event.target as HTMLInputElement).value)"
      />
    </div>
    <div>
      <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
        检查点策略
      </label>
      <select
        :value="config.pushCheckpointReason ?? 'none'"
        class="mt-1 w-full border border-neon-deep/40 bg-void px-2 py-1 font-mono text-xs text-text-main outline-none focus:border-neon"
        @change="updateOptional('pushCheckpointReason', ($event.target as HTMLSelectElement).value)"
      >
        <option value="none">不创建</option>
        <option value="manual">手动检查点</option>
        <option value="after-turn">回合后检查点</option>
      </select>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { WorkflowStateModel } from '@tsian/contracts'
import {
  formatStateTargetList,
  listStateCollectionViews,
  resolveStateModelLinkTargets,
  stateCollectionViewByValue,
  stateCollectionViewFromConfig,
} from '../state-model-view'

const props = defineProps<{
  config: Record<string, unknown>
  nodeId?: string | null
  stateModel?: WorkflowStateModel
  onUpdate: (config: Record<string, unknown>) => void
}>()

const collectionOptions = computed(() => listStateCollectionViews(props.stateModel))
const linkedTargets = computed(() =>
  props.nodeId
    ? resolveStateModelLinkTargets(props.stateModel, props.nodeId, 'write')
    : [],
)
const manualTarget = computed(() =>
  stateCollectionViewFromConfig(props.stateModel, props.config),
)
const selectedCollectionValue = computed(() =>
  linkedTargets.value[0]?.value ?? manualTarget.value?.value ?? '',
)
const currentTargetText = computed(() =>
  linkedTargets.value.length > 1
    ? formatStateTargetList(linkedTargets.value)
    : writeTargetText(linkedTargets.value[0] ?? manualTarget.value),
)
const operationSemanticsText = computed(() =>
  linkedTargets.value.length > 1
    ? '添加 / 更新 / 删除 / 清空；operations 需携带 collection'
    : '添加 / 更新 / 删除 / 清空',
)

function writeTargetText(target: ReturnType<typeof stateCollectionViewFromConfig> | undefined): string {
  if (!target) return 'operation 指定目标'
  return target.isGlobals ? `更新全局状态: ${target.displayName}` : target.displayName
}

function updateCollectionTarget(raw: string) {
  const target = stateCollectionViewByValue(props.stateModel, raw)
  props.onUpdate({
    ...props.config,
    namespace: target?.namespace,
    collection: target?.collection,
  })
}

function updateOptional(key: string, raw: string) {
  const value = raw.trim()
  props.onUpdate({ ...props.config, [key]: value || undefined })
}
</script>
