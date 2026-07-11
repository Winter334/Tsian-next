import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { zipSync, strToU8 } from "fflate"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, "../../../../..")
const outputPath = join(repoRoot, "tmp/final-builder-integration.tsian-frontend.zip")

const files = new Map()

function addText(path, content, mediaType = mediaTypeFor(path)) {
  const normalized = content.endsWith("\n") ? content : `${content}\n`
  files.set(path, { data: strToU8(normalized), mediaType })
}

function addBinary(path, bytes, mediaType = mediaTypeFor(path)) {
  files.set(path, { data: bytes, mediaType })
}

function mediaTypeFor(path) {
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "text/typescript"
  if (path.endsWith(".js") || path.endsWith(".mjs")) return "text/javascript"
  if (path.endsWith(".vue")) return "text/x-vue"
  if (path.endsWith(".css")) return "text/css"
  if (path.endsWith(".scss")) return "text/x-scss"
  if (path.endsWith(".less")) return "text/x-less"
  if (path.endsWith(".json")) return "application/json"
  if (path.endsWith(".svg")) return "image/svg+xml"
  if (path.endsWith(".txt")) return "text/plain"
  return "application/octet-stream"
}

addText("src/main.ts", `
import { createApp } from "vue"
import App from "./App.vue"
import "./styles/theme.scss"
import "./styles/less-demo.less"

createApp(App).mount("#app")
`)

addText("src/App.module.css", `
.shell {
  border: 2px solid #43d9ad;
  border-radius: 16px;
  padding: 16px;
  background: rgba(20, 17, 13, 0.95);
}
.moduleMarker {
  color: #43d9ad;
  font-weight: 700;
}
`)

addText("src/App.vue", `
<script setup lang="ts">
import { computed, ref } from "vue"
import WorkerPanel from "@/components/WorkerPanel.vue"
import GlobPanel from "@/components/GlobPanel.vue"
import StylePanel from "@/components/StylePanel.vue"
import styles from "./App.module.css"
import badgeUrl from "@/assets/badge.svg?url"

const ready = ref(true)
const fixtureSummary = computed(() => ready.value ? "builder-final-fixture-ready" : "pending")
</script>

<template>
  <main :class="styles.shell" data-fixture-root="builder-final">
    <h1>Builder Final Integration Fixture</h1>
    <p :class="styles.moduleMarker" data-css-module="active">{{ fixtureSummary }}</p>
    <img class="badge" :src="badgeUrl" alt="fixture badge" data-asset="badge" />
    <StylePanel />
    <GlobPanel />
    <WorkerPanel />
  </main>
</template>

<style scoped lang="scss">
@use "./styles/variables" as *;

h1 {
  color: $accent;
}

.badge {
  width: 48px;
  height: 48px;
  background: url("./assets/badge.svg") center / contain no-repeat;
}
</style>
`)

addText("src/components/StylePanel.vue", `
<script setup lang="ts">
const styleMarker = "sass-less-vue-style-ok"
</script>

<template>
  <section class="style-panel" data-style-panel="ok">
    <p>{{ styleMarker }}</p>
    <p class="less-chip">less-chip</p>
  </section>
</template>

<style scoped lang="less">
@import "../styles/tokens.less";
.style-panel {
  border-left: 4px solid @lessAccent;
  padding-left: 8px;
}
.less-chip {
  color: @lessAccent;
}
</style>
`)

addText("src/components/GlobPanel.vue", `
<script setup lang="ts">
const lazyPages = import.meta.glob("../pages/*.ts")
const eagerNested = import.meta.glob("@/pages/nested/*.ts", { eager: true })
const emptyMatch = import.meta.glob("../pages/empty/*.ts")

const lazyKeys = Object.keys(lazyPages).sort()
const eagerKeys = Object.keys(eagerNested).sort()
const emptyCount = Object.keys(emptyMatch).length
</script>

<template>
  <section data-glob-panel="ok">
    <p data-glob-lazy>{{ lazyKeys.join("|") }}</p>
    <p data-glob-eager>{{ eagerKeys.join("|") }}</p>
    <p data-glob-empty>{{ emptyCount }}</p>
  </section>
</template>
`)

