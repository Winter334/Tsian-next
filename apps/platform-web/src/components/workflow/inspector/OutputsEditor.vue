<template>
  <div class="space-y-2">
    <div class="flex items-center justify-between">
      <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
        输出端口
      </label>
      <button
        class="font-mono text-[10px] text-neon hover:text-neon/80"
        @click="addOutput"
      >
        + 添加
      </button>
    </div>
    <div
      v-for="(output, idx) in outputs"
      :key="idx"
      class="grid gap-1 border border-neon-deep/20 bg-void/40 p-2"
    >
      <div class="flex items-center gap-1">
        <input
          :value="output.name"
          class="min-w-0 flex-1 border border-neon-deep/40 bg-void px-2 py-1 font-mono text-[10px] text-text-main outline-none focus:border-neon"
          placeholder="输出名"
          @change="updateOutputName(idx, ($event.target as HTMLInputElement).value)"
        />
        <select
          :value="getExtract(output).type"
          class="w-20 border border-neon-deep/40 bg-void px-1 py-1 font-mono text-[10px] text-text-main outline-none focus:border-neon"
          @change="updateExtractType(idx, ($event.target as HTMLSelectElement).value as ExtractType)"
        >
          <option value="raw">raw</option>
          <option value="tag">tag</option>
          <option value="regex">regex</option>
        </select>
        <button
          class="px-1 font-mono text-xs text-danger hover:text-danger/80"
          @click="removeOutput(idx)"
        >
          ×
        </button>
      </div>

      <div class="grid grid-cols-2 gap-1">
        <select
          :value="getExtract(output).parse ?? ''"
          class="border border-neon-deep/30 bg-void px-1 py-1 font-mono text-[10px] text-text-main outline-none focus:border-neon"
          @change="updateParse(idx, ($event.target as HTMLSelectElement).value as ParseValue)"
        >
          <option value="">text</option>
          <option value="json">json</option>
          <option value="number">number</option>
        </select>
        <input
          v-if="getExtract(output).type === 'tag'"
          :value="getTagExtract(output).tag"
          class="border border-neon-deep/30 bg-void px-2 py-1 font-mono text-[10px] text-text-main outline-none focus:border-neon"
          placeholder="tag"
          @change="updateTag(idx, ($event.target as HTMLInputElement).value)"
        />
        <span v-else class="border border-neon-deep/10 bg-void px-2 py-1 font-mono text-[10px] text-text-dim">
          {{ getExtract(output).type }}
        </span>
      </div>

      <div v-if="getExtract(output).type === 'regex'" class="grid gap-1">
        <input
          :value="getRegexExtract(output).pattern"
          class="w-full border border-neon-deep/30 bg-void px-2 py-1 font-mono text-[10px] text-text-main outline-none focus:border-neon"
          placeholder="regex pattern"
          @change="updateRegex(idx, { pattern: ($event.target as HTMLInputElement).value })"
        />
        <div class="grid grid-cols-2 gap-1">
          <input
            :value="getRegexExtract(output).flags ?? ''"
            class="border border-neon-deep/30 bg-void px-2 py-1 font-mono text-[10px] text-text-main outline-none focus:border-neon"
            placeholder="flags"
            @change="updateRegex(idx, { flags: ($event.target as HTMLInputElement).value })"
          />
          <input
            type="number"
            min="0"
            :value="getRegexExtract(output).group ?? ''"
            class="border border-neon-deep/30 bg-void px-2 py-1 font-mono text-[10px] text-text-main outline-none focus:border-neon"
            placeholder="group"
            @change="updateRegexGroup(idx, ($event.target as HTMLInputElement).value)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type {
  NodeOutputDeclaration,
  NodeOutputExtractRule,
} from '@tsian/contracts'

type ExtractType = NodeOutputExtractRule['type']
type ParseValue = '' | 'json' | 'number'
type TagExtractRule = Extract<NodeOutputExtractRule, { type: 'tag' }>
type RegexExtractRule = Extract<NodeOutputExtractRule, { type: 'regex' }>

const props = defineProps<{
  outputs: NodeOutputDeclaration[]
  onUpdate: (outputs: NodeOutputDeclaration[]) => void
}>()

function withParse<T extends NodeOutputExtractRule>(
  rule: T,
  parse: NodeOutputExtractRule['parse'],
): T {
  if (!parse) return rule
  return { ...rule, parse }
}

function getExtract(output: NodeOutputDeclaration): NodeOutputExtractRule {
  return output.extract ?? { type: 'raw' }
}

function getTagExtract(output: NodeOutputDeclaration): TagExtractRule {
  const extract = getExtract(output)
  return extract.type === 'tag' ? extract : { type: 'tag', tag: '' }
}

function getRegexExtract(output: NodeOutputDeclaration): RegexExtractRule {
  const extract = getExtract(output)
  return extract.type === 'regex' ? extract : { type: 'regex', pattern: '' }
}

function updateOutput(idx: number, next: NodeOutputDeclaration) {
  props.onUpdate(props.outputs.map((output, i) => (i === idx ? next : output)))
}

function addOutput() {
  props.onUpdate([...props.outputs, { name: '', extract: { type: 'raw' } }])
}

function removeOutput(idx: number) {
  props.onUpdate(props.outputs.filter((_, i) => i !== idx))
}

function updateOutputName(idx: number, value: string) {
  const current = props.outputs[idx]
  if (!current) return
  updateOutput(idx, { ...current, name: value.trim() })
}

function updateExtractType(idx: number, type: ExtractType) {
  const current = props.outputs[idx]
  if (!current) return
  const previous = getExtract(current)
  const parse = previous.parse
  const extract =
    type === 'tag'
      ? withParse({ type: 'tag', tag: previous.type === 'tag' ? previous.tag : '' }, parse)
      : type === 'regex'
        ? withParse({
          type: 'regex',
          pattern: previous.type === 'regex' ? previous.pattern : '',
          flags: previous.type === 'regex' ? previous.flags : undefined,
          group: previous.type === 'regex' ? previous.group : undefined,
        }, parse)
        : withParse({ type: 'raw' }, parse)

  updateOutput(idx, { ...current, extract })
}

function updateParse(idx: number, parse: ParseValue) {
  const current = props.outputs[idx]
  if (!current) return
  const extract = { ...getExtract(current) }
  if (parse) {
    extract.parse = parse
  } else {
    delete extract.parse
  }
  updateOutput(idx, { ...current, extract })
}

function updateTag(idx: number, tag: string) {
  const current = props.outputs[idx]
  if (!current) return
  const previous = getExtract(current)
  updateOutput(idx, {
    ...current,
    extract: withParse({ type: 'tag', tag: tag.trim() }, previous.parse),
  })
}

function updateRegex(idx: number, patch: Partial<Pick<RegexExtractRule, 'pattern' | 'flags'>>) {
  const current = props.outputs[idx]
  if (!current) return
  const previous = getRegexExtract(current)
  const extract: RegexExtractRule = {
    ...previous,
    ...patch,
    flags: patch.flags !== undefined
      ? (patch.flags.trim() || undefined)
      : previous.flags,
  }
  updateOutput(idx, { ...current, extract })
}

function updateRegexGroup(idx: number, raw: string) {
  const current = props.outputs[idx]
  if (!current) return
  const previous = getRegexExtract(current)
  const group = raw.trim() ? Math.max(0, parseInt(raw, 10) || 0) : undefined
  const extract: RegexExtractRule = { ...previous, group }
  updateOutput(idx, { ...current, extract })
}
</script>
