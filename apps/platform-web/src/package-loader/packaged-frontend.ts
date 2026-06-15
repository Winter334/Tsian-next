import { readLocalGameCardFrontendFile } from "../storage"

const FRONTEND_ROUTE_PREFIX = "/__tsian_game_card_frontends"
const SERVICE_WORKER_PATH = "/tsian-game-card-frontend-sw.js"

function encodePath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/")
}

function waitForController(): Promise<void> {
  if (navigator.serviceWorker.controller) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange)
      reject(new Error("Packaged frontend service worker did not take control."))
    }, 3000)

    function onControllerChange() {
      window.clearTimeout(timeout)
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange)
      resolve()
    }

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange)
  })
}

export async function resolvePackagedFrontendUrl(input: {
  gameCardId: string
  entry: string
}): Promise<string> {
  if (!("serviceWorker" in navigator)) {
    throw new Error("当前浏览器不支持 packaged frontend 所需的 Service Worker。")
  }

  const entryFile = await readLocalGameCardFrontendFile(input.gameCardId, input.entry)
  if (!entryFile) {
    throw new Error(`Packaged frontend entry 不存在：${input.entry}`)
  }

  await navigator.serviceWorker.register(SERVICE_WORKER_PATH, { scope: "/" })
  await navigator.serviceWorker.ready
  if (navigator.serviceWorker.controller) {
    return `${window.location.origin}${FRONTEND_ROUTE_PREFIX}/${encodeURIComponent(input.gameCardId)}/${encodePath(input.entry)}`
  }
  await waitForController()

  const encodedCardId = encodeURIComponent(input.gameCardId)
  const encodedEntry = encodePath(input.entry)
  return `${window.location.origin}${FRONTEND_ROUTE_PREFIX}/${encodedCardId}/${encodedEntry}`
}
