<template>
  <div class="space-y-3">
    <div>
      <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
        读取 collection
      </label>
      <select
        :value="selectedCollectionValue"
        class="mt-1 w-full border border-neon-deep/40 bg-void px-2 py-1 font-mono text-xs text-text-main outline-none focus:border-neon"
        @change="updateCollectionTarget(($event.target as HTMLSelectElement).value)"
      >
        <option value="">未选择</option>
        <option
          v-for="option in collectionOptions"
          :key="option.value"
          :value="option.value"
        >
          {{ option.displayName }}
        </option>
      </select>
      <p class="mt-1 truncate font-mono text-[10px] text-text-dim">
        当前读取 // <span class="text-text-main">{{ currentTargetText }}</span>
      </p>
    </div>

    <div>
      <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
        命名空间
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
        集合名
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
        查询输入变量
      </label>
      <input
        :value="config.queryVarName ?? ''"
        class="mt-1 w-full border border-neon-deep/40 bg-void px-2 py-1 font-mono text-xs text-text-main outline-none focus:border-neon"
        placeholder="query"
        @change="updateOptional('queryVarName', ($event.target as HTMLInputElement).value)"
      />
    </div>

    <div>
      <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
        静态查询文本
      </label>
      <input
        :value="config.query ?? ''"
        class="mt-1 w-full border border-neon-deep/40 bg-void px-2 py-1 font-mono text-xs text-text-main outline-none focus:border-neon"
        placeholder="可选静态查询"
        @change="updateOptional('query', ($event.target as HTMLInputElement).value)"
      />
    </div>

    <div>
      <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
        数量上限
      </label>
      <input
        type="number"
        :value="config.limit ?? ''"
        min="1"
        max="200"
        class="mt-1 w-full border border-neon-deep/40 bg-void px-2 py-1 font-mono text-xs text-text-main outline-none focus:border-neon"
        @change="updateLimit(($event.target as HTMLInputElement).value)"
      />
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
    ? resolveStateModelLinkTargets(props.stateModel, props.nodeId, 'read')
    : [],
)
const manualTarget = computed(() =>
  stateCollectionViewFromConfig(props.stateModel, props.config),
)
const selectedCollectionValue = computed(() =>
  linkedTargets.value[0]?.value ?? manualTarget.value?.value ?? '',
)
const currentTargetText = computed(() =>
  linkedTargets.value.length > 0
    ? formatStateTargetList(linkedTargets.value)
    : manualTarget.value?.displayName ?? '未绑定',
)

function updateConfig(patch: Record<string, unknown>) {
  props.onUpdate({ ...props.config, ...patch, source: 'collection' })
}

function updateCollectionTarget(raw: string) {
  const target = stateCollectionViewByValue(props.stateModel, raw)
  updateConfig({
    namespace: target?.namespace,
    collection: target?.collection,
  })
}

function updateOptional(key: string, raw: string) {
  const value = raw.trim()
  updateConfig({ [key]: value || undefined })
}

function updateLimit(raw: string) {
  const value = parseInt(raw, 10)
  updateConfig({ limit: Number.isFinite(value) && value > 0 ? value : undefined })
}
</script>
