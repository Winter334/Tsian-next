<script setup lang="ts">
/** CharacterListItem — 在场人物的头像与姓名选择项。 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { useEntity } from "../../composables/useEntity"
import { getTsianClient } from "../../composables/useTsian"
import { pickDefaultAvatarUrl } from "../../lib/character-avatar"

const props = defineProps<{
  entityRef: string
  selected: boolean
  protagonist: boolean
  portraitRefreshToken: number
  showIdentity?: boolean
  ariaLabel?: string
}>()

const emit = defineEmits<{
  select: [ref: string, trigger: HTMLButtonElement]
}>()

function selectCharacter(event: MouseEvent): void {
  emit("select", props.entityRef, event.currentTarget as HTMLButtonElement)
}

const { data: entityData, error: entityError, load: loadEntity } = useEntity(props.entityRef)
const portraitUrl = ref<string | null>(null)
let portraitLoadVersion = 0

const localId = computed(() => {
  const idx = props.entityRef.indexOf(":")
  return idx >= 0 ? props.entityRef.slice(idx + 1) : props.entityRef
})

const displayName = computed(() => {
  const name = entityData.value?.entity?.name
  return typeof name === "string" && name.length > 0 ? name : localId.value
})

const identityLine = computed(() => {
  const identity = entityData.value?.entity?.identity
  if (!isRecord(identity)) return ""
  return [identity.role, identity.affiliation, identity.realm]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" · ")
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const portraitPath = computed(() => {
  const portrait = entityData.value?.entity?.portrait
  if (!isRecord(portrait)) return undefined
  return typeof portrait.path === "string" && portrait.path.length > 0 ? portrait.path : undefined
})

const defaultAvatarSrc = computed(() => {
  const entity = entityData.value?.entity
  if (!entity) return pickDefaultAvatarUrl({})
  const identity = isRecord(entity.identity) ? entity.identity : undefined
  return pickDefaultAvatarUrl({
    identity: typeof identity?.gender === "string" ? { gender: identity.gender } : undefined,
    gender: typeof entity.gender === "string" ? entity.gender : undefined,
  })
})

const thumbnailSrc = computed(() => portraitUrl.value ?? defaultAvatarSrc.value)
const missing = computed(() => entityError.value !== null)

onMounted(() => void loadEntity())
onBeforeUnmount(() => {
  portraitLoadVersion += 1
  revokePortraitUrl()
})

watch(portraitPath, () => void loadPortraitThumbnail(), { immediate: true })
watch(() => props.portraitRefreshToken, () => void refreshEntityAndPortrait())

function revokePortraitUrl(): void {
  if (!portraitUrl.value) return
  URL.revokeObjectURL(portraitUrl.value)
  portraitUrl.value = null
}

async function refreshEntityAndPortrait(): Promise<void> {
  await loadEntity({ force: true })
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
</script>

<template>
  <button
    type="button"
    class="char-list-item"
    :class="{ active: selected, protagonist, missing }"
    :aria-current="selected ? 'true' : undefined"
    :aria-label="ariaLabel ?? `${displayName}${protagonist ? '，主角' : ''}${missing ? '，档案缺失' : ''}`"
    @click="selectCharacter"
  >
    <span class="char-list-thumb" aria-hidden="true">
      <img :src="thumbnailSrc" alt="" />
    </span>
    <span class="char-list-copy">
      <span class="char-list-name">{{ displayName }}</span>
      <span v-if="showIdentity && identityLine" class="char-list-identity">{{ identityLine }}</span>
    </span>
    <span v-if="protagonist" class="char-list-marker" title="主角">主</span>
    <span v-else-if="selected" class="char-list-marker" title="当前角色">今</span>
  </button>
</template>

<style scoped>
.char-list-item {
  position: relative;
  width: 100%;
  min-height: 54px;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 7px;
  border: 1px solid transparent;
  border-radius: 8px 2px 8px 2px;
  background: transparent;
  color: var(--prose-muted);
  text-align: left;
  cursor: pointer;
  outline: none;
  transition: color 0.16s ease, background 0.16s ease, border-color 0.16s ease;
}

.char-list-item:hover,
.char-list-item:focus-visible {
  color: var(--prose);
  border-color: rgba(181, 137, 61, 0.22);
  background: rgba(181, 137, 61, 0.055);
}

.char-list-item:focus-visible {
  outline: 2px solid var(--ember-bright);
  outline-offset: 1px;
}

.char-list-item.active {
  color: var(--ember-bright);
  border-color: rgba(232, 169, 72, 0.34);
  background:
    linear-gradient(90deg, rgba(181, 137, 61, 0.13), transparent),
    rgba(155, 58, 46, 0.025);
}

.char-list-thumb {
  width: 34px;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 50% 45% 50% 42%;
  border: 1px solid rgba(181, 137, 61, 0.26);
  background: var(--void-deep);
}

.char-list-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.char-list-copy {
  min-width: 0;
  display: grid;
  gap: 1px;
}

.char-list-name,
.char-list-identity {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.char-list-name {
  font-family: var(--font-display);
  font-size: 0.84rem;
  letter-spacing: 0.04em;
}

.char-list-identity {
  font-family: var(--font-mono);
  font-size: 0.55rem;
  color: var(--prose-faint);
  letter-spacing: 0.03em;
}

.char-list-marker {
  font-family: var(--font-mono);
  font-size: 0.52rem;
  color: var(--ember-bright);
}

.char-list-item.missing {
  opacity: 0.58;
}

@media (prefers-reduced-motion: reduce) {
  .char-list-item {
    transition: none;
  }
}
</style>
