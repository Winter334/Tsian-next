<script setup lang="ts">
/**
 * CharacterCard — 角色卡壳：固定立绘栏 + tabs/panes（右侧详情区）。
 *
 * design §4.3 / R6：
 * - 左侧固定 CharacterPortrait（首字 = entity.name[0]；entity null 时取 localId[0]）。
 * - 右侧 CharacterDetail（tabs + panes）。
 * - 切换 tab 时立绘栏不变（预览 HTML 核心决策）。
 * - entity null 时降级显示 ref/localId + "档案缺失"；立绘栏首字取 localId[0]。
 *
 * displayItems 由本组件从 entity.extensions 调 parseExtensionsOnly 解析，
 * 透传给 OverviewPane（design §4.4 第 7 项 extensions 分区）。
 */
import { computed } from "vue"
import type { CharacterEntity, RelationshipFile } from "../../lib/character-types"
import type { DisplayItems } from "../../lib/runtime-types"
import { emptyDisplayItems } from "../../lib/runtime-types"
import { parseExtensionsOnly } from "../../lib/parse-entity"
import CharacterPortrait from "./CharacterPortrait.vue"
import CharacterDetail from "./CharacterDetail.vue"

const props = defineProps<{
  entity: CharacterEntity | null
  loading: boolean
  relationships: RelationshipFile | null
  /** 实体 ref（用于 entity null 时降级展示 localId）。 */
  entityRef: string | null
  /** 主角 ref，透传给 CharacterDetail → InventoryPane。 */
  protagonistRef: string | null
}>()

const emit = defineEmits<{
  select: [ref: string]
}>()

// displayItems：从 entity.extensions 解析（entity null 时为空桶）。
const displayItems = computed<DisplayItems>(() => {
  if (!props.entity || !props.entity.extensions) return emptyDisplayItems()
  const { displayItems: items } = parseExtensionsOnly(props.entity.extensions)
  return items
})

// 立绘栏首字：entity.name[0] 优先；entity null 时取 ref 的 localId[0]。
const portraitName = computed(() => {
  if (props.entity && props.entity.name.length > 0) return props.entity.name
  if (props.entityRef) {
    const idx = props.entityRef.indexOf(":")
    const localId = idx >= 0 ? props.entityRef.slice(idx + 1) : props.entityRef
    return localId
  }
  return "?"
})

const localId = computed(() => {
  if (!props.entityRef) return ""
  const idx = props.entityRef.indexOf(":")
  return idx >= 0 ? props.entityRef.slice(idx + 1) : props.entityRef
})

const hasEntity = computed(() => props.entity !== null)

// entity 切换时不重置 CharacterDetail 的 tab 状态——tab 是 UI 偏好，
// 切换角色时保持上次看的 tab 体验更连贯。CharacterDetail 内部持有 tab state。
// 父 CharacterView 用 :key=selectedRef 控制 CharacterCard remount，
// 因此 CharacterDetail 也会 remount，tab 默认回到 overview。这符合"切换角色回到概况"直觉。

function onSelect(ref: string) {
  emit("select", ref)
}
</script>

<template>
  <section class="char-card">
    <!-- 左侧固定立绘栏（不随标签切换） -->
    <div class="portrait-column">
      <CharacterPortrait :name="portraitName" />
    </div>

    <!-- 右侧详情栏（只有这里随标签切换） -->
    <div class="detail-column-wrap">
      <template v-if="hasEntity">
        <CharacterDetail
          :entity="entity!"
          :relationships="relationships"
          :display-items="displayItems"
          :protagonist-ref="protagonistRef"
          @select="onSelect"
        />
      </template>
      <!-- 降级：entity 读取失败 / 缺失 -->
      <div v-else class="entity-missing">
        <div class="missing-glyph">{{ localId.charAt(0) || "?" }}</div>
        <div class="missing-name">{{ localId || "未知" }}</div>
        <div class="missing-hint">{{ loading ? "读取中…" : "档案缺失" }}</div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.char-card {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(280px, 340px) 1fr;
  gap: 28px;
  overflow: hidden;
  padding: 24px 32px;
  min-width: 0;
}
.portrait-column {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-top: 22px;
}
.detail-column-wrap {
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.entity-missing {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
  color: var(--whisper);
}
.missing-glyph {
  font-family: var(--font-display);
  font-size: 4rem;
  color: var(--ember-bright);
  opacity: 0.5;
  font-weight: 700;
  text-shadow: 0 0 18px rgba(232, 169, 72, 0.12);
}
.missing-name {
  font-family: var(--font-display);
  font-size: 1.4rem;
  color: var(--prose-dim);
  letter-spacing: 0.06em;
}
.missing-hint {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  letter-spacing: 0.18em;
  color: var(--whisper);
  text-transform: uppercase;
}
</style>
