<script setup lang="ts">
import { ref, computed } from "vue"
import { CollapsibleRoot, CollapsibleTrigger, CollapsibleContent } from "reka-ui"

/**
 * ProcessNode — 过程节点（interim/thought/tool/tool-group）。
 *
 * prd 屏3：折叠卡 --void-deep + --line 边 + inset shadow；标签 mono。
 * tool-group：同 round 连续普通工具合并成自然语言摘要，展开看明细。
 * 接受 useTsian 的 StreamItem（kind 字段）或 tool-group 合并节点。
 *
 * 折叠动画：reka-ui CollapsibleContent 暴露 --reka-collapsible-content-height，
 * 用 data-state 驱动 keyframe。注意选择器必须精准命中 content 元素（.collapsible-body），
 * 不能用裸 [data-state]——Trigger 也有 data-state 但无该 CSS 变量，命中会导致高度跳动闪烁。
 */
/** 过程节点数据（interim/thought/tool/tool-group）。供 RoundProcess 复用。 */
export type ProcessNodeData = {
  kind: "interim" | "thought" | "tool" | "tool-group"
  id: string
  round?: number
  name?: string
  status?: "loading" | "running" | "success" | "failed"
  text?: string
  agentId?: string | null
  collapsed?: boolean
  tools?: Array<{ kind: "tool"; id: string; name: string; status: "loading" | "running" | "success" | "failed" }>
}

const props = defineProps<{
  node: ProcessNodeData
}>()

// 初始展开状态：thought/tool/tool-group 默认折叠，interim 默认展开（镜像 legacy）
const open = ref(props.node.kind === "interim")

const kindLabel: Record<string, string> = {
  thought: "思考",
  tool: "工具",
  interim: "过渡",
  "tool-group": "工具",
}

// 工具名 → 玩家可读摘要（移植自 legacy main.ts TOOL_LABEL）
const TOOL_LABEL: Record<string, { verb: string; noun: string; unit: string | null }> = {
  read: { verb: "读取", noun: "文件", unit: "个" },
  list: { verb: "列出", noun: "条目", unit: "项" },
  search: { verb: "搜索", noun: "匹配", unit: "处" },
  glob: { verb: "匹配", noun: "文件", unit: "个" },
  diff: { verb: "比对", noun: "差异", unit: null },
  write: { verb: "写入", noun: "文件", unit: null },
  edit: { verb: "编辑", noun: "文件", unit: null },
  move: { verb: "移动", noun: "文件", unit: null },
  delete: { verb: "删除", noun: "文件", unit: null },
  semantic_search: { verb: "语义检索", noun: "记忆", unit: null },
  use_skill: { verb: "激活", noun: "技能", unit: null },
  run_script: { verb: "执行", noun: "脚本", unit: null },
  inspect_frontend: { verb: "自检", noun: "前端", unit: null },
  ask_user: { verb: "向玩家", noun: "提问", unit: null },
}

// tool-group 合并摘要
const groupSummary = computed(() => {
  if (props.node.kind !== "tool-group" || !props.node.tools) return ""
  const tools = props.node.tools
  const byName = new Map<string, { count: number; name: string; status: string }>()
  for (const t of tools) {
    const existing = byName.get(t.name)
    if (existing) existing.count += 1
    else byName.set(t.name, { count: 1, name: t.name, status: t.status })
  }
  const sentences: string[] = []
  for (const { count, name, status } of byName.values()) {
    const label = TOOL_LABEL[name]
    const verb = label?.verb ?? name
    const noun = label?.noun ?? "操作"
    if (status === "failed") {
      sentences.push(`${verb}${noun}失败`)
      continue
    }
    const unit = label?.unit ?? null
    if (unit && count > 1) sentences.push(`${verb}了 ${count} ${unit}${noun}`)
    else sentences.push(`${verb}了${noun}`)
  }
  return sentences.join("、")
})

// interim/thought 首行预览
const preview = computed(() => {
  const text = props.node.text
  if (!text) return ""
  return text.slice(0, 50) + (text.length > 50 ? "…" : "")
})
</script>

