<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue"
import LabSurface from "./LabSurface.vue"
import {
  INITIAL_LAB_SNAPSHOT,
  SpatialLabController,
  type SpatialLabSnapshot,
} from "./spatial-lab-controller"

const canvasRef = ref<HTMLCanvasElement | null>(null)
const inputPlaneRef = ref<HTMLElement | null>(null)
const diagnosticsRef = ref<HTMLElement | null>(null)
const diagnosticsOpen = ref(
  new URLSearchParams(window.location.search).get("spatialDiagnostics") === "1",
)
const snapshot = ref<SpatialLabSnapshot>(INITIAL_LAB_SNAPSHOT)
const enabledSources = reactive({ left: true, center: true, right: true })
const controlResults = reactive<Record<string, string>>({})
let controller: SpatialLabController | null = null

function handleDiagnosticsShortcut(event: KeyboardEvent): void {
  if (!event.ctrlKey || !event.shiftKey || event.key.toLowerCase() !== "d") return
  event.preventDefault()
  diagnosticsOpen.value = !diagnosticsOpen.value
}

const surfaces = computed(() => [
  { sourceId: "left" as const, title: "Peripheral Array", zIndex: 12 },
  { sourceId: "center" as const, title: "Command Matrix", zIndex: 30 },
  { sourceId: "right" as const, title: "Telemetry Wing", zIndex: 12 },
].filter((surface) => enabledSources[surface.sourceId]))

const controlMatrix = [
  "hover", "active", "button", "link", "double-click", "text-input", "textarea", "checkbox", "radio",
  "range", "select", "native-select", "file", "contenteditable", "ime", "contextmenu", "scroll",
  "drag", "resize", "z-order", "caret", "native-picker", "focus-visible",
  "keyboard-tab", "keyboard-enter", "keyboard-space", "keyboard-escape", "texture",
]

function formatPoint(point: { x: number; y: number } | null): string {
  return point ? `${point.x.toFixed(2)}, ${point.y.toFixed(2)}` : "—"
}

function recordProbe(sourceId: string, key: string, detail: string): void {
  controlResults[`${sourceId}:${key}`] = detail || "event observed"
  controller?.requestSourcePaint(sourceId)
}

async function toggleSource(sourceId: keyof typeof enabledSources): Promise<void> {
  enabledSources[sourceId] = !enabledSources[sourceId]
  await nextTick()
  controller?.syncSources()
}

onMounted(() => {
  if (!canvasRef.value || !inputPlaneRef.value || !diagnosticsRef.value) return
  controller = new SpatialLabController({
    canvas: canvasRef.value,
    inputPlane: inputPlaneRef.value,
    diagnostics: diagnosticsRef.value,
    onSnapshot: (next) => { snapshot.value = next },
    onControlResult: (key, detail) => { controlResults[key] = detail },
  })
  controller.start()
  window.addEventListener("keydown", handleDiagnosticsShortcut)
})

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleDiagnosticsShortcut)
  controller?.dispose()
  controller = null
})

watch(() => snapshot.value.status, (status) => {
  if (status === "unsupported" || status === "error") diagnosticsOpen.value = true
})
</script>

