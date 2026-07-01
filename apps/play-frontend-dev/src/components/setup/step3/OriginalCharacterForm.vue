<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from "vue"
import gsap from "gsap"
import type { OriginalCharacterFormData } from "../../../lib/source"

/**
 * OriginalCharacterForm — 原创角色创建表单。
 *
 * 必填：角色名、一句话简介。
 * 可选（折叠）：外貌、性格、背景。
 * 进场：字段从下淡入（y:12, stagger:0.06），与 stage-fade 方向一致。
 */
const emit = defineEmits<{
  submit: [form: OriginalCharacterFormData]
  back: []
}>()

const formRef = ref<HTMLElement | null>(null)

const name = ref("")
const brief = ref("")
const appearance = ref("")
const personality = ref("")
const background = ref("")
const showOptional = ref(false)

const canSubmit = computed(() => name.value.trim() !== "" && brief.value.trim() !== "")

function toggleOptional() {
  showOptional.value = !showOptional.value
}

function onSubmit() {
  if (!canSubmit.value) return
  const form: OriginalCharacterFormData = {
    name: name.value.trim(),
    brief: brief.value.trim(),
  }
  if (appearance.value.trim()) form.appearance = appearance.value.trim()
  if (personality.value.trim()) form.personality = personality.value.trim()
  if (background.value.trim()) form.background = background.value.trim()
  emit("submit", form)
}

onMounted(async () => {
  await nextTick()
  if (!formRef.value) return
  const fields = formRef.value.querySelectorAll(".form-field")
  gsap.fromTo(fields,
    { opacity: 0, y: 12 },
    { opacity: 1, y: 0, duration: 0.35, stagger: 0.06, ease: "power2.out" },
  )
})

onUnmounted(() => {
  if (formRef.value) gsap.killTweensOf(formRef.value.querySelectorAll(".form-field"))
})
</script>

<template>
  <div class="original-form">
    <h3 class="guide-question">创造你的角色</h3>

    <div ref="formRef" class="form-fields">
      <!-- 必填：角色名 -->
      <label class="form-field">
        <span class="field-label">角色名 <span class="required">*</span></span>
        <input
          v-model="name"
          type="text"
          placeholder="给你的角色起个名字"
          class="field-input"
          maxlength="120"
        >
      </label>

      <!-- 必填：一句话简介 -->
      <label class="form-field">
        <span class="field-label">一句话简介 <span class="required">*</span></span>
        <input
          v-model="brief"
          type="text"
          placeholder="用一句话描述这个角色是谁"
          class="field-input"
          maxlength="500"
        >
      </label>

      <!-- 可选字段折叠 -->
      <div class="form-field">
        <button class="optional-toggle" type="button" @click="toggleOptional">
          <span class="toggle-arrow" :class="{ expanded: showOptional }">▸</span>
          展开更多（可选）
        </button>

        <div class="optional-collapse" :class="{ expanded: showOptional }">
          <div class="optional-fields">
            <label class="form-field optional">
              <span class="field-label">外貌描述</span>
              <textarea
                v-model="appearance"
                rows="3"
                placeholder="角色的外貌特征（可选）"
                class="field-textarea"
              />
            </label>

            <label class="form-field optional">
              <span class="field-label">性格特征</span>
              <textarea
                v-model="personality"
                rows="3"
                placeholder="角色的性格倾向（可选）"
                class="field-textarea"
              />
            </label>

            <label class="form-field optional">
              <span class="field-label">背景故事</span>
              <textarea
                v-model="background"
                rows="4"
                placeholder="角色的过往经历（可选）"
                class="field-textarea"
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.original-form {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  padding: 20px 0;
}

/* ── 引导问 ── */
.guide-question {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 1.05rem;
  color: var(--prose);
  text-align: center;
  letter-spacing: 0.02em;
}

/* ── 表单 ── */
.form-fields {
  display: flex;
  flex-direction: column;
  gap: 18px;
  width: 100%;
  max-width: 480px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--prose-dim);
}
.required {
  color: var(--ember);
}

/* ── 输入框 ── */
.field-input {
  width: 100%;
  padding: 10px 14px;
  background: rgba(20, 14, 8, 0.6);
  border: 1px solid var(--line-strong);
  border-radius: 4px;
  color: var(--prose);
  font-family: var(--font-serif);
  font-size: 0.9rem;
  transition: border-color 0.25s, box-shadow 0.25s;
  box-sizing: border-box;
}
.field-input::placeholder {
  color: var(--whisper);
}
.field-input:focus {
  outline: none;
  border-color: var(--ember);
  box-shadow: 0 0 8px rgba(181, 137, 61, 0.1);
}

.field-textarea {
  width: 100%;
  padding: 10px 14px;
  background: rgba(20, 14, 8, 0.6);
  border: 1px solid var(--line-strong);
  border-radius: 4px;
  color: var(--prose);
  font-family: var(--font-serif);
  font-size: 0.85rem;
  line-height: 1.5;
  resize: vertical;
  transition: border-color 0.25s, box-shadow 0.25s;
  box-sizing: border-box;
}
.field-textarea::placeholder {
  color: var(--whisper);
}
.field-textarea:focus {
  outline: none;
  border-color: var(--ember);
  box-shadow: 0 0 8px rgba(181, 137, 61, 0.1);
}

/* ── 可选折叠 ── */
.optional-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  background: transparent;
  border: none;
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--prose-dim);
  transition: color 0.2s;
}
.optional-toggle:hover {
  color: var(--ember);
}
.toggle-arrow {
  display: inline-block;
  transition: transform 0.3s cubic-bezier(0.22, 1, 0.36, 1);
}
.toggle-arrow.expanded {
  transform: rotate(90deg);
}

.optional-fields {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding-top: 18px;
}

/* ── grid 折叠：0fr→1fr 自然展开 ──
 * visibility 延迟切换：展开时立即可见（delay:0），收起时等高度过渡完再隐藏
 * （delay 与 duration 对齐），避免 textarea 在过渡中闪烁。 */
.optional-collapse {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  visibility: hidden;
  transition: grid-template-rows 0.35s cubic-bezier(0.22, 1, 0.36, 1),
              opacity 0.35s cubic-bezier(0.22, 1, 0.36, 1),
              visibility 0s linear 0.35s;
}
.optional-collapse.expanded {
  grid-template-rows: 1fr;
  opacity: 1;
  visibility: visible;
  transition: grid-template-rows 0.35s cubic-bezier(0.22, 1, 0.36, 1),
              opacity 0.35s cubic-bezier(0.22, 1, 0.36, 1),
              visibility 0s linear 0s;
}
.optional-collapse > .optional-fields {
  overflow: hidden;
  min-height: 0;
}
</style>
