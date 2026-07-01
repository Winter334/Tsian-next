<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from "vue"
import { useSetupState } from "../../composables/useSetupState"
import SetupStepper from "./SetupStepper.vue"
import MethodChoose from "./step1/MethodChoose.vue"
import PasteInput from "./step1/PasteInput.vue"
import FileInput from "./step1/FileInput.vue"
import SplitReview from "./step1/SplitReview.vue"

/**
 * SetupWizard — 开局导入向导壳。
 *
 * design §5：状态机 step/subView/understandingStatus；全屏接管（隐藏 header+nav）；
 * 横向 stepper 在顶，stage 在下；步骤切换 Vue Transition。
 *
 * prd 向导共用骨架：全屏接管，顶部 stepper，stage 全宽，无页头标题条。
 * action bar：左=返回/重新导入，右=主操作（导入/开始理解）。
 */

const {
  step,
  subView,
  understandingStatus,
  manifest,
  chapterIndex,
  busy,
  errorText,
  initializing,
  initialize,
  setView,
  startImport,
  confirmReimport,
  startOpeningUnderstanding,
} = useSetupState()

// step1 子组件 refs（读取输入数据）
const pasteRef = ref<InstanceType<typeof PasteInput> | null>(null)
const fileRef = ref<InstanceType<typeof FileInput> | null>(null)

// stepper 索引（0-based）
const currentStepIndex = computed(() => (subView.value === "understanding" ? 1 : 0))
const completedUntil = computed(() => {
  if (understandingStatus.value === "ready") return 1
  if (manifest.value) return 0
  return -1
})

// ── action bar 配置 ──
interface ActionConfig {
  secondaryLabel: string
  secondaryDisabled: boolean
  onSecondary: (() => void) | null
  tertiaryLabel?: string
  tertiaryDisabled?: boolean
  onTertiary?: (() => void) | null
  primaryLabel: string
  primaryDisabled: boolean
  onPrimary: (() => void) | null
}

const actions = computed<ActionConfig>(() => {
  if (subView.value === "choose") {
    return {
      secondaryLabel: "上一步",
      secondaryDisabled: true,
      onSecondary: null,
      primaryLabel: "选择导入方式",
      primaryDisabled: true,
      onPrimary: null,
    }
  }
  if (subView.value === "paste") {
    return {
      secondaryLabel: "返回",
      secondaryDisabled: busy.value,
      onSecondary: () => setView("choose"),
      primaryLabel: busy.value ? "导入中…" : "导入",
      primaryDisabled: busy.value,
      onPrimary: onImportPaste,
    }
  }
  if (subView.value === "file") {
    return {
      secondaryLabel: "返回",
      secondaryDisabled: busy.value,
      onSecondary: () => setView("choose"),
      primaryLabel: busy.value ? "导入中…" : "导入",
      primaryDisabled: busy.value,
      onPrimary: onImportFile,
    }
  }
  if (subView.value === "review") {
    return {
      secondaryLabel: "返回",
      secondaryDisabled: busy.value,
      onSecondary: () => setView("choose"),
      tertiaryLabel: "重新导入",
      tertiaryDisabled: busy.value,
      onTertiary: confirmReimport,
      primaryLabel: understandingStatus.value === "ready" ? "查看理解" : "开始理解",
      primaryDisabled: busy.value || !manifest.value,
      onPrimary: understandingStatus.value === "ready" ? () => setView("understanding") : startOpeningUnderstanding,
    }
  }
  // understanding（Step 7 完整实现，此处先给基础操作）
  return {
    secondaryLabel: "返回目录",
    secondaryDisabled: busy.value,
    onSecondary: () => setView("review"),
    primaryLabel: understandingStatus.value === "ready" ? "下一步" : busy.value ? "理解中…" : "开始理解",
    primaryDisabled: busy.value || understandingStatus.value === "ready" || !manifest.value,
    onPrimary: startOpeningUnderstanding,
  }
})

// ── 导入操作 ──
async function onImportPaste() {
  if (!pasteRef.value || busy.value) return
  const input = pasteRef.value.getInput()
  if (!input.text.trim()) {
    return
  }
  await startImport("paste", input)
}

async function onImportFile() {
  if (!fileRef.value || busy.value) return
  const input = await fileRef.value.readFile()
  if (!input || !input.text.trim()) {
    return
  }
  await startImport("file", input)
}

// 拖放文件自动导入
async function onAutoImport() {
  if (!fileRef.value || busy.value) return
  const input = await fileRef.value.readFile()
  if (!input) return
  await startImport("file", input)
}

// ── 初始化 ──
onMounted(() => {
  initialize()
})
</script>

