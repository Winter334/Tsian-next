<template>
  <div class="relative min-h-dvh bg-void text-text-main">
    <div ref="frontendMount" class="min-h-dvh w-full"></div>

    <div
      v-if="status === 'resolving' || status === 'remote-loading' || status === 'packaged-loading'"
      class="absolute inset-0 grid place-items-center bg-void/90 px-6"
    >
      <p class="font-mono text-xs uppercase tracking-[0.22em] text-neon">
        {{ loadingLabel }}
      </p>
    </div>

    <div
      v-if="status === 'error'"
      class="absolute inset-0 grid place-items-center bg-void px-6"
      role="alert"
    >
      <section class="w-full max-w-xl border border-neon-muted/40 bg-panel/90 p-5">
        <p class="font-mono text-[11px] uppercase tracking-[0.22em] text-warning">
          {{ errorTitle }}
        </p>
        <p class="mt-3 text-sm leading-7 text-text-dim">
          {{ errorMessage }}
        </p>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { GameCardFrontendBinding } from "@tsian/contracts"
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import {
  mountRemoteIframeFrontend,
  resolveRemoteFrontendUrl,
} from "../bridge"
import { loadOfficialDefaultFrontend } from "../package-loader/official-default"
import { resolvePackagedFrontendUrl } from "../package-loader/packaged-frontend"
import {
  getPlatformActiveGameCard,
  playFrontendBridge,
  waitForPlatformHostReady,
} from "../platform-host"

type PlayFrontendStatus =
  | "resolving"
  | "builtin-ready"
  | "remote-loading"
  | "remote-ready"
  | "packaged-loading"
  | "packaged-ready"
  | "error"

const frontendMount = ref<HTMLElement | null>(null)
const status = ref<PlayFrontendStatus>("resolving")
const errorTitle = ref("")
const errorMessage = ref("")
const fallbackFrontend: GameCardFrontendBinding & { kind: "builtin" } = {
  kind: "builtin",
  id: "official-default",
}
const packagedFrontendSandbox = "allow-scripts allow-same-origin allow-forms"

let disposeFrontend: (() => void) | null = null
let isDisposed = false
let mountVersion = 0

const loadingLabel = computed(() =>
  status.value === "packaged-loading"
    ? "LOADING PACKAGED FRONTEND"
    : status.value === "remote-loading"
    ? "LOADING REMOTE FRONTEND"
    : "RESOLVING FRONTEND",
)

function unmountFrontend() {
  disposeFrontend?.()
  disposeFrontend = null
}

function setError(title: string, message: string) {
  unmountFrontend()
  status.value = "error"
  errorTitle.value = title
  errorMessage.value = message
}

function mountBuiltinFrontend(frontend: GameCardFrontendBinding & { kind: "builtin" }) {
  if (frontend.id !== "official-default") {
    setError(
      "UNSUPPORTED BUILTIN FRONTEND",
      `当前内置前端尚不支持：${frontend.id}`,
    )
    return
  }

  if (!frontendMount.value) {
    setError("FRONTEND MOUNT FAILED", "游戏前端挂载点不可用。")
    return
  }

  const builtinFrontend = loadOfficialDefaultFrontend()
  disposeFrontend = builtinFrontend.mount(frontendMount.value, playFrontendBridge)
  status.value = "builtin-ready"
}

function mountRemoteFrontend(
  frontend: GameCardFrontendBinding & { kind: "remote" },
  title: string | undefined,
  version: number,
) {
  const resolvedUrl = resolveRemoteFrontendUrl(frontend.url)
  if (!resolvedUrl.ok) {
    setError("REMOTE FRONTEND REJECTED", resolvedUrl.error.message)
    return
  }

  if (!frontendMount.value) {
    setError("FRONTEND MOUNT FAILED", "游戏前端挂载点不可用。")
    return
  }

  status.value = "remote-loading"
  disposeFrontend = mountRemoteIframeFrontend(frontendMount.value, {
    url: resolvedUrl.url,
    bridge: playFrontendBridge,
    title,
    onLoad() {
      if (!isDisposed && mountVersion === version) {
        status.value = "remote-ready"
      }
    },
    onError(message) {
      if (!isDisposed && mountVersion === version) {
        setError("REMOTE FRONTEND LOAD FAILED", message)
      }
    },
  })
}

async function mountPackagedFrontend(
  frontend: GameCardFrontendBinding & { kind: "packaged" },
  cardId: string,
  title: string | undefined,
  version: number,
) {
  if (!frontendMount.value) {
    setError("FRONTEND MOUNT FAILED", "游戏前端挂载点不可用。")
    return
  }

  status.value = "packaged-loading"
  const url = await resolvePackagedFrontendUrl({
    gameCardId: cardId,
    entry: frontend.entry,
  })
  if (isDisposed || mountVersion !== version || !frontendMount.value) {
    return
  }

  disposeFrontend = mountRemoteIframeFrontend(frontendMount.value, {
    url,
    bridge: playFrontendBridge,
    // Service Worker-backed virtual URLs need a same-origin controlled iframe client.
    sandbox: packagedFrontendSandbox,
    title,
    onLoad() {
      if (!isDisposed && mountVersion === version) {
        status.value = "packaged-ready"
      }
    },
    onError(message) {
      if (!isDisposed && mountVersion === version) {
        setError("PACKAGED FRONTEND LOAD FAILED", message)
      }
    },
  })
}

async function mountActiveFrontend() {
  const version = ++mountVersion
  unmountFrontend()
  status.value = "resolving"
  errorTitle.value = ""
  errorMessage.value = ""

  try {
    await waitForPlatformHostReady()
    if (isDisposed || mountVersion !== version) {
      return
    }

    const activeCard = await getPlatformActiveGameCard()
    if (isDisposed || mountVersion !== version) {
      return
    }

    const frontend = activeCard?.manifest.frontend ?? fallbackFrontend
    if (frontend.kind === "builtin") {
      mountBuiltinFrontend(frontend)
      return
    }

    if (frontend.kind === "remote") {
      mountRemoteFrontend(frontend, activeCard?.manifest.name, version)
      return
    }

    if (!activeCard) {
      mountBuiltinFrontend(fallbackFrontend)
      return
    }

    await mountPackagedFrontend(frontend, activeCard.id, activeCard.manifest.name, version)
  } catch (error) {
    if (!isDisposed && mountVersion === version) {
      setError(
        "FRONTEND RESOLUTION FAILED",
        error instanceof Error ? error.message : "解析游戏前端失败。",
      )
    }
  }
}

onMounted(() => {
  void mountActiveFrontend()
})

onBeforeUnmount(() => {
  isDisposed = true
  mountVersion += 1
  unmountFrontend()
})
</script>
