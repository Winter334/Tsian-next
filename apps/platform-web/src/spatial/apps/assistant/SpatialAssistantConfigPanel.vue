<template>
  <section
    ref="panelRef"
    class="spatial-app spatial-modal-panel-source spatial-assistant-config"
    :data-spatial-source="SPATIAL_ASSISTANT_CONFIG_SOURCE_ID"
    data-spatial-layer="overlay"
    :data-spatial-z="SPATIAL_ASSISTANT_CONFIG_Z_INDEX"
    :data-spatial-input="interactive ? undefined : 'none'"
    data-spatial-preferred-width="760"
    data-spatial-parallax-factor="0"
    data-spatial-depth="0"
    data-spatial-yaw="0"
    data-spatial-pitch="0"
    data-spatial-scale="1"
    data-spatial-curve-half-angle="0.24"
    role="dialog"
    :aria-modal="interactive ? 'true' : undefined"
    :aria-hidden="interactive ? undefined : 'true'"
    aria-labelledby="spatial-assistant-config-title"
    :aria-busy="applying || updatingKnowledge || !interactive"
    tabindex="-1"
    data-spatial-gesture-owner
    @pointermove="continueDrag"
    @pointerup="endDrag"
    @pointercancel="endDrag"
    @keydown="onPanelKeydown"
  >
    <header
      class="spatial-modal-panel-source__header"
      data-spatial-gesture-start
      @pointerdown.stop="beginDrag"
    >
      <span class="spatial-modal-panel-source__kind">assistant</span>
      <h2 id="spatial-assistant-config-title">助手能力与权限</h2>
      <SpatialActionButton
        icon-only
        data-spatial-assistant-config-close
        class="spatial-modal-panel-source__close"
        aria-label="关闭助手配置"
        :disabled="!interactive || applying || updatingKnowledge"
        @pointerdown.stop
        @click="cancelChanges"
      >
        <template #icon><X /></template>
      </SpatialActionButton>
    </header>

    <div class="spatial-assistant-config__body spatial-app__scroll">
      <section class="spatial-app__section spatial-assistant-config__section">
        <div class="spatial-assistant-config__title">
          <div><h3>权限边界</h3><p>决定桌面助手能维护哪些 Workspace 区域。</p></div>
          <SpatialSelect
            :model-value="String(workspaceLevel)"
            :options="workspaceOptions"
            aria-label="Workspace 权限"
            :disabled="!interactive || applying || updatingKnowledge || !agent"
            @change="(value) => updateWorkspaceAccessLevel(Number(value))"
          />
        </div>
        <p>{{ workspaceAccessDescription }}</p>
      </section>

      <section class="spatial-app__section spatial-assistant-config__section">
        <div class="spatial-assistant-config__title">
          <div><h3>助手知识库</h3><p>更新助手理解 Tsian 所需的基础说明，不改变个性、模型与自定义能力。</p></div>
          <SpatialActionButton
            :disabled="!interactive || applying || updatingKnowledge || hasChanges"
            @click="refreshKnowledge"
          >
            <template #icon><RefreshCw /></template>{{ updatingKnowledge ? "更新中…" : "更新知识" }}
          </SpatialActionButton>
        </div>
      </section>

      <section class="spatial-app__section spatial-assistant-config__section">
        <div class="spatial-assistant-config__title">
          <div><h3>Skills</h3><p>{{ enabledSkillCount }} / {{ skills.length }} 已启用</p></div>
        </div>
        <article v-for="skill in skills" :key="skill.path" class="spatial-assistant-config__item">
          <button
            type="button"
            class="spatial-assistant-config__toggle"
            :aria-pressed="skillEnabled(skill)"
            :disabled="!interactive || applying || updatingKnowledge || !agent"
            @click="toggleSkill(skill, !skillEnabled(skill))"
          >
            <span><strong>{{ skill.title }}</strong><small>{{ entrySummary(skill.description || skill.summary) }}</small></span>
            <b>{{ skillEnabled(skill) ? "ON" : "OFF" }}</b>
          </button>
          <div v-if="skill.configItems?.length" class="spatial-assistant-config__fields">
            <label v-for="item in skill.configItems" :key="item.key" class="spatial-app__field">
              <span>{{ item.key }}<small v-if="item.description"> · {{ item.description }}</small></span>
              <input
                class="spatial-app__input"
                :type="isSecretKey(item.key) ? 'password' : 'text'"
                :value="configValue(skill.path, item)"
                :placeholder="item.defaultValue || ''"
                :disabled="!interactive || applying || updatingKnowledge"
                autocomplete="off"
                spellcheck="false"
                @input="setConfigValue(skill.path, item, ($event.target as HTMLInputElement).value)"
              >
            </label>
            <span v-if="skillConfigChanged(skill.path)" class="spatial-app__meta">未保存</span>
          </div>
        </article>
        <div v-if="skills.length === 0" class="spatial-app__empty">助手还没有可管理的 Skill。</div>
      </section>

      <section class="spatial-app__section spatial-assistant-config__section">
        <div class="spatial-assistant-config__title">
          <div><h3>能力开关</h3><p>{{ enabledAssistantCapabilityCount }} / {{ assistantCapabilities.length }} 已启用</p></div>
        </div>
        <div class="spatial-assistant-config__grid">
          <button
            v-for="capability in assistantCapabilities"
            :key="capability.key"
            type="button"
            class="spatial-assistant-config__capability"
            :aria-pressed="capability.enabled"
            :disabled="!interactive || capability.disabled"
            @click="toggleAssistantCapability(capability, !capability.enabled)"
          >
            <span><strong>{{ capability.title }}</strong><small>{{ capability.badge }}</small></span>
            <p>{{ capability.description }}</p>
            <b>{{ capability.enabled ? "ON" : "OFF" }}</b>
          </button>
        </div>
        <details v-if="toolDiagnostics.length" class="spatial-assistant-config__diagnostics">
          <summary>{{ toolDiagnostics.length }} 条助手 Tool 诊断</summary>
          <p v-for="diag in toolDiagnostics" :key="`${diag.code}:${diag.path}`">
            {{ diag.level }} · {{ diag.code }} · {{ diag.message }}
          </p>
        </details>
      </section>
    </div>

    <footer class="spatial-modal-panel-source__actions spatial-assistant-config__footer">
      <SpatialActionButton :disabled="!interactive || applying || updatingKnowledge" @click="cancelChanges">取消</SpatialActionButton>
      <SpatialActionButton :disabled="!interactive || applying || updatingKnowledge || !hasChanges" @click="applyChanges">应用</SpatialActionButton>
      <SpatialActionButton variant="primary" :disabled="!interactive || applying || updatingKnowledge" @click="confirmChanges">
        {{ applying ? "保存中…" : "确定" }}
      </SpatialActionButton>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, onUpdated, ref, watch } from "vue"