addText("src/components/WorkerPanel.vue", `
<script setup lang="ts">
import { onMounted, ref } from "vue"
import CalcWorker from "@/workers/calc.worker.ts?worker"

const status = ref("pending")
const result = ref("pending")
const jobs = ref("pending")
const asset = ref("pending")

onMounted(() => {
  const worker = new CalcWorker({ name: "builder-final-calc" })
  const timeout = window.setTimeout(() => {
    status.value = "timeout"
    worker.terminate()
  }, 5000)

  worker.onmessage = (event: MessageEvent<{ result: number; jobs: string[]; iconUrl: string; templateLength: number }>) => {
    window.clearTimeout(timeout)
    status.value = "ok"
    result.value = String(event.data.result)
    jobs.value = event.data.jobs.sort().join("|")
    asset.value = event.data.iconUrl.includes("assets/") ? "asset-url" : event.data.iconUrl
    document.body.dataset.workerResult = result.value
    document.body.dataset.workerJobs = jobs.value
    worker.terminate()
  }

  worker.onerror = () => {
    window.clearTimeout(timeout)
    status.value = "error"
    worker.terminate()
  }

  worker.postMessage({ op: "add", a: 2, b: 3 })
})
</script>

<template>
  <section data-worker-panel="ok">
    <p data-worker-status>{{ status }}</p>
    <p data-worker-result>{{ result }}</p>
    <p data-worker-jobs>{{ jobs }}</p>
    <p data-worker-asset>{{ asset }}</p>
  </section>
</template>
`)

addText("src/pages/alpha.ts", `
export const page = "alpha"
`)

addText("src/pages/beta.ts", `
export const page = "beta"
`)

addText("src/pages/nested/gamma.ts", `
export const page = "gamma"
`)

addText("src/workers/calc-helper.ts", `
export function add(a: number, b: number): number {
  return a + b
}
`)

addText("src/workers/jobs/add.ts", `
export const job = "add"
`)

addText("src/workers/jobs/multiply.ts", `
export const job = "multiply"
`)

addText("src/workers/calc.worker.ts", `
import { add } from "./calc-helper"
import payload from "./payload.json"
import template from "@/assets/worker-template.txt?raw"
import iconUrl from "@/assets/badge.svg?url"

const jobModules = import.meta.glob("./jobs/*.ts")

self.onmessage = async (event: MessageEvent<{ op: string; a: number; b: number }>) => {
  const bonus = typeof payload.bonus === "number" ? payload.bonus : 0
  const result = add(event.data.a, event.data.b) + bonus - template.length + template.length
  const dynamic = await import("./jobs/add")
  self.postMessage({
    result,
    jobs: [...Object.keys(jobModules), dynamic.job],
    iconUrl,
    templateLength: template.length,
  })
}
`)

addText("src/workers/payload.json", `
{
  "bonus": 7
}
`, "application/json")

addText("src/styles/_variables.scss", `
$accent: #43d9ad;
$surface: #14110d;
`)

addText("src/styles/theme.scss", `
@use "./variables" as *;

body {
  margin: 0;
  color: $accent;
  background: $surface;
}

.theme-marker {
  color: $accent;
}
`)

addText("src/styles/tokens.less", `
@lessAccent: #d4a24c;
`)

addText("src/styles/less-demo.less", `
@import "./tokens.less";

body::after {
  content: "less-global-ok";
  color: @lessAccent;
  display: none;
}
`)

addText("src/assets/worker-template.txt", "worker-template-ok")

addText("src/assets/badge.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#14110d"/>
  <circle cx="32" cy="32" r="20" fill="#43d9ad"/>
  <path d="M20 34l8 8 17-21" fill="none" stroke="#14110d" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`, "image/svg+xml")

const manifest = {
  schema: "tsian.frontend-package.v1",
  entry: "dist/index.html",
  framework: "vue",
  bridgeVersion: "tsian.play-bridge.v1",
  files: [...files.entries()].map(([path, file]) => ({
    path,
    mediaType: file.mediaType,
    size: file.data.byteLength,
  })),
  exportedAt: new Date("2026-07-11T00:00:00.000Z").toISOString(),
  exporter: {
    name: "trellis-final-integration-fixture",
    version: "0.1.0",
  },
}

const zipInput = {
  "frontend.json": strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
}
for (const [path, file] of files.entries()) {
  zipInput[path] = file.data
}

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, zipSync(zipInput, { level: 6 }))
console.log(outputPath)
