import { ensureFrontendActionRuntimeReady } from "../src/platform-host/frontend-actions/preflight"

const resultElement = document.querySelector<HTMLPreElement>("#result")
if (!resultElement) throw new Error("Preflight result element is missing.")

function publishResult(status: "passed" | "failed", payload: unknown): void {
  resultElement.dataset.status = status
  resultElement.textContent = JSON.stringify(payload)
  void fetch("/__preflight-result", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, payload }),
  })
}

async function seedPlatformOriginStorage(): Promise<{ indexedDB: true; caches: true }> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("tsian-frontend-action-preflight", 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore("sentinel").put("platform-origin", "value")
    }
    request.onerror = () => reject(request.error ?? new Error("Could not seed platform-origin IndexedDB."))
    request.onsuccess = () => {
      request.result.close()
      resolve()
    }
  })
  const cache = await caches.open("tsian-frontend-action-preflight")
  await cache.put("/__platform-origin-storage-sentinel", new Response("platform-origin"))
  return { indexedDB: true, caches: true }
}

async function run(): Promise<void> {
  try {
    const pageOriginStorage = await seedPlatformOriginStorage()
    const result = await ensureFrontendActionRuntimeReady()
    publishResult("passed", { ok: true, pageOriginStorage, result })
  } catch (error) {
    publishResult("failed", {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

void run()
