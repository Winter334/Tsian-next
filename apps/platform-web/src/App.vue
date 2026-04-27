<template>
  <main class="app-shell">
    <section class="panel">
      <header class="panel-header">
        <div class="panel-copy">
          <p class="eyebrow">Tsian</p>
          <h1>Play Lab</h1>
          <p class="summary">
            当前平台壳只负责存档、运行时和检查入口，把真正的游玩前端留给下面的工作区。
          </p>
        </div>
        <div class="status-grid">
          <article class="status-card">
            <span>Storage</span>
            <strong>{{ storageStatus }}</strong>
          </article>
          <article class="status-card">
            <span>AI</span>
            <strong>{{ aiStatus }}</strong>
          </article>
          <article class="status-card">
            <span>Frontend</span>
            <strong>{{ frontendName }}</strong>
          </article>
        </div>
      </header>
      <section class="save-bar">
        <label class="save-field">
          <span class="save-label">Save</span>
          <select v-model="activeSaveId" class="save-select" @change="handleChangeSave">
            <option v-for="save in saveOptions" :key="save.id" :value="save.id">
              {{ save.name }}
            </option>
          </select>
        </label>
        <div class="save-actions">
          <button class="save-button" type="button" @click="handleCreateSave">
            New Save
          </button>
          <button class="save-button save-button--ghost" type="button" @click="handleDeleteSave">
            Delete
          </button>
        </div>
      </section>
      <div ref="frontendMount" class="frontend-mount"></div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from "vue"
import { getBrowserAiConfig, getBrowserEmbeddingConfig } from "./config/ai"
import {
  createPlatformSave,
  deletePlatformSave,
  getPlatformActiveSaveId,
  initializePlatformHost,
  listPlatformSaves,
  playFrontendBridge,
  selectPlatformSave,
} from "./platform-host"
import { loadOfficialDefaultFrontend } from "./package-loader/official-default"
import { ensureLocalStorageReady } from "./storage"

const storageStatus = ref("checking...")
const aiStatus = ref("checking...")
const frontendName = ref("loading...")
const frontendMount = ref<HTMLElement | null>(null)
const saveOptions = ref<Array<{ id: string; name: string }>>([])
const activeSaveId = ref("")
let disposeFrontend: (() => void) | null = null

async function refreshSaves() {
  saveOptions.value = (await listPlatformSaves()).map((save) => ({
    id: save.id,
    name: save.name,
  }))
  activeSaveId.value = (await getPlatformActiveSaveId()) ?? ""
}

function mountFrontend() {
  disposeFrontend?.()

  const frontend = loadOfficialDefaultFrontend()
  frontendName.value = `${frontend.manifest.name} (${frontend.manifest.version})`

  if (frontendMount.value) {
    disposeFrontend = frontend.mount(frontendMount.value, playFrontendBridge)
  }
}

async function handleCreateSave() {
  await createPlatformSave()
  await refreshSaves()
  mountFrontend()
}

async function handleChangeSave() {
  if (!activeSaveId.value) {
    return
  }

  await selectPlatformSave(activeSaveId.value)
  await refreshSaves()
  mountFrontend()
}

async function handleDeleteSave() {
  if (!activeSaveId.value) {
    return
  }

  await deletePlatformSave(activeSaveId.value)
  await refreshSaves()
  mountFrontend()
}

onMounted(async () => {
  storageStatus.value = await ensureLocalStorageReady()
  aiStatus.value = [
    `chat=${getBrowserAiConfig() ? "configured" : "missing"}`,
    `embed=${getBrowserEmbeddingConfig() ? "configured" : "missing"}`,
  ].join(" | ")
  await initializePlatformHost()
  await refreshSaves()
  mountFrontend()
})

onBeforeUnmount(() => {
  disposeFrontend?.()
})
</script>

<style scoped>
.app-shell {
  width: 100%;
  min-height: 100vh;
  padding: 24px;
}

.panel {
  width: min(1400px, 100%);
  min-width: 0;
  margin: 0 auto;
  padding: 28px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 28px;
  background:
    radial-gradient(circle at top right, rgba(245, 158, 11, 0.12), transparent 24%),
    linear-gradient(180deg, rgba(15, 23, 42, 0.92), rgba(10, 15, 25, 0.96));
  box-shadow: 0 28px 70px rgba(2, 6, 23, 0.24);
}

.panel-header {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.9fr);
  gap: 18px;
  align-items: start;
}

.panel-copy {
  min-width: 0;
}

.eyebrow {
  margin: 0 0 12px;
  color: #f59e0b;
  font-size: 12px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

h1 {
  margin: 0 0 12px;
  font-family: "Iowan Old Style", "Noto Serif SC", "Source Han Serif SC", serif;
  font-size: clamp(38px, 4.2vw, 56px);
  line-height: 1.05;
}

.summary {
  margin: 0;
  color: #c7d3e2;
  font-size: 15px;
  line-height: 1.8;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.status-card {
  padding: 16px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 18px;
  background: rgba(8, 15, 26, 0.46);
}

.status-card span {
  display: block;
  color: #94a3b8;
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.status-card strong {
  display: block;
  margin-top: 8px;
  color: #f8fafc;
  font-size: 14px;
  line-height: 1.6;
}

.save-bar {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
  margin: 22px 0 0;
  padding: 18px 20px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 20px;
  background: rgba(8, 15, 26, 0.42);
}

.save-field {
  display: grid;
  gap: 8px;
  flex: 1;
}

.save-label {
  color: #94a3b8;
  font-size: 11px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.save-actions {
  display: flex;
  gap: 12px;
}

.save-select {
  min-width: 0;
  width: 100%;
  padding: 12px 14px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.88);
  color: #f8fafc;
  font: inherit;
}

.save-button {
  padding: 12px 16px;
  border: 1px solid rgba(245, 158, 11, 0.22);
  border-radius: 14px;
  background:
    linear-gradient(180deg, rgba(245, 158, 11, 0.18), rgba(245, 158, 11, 0.08)),
    rgba(15, 23, 42, 0.88);
  color: #fff7ea;
  font: inherit;
  cursor: pointer;
}

.save-button--ghost {
  border-color: rgba(148, 163, 184, 0.14);
  background: rgba(15, 23, 42, 0.72);
  color: #d6e0ec;
}

.frontend-mount {
  margin: 22px 0 0;
}

@media (max-width: 1080px) {
  .panel-header {
    grid-template-columns: 1fr;
  }

  .status-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .panel {
    padding: 18px;
  }

  .status-grid {
    grid-template-columns: 1fr;
  }

  .save-bar,
  .save-actions {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
