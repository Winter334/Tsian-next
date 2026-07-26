<script setup lang="ts">
/**
 * CharacterPortrait — 共享角色舞台立绘。
 *
 * 舞台只在显示层裁切；点击有效角色的立绘会打开完整图像 Dialog。上传流程保持
 * save-runtime workspace 路径与 portrait 元数据契约，object URL 在替换和卸载时释放。
 */
import { computed, onBeforeUnmount, ref, watch } from "vue"
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
} from "reka-ui"
import { useTsian } from "../../composables/useTsian"
import { preparePortraitBlob } from "../../lib/image-processing"

const props = defineProps<{
  /** 角色名（用于 alt 文本）。 */
  name: string
  /** workspace 中上传头像路径。缺省表示无上传。 */
  portraitPath?: string
  /** 默认头像 URL（按性别选择的内置 asset URL）。 */
  fallbackSrc: string
  /** 是否允许上传/更换当前角色肖像。 */
  canUpload: boolean
  /** 实体 ref（`character:<localId>`），用于派生写入路径。 */
  entityRef: string | null
}>()

const emit = defineEmits<{
  "portrait-updated": []
}>()

const { tsian } = useTsian()
const portraitUrl = ref<string | null>(null)
const uploadStatus = ref<string | null>(null)
const uploading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
let portraitLoadVersion = 0
let uploadVersion = 0
let unmounted = false

const localId = computed(() => {
  if (!props.entityRef) return ""
  const idx = props.entityRef.indexOf(":")
  return idx >= 0 ? props.entityRef.slice(idx + 1) : props.entityRef
})

const portraitAssetPath = computed(
  () => `save/assets/portraits/characters/${localId.value}.webp`,
)

const entityJsonPath = computed(() => {
  if (!props.entityRef) return ""
  const idx = props.entityRef.indexOf(":")
  const type = idx >= 0 ? props.entityRef.slice(0, idx) : "character"
  const id = idx >= 0 ? props.entityRef.slice(idx + 1) : props.entityRef
  return `save/entities/${type}/${id}.json`
})

/** 上传头像优先；缺失或读取失败时回退默认头像。 */
const displaySrc = computed(() => portraitUrl.value ?? props.fallbackSrc)
const canOpen = computed(() => props.entityRef !== null)

function revokePortraitUrl(): void {
  if (!portraitUrl.value) return
  URL.revokeObjectURL(portraitUrl.value)
  portraitUrl.value = null
}

async function loadPortraitBinary(path = props.portraitPath): Promise<void> {
  const version = ++portraitLoadVersion
  if (!path) {
    revokePortraitUrl()
    return
  }
  try {
    const file = await tsian.workspace.read(path, "save-runtime")
    if (version !== portraitLoadVersion) return
    const blob = file?.binary
    if (!blob || blob.size === 0) {
      revokePortraitUrl()
      return
    }
    const nextUrl = URL.createObjectURL(blob)
    if (version !== portraitLoadVersion) {
      URL.revokeObjectURL(nextUrl)
      return
    }
    revokePortraitUrl()
    portraitUrl.value = nextUrl
  } catch {
    if (version === portraitLoadVersion) revokePortraitUrl()
  }
}

watch(
  () => props.portraitPath,
  (path) => {
    void loadPortraitBinary(path)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  unmounted = true
  uploadVersion += 1
  portraitLoadVersion += 1
  revokePortraitUrl()
})

function triggerFileInput(): void {
  fileInput.value?.click()
}

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ""
  if (!file || uploading.value || !props.entityRef) return

  const version = ++uploadVersion
  const entityRef = props.entityRef
  const assetPath = portraitAssetPath.value
  const jsonPath = entityJsonPath.value
  uploading.value = true
  uploadStatus.value = "处理中…"

  const prepared = await preparePortraitBlob(file)
  if (version !== uploadVersion || unmounted || props.entityRef !== entityRef) return
  if ("error" in prepared) {
    uploading.value = false
    uploadStatus.value = prepared.error ?? "立绘处理失败"
    return
  }

  uploadStatus.value = "保存中…"
  try {
    await tsian.workspace.write(assetPath, prepared.blob, "save-runtime")
    if (version !== uploadVersion || unmounted || props.entityRef !== entityRef) return
    await patchEntityPortraitMetadata(jsonPath, assetPath, entityRef, version)
    if (version !== uploadVersion || unmounted || props.entityRef !== entityRef) return
    await loadPortraitBinary(assetPath)
    if (version !== uploadVersion || unmounted || props.entityRef !== entityRef) return
    uploading.value = false
    uploadStatus.value = null
    emit("portrait-updated")
  } catch (err) {
    if (version !== uploadVersion || unmounted) return
    uploading.value = false
    uploadStatus.value = err && typeof err === "object" && "message" in err
      ? String((err as { message: unknown }).message)
      : "保存失败"
  }
}

