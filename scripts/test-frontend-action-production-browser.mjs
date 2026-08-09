import { join, resolve } from "node:path"
import {
  readRequestBytes,
  runInIsolatedBrowser,
  startStaticHarnessServer,
} from "./lib/headless-browser.mjs"

const root = resolve(import.meta.dirname, "..")
const webRoot = join(root, "apps", "platform-web")
const distRoot = join(webRoot, "dist-runtime-preflight")

function fail(message) {
  throw new Error(message)
}

async function serve() {
  let settleResult
  const result = new Promise((resolveResult) => { settleResult = resolveResult })
  const harnessServer = await startStaticHarnessServer({
    distRoot,
    handleRequest: async ({ request, response, url }) => {
      if (url.pathname === "/__preflight-result" && request.method === "POST") {
        const body = await readRequestBytes(request)
        settleResult(JSON.parse(body.toString("utf8")))
        response.writeHead(204).end()
        return true
      }
      return false
    },
  })
  return { ...harnessServer, result }
}

async function main() {
  const { close, result: browserResult, url } = await serve()
  try {
    const response = await fetch(url)
    if (!response.ok) {
      fail(`Browser harness returned HTTP ${response.status}.`)
    }
    const completed = await runInIsolatedBrowser({
      url,
      result: browserResult,
      profilePrefix: "tsian-frontend-action-preflight-",
      timeoutMs: 30_000,
      timeoutMessage: "Headless browser timed out during Frontend Action preflight.",
    })
    const { status, payload } = completed.result
    if (status !== "passed" || payload?.ok !== true) {
      fail(`Production browser preflight failed: ${JSON.stringify(payload)}`)
    }
    const result = payload.result
    const equipmentTransport = payload.equipmentTransport
    if (
      equipmentTransport?.equipmentDomainErrorTransported !== true
      || equipmentTransport?.equipmentBusinessFailureWrites !== 0
    ) {
      fail("Equipment Action domain error did not survive the production Worker transport without writes.")
    }
    if (payload.pageOriginStorage?.indexedDB !== true || payload.pageOriginStorage?.caches !== true) {
      fail("Preflight page did not seed platform-origin IndexedDB and Cache Storage sentinels.")
    }
    const requiredTrue = ["schemaCompiled", "validDataAccepted", "invalidDataRejected", "workerExecuted"]
    for (const key of requiredTrue) {
      if (result?.[key] !== true) fail(`Preflight result ${key} was not true.`)
    }
    if (result.workerOrigin !== "null") fail("Frontend Action Worker did not use an opaque origin.")
    for (const key of [
      "indexedDB",
      "caches",
      "workerConstructor",
      "sharedWorkerConstructor",
      "navigatorStorage",
      "navigatorServiceWorker",
    ]) {
      if (result[key] !== "undefined") fail(`Ambient capability ${key} remained available.`)
    }
    process.stdout.write(`Frontend Action production browser preflight passed with ${completed.browser}.\n`)
    process.stdout.write(`${JSON.stringify({ ...result, ...equipmentTransport })}\n`)
  } finally {
    await close()
  }
}

await main()
