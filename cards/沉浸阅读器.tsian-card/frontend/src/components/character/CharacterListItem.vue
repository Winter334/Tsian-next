<script setup lang="ts">
/**
 * CharacterListItem — 在场/关联人物列表单行（CharacterList 子项）。
 *
 * 每行独立 useEntity(entityRef) 取对方实体的 name/brief/portrait（design §4.2 / R12 / R6）。
 * useEntity 是非单例薄封装：每个 CharacterListItem 实例独立持有 data/error。
 * 父 CharacterList 通过 :key=entityRef 在 refs 变化时 remount 本行。
 *
 * - 单行：肖像缩略图 + name + brief（1 行截断）。
 * - 上传肖像优先；缺失/读取失败时回退默认头像。
 * - 高亮 selectedRef；主角显示轻量徽标。
 * - 点击 emit `select(ref)`。
 * - 不显示 raw ref/id（R9）。
 * - entity 读取失败 / 缺失 → 该行降级显示 ref 的 localId + "档案缺失"，不阻断整列。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { useEntity } from "../../composables/useEntity"
import { getTsianClient } from "../../composables/useTsian"
import { pickDefaultAvatarUrl } from "../../lib/character-avatar"

const props = defineProps<{
  entityRef: string
  selected: boolean
  protagonist: boolean
  portraitRefreshToken: number
}>()

const emit = defineEmits<{
  select: [ref: string]
}>()

const { data: entityData, error: entityError, load: loadEntity } = useEntity(props.entityRef)

const portraitUrl = ref<string | null>(null)
let portraitLoadVersion = 0

onMounted(() => {
  void loadEntity()
})

onBeforeUnmount(() => {
  revokePortraitUrl()
})

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

const displayName = computed(() => {
  const name = entityData.value?.entity?.name
  return typeof name === "string" && name.length > 0 ? name : localId.value
})

const displayBrief = computed(() => {
  if (entityError.value === "load-failed" || entityError.value === "not-found") {
    return "档案缺失"
  }
  const brief = entityData.value?.entity?.brief
  return typeof brief === "string" && brief.length > 0 ? brief : ""
})

const localId = computed(() => {
  const idx = props.entityRef.indexOf(":")
  return idx >= 0 ? props.entityRef.slice(idx + 1) : props.entityRef
})

const portraitPath = computed(() => {
  const portrait = entityData.value?.entity?.portrait
  if (!isRecord(portrait)) return undefined
  const path = portrait.path
  return typeof path === "string" && path.length > 0 ? path : undefined
})

const defaultAvatarSrc = computed(() => {
  const entity = entityData.value?.entity
  if (!entity) return pickDefaultAvatarUrl({})

  const identity = entity.identity
  const identityGender = isRecord(identity) && typeof identity.gender === "string"
    ? identity.gender
    : undefined
  const gender = typeof entity.gender === "string" ? entity.gender : undefined

  return pickDefaultAvatarUrl({
    identity: identityGender ? { gender: identityGender } : undefined,
    gender,
  })
})

const thumbnailSrc = computed(() => portraitUrl.value ?? defaultAvatarSrc.value)

watch(
  portraitPath,
  () => {
    void loadPortraitThumbnail()
  },
  { immediate: true },
)

watch(
  () => props.portraitRefreshToken,
  () => {
    void refreshEntityAndPortrait()
  },
)

function revokePortraitUrl(): void {
  if (portraitUrl.value) {
    URL.revokeObjectURL(portraitUrl.value)
    portraitUrl.value = null
  }
}

async function refreshEntityAndPortrait(): Promise<void> {
  await loadEntity()
  await loadPortraitThumbnail(portraitPath.value)
}

async function loadPortraitThumbnail(path = portraitPath.value): Promise<void> {
  const version = ++portraitLoadVersion
  if (!path) {
    revokePortraitUrl()
    return
  }

  try {
    const file = await getTsianClient().workspace.read(path, "save-runtime")
    if (version !== portraitLoadVersion) return
    if (file === null) {
      revokePortraitUrl()
      return
    }
    const blob = file.binary
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
    if (version !== portraitLoadVersion) return
    revokePortraitUrl()
  }
}

function onClick() {
  emit("select", props.entityRef)
}
</script>

<template>
  <button
    class="char-list-item"
    :class="{ active: selected, protagonist }"
    type="button"
    :aria-current="selected ? 'true' : undefined"
    @click="onClick"
  >
    <span class="char-list-thumb" aria-hidden="true">
      <img class="char-list-thumb-img" :src="thumbnailSrc" alt="" />
    </span>
    <span class="char-list-info">
      <span class="char-list-line">
        <span class="char-list-name">{{ displayName }}</span>
        <span v-if="protagonist" class="char-list-badge">主角</span>
      </span>
      <span v-if="displayBrief" class="char-list-brief">{{ displayBrief }}</span>
    </span>
  </button>
</template>

<style scoped>
.char-list-item {
  position: relative;
  width: 100%;
  min-height: 70px;
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding: 8px 9px;
  overflow: hidden;
  cursor: pointer;
  color: var(--prose-muted);
  background:
    linear-gradient(135deg, rgba(181, 137, 61, 0.035), rgba(155, 58, 46, 0.025) 48%, rgba(6, 6, 8, 0.16)),
    rgba(6, 6, 8, 0.18);
  border: 1px solid rgba(181, 137, 61, 0.10);
  border-radius: 12px;
  text-align: left;
  font-family: inherit;
  transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease, color 0.2s ease;
}
.char-list-item::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background:
    radial-gradient(circle at 28% 50%, rgba(232, 169, 72, 0.16), transparent 46%),
    linear-gradient(135deg, rgba(232, 169, 72, 0.08), transparent 62%);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
}
.char-list-item::after {
  content: "";
  position: absolute;
  right: -24px;
  bottom: -32px;
  width: 86px;
  height: 86px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(232, 169, 72, 0.12), transparent 68%);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
}
.char-list-item:hover {
  color: var(--prose);
  border-color: rgba(181, 137, 61, 0.24);
  background:
    linear-gradient(135deg, rgba(181, 137, 61, 0.06), rgba(155, 58, 46, 0.035) 48%, rgba(6, 6, 8, 0.18)),
    rgba(12, 6, 7, 0.42);
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.16);
  transform: translateY(-1px);
}
.char-list-item:hover::after,
.char-list-item.active::after {
  opacity: 0.55;
}
.char-list-item.active::before {
  opacity: 1;
}
.char-list-item.active {
  color: var(--ember-bright);
  border-color: rgba(232, 169, 72, 0.28);
  background:
    linear-gradient(135deg, rgba(181, 137, 61, 0.13), rgba(155, 58, 46, 0.065) 48%, rgba(6, 6, 8, 0.18)),
    rgba(15, 7, 8, 0.62);
  box-shadow:
    inset 0 1px 0 rgba(232, 169, 72, 0.12),
    inset 0 0 24px rgba(232, 169, 72, 0.035),
    0 10px 24px rgba(0, 0, 0, 0.20),
    0 0 22px rgba(181, 137, 61, 0.16);
  transform: translateY(-1px);
}
.char-list-thumb {
  position: relative;
  z-index: 1;
  width: 42px;
  aspect-ratio: 3 / 4.15;
  overflow: hidden;
  border: 1px solid rgba(181, 137, 61, 0.28);
  border-radius: 8px;
  background:
    radial-gradient(circle at 50% 35%, rgba(181, 137, 61, 0.10), transparent 60%),
    var(--void-deep);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.025),
    0 8px 14px rgba(0, 0, 0, 0.24);
  flex-shrink: 0;
}
.char-list-thumb::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent 62%, rgba(6, 6, 8, 0.36));
  pointer-events: none;
}
.char-list-thumb-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.char-list-item.active .char-list-thumb {
  border-color: rgba(232, 169, 72, 0.62);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.035),
    0 0 10px rgba(181, 137, 61, 0.24),
    0 8px 14px rgba(0, 0, 0, 0.24);
}
.char-list-info {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.char-list-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.char-list-name {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: var(--font-display);
  font-size: 0.95rem;
  letter-spacing: 0.04em;
  color: var(--prose);
}
.char-list-item.active .char-list-name {
  color: var(--ember-bright);
  text-shadow: 0 0 10px rgba(232, 169, 72, 0.16);
}
.char-list-badge {
  flex-shrink: 0;
  padding: 1px 5px 2px;
  border: 1px solid rgba(232, 169, 72, 0.28);
  border-radius: 999px;
  color: var(--ember-bright);
  background: rgba(181, 137, 61, 0.08);
  font-family: var(--font-mono);
  font-size: 0.54rem;
  line-height: 1.2;
  letter-spacing: 0.08em;
}
.char-list-brief {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 0.68rem;
  line-height: 1.35;
  color: var(--prose-faint);
}
.char-list-item:hover .char-list-brief,
.char-list-item.active .char-list-brief {
  color: var(--prose-muted);
}
</style>