<template>
  <div class="setup-shell">
    <!-- 限宽容器（stepper 破出限宽） -->
    <div class="setup-body">
      <SetupStepper :current="currentStepIndex" :completed-until="completedUntil" />

      <div class="setup-inner">
        <!-- stage：子屏内容 -->
        <main class="setup-stage">
          <Transition name="stage-fade" mode="out-in">
            <!-- choose -->
            <div v-if="subView === 'choose'" key="choose" class="stage-content">
              <MethodChoose @select="(m) => setView(m)" />
            </div>

            <!-- paste -->
            <div v-else-if="subView === 'paste'" key="paste" class="stage-content">
              <PasteInput ref="pasteRef" />
            </div>

            <!-- file -->
            <div v-else-if="subView === 'file'" key="file" class="stage-content">
              <FileInput ref="fileRef" @auto-import="onAutoImport" />
            </div>

            <!-- review -->
            <div v-else-if="subView === 'review'" key="review" class="stage-content">
              <SplitReview :manifest="manifest" :chapter-index="chapterIndex" />
            </div>

            <!-- understanding（Step 7 完整实现） -->
            <div v-else key="understanding" class="stage-content">
              <div class="understanding-placeholder">
                <p class="placeholder-copy">
                  {{ understandingStatus === 'ready' ? '初始理解已完成' : '初始理解功能即将开放' }}
                </p>
                <p v-if="understandingStatus === 'ready'" class="placeholder-hint">
                  可以继续向导，或先去游玩体验。
                </p>
              </div>
            </div>
          </Transition>

          <!-- 错误提示 -->
          <Transition name="error-fade">
            <p v-if="errorText" class="setup-error">{{ errorText }}</p>
          </Transition>
        </main>
      </div>
    </div>

    <!-- action bar -->
    <div class="setup-action-wrap">
      <div class="setup-action-bar">
        <div class="action-left">
          <button
            class="setup-btn secondary"
            type="button"
            :disabled="actions.secondaryDisabled"
            @click="actions.onSecondary?.()"
          >
            {{ actions.secondaryLabel }}
          </button>
          <button
            v-if="actions.tertiaryLabel"
            class="setup-btn ghost"
            type="button"
            :disabled="actions.tertiaryDisabled"
            @click="actions.onTertiary?.()"
          >
            {{ actions.tertiaryLabel }}
          </button>
        </div>
        <div class="action-right">
          <button
            class="setup-btn primary"
            type="button"
            :disabled="actions.primaryDisabled"
            @click="actions.onPrimary?.()"
          >
            {{ actions.primaryLabel }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.setup-shell {
  position: relative;
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  z-index: 0; /* 与 stage-play 同层，在燃烧幕布 z:1 之下 */
}

.setup-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  overflow-y: auto;
}

/* stepper 破出限宽，延长到屏幕尽头 */
.setup-body > :deep(.setup-stepper) {
  width: 100%;
  max-width: none;
}

.setup-inner {
  width: 100%;
  max-width: 720px;
  padding: 0 24px;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.setup-stage {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding-top: 20px;
  padding-bottom: 40px;
}

.stage-content {
  flex: 1;
}

/* 子屏切换过渡 */
.stage-fade-enter-active,
.stage-fade-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.stage-fade-enter-from {
  opacity: 0;
  transform: translateY(12px);
}
.stage-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* 错误提示 */
.setup-error {
  margin: 16px 0 0;
  padding: 10px 14px;
  background: rgba(155, 58, 46, 0.12);
  border: 1px solid var(--blood);
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 0.78rem;
  color: #c4524a;
}
.error-fade-enter-active,
.error-fade-leave-active {
  transition: opacity 0.2s ease;
}
.error-fade-enter-from,
.error-fade-leave-to {
  opacity: 0;
}

/* understanding 占位（Step 7 替换） */
.understanding-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 60px 20px;
  text-align: center;
}
.placeholder-copy {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 1rem;
  color: var(--prose-dim);
}
.placeholder-hint {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--whisper);
}

/* ── action bar ── */
.setup-action-wrap {
  flex-shrink: 0;
  padding: 0 24px 20px;
}
.setup-action-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  max-width: 720px;
  margin: 0 auto;
  gap: 12px;
}
.action-left,
.action-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* 按钮基础 */
.setup-btn {
  background: transparent;
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 9px 18px;
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  color: var(--prose-dim);
  transition: border-color 0.2s, color 0.2s, box-shadow 0.2s, filter 0.2s, transform 0.1s;
}
.setup-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* secondary：幽灵态 */
.setup-btn.secondary:not(:disabled):hover,
.setup-btn.ghost:not(:disabled):hover {
  border-color: var(--ember);
  color: var(--prose);
}

/* primary：ember 实心 */
.setup-btn.primary {
  background: linear-gradient(135deg, var(--ember-bright), var(--ember));
  color: var(--void-deep);
  border-color: var(--ember);
  font-weight: 600;
}
.setup-btn.primary:not(:disabled):hover {
  box-shadow: 0 0 16px var(--ember-glow);
  filter: brightness(1.1);
}
.setup-btn.primary:not(:disabled):active {
  transform: scale(0.96);
}

/* 状态文案已移除（用户反馈：在按钮行里像被禁用的按钮，造成混淆） */
</style>
