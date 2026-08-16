<template>
  <section class="spatial-app spatial-reply-projection" aria-label="正文处理">
    <header class="spatial-app__header">
      <div class="spatial-app__identity">
        <span class="spatial-app__eyebrow">REPLY PROJECTION</span>
        <h1>{{ cardTitle }}</h1>
      </div>
      <div class="spatial-app__commands">
        <SpatialActionButton :disabled="!card || (!fileExists && readOnly)" @click="openWorkspaceEditor">
          <template #icon><FilePenLine /></template>编辑配置文件
        </SpatialActionButton>
        <SpatialActionButton :disabled="loading || saving" @click="reload">
          <template #icon><RefreshCw /></template>刷新
        </SpatialActionButton>
        <SpatialActionButton variant="primary" :disabled="!canEdit || !hasDraftChanges || saving" @click="save">
          <template #icon><Save /></template>{{ saving ? "保存中…" : "保存" }}
        </SpatialActionButton>
      </div>
    </header>

    <main v-if="loading" class="spatial-app__empty" role="status">正在读取正文处理配置…</main>
    <main v-else-if="!card" class="spatial-app__empty spatial-reply-projection__center">
      <FileJson2 aria-hidden="true" /><strong>未加载游戏卡</strong><span>请先加载一张游戏卡，再配置正文处理规则。</span>
      <SpatialActionButton variant="primary" @click="goToLibrary">去我的应用</SpatialActionButton>
    </main>
    <main v-else-if="loadError" class="spatial-app__banner spatial-app__banner--error" role="alert">{{ loadError }}</main>
    <main v-else-if="unsupportedReason" class="spatial-app__empty spatial-reply-projection__center">
      <FileWarning aria-hidden="true" /><strong>无法安全地结构化编辑</strong><span>{{ unsupportedReason }}</span><small>原配置没有被修改。</small>
      <SpatialActionButton @click="openWorkspaceEditor"><template #icon><FilePenLine /></template>编辑配置文件</SpatialActionButton>
    </main>
    <main v-else-if="missingConfig" class="spatial-app__empty spatial-reply-projection__center">
      <ListPlus aria-hidden="true" /><strong>尚未配置正文处理</strong><span>没有规则时，回复会保持原样。</span>
      <small v-if="readOnly">当前游戏卡为只读，请先复制为本地游戏卡。</small>
      <SpatialActionButton v-else variant="primary" @click="createConfig">创建配置</SpatialActionButton>
    </main>

    <main v-else-if="draft" class="spatial-reply-projection__workspace">
      <aside class="spatial-reply-projection__rules" aria-label="正文处理规则">
        <div class="spatial-reply-projection__panel-title">
          <div><span class="spatial-app__eyebrow">ORDERED RULES</span><strong>{{ draft.rules.length }}</strong></div>
          <SpatialActionButton :disabled="!canEdit" @click="addRule"><template #icon><Plus /></template>新增</SpatialActionButton>
        </div>
        <div class="spatial-reply-projection__rule-list" role="listbox">
          <p v-if="draft.rules.length === 0" class="spatial-app__empty">没有规则，回复保持原样。</p>
          <button
            v-for="(rule, index) in draft.rules"
            :key="rule.clientKey"
            type="button"
            class="spatial-reply-projection__rule"
            :class="{ 'spatial-reply-projection__rule--active': selectedRuleKey === rule.clientKey }"
            role="option"
            :aria-selected="selectedRuleKey === rule.clientKey"
            @click="selectRule(rule.clientKey)"
          >
            <strong>{{ ruleTitle(rule, index) }}</strong>
            <code>{{ rule.match || "（空匹配表达式）" }}</code>
            <small>{{ ruleTags(rule).join(" · ") }}</small>
          </button>
        </div>
        <div class="spatial-app__actions spatial-reply-projection__rule-actions">
          <SpatialActionButton :disabled="!canEdit || !selectedRule" @click="duplicateRule()"><template #icon><Copy /></template>复制</SpatialActionButton>
          <SpatialActionButton variant="danger" :disabled="!canEdit || !selectedRule" @click="deleteRule()"><template #icon><Trash2 /></template>删除</SpatialActionButton>
          <SpatialActionButton icon-only aria-label="上移规则" :disabled="!canEdit || selectedRuleIndex <= 0" @click="selectedRule && moveRule(selectedRule.clientKey, -1)"><template #icon><ArrowUp /></template></SpatialActionButton>
          <SpatialActionButton icon-only aria-label="下移规则" :disabled="!canEdit || selectedRuleIndex < 0 || selectedRuleIndex >= draft.rules.length - 1" @click="selectedRule && moveRule(selectedRule.clientKey, 1)"><template #icon><ArrowDown /></template></SpatialActionButton>
        </div>
      </aside>

      <section class="spatial-reply-projection__detail">
        <div v-if="!selectedRule" class="spatial-app__empty spatial-reply-projection__center">
          {{ draft.rules.length ? "选择一条规则。" : "新增规则后在这里编辑详情。" }}
        </div>
        <template v-else>
          <section class="spatial-app__section spatial-reply-projection__section">
            <div class="spatial-reply-projection__section-title"><div><h2>匹配</h2><small>规则名称与完整 JavaScript 正则字面量</small></div></div>
            <button type="button" class="spatial-reply-projection__toggle" :aria-pressed="selectedRule.idPresent" :disabled="!canEdit" @click="selectedRule.idPresent = !selectedRule.idPresent"><b>{{ selectedRule.idPresent ? "ON" : "OFF" }}</b>写入规则名称</button>
            <label v-if="selectedRule.idPresent" class="spatial-app__field"><span>名称（id）</span><input v-model="selectedRule.id" type="text" :readonly="!canEdit" /></label>
            <label class="spatial-app__field"><span>正则（match）</span><input v-model="selectedRule.match" type="text" :readonly="!canEdit" placeholder="/pattern/g" /></label>
          </section>

          <section class="spatial-app__section spatial-reply-projection__section">
            <div class="spatial-reply-projection__section-title"><div><h2>文本替换</h2><small>同一替换，或分别控制上下文与显示文本</small></div></div>
            <div class="spatial-app__segments" role="group" aria-label="文本替换模式">
              <button v-for="mode in replacementModes" :key="mode.value" type="button" class="spatial-app__segment" :aria-pressed="selectedRule.replacementMode === mode.value" :disabled="!canEdit" @click="setReplacementMode(mode.value)">{{ mode.label }}</button>
            </div>
            <label v-if="selectedRule.replacementMode === 'text'" class="spatial-app__field"><span>同时替换（text）</span><textarea v-model="selectedRule.text" :readonly="!canEdit" /></label>
            <div v-else-if="selectedRule.replacementMode === 'split'" class="spatial-reply-projection__split">
              <div>
                <button type="button" class="spatial-reply-projection__toggle" :aria-pressed="selectedRule.contentPresent" :disabled="!canEdit" @click="selectedRule.contentPresent = !selectedRule.contentPresent"><b>{{ selectedRule.contentPresent ? "ON" : "OFF" }}</b>上下文文本（content）<small>后续 Agent 会读取</small></button>
                <label v-if="selectedRule.contentPresent" class="spatial-app__field"><textarea v-model="selectedRule.content" :readonly="!canEdit" /></label>
              </div>
              <div>
                <button type="button" class="spatial-reply-projection__toggle" :aria-pressed="selectedRule.displayPresent" :disabled="!canEdit" @click="selectedRule.displayPresent = !selectedRule.displayPresent"><b>{{ selectedRule.displayPresent ? "ON" : "OFF" }}</b>显示文本（display）<small>玩家界面会呈现</small></button>
                <label v-if="selectedRule.displayPresent" class="spatial-app__field"><textarea v-model="selectedRule.display" :readonly="!canEdit" /></label>
              </div>
            </div>
          </section>

          <section class="spatial-app__section spatial-reply-projection__section">
            <div class="spatial-reply-projection__section-title">
              <div><h2>数据投影</h2><small>交给游戏界面的结构化数据；key[] 表示追加</small></div>
              <SpatialActionButton v-if="selectedRule.projectPresent" :disabled="!canEdit" @click="addProjectRow"><template #icon><Plus /></template>新增一项</SpatialActionButton>
            </div>
            <button type="button" class="spatial-reply-projection__toggle" :aria-pressed="selectedRule.projectPresent" :disabled="!canEdit" @click="selectedRule.projectPresent = !selectedRule.projectPresent"><b>{{ selectedRule.projectPresent ? "ON" : "OFF" }}</b>启用数据投影（project）</button>
            <p v-if="selectedRule.projectPresent" class="spatial-reply-projection__hint">表达式保持完整管道格式，例如 <code>$1|lines|stripList</code>。</p>
            <div v-if="selectedRule.projectPresent" class="spatial-reply-projection__projects">
              <div v-for="row in selectedRule.projectRows" :key="row.clientKey" class="spatial-reply-projection__project-row">
                <label class="spatial-app__field"><span>KEY</span><input v-model="row.key" type="text" :readonly="!canEdit" placeholder="key 或 key[]" /></label>
                <label class="spatial-app__field"><span>表达式</span><input v-model="row.expression" type="text" :readonly="!canEdit" placeholder="$1|trim" /></label>
                <SpatialActionButton icon-only variant="danger" aria-label="删除数据投影项" :disabled="!canEdit" @click="removeProjectRow(row.clientKey)"><template #icon><Trash2 /></template></SpatialActionButton>
              </div>
              <p v-if="selectedRule.projectRows.length === 0" class="spatial-app__empty">当前会保存为空的数据投影对象。</p>
            </div>
          </section>
        </template>
      </section>
    </main>

    <footer class="spatial-app__status spatial-reply-projection__status" :data-tone="statusKind">
      <span>{{ statusMessage }}</span><small>{{ statusLabel }}</small>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { useRoute, useRouter } from "vue-router"