import { RefreshCw, X } from "lucide-vue-next"
import {
  useAssistantConfigController,
} from "@/controllers/assistant/use-assistant-config-controller"
import SpatialActionButton from "../primitives/SpatialActionButton.vue"
import SpatialSelect from "../primitives/SpatialSelect.vue"
import "../spatial-apps.css"
import { useSpatialModalFocus } from "../../shell/use-spatial-modal-focus"
import {
  SPATIAL_ASSISTANT_CONFIG_SOURCE_ID,
  SPATIAL_ASSISTANT_CONFIG_Z_INDEX,
} from "../../shell/spatial-global-surfaces"
import {
  beginRoutedSpatialDrag,
  moveRoutedSpatialDrag,
  routedSpatialDragMatches,
  type SpatialRoutedDragState,
} from "../../shell/spatial-routed-drag"

const props = withDefaults(defineProps<{
  interactive?: boolean
}>(), {
  interactive: true,
})

const emit = defineEmits<{
  change: []
  close: []
  move: [delta: { x: number; y: number }]
  sourceDirty: [sourceId: string]
}>()
const panelRef = ref<HTMLElement | null>(null)
let drag: SpatialRoutedDragState | null = null
const modalFocus = useSpatialModalFocus(panelRef)
const controller = useAssistantConfigController({
  onChange: () => emit("change"),
  onClose: () => emit("close"),
})
const {
  agent, skills, toolDiagnostics, applying, updatingKnowledge,
  workspaceAccessOptions, assistantCapabilities, enabledAssistantCapabilityCount,
  workspaceLevel, enabledSkillCount, workspaceAccessDescription, hasChanges,
  isSecretKey, configValue, setConfigValue, skillConfigChanged, entrySummary,
  skillEnabled, toggleSkill, toggleAssistantCapability, updateWorkspaceAccessLevel,
  refreshKnowledge, applyChanges, confirmChanges, cancelChanges,
} = controller
const workspaceOptions = computed(() => workspaceAccessOptions.map((option) => ({
  value: String(option.level),
  label: option.label,
})))

function focusInitialControl(): void {
  if (!props.interactive) return
  modalFocus.focusInitial(
    panelRef.value?.querySelector<HTMLElement>("[data-spatial-assistant-config-close]"),
  )
}

