<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from "vue"
import { useSetupState } from "../../composables/useSetupState"
import type { OriginalCharacterFormData } from "../../lib/source"
import SetupStepper from "./SetupStepper.vue"
import MethodChoose from "./step1/MethodChoose.vue"
import PasteInput from "./step1/PasteInput.vue"
import FileInput from "./step1/FileInput.vue"
import SplitReview from "./step1/SplitReview.vue"
import UnderstandingRunning from "./step2/UnderstandingRunning.vue"
import UnderstandingReady from "./step2/UnderstandingReady.vue"
import UnderstandingFailed from "./step2/UnderstandingFailed.vue"
import CanonCharacterSelect from "./step3/CanonCharacterSelect.vue"
import OriginalCharacterForm from "./step3/OriginalCharacterForm.vue"
import CharacterConfirmed from "./step3/CharacterConfirmed.vue"
import PlaySetupDialog from "./step4/PlaySetupDialog.vue"
import OpeningConfirm from "./step5/OpeningConfirm.vue"
import StepStub from "./StepStub.vue"

/** enterPlay：玩家在 Step 5 点"进入故事"，App.vue 接线翻转 mode 到 play。 */
const emit = defineEmits<{ enterPlay: [] }>()

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
  understandingSummary,
  manifest,
  chapterIndex,
  busy,
  errorText,
  initializing,
  characterBranch,
  selectedCharacter,
  characterSetupStatus,
  playSetupStatus,
  initialize,
  setView,
  goToStep,
  startImport,
  startOpeningUnderstanding,
  setCharacterBranch,
  backToBranchChoice,
  confirmCanonCharacter,
  confirmOriginalCharacter,
  resetCharacterSetup,
} = useSetupState()

// step1 子组件 refs（读取输入数据）
const pasteRef = ref<InstanceType<typeof PasteInput> | null>(null)
const fileRef = ref<InstanceType<typeof FileInput> | null>(null)

// step3 原著选择追踪（CanonCharacterSelect emit select → 存到这里 → 启用 primary 按钮）
const canonSelectedCandidate = ref<{ id?: string; name: string; brief: string } | null>(null)

// 返回修改时清旧选择，避免确认时用到旧候选
function onResetCharacterSetup() {
  canonSelectedCandidate.value = null
  resetCharacterSetup()
}

// stepper 索引（0-based）：直接用 useSetupState 的 step ref（1-5 → 0-4）
const currentStepIndex = computed(() => step.value - 1)
const completedUntil = computed(() => {
  if (subView.value === "opening-confirm") return 4
  if (playSetupStatus.value === "complete") return 3
  if (characterSetupStatus.value === "confirmed") return 2
  if (understandingStatus.value === "ready") return 1
  if (manifest.value) return 0
  return -1
})

