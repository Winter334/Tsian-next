<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { useSetupState } from "../../composables/useSetupState"
import SetupStepper from "./SetupStepper.vue"
import MethodChoose from "./step1/MethodChoose.vue"
import PasteInput from "./step1/PasteInput.vue"
import FileInput from "./step1/FileInput.vue"
import SplitReview from "./step1/SplitReview.vue"
import OpeningBranchChoice from "./step2/OpeningBranchChoice.vue"
import PlaySetupDialog from "./step4/PlaySetupDialog.vue"
import OpeningConfirm from "./step5/OpeningConfirm.vue"

const emit = defineEmits<{ enterPlay: [] }>()

const {
  step,
  subView,
  manifest,
  chapterIndex,
  busy,
  statusText,
  errorText,
  playSetupStatus,
  playSetupError,
  initialize,
  setView,
  startImport,
  confirmReimport,
  showBranchChoice,
  startOpeningInterview,
} = useSetupState()

const pasteRef = ref<InstanceType<typeof PasteInput> | null>(null)
const fileRef = ref<InstanceType<typeof FileInput> | null>(null)
const currentStepIndex = computed(() => step.value - 1)
const completedUntil = computed(() => {
  if (subView.value === "opening-confirm" || playSetupStatus.value === "complete") return 2
  if (subView.value === "opening-interview" || playSetupStatus.value === "ready") return 1
  if (manifest.value) return 0
  return -1
})

interface ActionConfig {
  secondaryLabel: string
  secondaryDisabled: boolean
  onSecondary: (() => void | Promise<void>) | null
  primaryLabel: string
  primaryDisabled: boolean
  onPrimary: (() => void | Promise<void>) | null
}

const actions = computed<ActionConfig>(() => {
  if (subView.value === "choose") {
    return { secondaryLabel: "上一步", secondaryDisabled: true, onSecondary: null, primaryLabel: "选择导入方式", primaryDisabled: true, onPrimary: null }
  }
  if (subView.value === "paste") {
    return { secondaryLabel: "返回", secondaryDisabled: busy.value, onSecondary: () => setView("choose"), primaryLabel: busy.value ? "导入中…" : "导入", primaryDisabled: busy.value, onPrimary: onImportPaste }
  }
  if (subView.value === "file") {
    return { secondaryLabel: "返回", secondaryDisabled: busy.value, onSecondary: () => setView("choose"), primaryLabel: busy.value ? "导入中…" : "导入", primaryDisabled: busy.value, onPrimary: onImportFile }
  }
  if (subView.value === "review") {
    return { secondaryLabel: "重新导入", secondaryDisabled: busy.value, onSecondary: confirmReimport, primaryLabel: "开始创建", primaryDisabled: busy.value || !manifest.value, onPrimary: showBranchChoice }
  }
  if (subView.value === "branch-choice") {
    return { secondaryLabel: "返回目录", secondaryDisabled: false, onSecondary: () => setView("review"), primaryLabel: "选择上方角色类型", primaryDisabled: true, onPrimary: null }
  }
  if (subView.value === "opening-interview") {
    return { secondaryLabel: "访谈进行中", secondaryDisabled: true, onSecondary: null, primaryLabel: playSetupStatus.value === "complete" ? "下一步" : "完成后自动进入确认", primaryDisabled: true, onPrimary: null }
  }
  if (subView.value === "opening-confirm") {
    return { secondaryLabel: "开局已提交", secondaryDisabled: true, onSecondary: null, primaryLabel: "进入故事", primaryDisabled: false, onPrimary: () => emit("enterPlay") }
  }
  if (subView.value === "legacy-state") {
    return { secondaryLabel: "旧进度不支持升级", secondaryDisabled: true, onSecondary: null, primaryLabel: "请使用新存档", primaryDisabled: true, onPrimary: null }
  }
  return { secondaryLabel: "状态读取失败", secondaryDisabled: true, onSecondary: null, primaryLabel: "请重新进入或使用新存档", primaryDisabled: true, onPrimary: null }
})

async function onImportPaste() {
  if (!pasteRef.value || busy.value) return
  const input = pasteRef.value.getInput()
  if (input.text.trim()) await startImport("paste", input)
}

async function onImportFile() {
  if (!fileRef.value || busy.value) return
  const input = await fileRef.value.readFile()
  if (input?.text.trim()) await startImport("file", input)
}

async function onAutoImport() {
  if (!fileRef.value || busy.value) return
  const input = await fileRef.value.readFile()
  if (input) await startImport("file", input)
}

onMounted(() => {
  void initialize()
})
</script>

