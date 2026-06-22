// DB 名须与 src/storage/db.ts 的 TsianLocalDb 构造参数保持一致。
// v7 -> v8: mediaType removed from records; Content-Type now read from
// Blob.type (file.data.type) instead of a stored mediaType field.
const DB_NAME = "tsian-agent-runtime-v8"
const STORE_NAME = "gameCardFrontendFiles"
const FRONTEND_PREFIX = "/__tsian_game_card_frontends/"

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

function readFrontendFile(gameCardId, path) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly")
    tx.onerror = () => {
      db.close()
      reject(tx.error)
    }
    tx.oncomplete = () => db.close()
    const request = tx.objectStore(STORE_NAME).get(`${gameCardId}::${path}`)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result || null)
  }))
}

function parseFrontendRequest(url) {
  if (!url.pathname.startsWith(FRONTEND_PREFIX)) {
    return null
  }

  const rest = url.pathname.slice(FRONTEND_PREFIX.length)
  const slashIndex = rest.indexOf("/")
  if (slashIndex <= 0 || slashIndex === rest.length - 1) {
    return null
  }

  return {
    gameCardId: decodeURIComponent(rest.slice(0, slashIndex)),
    path: rest
      .slice(slashIndex + 1)
      .split("/")
      .map((part) => decodeURIComponent(part))
      .join("/"),
  }
}

async function serveFrontendFile(request) {
  const parsed = parseFrontendRequest(new URL(request.url))
  if (!parsed) {
    return new Response("Not found", { status: 404 })
  }

  const file = await readFrontendFile(parsed.gameCardId, parsed.path)
  if (!file) {
    return new Response("Not found", { status: 404 })
  }

  return new Response(file.data, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      "Content-Length": String(file.size),
      // mediaType is no longer stored; read the Blob's built-in type.
      "Content-Type": (file.data && file.data.type) || "application/octet-stream",
    },
  })
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url)
  if (!url.pathname.startsWith(FRONTEND_PREFIX)) {
    return
  }

  event.respondWith(serveFrontendFile(event.request))
})