async function patchEntityPortraitMetadata(
  path: string,
  assetPath: string,
  entityRef: string,
  version: number,
): Promise<void> {
  if (!path) throw new Error("缺少角色引用，无法更新立绘。")
  const file = await tsian.workspace.read(path, "save-runtime")
  if (version !== uploadVersion || unmounted || props.entityRef !== entityRef) return
  if (file === null) throw new Error("找不到角色档案，无法更新立绘元数据。")

  let parsed: Record<string, unknown>
  try {
    const raw: unknown = JSON.parse(file.content)
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error()
    parsed = raw as Record<string, unknown>
  } catch {
    throw new Error("角色档案解析失败，无法更新立绘元数据。")
  }
  if (version !== uploadVersion || unmounted || props.entityRef !== entityRef) return

  parsed.portrait = {
    path: assetPath,
    mimeType: "image/webp",
    updatedAt: new Date().toISOString(),
    updatedBy: "player",
  }
  if (version !== uploadVersion || unmounted || props.entityRef !== entityRef) return
  await tsian.workspace.write(
    path,
    `${JSON.stringify(parsed, null, 2)}\n`,
    "save-runtime",
  )
}
</script>

<template>
  <div class="portrait-stack">
    <DialogRoot v-if="canOpen">
      <DialogTrigger as-child>
        <button
          type="button"
          class="portrait-frame portrait-frame--interactive"
          :aria-label="`查看${name}的完整立绘`"
        >
          <img class="portrait-img" :src="displaySrc" :alt="name" />
          <span class="portrait-view-hint" aria-hidden="true">查看立绘</span>
        </button>
      </DialogTrigger>

      <DialogPortal>
        <DialogOverlay class="portrait-overlay" />
        <DialogContent class="portrait-dialog">
          <header class="portrait-dialog-head">
            <div>
              <DialogTitle class="portrait-dialog-title">{{ name }}</DialogTitle>
              <DialogDescription class="portrait-dialog-description">
                完整立绘
              </DialogDescription>
            </div>
            <DialogClose class="portrait-close" aria-label="关闭立绘查看">×</DialogClose>
          </header>

          <div class="portrait-full-wrap">
            <img class="portrait-full" :src="displaySrc" :alt="`${name}的完整立绘`" />
          </div>

          <div class="portrait-dialog-actions">
            <button
              v-if="canUpload"
              type="button"
              class="portrait-upload-btn"
              :disabled="uploading"
              @click="triggerFileInput"
            >
              {{ uploading ? (uploadStatus ?? "处理中…") : (portraitUrl ? "替换立绘" : "上传立绘") }}
            </button>
            <DialogClose class="portrait-done-btn">返回角色页</DialogClose>
          </div>

          <p v-if="uploadStatus && !uploading" class="portrait-status" role="alert">
            {{ uploadStatus }}
          </p>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>

    <div v-else class="portrait-frame" aria-hidden="true">
      <img class="portrait-img" :src="displaySrc" alt="" />
    </div>

    <input
      ref="fileInput"
      type="file"
      accept="image/png,image/jpeg,image/webp"
      class="portrait-file-input"
      @change="onFileChange"
    />
  </div>
</template>

<style scoped>
.portrait-stack {
  width: 100%;
  max-width: 420px;
}

.portrait-frame {
  width: 100%;
  max-width: 420px;
  aspect-ratio: 3 / 3.35;
  border: 0;
  padding: 0;
  background:
    radial-gradient(circle at 50% 34%, rgba(181, 137, 61, 0.14), transparent 58%),
    radial-gradient(circle at 50% 72%, rgba(155, 58, 46, 0.08), transparent 64%);
  position: relative;
  display: block;
  overflow: hidden;
  isolation: isolate;
  clip-path: polygon(5% 1%, 94% 0, 98% 7%, 96% 19%, 100% 29%, 97% 42%, 100% 55%, 96% 68%, 99% 80%, 93% 97%, 78% 99%, 65% 96%, 48% 100%, 34% 97%, 19% 100%, 6% 96%, 2% 84%, 5% 71%, 1% 59%, 4% 45%, 0 31%, 5% 17%);
}

.portrait-frame::before,
.portrait-frame::after {
  content: "";
  position: absolute;
  pointer-events: none;
  z-index: 2;
}

.portrait-frame::before {
  inset: 0;
  background:
    radial-gradient(ellipse at 4% 18%, rgba(6, 6, 8, 0.95) 0 2%, transparent 9%),
    radial-gradient(ellipse at 98% 32%, rgba(6, 6, 8, 0.9) 0 2%, transparent 10%),
    radial-gradient(ellipse at 7% 78%, rgba(6, 6, 8, 0.92) 0 3%, transparent 11%),
    radial-gradient(ellipse at 91% 88%, rgba(6, 6, 8, 0.88) 0 3%, transparent 12%);
  mix-blend-mode: multiply;
}