<template>
  <CollapsibleRoot v-model:open="open">
    <div class="process-node" :class="[node.kind, node.status]">
      <CollapsibleTrigger class="process-head">
        <span v-if="node.agentId" class="agent-tag">{{ node.agentId }}</span>
        <span v-if="node.agentId" class="glyph">·</span>
        <span class="node-kind">{{ kindLabel[node.kind] }}</span>
        <span v-if="node.kind === 'tool-group'" class="node-summary">{{ groupSummary }}</span>
        <span v-else-if="node.kind === 'tool' && node.name" class="node-name">{{ node.name }}</span>
        <span v-else-if="preview" class="node-preview">{{ preview }}</span>
        <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M9 6l6 6-6 6"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </CollapsibleTrigger>
      <CollapsibleContent class="collapsible-body">
        <div class="process-body">
          <template v-if="node.kind === 'tool-group' && node.tools">
            <div v-for="(t, i) in node.tools" :key="i" class="tool-item">
              <span class="tool-item-name">{{ t.name }}</span>
              <span class="tool-item-status">{{ t.status }}</span>
            </div>
          </template>
          <template v-else-if="node.text">{{ node.text }}</template>
          <template v-else-if="node.status === 'failed'">失败</template>
          <template v-else>（无内容）</template>
        </div>
      </CollapsibleContent>
    </div>
  </CollapsibleRoot>
</template>

<style scoped>
.process-node {
  background: var(--void-deep);
  border: 1px solid var(--line);
  border-radius: 4px;
  box-shadow: inset 0 0 12px rgba(0, 0, 0, 0.4);
  margin: 8px 0;
  overflow: hidden;
}
.process-node.failed {
  border-color: var(--blood);
}

.process-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  background: transparent;
  border: none;
  width: 100%;
  text-align: left;
  font-family: var(--font-mono);
  font-size: 0.78rem;
}
.process-head:hover {
  background: rgba(181, 137, 61, 0.05);
}

.agent-tag { color: var(--ember); }
.glyph { color: var(--prose-faint); }
.node-kind { color: var(--ember); letter-spacing: 0.06em; flex-shrink: 0; }
.node-name { color: var(--prose-muted); }
.node-summary { color: var(--prose); font-family: var(--font-serif); font-size: 0.85rem; }
.node-preview {
  color: var(--prose-muted);
  font-family: var(--font-serif);
  font-size: 0.85rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* chevron：展开时旋转 90°，过渡平滑 */
.chevron {
  margin-left: auto;
  color: var(--prose-faint);
  flex-shrink: 0;
  width: 13px;
  height: 13px;
  transform: rotate(0deg);
  transition: transform 0.25s ease, color 0.2s ease;
}
/* CollapsibleRoot open 时（data-state=open）旋转 chevron */
.process-node:has([data-state="open"]) .chevron {
  transform: rotate(90deg);
  color: var(--ember);
}
.process-head:hover .chevron {
  color: var(--ember);
}

/* reka-ui CollapsibleContent 展开/收起动画。
   精准命中 .collapsible-body（content 元素），避免裸 [data-state] 误伤 Trigger。
   overflow hidden 防止高度动画期间内容溢出闪烁。 */
:deep(.collapsible-body) {
  overflow: hidden;
}
:deep(.collapsible-body[data-state="open"]) {
  animation: collapsible-open 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}
:deep(.collapsible-body[data-state="closed"]) {
  animation: collapsible-close 0.22s cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes collapsible-open {
  from { height: 0; opacity: 0; }
  to { height: var(--reka-collapsible-content-height); opacity: 1; }
}
@keyframes collapsible-close {
  from { height: var(--reka-collapsible-content-height); opacity: 1; }
  to { height: 0; opacity: 0; }
}

.process-body {
  padding: 8px 12px 12px;
  font-family: var(--font-mono);
  font-size: 0.78rem;
  color: var(--prose-muted);
  border-top: 1px solid var(--line);
}
.tool-item { display: flex; justify-content: space-between; padding: 4px 0; }
.tool-item-name { color: var(--ember); }
.tool-item-status { color: var(--prose-faint); }
</style>