<template>
  <main class="spatial-lab-root">
    <section class="spatial-lab-stage" aria-label="Spatial HTML-in-Canvas interaction laboratory">
      <canvas
        ref="canvasRef"
        class="spatial-canvas"
        layoutsubtree
        aria-label="Curved spatial rendering of the live semantic controls below"
      >
        <LabSurface
          v-for="surface in surfaces"
          :key="surface.sourceId"
          :source-id="surface.sourceId"
          :title="surface.title"
          :z-index="surface.zIndex"
          @probe="recordProbe"
        />
      </canvas>
      <div
        ref="inputPlaneRef"
        class="spatial-input-plane"
        data-spatial-ignore
        aria-hidden="true"
      />
      <div class="spatial-stage-label" data-spatial-ignore aria-hidden="true">
        <span>SPATIAL FOUNDATION</span>
        <span>HTML SIGNAL / LIVE</span>
      </div>
    </section>

    <aside
      id="spatial-lab-diagnostics"
      ref="diagnosticsRef"
      class="spatial-lab-diagnostics"
      :class="{ 'spatial-lab-diagnostics--open': diagnosticsOpen }"
      :aria-hidden="!diagnosticsOpen"
      :inert="!diagnosticsOpen"
      data-spatial-ignore
      @keydown.esc="diagnosticsOpen = false"
    >
      <header>
        <p>Tsian / local development probe</p>
        <h1>Spatial Foundation</h1>
        <span class="lab-status" :data-status="snapshot.status">{{ snapshot.status }}</span>
      </header>

      <section class="diagnostic-block">
        <h2>Capability</h2>
        <p>{{ snapshot.supportMessage }}</p>
        <dl>
          <div><dt>API variant</dt><dd>{{ snapshot.apiVariant }}</dd></div>
          <div><dt>Context variant</dt><dd>{{ snapshot.contextVariant }}</dd></div>
          <div><dt>Reduced motion</dt><dd>{{ snapshot.reducedMotion }}</dd></div>
          <div><dt>Context loss</dt><dd>{{ snapshot.contextLossProbe }}</dd></div>
          <div><dt>Native escape</dt><dd>{{ snapshot.lastNativeEscape }}</dd></div>
          <div><dt>Synthetic delivery</dt><dd>{{ snapshot.lastSyntheticDelivery }}</dd></div>
          <div><dt>Native outcome</dt><dd>{{ snapshot.lastNativeOutcome }}</dd></div>
        </dl>
      </section>

      <section class="diagnostic-block">
        <h2>Mapped pointer</h2>
        <dl>
          <div><dt>trusted</dt><dd>{{ formatPoint(snapshot.pointer.trusted) }}</dd></div>
          <div><dt>curved NDC</dt><dd>{{ formatPoint(snapshot.pointer.curved) }}</dd></div>
          <div><dt>planar client</dt><dd>{{ formatPoint(snapshot.pointer.planar) }}</dd></div>
          <div><dt>source</dt><dd>{{ snapshot.pointer.sourceId ?? "—" }}</dd></div>
          <div><dt>target</dt><dd>{{ snapshot.pointer.targetId ?? "—" }}</dd></div>
          <div><dt>resolution</dt><dd>{{ snapshot.pointer.status }}</dd></div>
        </dl>
      </section>

      <section class="diagnostic-block">
        <h2>Idle / resources</h2>
        <dl>
          <div><dt>frames</dt><dd>{{ snapshot.metrics.frameCount }}</dd></div>
          <div><dt>frame ms</dt><dd>{{ snapshot.metrics.lastFrameTimeMs.toFixed(2) }}</dd></div>
          <div><dt>uploads</dt><dd>{{ snapshot.metrics.uploadCount }}</dd></div>
          <div><dt>upload bytes</dt><dd>{{ snapshot.metrics.uploadedBytesEstimate }}</dd></div>
          <div><dt>textures</dt><dd>{{ snapshot.metrics.textureCount }}</dd></div>
          <div><dt>disposals</dt><dd>{{ snapshot.metrics.disposalCount }}</dd></div>
          <div><dt>display DPR</dt><dd>{{ snapshot.metrics.displayDpr.toFixed(2) }}</dd></div>
          <div><dt>raster scale</dt><dd>{{ snapshot.metrics.internalRasterScale.toFixed(2) }}</dd></div>
          <div><dt>reasons</dt><dd>{{ snapshot.metrics.activeReasons.join(", ") || "idle" }}</dd></div>
          <div><dt>stable</dt><dd>{{ snapshot.idleStableMs }} ms</dd></div>
        </dl>
        <p v-if="snapshot.metrics.lastFailure" class="diagnostic-error">{{ snapshot.metrics.lastFailure }}</p>
      </section>

      <section class="diagnostic-block lab-actions">
        <h2>Lifecycle probes</h2>
        <div>
          <button type="button" @click="controller?.triggerTransition()">RGB transition</button>
          <button type="button" @click="controller?.triggerContextLoss()">Lose / restore GL</button>
          <button type="button" @click="controller?.setReducedMotionOverride(true)">Force reduced</button>
          <button type="button" @click="controller?.setReducedMotionOverride(null)">Use system motion</button>
          <button type="button" @click="controller?.resetParallax()">Reset parallax</button>
        </div>
        <div>
          <button type="button" @click="controller?.releaseSource('center')">Release center texture</button>
          <button type="button" @click="controller?.restoreSource('center')">Recapture center</button>
        </div>
        <div>
          <button v-for="sourceId in (['left', 'center', 'right'] as const)" :key="sourceId" type="button" @click="toggleSource(sourceId)">
            {{ enabledSources[sourceId] ? `Remove ${sourceId}` : `Add ${sourceId}` }}
          </button>
        </div>
      </section>

      <section class="diagnostic-block control-matrix">
        <h2>Control matrix</h2>
        <div v-for="sourceId in (['left', 'center', 'right'] as const)" :key="sourceId" class="matrix-source">
          <h3>{{ sourceId }}</h3>
          <p v-for="key in controlMatrix" :key="key">
            <span>{{ key }}</span>
            <output :class="{ 'matrix-pending': !controlResults[`${sourceId}:${key}`] }">
              {{ controlResults[`${sourceId}:${key}`] ?? "not yet verified" }}
            </output>
          </p>
        </div>
      </section>

      <footer>
        Ctrl+Shift+D toggles this drawer; ?spatialDiagnostics=1 opens it on load. Browser-only
        gates remain explicit: paint timing, edge hit accuracy, native popup, IME, focus capture,
        DPR resize, and context restoration must be observed here.
      </footer>
    </aside>
  </main>
</template>
