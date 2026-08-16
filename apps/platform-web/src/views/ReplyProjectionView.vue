<template>
  <section class="reply-projection-view grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
    <header class="retro-toolbar flex min-w-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
      <div class="min-w-0">
        <p class="truncate text-sm font-bold text-text-main">{{ cardTitle }}</p>
        <p class="font-mono text-[11px] text-text-dim">正文处理</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
          :disabled="!card || (!fileExists && readOnly)"
          @click="openWorkspaceEditor"
        >
          <FilePenLine class="h-3.5 w-3.5" aria-hidden="true" />
          编辑配置文件
        </button>
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
          :disabled="loading || saving"
          @click="reload"
        >
          <RefreshCw class="h-3.5 w-3.5" aria-hidden="true" />
          刷新
        </button>
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
          :disabled="!canEdit || !hasDraftChanges || saving"
          @click="save"
        >
          <Save class="h-3.5 w-3.5" aria-hidden="true" />
          {{ saving ? "保存中…" : "保存" }}
        </button>
      </div>
    </header>

    <main class="min-h-0 overflow-auto p-3">
      <div v-if="loading" class="retro-inset grid min-h-[360px] place-items-center">
        <p class="font-mono text-xs uppercase tracking-[0.22em] text-neon">正在读取配置</p>
      </div>

      <div v-else-if="!card" class="retro-inset grid min-h-[360px] place-items-center p-5 text-center">
        <div class="max-w-sm">
          <FileJson2 class="mx-auto h-10 w-10 text-neon-muted" aria-hidden="true" />
          <p class="mt-3 text-sm font-bold text-text-main">未加载游戏卡</p>
          <p class="mt-2 text-sm leading-6 text-text-dim">请先加载一张游戏卡，再配置正文处理规则。</p>
          <button type="button" class="retro-button retro-focus mt-4 h-8 px-3 font-mono text-xs" @click="goToLibrary">去我的应用</button>
        </div>
      </div>

      <div v-else-if="loadError" class="retro-inset grid min-h-[360px] place-items-center p-5">
        <div class="max-w-lg border border-danger/40 bg-danger/10 p-4">
          <p class="font-mono text-xs uppercase tracking-wider text-danger">配置不可用</p>
          <p class="mt-2 text-sm leading-6 text-text-dim">{{ loadError }}</p>
        </div>
      </div>

      <div v-else-if="unsupportedReason" class="retro-inset grid min-h-[360px] place-items-center p-5">
        <div class="max-w-lg border border-danger/40 bg-danger/10 p-4">
          <p class="font-mono text-xs uppercase tracking-wider text-danger">无法安全地结构化编辑</p>
          <p class="mt-2 text-sm leading-6 text-text-dim">{{ unsupportedReason }}</p>
          <p class="mt-2 text-xs leading-5 text-text-dim">原配置没有被修改。可在资源管理器中直接编辑该文件。</p>
          <button type="button" class="retro-button retro-focus mt-4 inline-flex h-8 items-center gap-2 px-3 font-mono text-xs" @click="openWorkspaceEditor">
            <FilePenLine class="h-3.5 w-3.5" aria-hidden="true" />编辑配置文件
          </button>
        </div>
      </div>

      <div v-else-if="missingConfig" class="retro-inset grid min-h-[360px] place-items-center p-5 text-center">
        <div class="max-w-sm">
          <ListPlus class="mx-auto h-10 w-10 text-neon-muted" aria-hidden="true" />
          <p class="mt-3 text-sm font-bold text-text-main">尚未配置正文处理</p>
          <p class="mt-2 text-sm leading-6 text-text-dim">没有规则时，回复会保持原样。</p>
          <p v-if="readOnly" class="mt-2 text-xs leading-5 text-danger">当前游戏卡为只读，请先复制为本地游戏卡。</p>
          <button v-else type="button" class="retro-button retro-focus mt-4 h-8 px-3 font-mono text-xs" @click="createConfig">创建配置</button>
        </div>
      </div>

      <div v-else-if="draft" class="reply-projection-workspace grid min-h-full min-w-0 gap-3">
        <aside class="retro-inset grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
          <header class="flex items-center justify-between gap-2 border-b border-neon-deep/35 px-3 py-2">
            <div>
              <p class="font-mono text-xs uppercase tracking-wider text-neon">有序规则</p>
              <p class="mt-0.5 font-mono text-[10px] text-text-dim">{{ draft.rules.length }} 条</p>
            </div>
            <button type="button" class="retro-button retro-focus inline-flex h-7 items-center gap-1.5 px-2 font-mono text-[11px]" :disabled="!canEdit" @click="addRule">
              <Plus class="h-3.5 w-3.5" aria-hidden="true" />新增
            </button>
          </header>

          <div class="reply-projection-list min-h-0 overflow-auto p-2" role="listbox" aria-label="正文处理规则">
            <p v-if="draft.rules.length === 0" class="p-3 text-center text-sm leading-6 text-text-dim">没有规则，回复保持原样。</p>
            <button
              v-for="(rule, index) in draft.rules"
              :key="rule.clientKey"
              type="button"
              class="retro-focus mb-2 grid w-full min-w-0 gap-1 border p-2.5 text-left last:mb-0"
              :class="selectedRuleKey === rule.clientKey ? 'border-neon bg-neon/10' : 'border-neon-deep/35 bg-panel/55 hover:bg-elevated/55'"
              role="option"
              :aria-selected="selectedRuleKey === rule.clientKey"
              @click="selectRule(rule.clientKey)"
            >
              <span class="truncate text-sm font-bold text-text-main">{{ ruleTitle(rule, index) }}</span>
              <span class="truncate font-mono text-[11px] text-neon-muted">{{ rule.match || "（空匹配表达式）" }}</span>
              <span class="truncate text-[10px] text-text-dim">{{ ruleTags(rule).join(" · ") }}</span>
            </button>
          </div>

          <footer class="flex flex-wrap items-center gap-1 border-t border-neon-deep/35 p-2">
            <button type="button" class="retro-button retro-focus h-7 px-2 text-[11px]" :disabled="!canEdit || !selectedRule" @click="duplicateRule()">复制</button>
            <button type="button" class="retro-button retro-focus h-7 px-2 text-[11px] text-danger" :disabled="!canEdit || !selectedRule" @click="deleteRule()">删除</button>
            <button type="button" class="retro-button retro-focus grid h-7 w-7 place-items-center" :disabled="!canEdit || selectedRuleIndex <= 0" aria-label="上移规则" @click="selectedRule && moveRule(selectedRule.clientKey, -1)"><ArrowUp class="h-3.5 w-3.5" /></button>
            <button type="button" class="retro-button retro-focus grid h-7 w-7 place-items-center" :disabled="!canEdit || selectedRuleIndex < 0 || selectedRuleIndex >= draft.rules.length - 1" aria-label="下移规则" @click="selectedRule && moveRule(selectedRule.clientKey, 1)"><ArrowDown class="h-3.5 w-3.5" /></button>
          </footer>
        </aside>

        <section class="retro-inset min-h-0 min-w-0 overflow-auto p-3">
          <div v-if="!selectedRule" class="grid min-h-[320px] place-items-center text-sm text-text-dim">
            {{ draft.rules.length ? "选择一条规则。" : "新增规则后在这里编辑详情。" }}
          </div>
          <div v-else class="grid gap-3">
            <section class="reply-projection-section border border-neon-deep/35 bg-panel/45">
              <header><span class="text-text-main">匹配</span><small class="text-text-dim">规则名称与完整 JavaScript 正则字面量</small></header>
              <div class="grid gap-3 p-3">
                <div class="flex flex-wrap items-center gap-3">
                  <Switch :model-value="selectedRule.idPresent" :disabled="!canEdit" aria-label="写入规则名称" @update:model-value="selectedRule.idPresent = Boolean($event)" />
                  <span class="text-xs text-text-main">写入规则名称</span>
                </div>
                <label v-if="selectedRule.idPresent" class="grid gap-1.5">
                  <span class="text-xs font-bold text-text-main">名称（id）</span>
                  <input v-model="selectedRule.id" type="text" class="retro-focus h-9 border border-neon-deep/50 bg-elevated px-3 font-mono text-xs text-text-main" :readonly="!canEdit" />
                </label>
                <label class="grid gap-1.5">
                  <span class="text-xs font-bold text-text-main">正则（match）</span>
                  <input v-model="selectedRule.match" type="text" class="retro-focus h-9 border border-neon-deep/50 bg-elevated px-3 font-mono text-xs text-text-main" :readonly="!canEdit" placeholder="/pattern/g" />
                </label>
              </div>
            </section>

            <section class="reply-projection-section border border-neon-deep/35 bg-panel/45">
              <header><span class="text-text-main">文本替换</span><small class="text-text-dim">选择同一替换，或分别控制上下文与显示文本</small></header>
              <div class="grid gap-3 p-3">
                <div class="flex flex-wrap gap-2" role="group" aria-label="文本替换模式">
                  <button v-for="mode in replacementModes" :key="mode.value" type="button" class="retro-focus h-8 border px-3 font-mono text-xs" :class="selectedRule.replacementMode === mode.value ? 'border-neon bg-neon/10 text-neon' : 'border-neon-deep/40 bg-elevated text-text-dim'" :aria-pressed="selectedRule.replacementMode === mode.value" :disabled="!canEdit" @click="setReplacementMode(mode.value)">{{ mode.label }}</button>
                </div>
                <label v-if="selectedRule.replacementMode === 'text'" class="grid gap-1.5">
                  <span class="text-xs font-bold text-text-main">同时替换（text）</span>
                  <textarea v-model="selectedRule.text" rows="3" class="retro-focus min-h-20 resize-y border border-neon-deep/50 bg-elevated p-3 font-mono text-xs text-text-main" :readonly="!canEdit" />
                </label>
                <div v-else-if="selectedRule.replacementMode === 'split'" class="grid gap-3">
                  <div class="grid gap-2">
                    <div class="flex flex-wrap items-center gap-3"><Switch :model-value="selectedRule.contentPresent" :disabled="!canEdit" aria-label="启用上下文文本替换" @update:model-value="selectedRule.contentPresent = Boolean($event)" /><span class="text-xs font-bold text-text-main">上下文文本（content）</span><span class="text-xs text-text-dim">后续 Agent 会读取</span></div>
                    <textarea v-if="selectedRule.contentPresent" v-model="selectedRule.content" rows="2" class="retro-focus min-h-16 resize-y border border-neon-deep/50 bg-elevated p-3 font-mono text-xs text-text-main" :readonly="!canEdit" />
                  </div>
                  <div class="grid gap-2">
                    <div class="flex flex-wrap items-center gap-3"><Switch :model-value="selectedRule.displayPresent" :disabled="!canEdit" aria-label="启用显示文本替换" @update:model-value="selectedRule.displayPresent = Boolean($event)" /><span class="text-xs font-bold text-text-main">显示文本（display）</span><span class="text-xs text-text-dim">玩家界面会呈现</span></div>
                    <textarea v-if="selectedRule.displayPresent" v-model="selectedRule.display" rows="2" class="retro-focus min-h-16 resize-y border border-neon-deep/50 bg-elevated p-3 font-mono text-xs text-text-main" :readonly="!canEdit" />
                  </div>
                </div>
              </div>
            </section>

            <section class="reply-projection-section border border-neon-deep/35 bg-panel/45">
              <header><span class="text-text-main">数据投影</span><small class="text-text-dim">交给游戏界面的结构化数据；key 以 [] 结尾表示追加</small></header>
              <div class="grid gap-3 p-3">
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div class="flex items-center gap-3"><Switch :model-value="selectedRule.projectPresent" :disabled="!canEdit" aria-label="启用数据投影" @update:model-value="selectedRule.projectPresent = Boolean($event)" /><span class="text-xs text-text-main">启用数据投影（project）</span></div>
                  <button v-if="selectedRule.projectPresent" type="button" class="retro-button retro-focus inline-flex h-7 items-center gap-1.5 px-2 text-[11px]" :disabled="!canEdit" @click="addProjectRow"><Plus class="h-3.5 w-3.5" />新增一项</button>
                </div>
                <p v-if="selectedRule.projectPresent" class="text-xs leading-5 text-text-dim">表达式保持完整管道格式，例如 <code class="font-mono text-neon-muted">$1|lines|stripList</code>。</p>
                <div v-if="selectedRule.projectPresent" class="grid gap-2">
                  <div v-for="row in selectedRule.projectRows" :key="row.clientKey" class="reply-projection-project-row grid min-w-0 gap-2">
                    <label class="grid min-w-0 gap-1"><span class="font-mono text-[10px] text-text-dim">KEY</span><input v-model="row.key" type="text" class="retro-focus h-8 min-w-0 border border-neon-deep/50 bg-elevated px-2 font-mono text-xs text-text-main" :readonly="!canEdit" placeholder="key 或 key[]" /></label>
                    <label class="grid min-w-0 gap-1"><span class="font-mono text-[10px] text-text-dim">表达式</span><input v-model="row.expression" type="text" class="retro-focus h-8 min-w-0 border border-neon-deep/50 bg-elevated px-2 font-mono text-xs text-text-main" :readonly="!canEdit" placeholder="$1|trim" /></label>
                    <button type="button" class="retro-button retro-focus mt-5 grid h-8 w-8 place-items-center text-danger" :disabled="!canEdit" aria-label="删除数据投影项" @click="removeProjectRow(row.clientKey)"><Trash2 class="h-3.5 w-3.5" /></button>
                  </div>
                  <p v-if="selectedRule.projectRows.length === 0" class="border border-neon-deep/25 bg-elevated/35 p-3 text-xs text-text-dim">当前会保存为空的数据投影对象。</p>
                </div>
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>

    <footer class="retro-statusbar flex min-h-9 items-center justify-between gap-3 border-t px-3 py-2">
      <p class="min-w-0 truncate text-sm" :class="statusTone">{{ statusMessage }}</p>
      <p class="shrink-0 font-mono text-[11px] text-text-dim">{{ statusLabel }}</p>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { useRoute, useRouter } from "vue-router"
