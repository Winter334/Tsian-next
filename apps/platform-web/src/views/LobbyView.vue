<template>
  <!-- 大厅页：选择内置模组进入模组页 -->
  <section class="page-section">
    <div class="section-copy">
      <p class="section-eyebrow">大厅</p>
      <h2>选择一个模组</h2>
      <p>模组页会只展示该模组自己的存档，不再把所有模组的存档混在一起。</p>
    </div>
    <div class="mod-grid">
      <article v-for="mod in builtinMods" :key="mod.id" class="mod-card">
        <div class="mod-card__head">
          <div>
            <p class="mod-kicker">{{ mod.id }}</p>
            <h3>{{ mod.name }}</h3>
          </div>
          <span class="mod-version">v{{ mod.version }}</span>
        </div>
        <p class="mod-description">
          {{ mod.description || "当前模组未提供描述。" }}
        </p>
        <div class="mod-meta">
          <span>作者：{{ mod.author || "未填写" }}</span>
          <span>存档：{{ countSavesForMod(mod.id) }}</span>
          <span>实体类型：{{ mod.entityTypeCount }}</span>
          <span>预设事件：{{ mod.eventCount }}</span>
        </div>
        <div class="mod-actions">
          <button class="primary-button" type="button" @click="openModPage(mod.id)">
            进入模组页
          </button>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { ModStaticContent } from "@tsian/contracts"
import { onMounted, ref } from "vue"
import { useRouter } from "vue-router"
import { listPlatformSaves, playFrontendBridge } from "../platform-host"

interface BuiltinModSummary {
  id: string
  name: string
  version: string
  author?: string
  description?: string
  entityTypeCount: number
  archiveCount: number
  eventCount: number
}

interface SaveOption {
  id: string
  modId: string
}

const router = useRouter()
const builtinMods = ref<BuiltinModSummary[]>([])
const saveOptions = ref<SaveOption[]>([])

function countSavesForMod(modId: string): number {
  return saveOptions.value.filter((save) => save.modId === modId).length
}

async function refreshBuiltinMods() {
  const result = await playFrontendBridge.query.query<ModStaticContent>({
    resource: "builtin-mods",
  })
  builtinMods.value = result.items.map((mod) => ({
    id: mod.manifest.id,
    name: mod.manifest.name,
    version: mod.manifest.version,
    author: mod.manifest.author,
    description: mod.manifest.description,
    entityTypeCount: mod.entityTypeDefinitions.length,
    archiveCount: mod.archiveCatalog.length,
    eventCount: mod.eventCatalog.length,
  }))
}

async function refreshSaves() {
  saveOptions.value = (await listPlatformSaves()).map((save) => ({
    id: save.id,
    modId: save.modId,
  }))
}

function openModPage(modId: string) {
  router.push({ path: "/mod", query: { id: modId } })
}

onMounted(async () => {
  await refreshBuiltinMods()
  await refreshSaves()
})
</script>

<style scoped>
.page-section {
  display: grid;
  gap: var(--ts-space-6);
  margin-top: var(--ts-space-6);
}

.section-copy {
  display: grid;
  gap: var(--ts-space-2);
}

.section-eyebrow,
.mod-kicker {
  margin: 0 0 var(--ts-space-3);
  color: var(--ts-color-accent-default);
  font-size: var(--ts-text-xs);
  letter-spacing: var(--ts-tracking-wide);
  text-transform: uppercase;
}

h2 {
  margin: 0;
  font-family: var(--ts-font-serif);
  font-size: var(--ts-text-2xl);
  line-height: var(--ts-leading-tight);
  color: var(--ts-color-text-primary);
}

h3 {
  margin: 0;
  font-family: var(--ts-font-serif);
  font-size: var(--ts-text-xl);
  line-height: 1.3;
  color: var(--ts-color-text-primary);
}

.section-copy p {
  margin: 0;
  color: var(--ts-color-text-secondary);
  font-size: var(--ts-text-base);
  line-height: var(--ts-leading-normal);
}

.mod-grid {
  display: grid;
  gap: var(--ts-space-4);
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
}

.mod-card {
  display: grid;
  gap: var(--ts-space-3);
  padding: var(--ts-space-4);
  border: 1px solid var(--ts-color-border-default);
  border-radius: var(--ts-radius-xl);
  background: var(--ts-color-surface-raised);
  box-shadow: var(--ts-shadow-2);
}

.mod-card__head {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: var(--ts-space-3);
}

.mod-version {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: var(--ts-space-1) var(--ts-space-2);
  border-radius: var(--ts-radius-full);
  background: var(--ts-color-accent-subtle);
  color: var(--ts-color-accent-default);
  font-size: var(--ts-text-xs);
  line-height: 1;
}

.mod-description {
  margin: 0;
  color: var(--ts-color-text-secondary);
  line-height: var(--ts-leading-normal);
}

.mod-meta {
  display: grid;
  gap: var(--ts-space-2);
}

.mod-meta span {
  color: var(--ts-color-text-muted);
  font-size: var(--ts-text-sm);
  line-height: 1.7;
}

.mod-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ts-space-3);
}

.primary-button {
  padding: var(--ts-space-3) var(--ts-space-4);
  border: 1px solid var(--ts-color-accent-default);
  border-radius: var(--ts-radius-lg);
  background: var(--ts-color-accent-default);
  color: var(--ts-color-accent-fg);
  font: inherit;
  font-weight: var(--ts-weight-medium);
  cursor: pointer;
  transition:
    transform var(--ts-duration-default) var(--ts-ease-out),
    background var(--ts-duration-default) var(--ts-ease-out);
}

.primary-button:hover {
  transform: translateY(-1px);
}

@media (max-width: 720px) {
  .mod-grid {
    grid-template-columns: 1fr;
  }

  .mod-card__head {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
