<script setup lang="ts">
/** CharacterList — 当前场景在场人物的精简选择栏。 */
import CharacterListItem from "./CharacterListItem.vue"

defineProps<{
  presentRefs: Array<{ ref: string }>
  selectedRef: string | null
  protagonistRef: string | null
  portraitRefreshToken: number
  variant?: "desktop" | "drawer"
}>()

const emit = defineEmits<{
  select: [ref: string, trigger: HTMLButtonElement]
}>()
</script>

<template>
  <aside class="char-list" :class="`char-list--${variant ?? 'desktop'}`">
    <div class="char-list-title">
      <span>在场</span>
      <span class="char-list-count">{{ presentRefs.length }}</span>
    </div>
    <div class="char-list-group">
      <CharacterListItem
        v-for="person in presentRefs"
        :key="person.ref"
        :entity-ref="person.ref"
        :selected="selectedRef === person.ref"
        :protagonist="protagonistRef === person.ref"
        :portrait-refresh-token="portraitRefreshToken"
        @select="(entityRef, trigger) => emit('select', entityRef, trigger)"
      />
    </div>
  </aside>
</template>

<style scoped>
.char-list {
  position: relative;
  width: 168px;
  flex-shrink: 0;
  height: 100%;
  overflow-y: auto;
  padding: 12px 0 18px;
  box-sizing: border-box;
  border-right: 1px solid rgba(181, 137, 61, 0.16);
  background:
    radial-gradient(circle at 20% 14%, rgba(181, 137, 61, 0.075), transparent 35%),
    linear-gradient(180deg, rgba(16, 7, 8, 0.78), rgba(6, 3, 4, 0.64));
  scrollbar-width: none;
  mask-image: linear-gradient(black 0, black 94%, transparent 100%);
}

.char-list::-webkit-scrollbar {
  display: none;
}

.char-list-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 8px 10px;
  padding: 0 5px 8px;
  border-bottom: 1px solid var(--line);
  font-family: var(--font-mono);
  font-size: 0.6rem;
  letter-spacing: 0.12em;
  color: var(--prose-faint);
}

.char-list-count {
  color: var(--ember-bright);
}

.char-list-group {
  display: grid;
  gap: 6px;
  padding: 0 8px;
}

.char-list--drawer {
  width: 100%;
  border-right: 0;
  background: transparent;
}
</style>