import { ArrowDown, ArrowUp, FileJson2, FilePenLine, ListPlus, Plus, RefreshCw, Save, Trash2 } from "lucide-vue-next"
import { Switch } from "@/components/ui/switch"
import { useReplyProjectionController } from "@/controllers/reply-projection/use-reply-projection-controller"
import type { ReplyProjectionReplacementMode } from "@/controllers/reply-projection/reply-projection-draft"

const props = defineProps<{ minimized?: boolean }>()
const route = useRoute()
const router = useRouter()
const replacementModes: Array<{ value: ReplyProjectionReplacementMode; label: string }> = [
  { value: "none", label: "不替换" },
  { value: "text", label: "同时替换" },
  { value: "split", label: "分别替换" },
]

const controller = useReplyProjectionController({
  route,
  minimized: () => props.minimized,
  openWorkspaceEditor(input) {
    void router.push({ name: "workspace-editor", query: input })
  },
  openLibrary() { void router.push("/library") },
})
const {
  card, draft, selectedRule, selectedRuleIndex, selectedRuleKey, loading, saving,
  readOnly, fileExists, missingConfig, unsupportedReason, loadError,
  hasDraftChanges, canEdit, cardTitle, statusMessage, statusKind, statusLabel, createConfig,
  selectRule, addRule, duplicateRule, deleteRule, moveRule, setReplacementMode,
  addProjectRow, removeProjectRow, ruleTitle, ruleTags, save, reload,
  openWorkspaceEditor, goToLibrary,
} = controller

