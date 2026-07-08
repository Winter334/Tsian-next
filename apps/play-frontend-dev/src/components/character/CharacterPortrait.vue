<script setup lang="ts">
/**
 * CharacterPortrait — 角色立绘栏（角色卡左侧固定栏）。
 *
 * task 07-05 design §"UI Design" / D6 / R4-R8：
 * - 3:4.15 比例（保留原有暗色仪式风边框/内层细线/底部渐变）。
 * - 有上传头像时展示 workspace binary 图片；无上传或读取失败时展示默认头像。
 * - 不再展示首字占位。
 * - protagonist 可通过图片下方常驻按钮上传/更换图片（canUpload 控制）。
 * - 上传流程：验证 → preparePortraitBlob → 写 Blob 到
 *   `save/assets/portraits/characters/<localId>.webp` → 读 entity JSON →
 *   patch portrait 元数据 → 写回 entity JSON → emit portrait-updated。
 * - object URL 在替换和卸载时 revoke。
 */
import { computed, onBeforeUnmount, ref, watch } from "vue"
import { useTsian } from "../../composables/useTsian"
import { preparePortraitBlob } from "../../lib/image-processing"

const props = defineProps<{
  /** 角色名（用于 alt 文本）。 */
  name: string
  /** workspace 中上传头像路径（save/assets/portraits/characters/<localId>.webp）。缺省表示无上传。 */
  portraitPath?: string
  /** 默认头像 URL（按性别选择的内置 asset URL）。 */
  fallbackSrc: string
  /** 是否允许上传/更换（仅 protagonist）。 */
  canUpload: boolean
  /** 实体 ref（`character:<localId>`），用于派生 localId 与 entity JSON 路径。 */
  entityRef: string | null
}>()

const emit = defineEmits<{
  "portrait-updated": []
}>()

const { tsian } = useTsian()

// ── object URL 管理 ──
const portraitUrl = ref<string | null>(null)
const uploadStatus = ref<string | null>(null)
const uploading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

/** 从 entityRef 派生 localId（冒号后半段）。 */
const localId = computed(() => {
  if (!props.entityRef) return ""
  const idx = props.entityRef.indexOf(":")
  return idx >= 0 ? props.entityRef.slice(idx + 1) : props.entityRef
})

/** 上传头像固定写入路径。 */
const portraitAssetPath = computed(
  () => `save/assets/portraits/characters/${localId.value}.webp`,
)

/** entity JSON 路径（用于 patch portrait 元数据）。 */
const entityJsonPath = computed(() => {
  if (!props.entityRef) return ""
  const idx = props.entityRef.indexOf(":")
  const type = idx >= 0 ? props.entityRef.slice(0, idx) : "character"
  const id = idx >= 0 ? props.entityRef.slice(idx + 1) : props.entityRef
  return `save/entities/${type}/${id}.json`
})

/** 当前应渲染的图片 src：上传头像优先，失败/缺失回退默认头像。 */
const displaySrc = computed(() => portraitUrl.value ?? props.fallbackSrc)

/** 释放当前 object URL（如有）。 */
function revokePortraitUrl(): void {
  if (portraitUrl.value) {
    URL.revokeObjectURL(portraitUrl.value)
    portraitUrl.value = null
  }
}

/** 从 workspace 读取上传头像 binary 并创建 object URL。 */
async function loadPortraitBinary(): Promise<void> {
  if (!props.portraitPath) {
    revokePortraitUrl()
    return
  }
  try {
    const file = await tsian.workspace.read(props.portraitPath, "save-runtime")
    if (file === null) {
      // 上传头像不存在（元数据残留或文件丢失）→ 回退默认头像。
      revokePortraitUrl()
      return
    }
    const blob = file.binary
    if (!blob || blob.size === 0) {
      revokePortraitUrl()
      return
    }
    revokePortraitUrl()
    portraitUrl.value = URL.createObjectURL(blob)
  } catch {
    // 读取失败 → 回退默认头像，不抛错（type-safety §workspace-read）。
    revokePortraitUrl()
  }
}

// portraitPath 变化时重新加载 binary。
watch(
  () => props.portraitPath,
  () => {
    void loadPortraitBinary()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  revokePortraitUrl()
})