import { ArrowDown, ArrowUp, Copy, FileJson2, FilePenLine, FileWarning, ListPlus, Plus, RefreshCw, Save, Trash2 } from "lucide-vue-next"
import { useReplyProjectionController } from "@/controllers/reply-projection/use-reply-projection-controller"
import type { ReplyProjectionReplacementMode } from "@/controllers/reply-projection/reply-projection-draft"
import SpatialActionButton from "../primitives/SpatialActionButton.vue"
import "../spatial-apps.css"

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
  openWorkspaceEditor(input) { void router.push({ name: "workspace-editor", query: input }) },
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
</script>

<style scoped>
.spatial-reply-projection { grid-template-rows:auto minmax(0,1fr) auto; }
.spatial-reply-projection__center { place-content:center; justify-items:center; text-align:center; }
.spatial-reply-projection__center > svg { width:40px; height:40px; color:var(--spatial-window-accent); }
.spatial-reply-projection__center strong { color:var(--spatial-window-ink); }
.spatial-reply-projection__workspace { display:grid; min-width:0; min-height:0; grid-template-columns:minmax(190px,.32fr) minmax(0,1fr); overflow:hidden; }
.spatial-reply-projection__rules { display:grid; min-width:0; min-height:0; grid-template-rows:auto minmax(0,1fr) auto; border-right:1px solid var(--spatial-app-border); background:var(--spatial-app-surface-muted); }
.spatial-reply-projection__panel-title,.spatial-reply-projection__section-title { display:flex; min-width:0; align-items:center; justify-content:space-between; gap:9px; }
.spatial-reply-projection__panel-title { padding:9px; border-bottom:1px solid var(--spatial-app-border); }
.spatial-reply-projection__panel-title > div { display:flex; align-items:center; gap:8px; }
.spatial-reply-projection__rule-list,.spatial-reply-projection__detail { min-width:0; min-height:0; overflow:auto; }
.spatial-reply-projection__rule-list { padding:8px; }
.spatial-reply-projection__rule { display:grid; width:100%; min-width:0; margin-bottom:6px; padding:9px; gap:4px; border:1px solid var(--spatial-app-border); color:var(--spatial-window-ink); background:var(--spatial-app-surface); text-align:left; }
.spatial-reply-projection__rule:hover,.spatial-reply-projection__rule[data-spatial-hover],.spatial-reply-projection__rule--active { background:var(--spatial-app-surface-strong); }
.spatial-reply-projection__rule--active { border-left:3px solid var(--spatial-window-accent); }
.spatial-reply-projection__rule code,.spatial-reply-projection__rule small { overflow:hidden; color:var(--spatial-app-muted); font:9px/1.45 "JetBrains Mono",monospace; text-overflow:ellipsis; white-space:nowrap; }
.spatial-reply-projection__rule-actions { padding:8px; border-top:1px solid var(--spatial-app-border); }
.spatial-reply-projection__detail { display:grid; align-content:start; padding:10px; gap:9px; }
.spatial-reply-projection__section { display:grid; gap:10px; }
.spatial-reply-projection__section-title h2,.spatial-reply-projection__section-title small { margin:0; }
.spatial-reply-projection__section-title small,.spatial-reply-projection__hint,.spatial-reply-projection__toggle small { color:var(--spatial-app-muted); font-size:9px; }
.spatial-reply-projection__toggle { display:flex; min-height:32px; padding:0 9px; align-items:center; gap:8px; border:1px solid var(--spatial-app-border); color:var(--spatial-window-ink); background:var(--spatial-app-surface); text-align:left; }
.spatial-reply-projection__toggle[aria-pressed="true"] { border-left:3px solid var(--spatial-window-accent); background:var(--spatial-app-accent-soft); }
.spatial-reply-projection__toggle b { color:var(--spatial-window-accent); font:8px "JetBrains Mono",monospace; }
.spatial-reply-projection__split,.spatial-reply-projection__projects { display:grid; gap:9px; }
.spatial-reply-projection__split > div { display:grid; gap:6px; }
.spatial-reply-projection__hint { margin:0; line-height:1.6; }
.spatial-reply-projection__hint code { color:var(--spatial-window-accent); font-family:"JetBrains Mono",monospace; }
.spatial-reply-projection__project-row { display:grid; min-width:0; grid-template-columns:minmax(105px,.42fr) minmax(160px,1fr) auto; align-items:end; gap:7px; }
.spatial-reply-projection__status { display:flex; min-width:0; min-height:34px; padding:8px 12px; align-items:center; justify-content:space-between; gap:8px; border-top:1px solid var(--spatial-app-border); }
.spatial-reply-projection__status span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.spatial-reply-projection__status small { flex:none; color:var(--spatial-app-muted); }
.spatial-reply-projection__status[data-tone="danger"] { color:var(--spatial-window-accent); }
.spatial-reply-projection__status[data-tone="warning"] { color:var(--spatial-window-tab); }
@container (max-width:700px) {
  .spatial-reply-projection__workspace { grid-template-columns:1fr; overflow:auto; }
  .spatial-reply-projection__rules { min-height:230px; max-height:42cqh; border-right:0; border-bottom:1px solid var(--spatial-app-border); }
  .spatial-reply-projection__detail { overflow:visible; }
}
@container (max-width:480px) {
  .spatial-reply-projection__project-row { grid-template-columns:minmax(0,1fr) auto; }
  .spatial-reply-projection__project-row label:nth-child(2) { grid-column:1 / -1; grid-row:2; }
  .spatial-reply-projection__project-row .spatial-action-button { grid-column:2; grid-row:1; }
}
</style>