const statusTone = computed(() => {
  if (statusKind.value === "danger") return "text-danger"
  if (statusKind.value === "warning") return "text-warning"
  if (statusKind.value === "success") return "text-neon"
  return "text-text-dim"
})
</script>

<style scoped>
.reply-projection-view { container-type: inline-size; }
.reply-projection-workspace { grid-template-rows: minmax(190px, 0.42fr) minmax(360px, 1fr); }
.reply-projection-section > header { display:flex; min-width:0; flex-wrap:wrap; align-items:baseline; justify-content:space-between; gap:.35rem 1rem; padding:.55rem .75rem; border-bottom:1px solid currentColor; }
.reply-projection-section > header { border-bottom-color:color-mix(in srgb,currentColor 18%,transparent); }
.reply-projection-section > header span { font-size:.8rem; font-weight:700; }
.reply-projection-section > header small { font-size:.68rem; }
.reply-projection-project-row { grid-template-columns:minmax(110px,.42fr) minmax(180px,1fr) auto; }
@container (min-width: 820px) {
  .reply-projection-workspace { grid-template-columns:minmax(230px,300px) minmax(0,1fr); grid-template-rows:minmax(0,1fr); }
}
@container (max-width: 520px) {
  .reply-projection-project-row { grid-template-columns:minmax(0,1fr) auto; }
  .reply-projection-project-row label:nth-child(2) { grid-column:1 / -1; grid-row:2; }
  .reply-projection-project-row button { grid-column:2; grid-row:1; }
}
</style>