function onPanelKeydown(event: KeyboardEvent): void {
  event.stopPropagation()
  if (!props.interactive) return
  if (event.key === "Escape") {
    event.preventDefault()
    cancelChanges()
  } else if (event.key === "Tab") {
    modalFocus.trapTab(event)
  }
}

function beginDrag(event: PointerEvent): void {
  if (!props.interactive || (event.target as Element).closest("button")) return
  drag = beginRoutedSpatialDrag(event)
}

function continueDrag(event: PointerEvent): void {
  if (!drag) return
  const delta = moveRoutedSpatialDrag(drag, event)
  if (delta) emit("move", delta)
}

function endDrag(event: PointerEvent): void {
  if (!routedSpatialDragMatches(drag, event)) return
  drag = null
}

function markPanelDirty(): void {
  emit("sourceDirty", SPATIAL_ASSISTANT_CONFIG_SOURCE_ID)
}

onMounted(() => {
  modalFocus.captureInvoker()
  void nextTick(() => {
    markPanelDirty()
    focusInitialControl()
  })
})
onUpdated(markPanelDirty)
onBeforeUnmount(() => {
  drag = null
  modalFocus.restoreInvoker()
})
watch(() => props.interactive, (interactive) => {
  if (!interactive) {
    drag = null
    return
  }
  void nextTick(async () => {
    await nextTick()
    if (!panelRef.value?.contains(document.activeElement)) focusInitialControl()
  })
})
</script>

<style scoped>
.spatial-assistant-config { grid-template-rows: auto minmax(0, 1fr) auto; }
.spatial-assistant-config > .spatial-modal-panel-source__header { cursor: grab; user-select: none; }
.spatial-assistant-config__header, .spatial-assistant-config__footer, .spatial-assistant-config__title { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 10px; }
.spatial-assistant-config__header { padding: 11px 13px; border-bottom: 1px solid var(--spatial-app-border); }
.spatial-assistant-config__header h2 { margin: 2px 0 0; font-size: 15px; }
.spatial-assistant-config__body { display: grid; padding: 10px; align-content: start; gap: 9px; }
.spatial-assistant-config__section { display: grid; gap: 10px; }
.spatial-assistant-config__section p, .spatial-assistant-config__item small, .spatial-assistant-config__capability small { margin: 0; color: var(--spatial-app-muted); font-size: 9px; line-height: 1.5; }
.spatial-assistant-config__title > div { display: grid; min-width: 0; gap: 3px; }
.spatial-assistant-config__title .spatial-select { width: 180px; }
.spatial-assistant-config__item { border: 1px solid var(--spatial-app-border); background: var(--spatial-app-surface); }
.spatial-assistant-config__toggle { display: grid; width: 100%; min-height: 48px; padding: 9px 10px; align-items: center; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; border: 0; color: inherit; background: transparent; text-align: left; }
.spatial-assistant-config__toggle[aria-pressed="true"] { border-left: 3px solid var(--spatial-window-accent); background: var(--spatial-app-accent-soft); }
.spatial-assistant-config__toggle span { display: grid; min-width: 0; gap: 3px; }
.spatial-assistant-config__toggle b, .spatial-assistant-config__capability b { color: var(--spatial-window-accent); font: 9px "JetBrains Mono", monospace; }
.spatial-assistant-config__fields { display: grid; padding: 10px; gap: 8px; border-top: 1px solid var(--spatial-app-border); }
.spatial-assistant-config__fields small { font-size: inherit; }
.spatial-assistant-config__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
.spatial-assistant-config__capability { position: relative; display: grid; min-width: 0; min-height: 74px; padding: 9px 40px 9px 9px; gap: 5px; border: 1px solid var(--spatial-app-border); color: inherit; background: var(--spatial-app-surface); text-align: left; }
.spatial-assistant-config__capability[aria-pressed="true"] { border-left: 3px solid var(--spatial-window-accent); background: var(--spatial-app-accent-soft); }
.spatial-assistant-config__capability span { display: grid; gap: 2px; }
.spatial-assistant-config__capability p { margin: 0; color: var(--spatial-app-muted); font-size: 8px; line-height: 1.45; }
.spatial-assistant-config__capability b { position: absolute; top: 9px; right: 8px; }
.spatial-assistant-config__diagnostics { color: var(--spatial-app-muted); font-size: 9px; }
.spatial-assistant-config__footer { padding: 10px 13px; justify-content: flex-end; border-top: 1px solid var(--spatial-app-border); }
@container (max-width: 620px) { .spatial-assistant-config__grid { grid-template-columns: 1fr; } .spatial-assistant-config__title { align-items: stretch; flex-direction: column; } .spatial-assistant-config__title .spatial-select { width: 100%; } }
</style>
