<template>
  <div class="space-y-3">
    <div class="grid gap-2 md:grid-cols-2">
      <label class="grid gap-1">
        <span class="form-label">输入变量</span>
        <input
          :value="config.inputVarName ?? 'records'"
          class="form-input"
          placeholder="records"
          @change="updateOptional('inputVarName', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label class="grid gap-1">
        <span class="form-label">输出名称</span>
        <input
          :value="config.outputName ?? 'text'"
          class="form-input"
          placeholder="text"
          @change="updateOptional('outputName', ($event.target as HTMLInputElement).value)"
        />
      </label>
    </div>

    <label class="grid gap-1">
      <span class="form-label">单条记录模板</span>
      <textarea
        :value="textValue(config.itemTemplate)"
        rows="6"
        class="form-textarea"
        placeholder="- {{item.content}}"
        @change="updateRequired('itemTemplate', ($event.target as HTMLTextAreaElement).value)"
      />
    </label>

    <div class="grid gap-2 md:grid-cols-2">
      <label class="grid gap-1">
        <span class="form-label">分隔符</span>
        <input
          :value="config.separator ?? ''"
          class="form-input"
          placeholder="\n"
          @change="updateOptional('separator', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label class="grid gap-1">
        <span class="form-label">空结果文本</span>
        <input
          :value="config.emptyText ?? ''"
          class="form-input"
          @change="updateOptional('emptyText', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label class="grid gap-1">
        <span class="form-label">前缀</span>
        <input
          :value="config.prefix ?? ''"
          class="form-input"
          @change="updateOptional('prefix', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label class="grid gap-1">
        <span class="form-label">后缀</span>
        <input
          :value="config.suffix ?? ''"
          class="form-input"
          @change="updateOptional('suffix', ($event.target as HTMLInputElement).value)"
        />
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  config: Record<string, unknown>
  onUpdate: (config: Record<string, unknown>) => void
}>()

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function updateRequired(key: string, value: string) {
  props.onUpdate({ ...props.config, [key]: value })
}

function updateOptional(key: string, raw: string) {
  props.onUpdate({ ...props.config, [key]: raw || undefined })
}
</script>

<style scoped>
.form-label {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 10px;
  line-height: 1rem;
  letter-spacing: 0;
  text-transform: uppercase;
  color: #608996;
}

.form-input,
.form-textarea {
  width: 100%;
  border: 1px solid rgba(0, 139, 139, 0.4);
  background: #080c11;
  padding: 0.25rem 0.5rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 0.75rem;
  color: #e0f7fa;
  outline: none;
}

.form-textarea {
  resize: vertical;
}
</style>
