import { spawn, spawnSync } from "node:child_process"
import { createServer } from "node:http"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { extname, join, resolve, sep } from "node:path"
import process from "node:process"

const root = resolve(import.meta.dirname, "..")
const webRoot = join(root, "apps", "platform-web")
const distRoot = join(webRoot, "dist-runtime-preflight")
const cspPath = join(root, "apps", "platform-server", "internal", "server", "platform-web.csp")

function fail(message) {
  throw new Error(message)
}

function commandAvailable(command) {
  const probe = spawnSync(command, ["--version"], {
    stdio: "ignore",
    windowsHide: true,
  })
  return probe.status === 0
}

function browserCandidates() {
  if (process.env.TSIAN_BROWSER_PATH) return [process.env.TSIAN_BROWSER_PATH]
  if (process.platform === "win32") {
    return [
      join(process.env.PROGRAMFILES ?? "", "Google", "Chrome", "Application", "chrome.exe"),
      join(process.env["PROGRAMFILES(X86)"] ?? "", "Google", "Chrome", "Application", "chrome.exe"),
      join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
      join(process.env.PROGRAMFILES ?? "", "Microsoft", "Edge", "Application", "msedge.exe"),
      join(process.env["PROGRAMFILES(X86)"] ?? "", "Microsoft", "Edge", "Application", "msedge.exe"),
    ]
  }
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ]
  }
  return ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"]
}

async function findBrowser() {
  for (const candidate of browserCandidates()) {
    if (!candidate) continue
    if (candidate.includes(sep)) {
      try {
        if ((await stat(candidate)).isFile()) return candidate
      } catch {}
    } else if (commandAvailable(candidate)) {
      return candidate
    }
  }
  fail("Chrome, Edge, or Chromium was not found. Set TSIAN_BROWSER_PATH to the browser executable.")
}

function contentType(pathname) {
  switch (extname(pathname)) {
    case ".html": return "text/html; charset=utf-8"
    case ".js": return "text/javascript; charset=utf-8"
    case ".css": return "text/css; charset=utf-8"
    case ".json": return "application/json; charset=utf-8"
    default: return "application/octet-stream"
  }
}

async function serve(csp) {
  let settleResult
  const result = new Promise((resolveResult) => { settleResult = resolveResult })
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1")
      if (url.pathname === "/__preflight-result" && request.method === "POST") {
        let body = ""
        request.setEncoding("utf8")
        for await (const chunk of request) body += chunk
        settleResult(JSON.parse(body))
        response.writeHead(204, { "Content-Security-Policy": csp }).end()
        return
      }
      const relativePath = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1))
      const absolutePath = resolve(distRoot, relativePath)
      if (absolutePath !== distRoot && !absolutePath.startsWith(`${distRoot}${sep}`)) {
        response.writeHead(404).end()
        return
      }
      const content = await readFile(absolutePath)
      response.writeHead(200, {
        "Content-Type": contentType(absolutePath),
        "Content-Security-Policy": csp,
        "Cache-Control": "no-store",
      })
      response.end(content)
    } catch {
      response.writeHead(404).end()
    }
  })
  await new Promise((resolveListen, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === "string") fail("Could not determine preflight server address.")
  return { server, result, url: `http://127.0.0.1:${address.port}/` }
}

function launchBrowser(browser, url, profile) {
  const child = spawn(browser, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    `--user-data-dir=${profile}`,
    url,
  ], {
    windowsHide: true,
    stdio: ["ignore", "ignore", "pipe"],
  })
  let stderr = ""
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk) => { stderr += chunk })
  return {
    child,
    exited: new Promise((resolveExit, rejectExit) => {
      child.once("error", rejectExit)
      child.once("close", (code) => resolveExit({ code, stderr }))
    }),
  }
}

async function main() {
  const csp = (await readFile(cspPath, "utf8")).trim()
  if (!csp.includes("script-src 'self' 'unsafe-eval'")) {
    fail("Production CSP must permit Ajv and Action dynamic function compilation.")
  }
  if (!/worker-src[^;]*\bdata:/.test(csp)) {
    fail("Production CSP must permit opaque-origin data: Frontend Action Workers.")
  }

  const browser = await findBrowser()
  const profile = await mkdtemp(join(tmpdir(), "tsian-frontend-action-preflight-"))
  const { server, result: browserResult, url } = await serve(csp)
  let launched
  try {
    const response = await fetch(url)
    if (response.headers.get("content-security-policy") !== csp) {
      fail("Browser harness CSP differs from the canonical production CSP.")
    }
    launched = launchBrowser(browser, url, profile)
    let timeoutId
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("Headless browser timed out during Frontend Action preflight.")), 30_000)
    })
    let completed
    try {
      completed = await Promise.race([
        browserResult.then((value) => ({ kind: "result", value })),
        launched.exited.then((value) => ({ kind: "exit", value })),
        timeout,
      ])
    } finally {
      clearTimeout(timeoutId)
    }
    if (completed.kind === "exit") {
      fail(`Headless browser exited before reporting preflight result (code ${completed.value.code}).\n${completed.value.stderr}`)
    }
    const { status, payload } = completed.value
    if (status !== "passed" || payload?.ok !== true) {
      fail(`Production browser preflight failed: ${JSON.stringify(payload)}`)
    }
    const result = payload.result
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
    process.stdout.write(`Frontend Action production browser preflight passed with ${browser}.\n`)
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } finally {
    launched?.child.kill()
    await new Promise((resolveClose) => server.close(resolveClose))
    await rm(profile, { recursive: true, force: true })
  }
}

await main()