.portrait-frame::after {
  inset: auto 0 0;
  height: 28%;
  background: linear-gradient(transparent, rgba(6, 6, 8, 0.72));
}

.portrait-frame--interactive {
  color: inherit;
  cursor: zoom-in;
}

.portrait-frame--interactive:focus-visible {
  outline: 2px solid var(--ember-bright);
  outline-offset: 4px;
}

.portrait-img {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: saturate(0.9) contrast(1.03);
}

.portrait-view-hint {
  position: absolute;
  z-index: 3;
  right: 8%;
  bottom: 5%;
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.16em;
  color: rgba(232, 169, 72, 0.72);
  opacity: 0;
  transform: translateY(3px);
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.portrait-frame--interactive:hover .portrait-view-hint,
.portrait-frame--interactive:focus-visible .portrait-view-hint {
  opacity: 1;
  transform: translateY(0);
}

.portrait-overlay {
  position: fixed;
  inset: 0;
  z-index: 140;
  background: rgba(3, 3, 5, 0.88);
  backdrop-filter: blur(8px);
}

.portrait-dialog {
  position: fixed;
  z-index: 141;
  top: 50%;
  left: 50%;
  width: min(920px, calc(100vw - 48px));
  max-height: min(880px, calc(100dvh - 48px));
  transform: translate(-50%, -50%);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto auto;
  gap: 14px;
  padding: 20px;
  border: 1px solid rgba(181, 137, 61, 0.42);
  border-radius: 12px;
  background:
    radial-gradient(circle at 50% 18%, rgba(181, 137, 61, 0.1), transparent 42%),
    rgba(8, 7, 9, 0.98);
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.72);
  outline: none;
}

.portrait-dialog:focus-visible {
  box-shadow: 0 0 0 2px var(--ember-bright), 0 30px 90px rgba(0, 0, 0, 0.72);
}

.portrait-dialog-head,
.portrait-dialog-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.portrait-dialog-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.28rem;
  letter-spacing: 0.08em;
  color: var(--ember-bright);
}

.portrait-dialog-description {
  margin-top: 2px;
  font-family: var(--font-mono);
  font-size: 0.68rem;
  letter-spacing: 0.18em;
  color: var(--prose-faint);
}

.portrait-close {
  width: 36px;
  height: 36px;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: rgba(6, 6, 8, 0.72);
  color: var(--prose-muted);
  font-size: 1.45rem;
  line-height: 1;
  cursor: pointer;
}

.portrait-full-wrap {
  min-height: 220px;
  overflow: hidden;
  display: grid;
  place-items: center;
  background:
    radial-gradient(circle, rgba(181, 137, 61, 0.07), transparent 58%),
    rgba(0, 0, 0, 0.24);
}

.portrait-full {
  display: block;
  max-width: 100%;
  max-height: calc(100dvh - 220px);
  object-fit: contain;
}

.portrait-upload-btn,
.portrait-done-btn {
  min-height: 38px;
  padding: 8px 16px;
  border: 1px solid rgba(181, 137, 61, 0.34);
  border-radius: 6px;
  background: rgba(181, 137, 61, 0.08);
  color: var(--ember-bright);
  font-family: var(--font-mono);
  font-size: 0.72rem;
  letter-spacing: 0.1em;
  cursor: pointer;
}

.portrait-done-btn {
  margin-left: auto;
  background: transparent;
  color: var(--prose-muted);
}

.portrait-close:hover,
.portrait-close:focus-visible,
.portrait-upload-btn:hover:not(:disabled),
.portrait-upload-btn:focus-visible,
.portrait-done-btn:hover,
.portrait-done-btn:focus-visible {
  outline: 2px solid var(--ember-bright);
  outline-offset: 2px;
  color: #f3c979;
}

.portrait-upload-btn:disabled {
  cursor: progress;
  opacity: 0.55;
}

.portrait-status {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid rgba(155, 58, 46, 0.42);
  border-radius: 6px;
  background: rgba(120, 30, 30, 0.24);
  color: #f0b0b0;
  font-family: var(--font-mono);
  font-size: 0.7rem;
}

.portrait-file-input {
  display: none;
}

@media (max-width: 720px) {
  .portrait-dialog {
    width: calc(100vw - 20px);
    max-height: calc(100dvh - 20px);
    padding: 14px;
  }

  .portrait-full {
    max-height: calc(100dvh - 190px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .portrait-view-hint {
    transition: none;
  }
}
</style>