// ── 上传流程 ──
function triggerFileInput(): void {
  fileInput.value?.click()
}

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // 重置 input value 以便重复选择同一文件。
  input.value = ""
  if (!file) return
  if (uploading.value) return

  uploading.value = true
  uploadStatus.value = "处理中…"

  // 1. 验证 + 裁剪 + WebP 导出
  const prepared = await preparePortraitBlob(file)
  if ("error" in prepared) {
    uploading.value = false
    uploadStatus.value = prepared.error
    return
  }

  uploadStatus.value = "保存中…"

  try {
    // 2. 写 Blob 到 save-runtime workspace。
    await tsian.workspace.write(
      portraitAssetPath.value,
      prepared.blob,
      "save-runtime",
    )

    // 3. 读 entity JSON → patch portrait 元数据 → 写回。
    await patchEntityPortraitMetadata()

    // 4. 重新加载 binary 展示新头像。
    await loadPortraitBinary()

    uploading.value = false
    uploadStatus.value = null
    emit("portrait-updated")
  } catch (err) {
    uploading.value = false
    const msg = err && typeof err === "object" && "message" in err
      ? (err as { message: string }).message
      : "保存失败"
    uploadStatus.value = msg
  }
}

/** 读 entity JSON，patch portrait 元数据，写回 workspace。 */
async function patchEntityPortraitMetadata(): Promise<void> {
  const path = entityJsonPath.value
  if (!path) return
  const file = await tsian.workspace.read(path, "save-runtime")
  if (file === null) {
    throw new Error("找不到角色档案，无法更新头像元数据。")
  }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(file.content) as Record<string, unknown>
  } catch {
    throw new Error("角色档案解析失败，无法更新头像元数据。")
  }
  parsed.portrait = {
    path: portraitAssetPath.value,
    mimeType: "image/webp",
    updatedAt: new Date().toISOString(),
    updatedBy: "player",
  }
  await tsian.workspace.write(
    path,
    JSON.stringify(parsed, null, 2) + "\n",
    "save-runtime",
  )
}
</script>

<template>
  <div class="portrait-stack">
    <div class="portrait-frame">
      <img
        v-if="displaySrc"
        class="portrait-img"
        :src="displaySrc"
        :alt="name"
      />
    </div>

    <!-- 上传/更换按钮（仅 protagonist，常驻在图片下方） -->
    <button
      v-if="canUpload"
      type="button"
      class="portrait-upload-btn"
      :disabled="uploading"
      :title="uploading ? (uploadStatus ?? '') : '上传 / 更换头像'"
      @click="triggerFileInput"
    >
      <span v-if="uploading">{{ uploadStatus ?? "处理中…" }}</span>
      <span v-else>更换头像</span>
    </button>

    <!-- 状态提示（上传错误） -->
    <div v-if="uploadStatus && !uploading" class="portrait-status portrait-status--error">
      {{ uploadStatus }}
    </div>

    <!-- 隐藏文件输入 -->
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
  max-width: 340px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
}
.portrait-frame {
  width: 100%;
  max-width: 340px;
  aspect-ratio: 3 / 4.15;
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  background:
    radial-gradient(circle at 50% 36%, rgba(181, 137, 61, 0.12), transparent 62%),
    radial-gradient(circle at 50% 62%, rgba(155, 58, 46, 0.08), transparent 65%),
    var(--void-deep);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.02),
    0 18px 50px rgba(0, 0, 0, 0.35);
}
.portrait-frame::before {
  /* 内层细线 */
  content: "";
  position: absolute;
  inset: 10px;
  border: 1px solid rgba(181, 137, 61, 0.12);
  border-radius: 7px;
  pointer-events: none;
}
.portrait-frame::after {
  /* 底部渐变蒙层 */
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 24%;
  background: linear-gradient(transparent, rgba(6, 6, 8, 0.48));
  pointer-events: none;
}
.portrait-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  z-index: 1;
}
.portrait-upload-btn {
  width: 100%;
  min-height: 38px;
  padding: 8px 14px;
  border: 1px solid rgba(181, 137, 61, 0.36);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(181, 137, 61, 0.12), rgba(181, 137, 61, 0.04)),
    rgba(6, 6, 8, 0.72);
  color: var(--ember-bright);
  font-family: var(--font-mono);
  font-size: 0.72rem;
  letter-spacing: 0.16em;
  cursor: pointer;
  transition: border-color 0.18s ease, background 0.18s ease, color 0.18s ease;
}
.portrait-upload-btn:hover,
.portrait-upload-btn:focus-visible {
  border-color: rgba(232, 169, 72, 0.62);
  background:
    linear-gradient(180deg, rgba(232, 169, 72, 0.16), rgba(181, 137, 61, 0.06)),
    rgba(10, 5, 6, 0.86);
  color: #f3c979;
}
.portrait-upload-btn:disabled {
  cursor: progress;
  color: var(--prose-muted);
  border-color: rgba(181, 137, 61, 0.24);
}
.portrait-status {
  padding: 6px 10px;
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 0.68rem;
  letter-spacing: 0.06em;
  text-align: center;
}
.portrait-status--error {
  background: rgba(120, 30, 30, 0.72);
  color: #f0b0b0;
  border: 1px solid rgba(200, 60, 60, 0.4);
}
.portrait-file-input {
  display: none;
}
</style>