<template>
  <div class="setup-shell">
    <div class="setup-body">
      <SetupStepper :current="currentStepIndex" :completed-until="completedUntil" />

      <div class="setup-inner">
        <main class="setup-stage">
          <Transition name="stage-fade" mode="out-in">
            <div v-if="subView === 'choose'" key="choose" class="stage-content">
              <MethodChoose @select="(mode) => setView(mode)" />
            </div>
            <div v-else-if="subView === 'paste'" key="paste" class="stage-content">
              <PasteInput ref="pasteRef" />
            </div>
            <div v-else-if="subView === 'file'" key="file" class="stage-content">
              <FileInput ref="fileRef" @auto-import="onAutoImport" />
            </div>
            <div v-else-if="subView === 'review'" key="review" class="stage-content">
              <SplitReview :manifest="manifest" :chapter-index="chapterIndex" />
            </div>
            <div v-else-if="subView === 'branch-choice'" key="branch-choice" class="stage-content">
              <OpeningBranchChoice @select="startOpeningInterview" />
            </div>
            <div v-else-if="subView === 'opening-interview'" key="opening-interview" class="stage-content stage-content--dialog">
              <PlaySetupDialog />
            </div>
            <div v-else-if="subView === 'opening-confirm'" key="opening-confirm" class="stage-content">
              <OpeningConfirm />
            </div>
            <section v-else-if="subView === 'legacy-state'" key="legacy-state" class="legacy-state">
              <span class="legacy-mark" aria-hidden="true">!</span>
              <h2>旧开局进度无法继续</h2>
              <p>{{ playSetupError || "当前存档来自测试期旧流程，请创建新存档后重新导入小说。" }}</p>
            </section>
            <section v-else key="fatal-state" class="legacy-state">
              <span class="legacy-mark" aria-hidden="true">!</span>
              <h2>无法安全继续开局</h2>
              <p>{{ playSetupError || "读取存档状态失败。请重新进入；若问题持续，请使用新存档重新导入小说。" }}</p>
            </section>
          </Transition>

          <Transition name="error-fade">
            <p v-if="errorText" class="setup-error">{{ errorText }}</p>
          </Transition>
        </main>
      </div>
    </div>

    <div class="setup-action-wrap">
      <div class="setup-action-bar">
        <button class="setup-btn secondary" type="button" :disabled="actions.secondaryDisabled" @click="actions.onSecondary?.()">
          {{ actions.secondaryLabel }}
        </button>
        <p v-if="busy && statusText" class="setup-status" aria-live="polite">{{ statusText }}</p>
        <button class="setup-btn primary" type="button" :disabled="actions.primaryDisabled" @click="actions.onPrimary?.()">
          {{ actions.primaryLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.setup-shell {
  position: relative;
  z-index: 0;
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  --setup-stage-top-offset: 20px;
  --setup-stage-bottom-offset: 40px;
}
.setup-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  overflow-y: auto;
}
.setup-inner {
  display: flex;
  width: 100%;
  max-width: 720px;
  flex: 1;
  flex-direction: column;
  padding: 0 24px;
}
.setup-stage {
  display: flex;
  flex: 1;
  flex-direction: column;
  padding-top: var(--setup-stage-top-offset);
  padding-bottom: var(--setup-stage-bottom-offset);
}
.stage-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: center;
}
.stage-content--dialog { min-height: 0; justify-content: flex-start; }
.stage-fade-enter-active, .stage-fade-leave-active { transition: opacity 0.25s ease, transform 0.25s ease; }
.stage-fade-enter-from { opacity: 0; transform: translateY(12px); }
.stage-fade-leave-to { opacity: 0; transform: translateY(-8px); }
.setup-error {
  margin: 16px 0 0;
  padding: 10px 14px;
  border: 1px solid var(--blood);
  border-radius: 4px;
  background: rgba(155, 58, 46, 0.12);
  color: #c4524a;
  font-family: var(--font-mono);
  font-size: 0.78rem;
}
.error-fade-enter-active, .error-fade-leave-active { transition: opacity 0.2s ease; }
.error-fade-enter-from, .error-fade-leave-to { opacity: 0; }
.legacy-state {
  max-width: 560px;
  margin: auto;
  padding: 32px;
  border: 1px solid var(--blood);
  border-radius: 8px;
  background: rgba(43, 4, 4, 0.28);
  color: var(--prose-muted);
  text-align: center;
}
.legacy-state h2 { color: var(--prose); font-family: var(--font-display, serif); }
.legacy-state p { line-height: 1.7; }
.legacy-mark {
  display: inline-flex;
  width: 34px;
  height: 34px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--blood);
  border-radius: 50%;
  color: var(--blood);
}
.setup-action-wrap { flex-shrink: 0; padding: 0 24px 20px; }
.setup-action-bar {
  display: flex;
  max-width: 720px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0 auto;
}
.setup-status {
  flex: 1;
  margin: 0;
  color: var(--prose-faint);
  font-family: var(--font-mono);
  font-size: 0.72rem;
  letter-spacing: 0.06em;
  text-align: center;
}
.setup-btn {
  padding: 9px 18px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: transparent;
  color: var(--prose-muted);
  font-family: var(--font-mono);
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  cursor: pointer;
  transition: border-color 0.2s, color 0.2s, box-shadow 0.2s, filter 0.2s, transform 0.1s;
}
.setup-btn:disabled { opacity: 0.58; cursor: not-allowed; }
.setup-btn.secondary:not(:disabled):hover { border-color: var(--ember); color: var(--prose); }
.setup-btn.primary { border-color: var(--ember); background: linear-gradient(135deg, var(--ember-bright), var(--ember)); color: var(--void-deep); font-weight: 600; }
.setup-btn.primary:not(:disabled):hover { box-shadow: 0 0 16px var(--ember-glow); filter: brightness(1.1); }
.setup-btn.primary:not(:disabled):active { transform: scale(0.96); }
@media (min-width: 1024px) and (min-height: 820px) {
  .setup-shell { --setup-stage-top-offset: clamp(32px, 5vh, 64px); --setup-stage-bottom-offset: clamp(32px, 5vh, 64px); }
}
@media (max-width: 640px) {
  .setup-action-bar { flex-wrap: wrap; }
  .setup-status { order: 3; flex-basis: 100%; }
}
</style>