// ── action bar 配置 ──
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
      primaryLabel: understandingStatus.value === "ready" ? "查看理解" : "开始理解",
      primaryDisabled: busy.value || !manifest.value,
      onPrimary: understandingStatus.value === "ready" ? () => setView("understanding") : startOpeningUnderstanding,
    }
  }
  // understanding 视图
  if (understandingStatus.value === "running") {
    return {
      secondaryLabel: "返回目录",
      secondaryDisabled: true, // running 时不允许返回
      onSecondary: null,
      primaryLabel: "理解中…",
      primaryDisabled: true,
      onPrimary: null,
    }
  }
  if (understandingStatus.value === "failed") {
    return {
      secondaryLabel: "返回目录",
      secondaryDisabled: busy.value,
      onSecondary: () => setView("review"),
      primaryLabel: "重试",
      primaryDisabled: busy.value,
      onPrimary: startOpeningUnderstanding,
    }
  }
  // ready：分支卡在组件内交互，不需要主按钮
  if (understandingStatus.value === "ready" && subView.value === "understanding") {
    return {
      secondaryLabel: "返回目录",
      secondaryDisabled: busy.value,
      onSecondary: () => setView("review"),
      primaryLabel: "下一步",
      primaryDisabled: false,
      onPrimary: () => goToStep(3),
    }
  }

  // ── Step 3 角色设定 ──
  if (subView.value === "character-setup") {
    // 确认屏
    if (characterSetupStatus.value === "confirmed") {
      return {
        secondaryLabel: "返回修改",
        secondaryDisabled: busy.value,
        onSecondary: onResetCharacterSetup,
        primaryLabel: "下一步",
        primaryDisabled: busy.value,
        onPrimary: () => goToStep(4),
      }
    }
    // 原著角色选择
    if (characterBranch.value === "canon") {
      return {
        secondaryLabel: "返回分支",
        secondaryDisabled: busy.value,
        onSecondary: backToBranchChoice,
        primaryLabel: busy.value ? "确认中…" : "确认选择",
        primaryDisabled: busy.value || !canonSelectedCandidate.value,
        onPrimary: onConfirmCanon,
      }
    }
    // 原创角色表单
    if (characterBranch.value === "original") {
      return {
        secondaryLabel: "返回分支",
        secondaryDisabled: busy.value,
        onSecondary: backToBranchChoice,
        primaryLabel: "填写角色信息",
        primaryDisabled: true,
        onPrimary: null,
      }
    }
  }

  // ── Step 4 游玩设定对话 ──
  if (subView.value === "play-setup") {
    return {
      secondaryLabel: "返回角色",
      secondaryDisabled: playSetupStatus.value === "running",
      onSecondary: () => goToStep(3),
      primaryLabel: "下一步",
      primaryDisabled: playSetupStatus.value !== "complete",
      onPrimary: () => goToStep(5),
    }
  }

  // ── Step 5 开局确认 ──
  if (subView.value === "opening-confirm") {
    return {
      secondaryLabel: "返回设定",
      secondaryDisabled: false,
      onSecondary: () => goToStep(4),
      primaryLabel: "进入故事",
      primaryDisabled: false,
      onPrimary: onEnterPlay,
    }
  }

  // stub 占位（兜底，正常流程不触发）
  if (subView.value === "stub") {
    return {
      secondaryLabel: "返回",
      secondaryDisabled: false,
      onSecondary: () => goToStep(3),
      primaryLabel: "下一步",
      primaryDisabled: true,
      onPrimary: null,
    }
  }
  return {
    secondaryLabel: "返回目录",
    secondaryDisabled: busy.value,
    onSecondary: () => setView("review"),
    primaryLabel: "下一步",
    primaryDisabled: true,
    onPrimary: null,
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

/** Step 5 "进入故事"：通知 App.vue 翻转 mode 到 play（含烧蚀过渡）。 */
function onEnterPlay() {
  emit("enterPlay")
}

// 拖放文件自动导入
async function onAutoImport() {
  if (!fileRef.value || busy.value) return
  const input = await fileRef.value.readFile()
  if (!input) return
  await startImport("file", input)
}

// ── Step 3 角色设定操作 ──

function onCanonSelect(candidate: { id?: string; name: string; brief: string }) {
  canonSelectedCandidate.value = candidate
}

async function onConfirmCanon() {
  if (!canonSelectedCandidate.value) return
  await confirmCanonCharacter(canonSelectedCandidate.value)
}

async function onConfirmOriginal(formData: OriginalCharacterFormData) {
  await confirmOriginalCharacter(formData)
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

            <!-- understanding：根据状态渲染 running/ready/failed -->
            <div v-else-if="subView === 'understanding'" key="understanding" class="stage-content">
              <UnderstandingRunning v-if="understandingStatus === 'running'" />
              <UnderstandingReady
                v-else-if="understandingStatus === 'ready'"
                :summary="understandingSummary"
                @select="setCharacterBranch"
              />
              <UnderstandingFailed
                v-else-if="understandingStatus === 'failed'"
                :error="errorText"
                @retry="startOpeningUnderstanding"
              />
              <!-- idle 不会出现在 understanding 视图（review 点开始理解直接进 running） -->
            </div>

            <!-- Step 3 角色设定 -->
            <div v-else-if="subView === 'character-setup'" :key="`char-${characterBranch}-${characterSetupStatus}`" class="stage-content">
              <!-- 确认屏 -->
              <CharacterConfirmed
                v-if="characterSetupStatus === 'confirmed' && selectedCharacter"
                :character="selectedCharacter"
                @back="onResetCharacterSetup"
                @next="goToStep(4)"
              />
              <!-- 原著角色选择 -->
              <CanonCharacterSelect
                v-else-if="characterBranch === 'canon'"
                :candidates="understandingSummary?.candidateCharacters ?? []"
                @select="onCanonSelect"
                @back="backToBranchChoice"
              />
              <!-- 原创角色表单 -->
              <OriginalCharacterForm
                v-else-if="characterBranch === 'original'"
                @submit="onConfirmOriginal"
                @back="backToBranchChoice"
              />
            </div>

            <!-- Step 4 游玩设定对话 -->
            <div v-else-if="subView === 'play-setup'" key="play-setup" class="stage-content stage-content--dialog">
              <PlaySetupDialog />
            </div>

            <!-- Step 5 开局确认：设定卡片过渡入口 -->
            <div v-else-if="subView === 'opening-confirm'" key="opening-confirm" class="stage-content">
              <OpeningConfirm />
            </div>

            <!-- stub：兜底，正常流程不触发 -->
            <div v-else key="stub" class="stage-content">
              <StepStub :step="step" title="即将开放" @back="goToStep(4)" />
            </div>
          </Transition>

          <!-- 错误提示（understanding 视图有自己的错误展示，不重复显示） -->
          <Transition name="error-fade">
            <p v-if="errorText && subView !== 'understanding'" class="setup-error">{{ errorText }}</p>
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
  --setup-stage-top-offset: 20px;
  --setup-stage-bottom-offset: 40px;
  --setup-stage-content-justify: flex-start;
}

@media (min-width: 1024px) and (min-height: 820px) {
  .setup-shell {
    --setup-stage-top-offset: clamp(32px, 5vh, 64px);
    --setup-stage-bottom-offset: clamp(32px, 5vh, 64px);
    --setup-stage-content-justify: center;
  }
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
  padding-top: var(--setup-stage-top-offset);
  padding-bottom: var(--setup-stage-bottom-offset);
}

.stage-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: var(--setup-stage-content-justify);
}
/* 对话步骤需要满高 flex 布局，让消息列表滚动区 + Composer 正确撑开 */
.stage-content--dialog {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  min-height: 0;
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
  color: var(--prose-muted);
  transition: border-color 0.2s, color 0.2s, box-shadow 0.2s, filter 0.2s, transform 0.1s;
}
.setup-btn:disabled {
  opacity: 0.58;
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
