<script setup lang="ts">
/**
 * StatusBarCharacter — 状态栏"角色"区（展开 + 折叠双形态）。
 *
 * design §5.3：
 * - 展开态：方形圆角 56×56 头像 + 角色名 + brief（1 行截断），点击进角色卡。
 * - 折叠态（极简图腾）：方形圆角 40×40 头像 + 底部渐变蒙层 + 首字叠加 + 径向微光，
 *   点击 emit toggle（展开状态栏）。
 * - 无角色时：默认占位"?" + 暗化边框（折叠态）/"未设定角色"（展开态）。
 *
 * 数据来源：runtime.protagonistRef（{ ref, name } | null）。
 * 有 ref 时通过 useEntity(ref) 读取实体获取 name/brief（entity 文件内 name/brief
 * 是权威值，runtime.protagonistRef.name 是冗余快照——优先用 entity 的）。
 * ref 为 null → 显示"未设定角色"。
 *
 * 不抛错：useEntity 内部 catch，error 走 error ref（type-safety §"play-frontend
 * Workspace Data Consumption"）。
 */
import { computed, watch } from "vue"
import { useEntity } from "../../composables/useEntity"

interface CharacterSnapshot {
  ref: string
  name: string
}

const props = defineProps<{
  collapsed: boolean
  character: CharacterSnapshot | null
}>()

const emit = defineEmits<{
  toggle: []
  "open-character": []
}>()

// 当 character.ref 存在时，按需读取实体文件获取 name/brief。
// useEntity 是非单例薄封装：每个 StatusBarCharacter 实例独立持有 data/error。
// 当 ref 变化时重新读取（切换存档/角色场景）。
const entityRef = computed(() => props.character?.ref ?? "")
const { data: entityData, load: loadEntity } = useEntity(entityRef.value)

watch(
  entityRef,
  (ref) => {
    if (ref) void loadEntity()
  },
  { immediate: true },
)

// 角色名：优先实体文件的 name，其次 runtime 快照 name，最后占位。
const displayName = computed(() => {
  const entityName = entityData.value?.entity?.name
  if (typeof entityName === "string" && entityName.trim().length > 0) return entityName
  return props.character?.name ?? ""
})

// brief：仅实体文件提供；runtime 快照不含 brief。
const displayBrief = computed(() => {
  const brief = entityData.value?.entity?.brief
  return typeof brief === "string" && brief.trim().length > 0 ? brief : ""
})

const hasCharacter = computed(() => Boolean(props.character?.ref) && displayName.value.length > 0)

// 头像首字：角色名首字（中文取 1 字，英文取首字母）。
const avatarGlyph = computed(() => {
  if (!hasCharacter.value) return "?"
  const name = displayName.value
  return name.charAt(0) || "?"
})
</script>

<template>
  <!-- 折叠态：极简图腾头像，点击展开状态栏 -->
  <button
    v-if="collapsed"
    class="sb-char-collapsed"
    :class="{ empty: !hasCharacter }"
    :aria-label="hasCharacter ? `展开状态栏 — ${displayName}` : '展开状态栏'"
    @click="emit('toggle')"
  >
    <span class="avatar-glyph">{{ avatarGlyph }}</span>
  </button>

  <!-- 展开态：头像 + 名字 + brief，点击进角色卡 -->
  <button
    v-else
    class="sb-char-expanded"
    :class="{ empty: !hasCharacter }"
    :aria-label="hasCharacter ? `查看角色卡 — ${displayName}` : '未设定角色'"
    @click="hasCharacter ? emit('open-character') : emit('toggle')"
  >
    <span class="avatar-square">
      <span class="avatar-glyph">{{ avatarGlyph }}</span>
    </span>
    <span class="char-meta">
      <span class="char-name">{{ hasCharacter ? displayName : "未设定角色" }}</span>
      <span v-if="hasCharacter && displayBrief" class="char-brief">{{ displayBrief }}</span>
    </span>
  </button>
</template>

<style scoped>
/* ── 折叠态：极简图腾 ── */
.sb-char-collapsed {
  /* 48px 栏宽减去左右 padding 4px 各 = 40px 头像 */
  width: 40px;
  height: 40px;
  margin: 8px auto 0;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  background:
    radial-gradient(circle at 50% 40%, rgba(181, 137, 61, 0.08), transparent 70%),
    var(--void-deep);
  position: relative;
  cursor: pointer;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  overflow: hidden;
  padding: 0;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.sb-char-collapsed::before {
  /* 底部渐变蒙层 */
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 40%;
  background: linear-gradient(transparent, rgba(6, 6, 8, 0.85));
  pointer-events: none;
}
.sb-char-collapsed:hover {
  border-color: var(--ember);
  box-shadow: 0 0 10px rgba(181, 137, 61, 0.25);
}
.sb-char-collapsed.empty {
  border-color: var(--whisper);
  background: var(--void-deep);
}
.sb-char-collapsed.empty:hover {
  border-color: var(--prose-dim);
  box-shadow: none;
}

/* 首字叠加在蒙层上（折叠态） */
.sb-char-collapsed .avatar-glyph {
  position: relative;
  z-index: 1;
  font-family: var(--font-display);
  font-size: 0.95rem;
  color: var(--ember-bright);
  font-weight: 700;
  padding-bottom: 4px;
  letter-spacing: 0;
}
.sb-char-collapsed.empty .avatar-glyph {
  color: var(--whisper);
}

/* ── 展开态：头像 + 名字 + brief ── */
.sb-char-expanded {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: transparent;
  border: none;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  cursor: pointer;
  text-align: left;
  transition: background 0.2s;
}
.sb-char-expanded:hover {
  background: rgba(181, 137, 61, 0.05);
}

.avatar-square {
  flex-shrink: 0;
  width: 56px;
  height: 56px;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  background: var(--void-deep);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.sb-char-expanded:hover .avatar-square {
  border-color: var(--ember);
  box-shadow: 0 0 8px rgba(181, 137, 61, 0.2);
}
.sb-char-expanded.empty .avatar-square {
  border-color: var(--whisper);
}

/* 展开态首字：稍大 */
.avatar-square .avatar-glyph {
  font-family: var(--font-display);
  font-size: 1.4rem;
  color: var(--ember-bright);
  font-weight: 700;
}
.sb-char-expanded.empty .avatar-square .avatar-glyph {
  color: var(--whisper);
}

.char-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0; /* 允许子元素截断 */
  flex: 1;
}

.char-name {
  font-family: var(--font-serif);
  font-size: 0.95rem;
  color: var(--prose);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sb-char-expanded.empty .char-name {
  color: var(--prose-dim);
  font-style: italic;
}

.char-brief {
  font-family: var(--font-serif);
  font-size: 0.75rem;
  color: var(--prose-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
